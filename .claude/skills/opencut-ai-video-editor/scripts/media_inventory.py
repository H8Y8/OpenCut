#!/usr/bin/env python3
"""Build a deterministic media inventory for OpenCut AI-editing workflows.

The script intentionally has no third-party dependencies. It scans a folder,
classifies common video/image/audio assets, computes hashes for identity and
(optional) ffprobe metadata when ffprobe is available.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "opencut.media-inventory.v1"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}
IGNORED_DIRS = {".git", "node_modules", "dist", ".moon", ".next"}


def classify(path: Path) -> str | None:
    extension = path.suffix.lower()
    if extension in VIDEO_EXTENSIONS:
        return "video"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in AUDIO_EXTENSIONS:
        return "audio"
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffprobe(path: Path) -> dict[str, Any] | None:
    if shutil.which("ffprobe") is None:
        return None
    command = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        return {"error": completed.stderr.strip() or "ffprobe failed"}
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        return {"error": f"invalid ffprobe JSON: {error}"}


def compact_probe(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    if "error" in raw:
        return {"error": raw["error"]}

    result: dict[str, Any] = {}
    format_data = raw.get("format") or {}
    if "duration" in format_data:
        try:
            result["duration_seconds"] = round(float(format_data["duration"]), 3)
        except (TypeError, ValueError):
            pass
    if "bit_rate" in format_data:
        try:
            result["bit_rate"] = int(format_data["bit_rate"])
        except (TypeError, ValueError):
            pass

    streams = []
    for stream in raw.get("streams") or []:
        item = {"codec_type": stream.get("codec_type"), "codec_name": stream.get("codec_name")}
        if stream.get("width") is not None:
            item["width"] = stream.get("width")
        if stream.get("height") is not None:
            item["height"] = stream.get("height")
        if stream.get("r_frame_rate") not in (None, "0/0"):
            item["frame_rate"] = stream.get("r_frame_rate")
        streams.append({key: value for key, value in item.items() if value is not None})
    if streams:
        result["streams"] = streams
    return result


def iter_media_files(root: Path):
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix().lower()):
        if any(part in IGNORED_DIRS for part in path.relative_to(root).parts):
            continue
        if path.is_file() and classify(path) is not None:
            yield path


def build_inventory(root: Path, probe: bool = True) -> dict[str, Any]:
    root = root.resolve()
    if not root.exists():
        raise FileNotFoundError(f"media root does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"media root is not a directory: {root}")

    assets = []
    summary = {"video": 0, "image": 0, "audio": 0, "other": 0}
    for path in iter_media_files(root):
        asset_type = classify(path)
        if asset_type is None:
            summary["other"] += 1
            continue
        summary[asset_type] += 1
        asset: dict[str, Any] = {
            "path": path.relative_to(root).as_posix(),
            "type": asset_type,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        if probe:
            metadata = compact_probe(ffprobe(path))
            if metadata:
                asset["probe"] = metadata
        assets.append(asset)

    return {
        "schema_version": SCHEMA_VERSION,
        "root": root.as_posix(),
        "summary": summary,
        "assets": assets,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create an OpenCut AI-editing media inventory JSON file.")
    parser.add_argument("media_root", type=Path, help="Folder containing source videos, images, and audio files")
    parser.add_argument("-o", "--output", type=Path, help="Write JSON to this path instead of stdout")
    parser.add_argument("--no-probe", action="store_true", help="Skip ffprobe metadata collection")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    inventory = build_inventory(args.media_root, probe=not args.no_probe)
    payload = json.dumps(inventory, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
