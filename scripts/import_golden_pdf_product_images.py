"""Conservative, resumable import of the user-confirmed GUIANFA catalog images.

Dry-run is the default and makes no writes. --apply is intentionally explicit:
it uses the authenticated Enterprise Center asset POST and version-checked
profile PATCH, never edits the local-store JSON directly.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from pypdf import PdfReader


PDF_SHA256 = "0bec39b5d64f9ac88df3435120f697d99986dd859a5988da7cfef100b0c79979"
TENANT_ID = "local_tenant_preview_beauty_showcase_local_test"
BASE_FACT_HASH = "b997acf1cfb9e7dbc55e84c82a38a01cef8d6baf166f7e9ee258d302cdf9cd52"
# (profile index, PDF page, numbered product, image ordinal on page, exact Chinese name)
MATCHES = (
    (0, 1, 1, 1, "云朵泡沫卸妆蜜"),
    (1, 3, 3, 1, "深海冰川舒缓喷雾"),
    (2, 4, 4, 1, "燕窝碎碎洁面凝露"),
    (3, 5, 5, 1, "冰沙面霜"),
    (4, 6, 6, 1, "蜜桃冰雪霜"),
    (5, 7, 7, 1, "童颜紧致胶原面膜"),
    (6, 8, 8, 1, "牛油果保湿修护面膜"),
    (8, 12, 12, 1, "维C奢养亮肤面膜"),
    (9, 22, 28, 2, "止汗净味狐臭喷雾"),
    (10, 23, 29, 1, "海洋酷爽爽身走珠液"),
    (11, 24, 30, 1, "花漾邂逅爽身走珠液"),
    (12, 25, 31, 1, "花漾柔肤香体膏"),
    (13, 26, 32, 1, "植萃清雅香体棒"),
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def profile_from_store(path: Path) -> dict:
    rows = json.loads(path.read_text())
    matches = [row for row in rows if row.get("tenant_id") == TENANT_ID]
    if len(matches) != 1:
        raise ValueError("golden_tenant_profile_missing_or_duplicate")
    return matches[0]["profile"]


def catalog_images(path: Path) -> dict[tuple[int, int], bytes]:
    if sha(path.read_bytes()) != PDF_SHA256:
        raise ValueError("source_pdf_hash_changed")
    reader = PdfReader(path)
    if len(reader.pages) != 34:
        raise ValueError("source_pdf_page_count_changed")
    result = {}
    for _, page_no, number, image_no, name in MATCHES:
        page = reader.pages[page_no - 1]
        text = "".join((page.extract_text() or "").split())
        if f"#{number}GUIANFA" not in text or name not in text:
            raise ValueError(f"pdf_product_evidence_changed:{number}")
        if image_no > len(page.images):
            raise ValueError(f"pdf_image_object_missing:{number}")
        result[(page_no, image_no)] = page.images[image_no - 1].data
    if len({sha(value) for value in result.values()}) != len(MATCHES):
        raise ValueError("pdf_image_hash_not_unique")
    return result


def bound_image(product: dict, image_sha: str) -> dict | None:
    for image in product.get("images") or []:
        if image.get("sourcePdfSha256") == PDF_SHA256 and image.get("sourcePdfImageSha256") == image_sha:
            return image
    return None


def manifest(profile: dict, images: dict[tuple[int, int], bytes]) -> dict:
    products = profile.get("products", {}).get("items", [])
    if len(products) != 21:
        raise ValueError("golden_product_count_changed")
    entries = []
    for index, page, number, image_no, name in MATCHES:
        product = products[index]
        expected_id = f"import-1791945562092-{index}"
        if product.get("id") != expected_id or name not in "".join(product.get("name", "").split()):
            raise ValueError(f"golden_product_identity_changed:{index + 1}")
        image_bytes = images[(page, image_no)]
        image_sha = sha(image_bytes)
        existing = bound_image(product, image_sha)
        if existing:
            if not existing.get("url") or product.get("imageUrl") not in (None, "", existing["url"]):
                raise ValueError(f"golden_product_binding_conflict:{expected_id}")
            state = "already_bound"
        elif product.get("imageUrl") or product.get("images"):
            raise ValueError(f"golden_product_binding_conflict:{expected_id}")
        else:
            state = "pending"
        entries.append({"productId": expected_id, "productIndex": index + 1, "productName": product["name"],
                        "pdfPage": page, "pdfNumber": number, "imageOnPage": image_no,
                        "sourcePdfSha256": PDF_SHA256, "sourcePdfImageSha256": image_sha,
                        "sourceImageBytes": len(image_bytes), "state": state})
    untouched = [products[i]["id"] for i in range(21) if i not in {row[0] for row in MATCHES}]
    return {"schema": "golden-pdf-product-image-import.v1", "tenantId": TENANT_ID,
            "sourcePdfSha256": PDF_SHA256, "baselineFactVersion": BASE_FACT_HASH,
            "currentFactVersion": profile.get("factVersion", {}).get("contentHash"),
            "entries": entries, "untouchedProductIds": untouched}


def request_json(base: str, token: str, method: str, route: str, body: dict | None = None,
                 if_match: str = "") -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if if_match:
        headers["If-Match"] = if_match
    req = Request(urljoin(base, route), data=payload, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"enterprise_api_{method}_{error.code}:{error.read(300)!r}") from error


def request_asset_sha(base: str, token: str, route: str) -> str:
    if not route.startswith("/api/overseas/enterprise/assets/"):
        raise ValueError("enterprise_asset_url_scope_invalid")
    request = Request(urljoin(base, route), headers={"Authorization": f"Bearer {token}"})
    with urlopen(request, timeout=30) as response:
        return sha(response.read(12 * 1024 * 1024))


def save_ledger(path: Path, ledger: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as output:
        os.chmod(temporary, 0o600)
        json.dump(ledger, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def apply_import(base: str, token: str, pdf: Path, ledger_file: Path) -> dict:
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("only_local_test_server_allowed")
    images = catalog_images(pdf)
    current = request_json(base, token, "GET", "/api/overseas/enterprise/profile")
    plan = manifest(current, images)
    if plan["currentFactVersion"] != BASE_FACT_HASH and not any(e["state"] == "already_bound" for e in plan["entries"]):
        raise ValueError("golden_fact_version_changed_without_import_provenance")
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else {"sourcePdfSha256": PDF_SHA256, "tenantId": TENANT_ID, "uploads": {}}
    if ledger.get("sourcePdfSha256") != PDF_SHA256 or ledger.get("tenantId") != TENANT_ID:
        raise ValueError("import_ledger_scope_mismatch")
    uploads = ledger["uploads"]
    for entry in plan["entries"]:
        if entry["state"] == "already_bound":
            continue
        key = entry["productId"]
        prior = uploads.get(key)
        if prior and prior.get("sourcePdfImageSha256") != entry["sourcePdfImageSha256"]:
            raise ValueError(f"import_ledger_image_conflict:{key}")
        if not prior:
            image = images[(entry["pdfPage"], entry["imageOnPage"])]
            uploaded = request_json(base, token, "POST", "/api/overseas/enterprise/assets",
                                    {"name": f"guianfa-pdf-{entry['pdfNumber']}.png", "type": "image/png",
                                     "productId": key, "dataUrl": "data:image/png;base64," + base64.b64encode(image).decode()})
            url = uploaded.get("url", "")
            material = uploaded.get("material", {})
            normalized_sha = str(material.get("contentSha256") or material.get("sha256") or "")
            uploaded_type = str(uploaded.get("type") or "")
            uploaded_size = uploaded.get("size")
            if (not url.startswith("/api/overseas/enterprise/assets/")
                    or not material.get("id") or len(normalized_sha) != 64
                    or uploaded_type not in ("image/jpeg", "image/png", "image/webp")
                    or not isinstance(uploaded_size, int) or uploaded_size < 1):
                raise ValueError(f"enterprise_asset_receipt_invalid:{key}")
            uploads[key] = {"sourcePdfImageSha256": entry["sourcePdfImageSha256"], "url": url,
                            "materialId": material["id"], "normalizedSha256": normalized_sha,
                            "type": uploaded_type, "size": uploaded_size}
            save_ledger(ledger_file, ledger)
    # Re-read immediately before CAS; no stale profile is overwritten.
    current = request_json(base, token, "GET", "/api/overseas/enterprise/profile")
    plan = manifest(current, images)
    products = current["products"]["items"]
    changed = False
    for entry in plan["entries"]:
        if entry["state"] == "already_bound":
            continue
        target = products[entry["productIndex"] - 1]
        receipt = uploads[entry["productId"]]
        if request_asset_sha(base, token, receipt["url"]) != receipt.get("normalizedSha256"):
            raise ValueError(f"enterprise_asset_bytes_changed:{entry['productId']}")
        asset = {"name": f"GUIANFA PDF #{entry['pdfNumber']} 商品图", "type": receipt["type"],
                 "size": receipt["size"], "updatedAt": "2026-10-18T00:00:00.000Z",
                 "url": receipt["url"], "sourcePdfSha256": PDF_SHA256,
                 "sourcePdfPage": entry["pdfPage"], "sourcePdfNumber": entry["pdfNumber"],
                 "sourcePdfImageOrdinal": entry["imageOnPage"],
                 "sourcePdfImageSha256": entry["sourcePdfImageSha256"],
                 "sourceAuthorization": "user_confirmed_GUIANFA_COOSTO_same_enterprise_2026-10-18"}
        target["images"] = [asset]
        target["imageUrl"] = receipt["url"]
        changed = True
    if changed:
        request_json(base, token, "PATCH", "/api/overseas/enterprise/profile",
                     {"products": {"items": products}}, if_match=plan["currentFactVersion"])
    verified = request_json(base, token, "GET", "/api/overseas/enterprise/profile")
    final = manifest(verified, images)
    if any(entry["state"] != "already_bound" for entry in final["entries"]):
        raise ValueError("enterprise_product_import_verification_failed")
    return final


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--profile-json", type=Path, help="local-store tenant_profiles.json for dry-run")
    parser.add_argument("--apply", action="store_true", help="explicitly mutate through authenticated local APIs")
    parser.add_argument("--base-url", default="http://127.0.0.1:8792")
    parser.add_argument("--ledger", type=Path, help="recoverable receipt file outside the golden store")
    parser.add_argument("--confirm-pdf-sha", default="")
    arguments = parser.parse_args()
    if arguments.apply:
        if arguments.confirm_pdf_sha != PDF_SHA256 or not arguments.ledger:
            parser.error("--apply requires --confirm-pdf-sha and --ledger")
        token = os.getenv("ENTERPRISE_IMPORT_AUTH_TOKEN", "")
        if not token:
            parser.error("ENTERPRISE_IMPORT_AUTH_TOKEN is required for --apply")
        result = apply_import(arguments.base_url, token, arguments.pdf, arguments.ledger)
    else:
        if not arguments.profile_json:
            parser.error("dry-run requires --profile-json")
        result = manifest(profile_from_store(arguments.profile_json), catalog_images(arguments.pdf))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
