#!/usr/bin/env python3
"""Validate an OpenCut AI edit-decision package.

This intentionally avoids third-party dependencies so it can run in a fresh
checkout. It performs structural checks that matter before an agent hands an
edit plan to OpenCut, a future MCP adapter, or a rough ffmpeg preview.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

EXPECTED_SCHEMA_VERSION = "opencut.ai-edit-decision.v1"


class ValidationIssue(str):
    """String subclass used only to make return types self-documenting."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}: invalid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: top-level JSON value must be an object")
    return payload


def require_object(value: Any, label: str, errors: list[ValidationIssue]) -> dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(ValidationIssue(f"{label} must be an object"))
        return {}
    return value


def require_array(value: Any, label: str, errors: list[ValidationIssue]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(ValidationIssue(f"{label} must be an array"))
        return []
    return value


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def inventory_assets(inventory: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not inventory:
        return {}
    assets = inventory.get("assets", [])
    if not isinstance(assets, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for item in assets:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            result[item["path"]] = item
    return result


def validate_edit_decision(
    plan: dict[str, Any],
    inventory: dict[str, Any] | None = None,
    *,
    duration_tolerance: float = 0.10,
) -> tuple[list[ValidationIssue], list[ValidationIssue]]:
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    if plan.get("schema_version") != EXPECTED_SCHEMA_VERSION:
        errors.append(
            ValidationIssue(
                f"schema_version must be {EXPECTED_SCHEMA_VERSION!r}, got {plan.get('schema_version')!r}"
            )
        )

    project = require_object(plan.get("project"), "project", errors)
    timeline = require_object(plan.get("timeline"), "timeline", errors)
    assets = require_array(plan.get("assets"), "assets", errors)

    target_duration = number(project.get("target_duration_seconds"))
    if target_duration is None or target_duration <= 0:
        errors.append(ValidationIssue("project.target_duration_seconds must be a positive number"))

    timeline_duration = number(timeline.get("duration_seconds"))
    if timeline_duration is None or timeline_duration <= 0:
        errors.append(ValidationIssue("timeline.duration_seconds must be a positive number"))
    elif target_duration:
        tolerance = max(target_duration * duration_tolerance, 0.25)
        if abs(timeline_duration - target_duration) > tolerance:
            warnings.append(
                ValidationIssue(
                    "timeline.duration_seconds differs from project.target_duration_seconds "
                    f"by more than {duration_tolerance:.0%}: {timeline_duration} vs {target_duration}"
                )
            )

    plan_assets: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(assets):
        if not isinstance(item, dict):
            errors.append(ValidationIssue(f"assets[{index}] must be an object"))
            continue
        path = item.get("path")
        asset_type = item.get("type")
        if not isinstance(path, str) or not path:
            errors.append(ValidationIssue(f"assets[{index}].path must be a non-empty string"))
            continue
        if path in plan_assets:
            errors.append(ValidationIssue(f"duplicate asset path: {path}"))
        plan_assets[path] = item
        if asset_type not in {"video", "image", "audio", "subtitle", "generated"}:
            errors.append(ValidationIssue(f"assets[{index}].type has unsupported value: {asset_type!r}"))

    inv_assets = inventory_assets(inventory)
    if inventory is not None:
        for path, item in plan_assets.items():
            if item.get("type") == "generated":
                continue
            inv_item = inv_assets.get(path)
            if inv_item is None:
                errors.append(ValidationIssue(f"asset {path!r} is not present in media inventory"))
                continue
            if item.get("sha256") and inv_item.get("sha256") and item["sha256"] != inv_item["sha256"]:
                errors.append(ValidationIssue(f"asset {path!r} sha256 does not match media inventory"))

    tracks = require_array(timeline.get("tracks"), "timeline.tracks", errors)
    if not tracks:
        errors.append(ValidationIssue("timeline.tracks must contain at least one track"))

    for track_index, track in enumerate(tracks):
        if not isinstance(track, dict):
            errors.append(ValidationIssue(f"timeline.tracks[{track_index}] must be an object"))
            continue
        track_id = track.get("id", f"#{track_index}")
        items = require_array(track.get("items"), f"timeline.tracks[{track_index}].items", errors)
        previous_end = 0.0
        for item_index, item in enumerate(items):
            label = f"track {track_id!r} item[{item_index}]"
            if not isinstance(item, dict):
                errors.append(ValidationIssue(f"{label} must be an object"))
                continue
            asset_path = item.get("asset_path")
            if not isinstance(asset_path, str) or not asset_path:
                errors.append(ValidationIssue(f"{label}.asset_path must be a non-empty string"))
            elif asset_path not in plan_assets:
                errors.append(ValidationIssue(f"{label} references asset_path not listed in assets: {asset_path!r}"))

            start = number(item.get("start"))
            duration = number(item.get("duration"))
            if start is None or start < 0:
                errors.append(ValidationIssue(f"{label}.start must be a non-negative number"))
                start = previous_end
            if duration is None or duration <= 0:
                errors.append(ValidationIssue(f"{label}.duration must be a positive number"))
                duration = 0.0
            if start < previous_end and track.get("type") in {"video", "audio", "subtitle"}:
                warnings.append(ValidationIssue(f"{label} overlaps the previous item on the same track"))
            previous_end = max(previous_end, start + duration)

    subtitles = plan.get("subtitles", [])
    if subtitles:
        for index, subtitle in enumerate(require_array(subtitles, "subtitles", errors)):
            if not isinstance(subtitle, dict):
                errors.append(ValidationIssue(f"subtitles[{index}] must be an object"))
                continue
            subtitle_start = number(subtitle.get("start"))
            subtitle_duration = number(subtitle.get("duration"))
            if subtitle_start is None or subtitle_start < 0:
                errors.append(ValidationIssue(f"subtitles[{index}].start must be a non-negative number"))
            if subtitle_duration is None or subtitle_duration <= 0:
                errors.append(ValidationIssue(f"subtitles[{index}].duration must be a positive number"))
            if not isinstance(subtitle.get("text"), str) or not subtitle.get("text"):
                errors.append(ValidationIssue(f"subtitles[{index}].text must be a non-empty string"))

    return errors, warnings


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate an OpenCut AI edit-decision JSON file.")
    parser.add_argument("edit_decision", type=Path, help="Path to edit-decision.json")
    parser.add_argument("--inventory", type=Path, help="Path to media-inventory.json for source-asset checks")
    parser.add_argument(
        "--duration-tolerance",
        type=float,
        default=0.10,
        help="Allowed fractional duration drift before warning (default: 0.10)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        plan = load_json(args.edit_decision)
        inventory = load_json(args.inventory) if args.inventory else None
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    errors, warnings = validate_edit_decision(plan, inventory, duration_tolerance=args.duration_tolerance)
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if errors:
        print(f"FAIL: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"PASS: edit decision is structurally valid ({len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
