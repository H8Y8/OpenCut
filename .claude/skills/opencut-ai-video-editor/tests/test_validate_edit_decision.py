import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate_edit_decision.py"


def load_module():
    spec = importlib.util.spec_from_file_location("validate_edit_decision", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def valid_plan():
    return {
        "schema_version": "opencut.ai-edit-decision.v1",
        "project": {
            "title": "Test edit",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 10,
            "language": "zh-TW",
        },
        "assets": [
            {
                "path": "clip.mp4",
                "type": "video",
                "sha256": "abc123",
            }
        ],
        "timeline": {
            "duration_seconds": 10,
            "tracks": [
                {
                    "id": "v1",
                    "type": "video",
                    "items": [
                        {
                            "id": "clip-1",
                            "asset_path": "clip.mp4",
                            "start": 0,
                            "duration": 10,
                            "rationale": "Primary clip for the requested story.",
                        }
                    ],
                }
            ],
        },
    }


class ValidateEditDecisionTests(unittest.TestCase):
    def test_valid_plan_with_matching_inventory_passes(self):
        module = load_module()
        inventory = {"assets": [{"path": "clip.mp4", "type": "video", "sha256": "abc123"}]}

        errors, warnings = module.validate_edit_decision(valid_plan(), inventory)

        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_timeline_item_must_reference_declared_asset(self):
        module = load_module()
        plan = valid_plan()
        plan["timeline"]["tracks"][0]["items"][0]["asset_path"] = "missing.mp4"

        errors, _warnings = module.validate_edit_decision(plan)

        self.assertTrue(any("asset_path not listed in assets" in error for error in errors))

    def test_inventory_mismatch_is_an_error_for_source_assets(self):
        module = load_module()
        inventory = {"assets": [{"path": "other.mp4", "type": "video", "sha256": "abc123"}]}

        errors, _warnings = module.validate_edit_decision(valid_plan(), inventory)

        self.assertTrue(any("not present in media inventory" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
