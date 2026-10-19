import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).with_name("import_golden_pdf_product_images.py")
spec = importlib.util.spec_from_file_location("product_image_import", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    products = [{"id": f"import-1791945562092-{i}", "name": f"placeholder-{i}", "images": []}
                for i in range(21)]
    images = {}
    for index, page, _, image_no, name in module.MATCHES:
        products[index]["name"] = name
        images[(page, image_no)] = f"image-{index}".encode()
    return {"products": {"items": products}, "factVersion": {"contentHash": module.BASE_FACT_HASH}}, images


class GoldenProductImageImportTests(unittest.TestCase):
    def test_manifest_is_exactly_thirteen_and_preserves_eight_unmatched(self):
        profile, images = fixture()
        before = copy.deepcopy(profile)
        result = module.manifest(profile, images)
        self.assertEqual(len(result["entries"]), 13)
        self.assertEqual(len(result["untouchedProductIds"]), 8)
        self.assertEqual(result["entries"][8]["productId"], "import-1791945562092-9")
        self.assertEqual((result["entries"][8]["pdfPage"], result["entries"][8]["pdfNumber"], result["entries"][8]["imageOnPage"]), (22, 28, 2))
        self.assertEqual(profile, before, "dry-run must not modify even an in-memory profile")

    def test_existing_other_product_image_refuses_overwrite(self):
        profile, images = fixture()
        profile["products"]["items"][9]["imageUrl"] = "/other-image.png"
        with self.assertRaisesRegex(ValueError, "binding_conflict"):
            module.manifest(profile, images)

    def test_apply_recovers_partial_upload_and_replay_skips_completed(self):
        profile, images = fixture()
        calls = {"post": 0, "patch": 0, "fail_once": True}

        def fake_api(_base, _token, method, route, body=None, if_match=""):
            if method == "GET":
                return copy.deepcopy(profile)
            if method == "POST":
                calls["post"] += 1
                if calls["fail_once"] and calls["post"] == 2:
                    calls["fail_once"] = False
                    raise RuntimeError("simulated upload interruption")
                product_id = body["productId"]
                return {"url": f"/api/overseas/enterprise/assets/{product_id}.png", "type": "image/jpeg", "size": 42, "material": {
                    "id": f"material-{product_id}", "sha256": "a" * 64}}
            if method == "PATCH":
                self.assertEqual(if_match, profile["factVersion"]["contentHash"])
                calls["patch"] += 1
                profile["products"]["items"] = copy.deepcopy(body["products"]["items"])
                profile["factVersion"]["contentHash"] = "updated-fact-hash"
                return {"ok": True}
            raise AssertionError((method, route))

        with tempfile.TemporaryDirectory() as temp, patch.object(module, "catalog_images", return_value=images), patch.object(module, "request_json", side_effect=fake_api), patch.object(module, "request_asset_sha", return_value="a" * 64):
            ledger = Path(temp) / "ledger.json"
            with self.assertRaisesRegex(RuntimeError, "simulated"):
                module.apply_import("http://127.0.0.1:8792", "fake-test-token", Path(temp) / "source.pdf", ledger)
            self.assertEqual(len(json.loads(ledger.read_text())["uploads"]), 1)
            result = module.apply_import("http://127.0.0.1:8792", "fake-test-token", Path(temp) / "source.pdf", ledger)
            self.assertTrue(all(entry["state"] == "already_bound" for entry in result["entries"]))
            self.assertEqual(calls["post"], 14, "one interrupted request, no repeat of recorded upload")
            self.assertEqual(calls["patch"], 1)
            module.apply_import("http://127.0.0.1:8792", "fake-test-token", Path(temp) / "source.pdf", ledger)
            self.assertEqual(calls["post"], 14)
            self.assertEqual(calls["patch"], 1)

    def test_apply_rejects_remote_endpoint(self):
        with self.assertRaisesRegex(ValueError, "only_local_test_server_allowed"):
            module.apply_import("https://example.com", "token", Path("missing.pdf"), Path("missing-ledger"))


if __name__ == "__main__":
    unittest.main()
