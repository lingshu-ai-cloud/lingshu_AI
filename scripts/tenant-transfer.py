#!/usr/bin/env python3
"""Export and import one PocketBase tenant without overwriting target data.

The exporter writes a self-contained directory containing selected SQLite rows,
PocketBase record files, referenced application media, and object-storage keys.
The importer requires PocketBase to be stopped and performs an atomic database
transaction. Existing target rows or files are never overwritten.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
SKIP_TABLES = {"_collections", "_migrations", "_params", "_superusers"}
TENANT_COLUMNS = {"tenantid", "organizationid"}
USER_COLUMNS = {
    "userid", "ownerid", "createdby", "updatedby", "memberid", "assignedto",
    "takenby", "decidedby", "recordid", "recordref",
}
MEDIA_EXTENSIONS = {
    ".mp4", ".mov", ".webm", ".mkv", ".avi", ".jpg", ".jpeg", ".png",
    ".webp", ".gif", ".mp3", ".wav", ".m4a", ".aac", ".srt", ".vtt",
}


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def normalized(name: str) -> str:
    return name.lower().replace("_", "")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def encode(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"__tenant_transfer_bytes__": base64.b64encode(value).decode("ascii")}
    return value


def decode(value: Any) -> Any:
    if isinstance(value, dict) and set(value) == {"__tenant_transfer_bytes__"}:
        return base64.b64decode(value["__tenant_transfer_bytes__"])
    return value


def table_names(connection: sqlite3.Connection) -> list[str]:
    return [
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f"PRAGMA table_info({quote(table)})")]


def select_matching_rows(
    connection: sqlite3.Connection,
    table: str,
    columns: list[str],
    clauses: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    if not clauses:
        return []
    where = " OR ".join(f"CAST({quote(column)} AS TEXT)=?" for column, _ in clauses)
    params = [value for _, value in clauses]
    cursor = connection.execute(f"SELECT * FROM {quote(table)} WHERE {where}", params)
    return [dict(row) for row in cursor.fetchall()]


def collect_rows(
    connection: sqlite3.Connection,
    email: str,
) -> tuple[dict[str, list[dict[str, Any]]], str, str]:
    connection.row_factory = sqlite3.Row
    user = connection.execute(
        "SELECT * FROM users WHERE lower(email)=?", (email.lower(),)
    ).fetchone()
    if not user:
        raise RuntimeError(f"account not found: {email}")
    user_id = str(user["id"])
    tenant_id = str(user["tenantId"])
    if not tenant_id:
        raise RuntimeError("source user has no tenantId")

    schemas = {
        table: table_columns(connection, table)
        for table in table_names(connection)
        if table not in SKIP_TABLES
    }
    selected: dict[str, dict[str, dict[str, Any]]] = {}

    def add(table: str, rows: Iterable[dict[str, Any]]) -> bool:
        changed = False
        bucket = selected.setdefault(table, {})
        for row in rows:
            record_id = str(row.get("id", ""))
            key = record_id or hashlib.sha256(
                json.dumps({k: encode(v) for k, v in row.items()}, sort_keys=True).encode()
            ).hexdigest()
            if key not in bucket:
                bucket[key] = row
                changed = True
        return changed

    add("users", [dict(user)])
    if "tenants" in schemas:
        add(
            "tenants",
            select_matching_rows(
                connection, "tenants", schemas["tenants"], [("id", tenant_id)]
            ),
        )

    for table, columns in schemas.items():
        if table in {"users", "tenants"}:
            continue
        clauses: list[tuple[str, str]] = []
        for column in columns:
            key = normalized(column)
            if key in TENANT_COLUMNS:
                clauses.append((column, tenant_id))
            elif key in USER_COLUMNS:
                clauses.append((column, user_id))
        add(table, select_matching_rows(connection, table, columns, clauses))

    # Pull relation rows that do not carry tenant_id themselves. Limit traversal
    # to explicit id/ref columns and to ids already proven to belong to the tenant.
    known_ids = {user_id, tenant_id}
    for rows in selected.values():
        known_ids.update(str(row.get("id")) for row in rows.values() if row.get("id"))
    for _ in range(6):
        changed = False
        for table, columns in schemas.items():
            relation_columns = [
                column for column in columns
                if column != "id" and (
                    normalized(column).endswith("id")
                    or normalized(column).endswith("ref")
                )
            ]
            if not relation_columns or not known_ids:
                continue
            rows: list[dict[str, Any]] = []
            identifiers = sorted(known_ids)
            for column in relation_columns:
                for offset in range(0, len(identifiers), 400):
                    chunk = identifiers[offset:offset + 400]
                    placeholders = ",".join("?" for _ in chunk)
                    cursor = connection.execute(
                        f"SELECT * FROM {quote(table)} WHERE "
                        f"CAST({quote(column)} AS TEXT) IN ({placeholders})",
                        chunk,
                    )
                    rows.extend(dict(row) for row in cursor.fetchall())
            if add(table, rows):
                changed = True
                for row in rows:
                    if row.get("id"):
                        known_ids.add(str(row["id"]))
        if not changed:
            break

    result = {
        table: list(rows.values())
        for table, rows in selected.items()
        if rows
    }
    return result, user_id, tenant_id


def walk_values(value: Any, key: str = "") -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        for child_key, child in value.items():
            yield from walk_values(child, str(child_key))
        return
    if isinstance(value, list):
        for child in value:
            yield from walk_values(child, key)
        return
    if not isinstance(value, str) or not value:
        return
    stripped = value.strip()
    if stripped[:1] in {"{", "["}:
        try:
            yield from walk_values(json.loads(stripped), key)
        except Exception:
            pass
    yield key, stripped


def collect_asset_references(
    records: dict[str, list[dict[str, Any]]]
) -> tuple[set[str], set[str], set[str]]:
    media_paths: set[str] = set()
    media_basenames: set[str] = set()
    object_keys: set[str] = set()
    for rows in records.values():
        for row in rows:
            for key, value in walk_values(row):
                lowered_key = normalized(key)
                if "objectkey" in lowered_key:
                    object_keys.add(value.lstrip("/"))
                marker = "/media/"
                if marker in value:
                    relative = value.split(marker, 1)[1].split("?", 1)[0].lstrip("/")
                    if relative:
                        media_paths.add(relative)
                        media_basenames.add(Path(relative).name)
                candidate = value.split("?", 1)[0]
                if Path(candidate).suffix.lower() in MEDIA_EXTENSIONS and "://" not in candidate:
                    relative = candidate.lstrip("/")
                    if relative.startswith("media/"):
                        relative = relative[6:]
                    media_paths.add(relative)
                    media_basenames.add(Path(relative).name)
    return media_paths, media_basenames, object_keys


def copy_pb_storage(
    connection: sqlite3.Connection,
    pb_root: Path,
    records: dict[str, list[dict[str, Any]]],
    output: Path,
) -> int:
    if "_collections" not in table_names(connection):
        return 0
    collections = {
        str(row[1]): str(row[0])
        for row in connection.execute('SELECT id, name FROM "_collections"')
    }
    copied = 0
    for table, rows in records.items():
        collection_id = collections.get(table)
        if not collection_id:
            continue
        for row in rows:
            record_id = str(row.get("id", ""))
            if not record_id:
                continue
            source = pb_root / "storage" / collection_id / record_id
            if source.is_dir():
                destination = output / "pb_storage" / table / record_id
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(source, destination)
                copied += sum(1 for item in destination.rglob("*") if item.is_file())
    return copied


def copy_app_media(
    app_data_root: Path | None,
    output: Path,
    media_paths: set[str],
    media_basenames: set[str],
    record_ids: set[str],
    tenant_id: str,
) -> int:
    if not app_data_root:
        return 0
    media_root = app_data_root / "media"
    if not media_root.is_dir():
        return 0
    copied = 0
    for source in media_root.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(media_root).as_posix()
        include = (
            relative in media_paths
            or source.name in media_basenames
            or tenant_id in source.parts
            or any(source.name.startswith(record_id) for record_id in record_ids)
        )
        if not include:
            continue
        destination = output / "app_media" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied += 1
    return copied


def command_export(args: argparse.Namespace) -> None:
    output = Path(args.output).resolve()
    if output.exists():
        raise RuntimeError(f"output already exists: {output}")
    output.mkdir(parents=True, mode=0o700)
    db = Path(args.db).resolve()
    connection = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    records, user_id, tenant_id = collect_rows(connection, args.email)
    encoded_records = {
        table: [{key: encode(value) for key, value in row.items()} for row in rows]
        for table, rows in records.items()
    }
    record_ids = {
        str(row.get("id"))
        for rows in records.values()
        for row in rows
        if row.get("id")
    }
    media_paths, media_basenames, object_keys = collect_asset_references(records)
    pb_files = copy_pb_storage(connection, Path(args.pb_root).resolve(), records, output)
    connection.close()
    app_files = copy_app_media(
        Path(args.app_data_root).resolve() if args.app_data_root else None,
        output,
        media_paths,
        media_basenames,
        record_ids,
        tenant_id,
    )
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "email": args.email.lower(),
        "sourceUserId": user_id,
        "sourceTenantId": tenant_id,
        "records": encoded_records,
        "objectStorageKeys": sorted(object_keys),
        "counts": {
            "tables": len(encoded_records),
            "records": sum(len(rows) for rows in encoded_records.values()),
            "pbFiles": pb_files,
            "appMediaFiles": app_files,
            "objectStorageKeys": len(object_keys),
        },
    }
    records_file = output / "records.json"
    records_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "files": {
            item.relative_to(output).as_posix(): sha256_file(item)
            for item in sorted(output.rglob("*"))
            if item.is_file()
        },
    }
    (output / "SHA256SUMS.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
    )
    os.chmod(records_file, 0o600)
    os.chmod(output / "SHA256SUMS.json", 0o600)
    print(json.dumps(payload["counts"], sort_keys=True))
    print(f"EXPORT_DIR={output}")


def verify_manifest(package: Path) -> None:
    manifest = json.loads((package / "SHA256SUMS.json").read_text(encoding="utf-8"))
    for relative, expected in manifest["files"].items():
        path = package / relative
        if not path.is_file() or sha256_file(path) != expected:
            raise RuntimeError(f"package checksum failed: {relative}")


def rows_equal(existing: sqlite3.Row, row: dict[str, Any], columns: list[str]) -> bool:
    return all(existing[column] == row[column] for column in columns)


def command_import(args: argparse.Namespace) -> None:
    package = Path(args.package).resolve()
    verify_manifest(package)
    payload = json.loads((package / "records.json").read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("unsupported package schema")
    records = {
        table: [{key: decode(value) for key, value in row.items()} for row in rows]
        for table, rows in payload["records"].items()
    }
    db = Path(args.db).resolve()
    pb_root = Path(args.pb_root).resolve()
    app_data_root = Path(args.app_data_root).resolve()
    connection = sqlite3.connect(db)
    connection.row_factory = sqlite3.Row
    schemas = {table: table_columns(connection, table) for table in table_names(connection)}
    missing_tables = sorted(table for table, rows in records.items() if rows and table not in schemas)
    if missing_tables:
        raise RuntimeError("target is missing tables: " + ",".join(missing_tables))

    existing_email = connection.execute(
        "SELECT id FROM users WHERE lower(email)=?", (payload["email"],)
    ).fetchone()
    if existing_email and str(existing_email["id"]) != payload["sourceUserId"]:
        raise RuntimeError("target email belongs to a different user id")

    for table, rows in records.items():
        target_columns = schemas[table]
        for row in rows:
            missing_columns = sorted(set(row) - set(target_columns))
            if missing_columns:
                raise RuntimeError(f"target {table} is missing columns: {','.join(missing_columns)}")

    collections = {
        str(row[1]): str(row[0])
        for row in connection.execute('SELECT id, name FROM "_collections"')
    }
    for table_dir in (package / "pb_storage").glob("*") if (package / "pb_storage").is_dir() else []:
        if table_dir.name not in collections:
            raise RuntimeError(f"target collection missing for files: {table_dir.name}")
        for record_dir in table_dir.iterdir():
            target = pb_root / "storage" / collections[table_dir.name] / record_dir.name
            if target.exists():
                raise RuntimeError(f"target PocketBase file directory already exists: {target}")
    for source in (package / "app_media").rglob("*") if (package / "app_media").is_dir() else []:
        if not source.is_file():
            continue
        target = app_data_root / "media" / source.relative_to(package / "app_media")
        if target.exists() and sha256_file(target) != sha256_file(source):
            raise RuntimeError(f"target media conflict: {target}")

    inserted = 0
    skipped = 0
    created_paths: list[Path] = []
    order = [table for table in ("tenants", "users") if table in records]
    order.extend(sorted(table for table in records if table not in {"tenants", "users"}))
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        for table in order:
            for row in records[table]:
                columns = list(row)
                record_id = row.get("id")
                if record_id is not None and "id" in schemas[table]:
                    existing = connection.execute(
                        f"SELECT * FROM {quote(table)} WHERE id=?", (record_id,)
                    ).fetchone()
                    if existing:
                        if not rows_equal(existing, row, columns):
                            raise RuntimeError(f"target row conflict: {table}/{record_id}")
                        skipped += 1
                        continue
                placeholders = ",".join("?" for _ in columns)
                connection.execute(
                    f"INSERT INTO {quote(table)} ({','.join(quote(c) for c in columns)}) "
                    f"VALUES ({placeholders})",
                    [row[column] for column in columns],
                )
                inserted += 1

        pb_package = package / "pb_storage"
        if pb_package.is_dir():
            for table_dir in pb_package.iterdir():
                for record_dir in table_dir.iterdir():
                    target = pb_root / "storage" / collections[table_dir.name] / record_dir.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(record_dir, target)
                    created_paths.append(target)
        app_package = package / "app_media"
        if app_package.is_dir():
            for source in app_package.rglob("*"):
                if not source.is_file():
                    continue
                target = app_data_root / "media" / source.relative_to(app_package)
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                created_paths.append(target)
        connection.commit()
    except Exception:
        connection.rollback()
        for path in reversed(created_paths):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        raise
    finally:
        connection.close()
    print(json.dumps({"inserted": inserted, "skipped": skipped}, sort_keys=True))
    print("IMPORT_COMPLETE")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--db", required=True)
    export.add_argument("--pb-root", required=True)
    export.add_argument("--app-data-root")
    export.add_argument("--email", required=True)
    export.add_argument("--output", required=True)
    export.set_defaults(handler=command_export)
    importer = commands.add_parser("import")
    importer.add_argument("--db", required=True)
    importer.add_argument("--pb-root", required=True)
    importer.add_argument("--app-data-root", required=True)
    importer.add_argument("--package", required=True)
    importer.set_defaults(handler=command_import)
    return root


def main() -> None:
    args = parser().parse_args()
    try:
        args.handler(args)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
