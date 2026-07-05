import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "media_inventory.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_inventory", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaInventoryTests(unittest.TestCase):
    def test_build_inventory_groups_media_files_and_ignores_non_media(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "b-roll").mkdir()
            (root / "clip.mp4").write_bytes(b"not a real video")
            (root / "b-roll" / "photo.JPG").write_bytes(b"not a real image")
            (root / "voice.wav").write_bytes(b"not a real audio")
            (root / "notes.txt").write_text("ignore me")

            inventory = module.build_inventory(root, probe=False)

        self.assertEqual(inventory["schema_version"], "opencut.media-inventory.v1")
        self.assertEqual(inventory["summary"], {"video": 1, "image": 1, "audio": 1, "other": 0})
        self.assertEqual(
            [(asset["type"], asset["path"]) for asset in inventory["assets"]],
            [
                ("image", "b-roll/photo.JPG"),
                ("video", "clip.mp4"),
                ("audio", "voice.wav"),
            ],
        )
        self.assertTrue(all("sha256" in asset for asset in inventory["assets"]))


if __name__ == "__main__":
    unittest.main()
