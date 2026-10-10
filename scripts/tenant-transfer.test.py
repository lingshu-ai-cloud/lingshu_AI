#!/usr/bin/env python3
"""Contract test for complete tenant-scoped PocketBase transfers."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TRANSFER = ROOT / "scripts" / "tenant-transfer.py"


def create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE _collections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          tenantId TEXT NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          tenantId TEXT NOT NULL,
          ownerId TEXT NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE project_events (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          message TEXT NOT NULL
        );
        """
    )
    connection.executemany(
        "INSERT INTO _collections (id, name) VALUES (?, ?)",
        [("users_collection", "users"), ("projects_collection", "projects")],
    )
    connection.executemany(
        "INSERT INTO tenants (id, name) VALUES (?, ?)",
        [("tenant_a", "Tenant A"), ("tenant_b", "Tenant B")],
    )
    connection.executemany(
        "INSERT INTO users (id, email, tenantId) VALUES (?, ?, ?)",
        [
            ("user_a1", "rongshangshengwu@gmail.com", "tenant_a"),
            ("user_a2", "colleague@example.com", "tenant_a"),
            ("user_b1", "outsider@example.com", "tenant_b"),
        ],
    )
    connection.executemany(
        "INSERT INTO projects (id, tenantId, ownerId, name) VALUES (?, ?, ?, ?)",
        [
            ("project_a1", "tenant_a", "user_a1", "Primary project"),
            ("project_a2", "tenant_a", "user_a2", "Colleague project"),
            ("project_b1", "tenant_b", "user_b1", "Other tenant"),
        ],
    )
    connection.executemany(
        "INSERT INTO project_events (id, projectId, message) VALUES (?, ?, ?)",
        [
            ("event_a1", "project_a1", "primary event"),
            ("event_a2", "project_a2", "colleague event"),
            ("event_b1", "project_b1", "other event"),
        ],
    )
    connection.commit()
    connection.close()


def create_empty_target(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE _collections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          tenantId TEXT NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          tenantId TEXT NOT NULL,
          ownerId TEXT NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE project_events (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          message TEXT NOT NULL
        );
        INSERT INTO _collections (id, name) VALUES
          ('users_collection', 'users'),
          ('projects_collection', 'projects');
        """
    )
    connection.commit()
    connection.close()


def ids(payload: dict, table: str) -> set[str]:
    return {str(row["id"]) for row in payload["records"].get(table, [])}


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="tenant-transfer-test-") as temporary:
        root = Path(temporary)
        source_db = root / "source.db"
        target_db = root / "target.db"
        source_pb = root / "source-pb"
        target_pb = root / "target-pb"
        target_app = root / "target-app"
        package = root / "package"
        create_database(source_db)
        create_empty_target(target_db)

        storage = source_pb / "storage" / "projects_collection" / "project_a2"
        storage.mkdir(parents=True)
        (storage / "tenant-video.mp4").write_bytes(b"tenant-video")
        other_storage = source_pb / "storage" / "projects_collection" / "project_b1"
        other_storage.mkdir(parents=True)
        (other_storage / "other-video.mp4").write_bytes(b"other-video")

        subprocess.run(
            [
                "python3", str(TRANSFER), "export",
                "--db", str(source_db),
                "--pb-root", str(source_pb),
                "--email", "rongshangshengwu@gmail.com",
                "--output", str(package),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads((package / "records.json").read_text(encoding="utf-8"))
        assert ids(payload, "users") == {"user_a1", "user_a2"}
        assert ids(payload, "projects") == {"project_a1", "project_a2"}
        assert ids(payload, "project_events") == {"event_a1", "event_a2"}
        assert (package / "pb_storage" / "projects" / "project_a2" / "tenant-video.mp4").is_file()
        assert not (package / "pb_storage" / "projects" / "project_b1").exists()

        subprocess.run(
            [
                "python3", str(TRANSFER), "import",
                "--db", str(target_db),
                "--pb-root", str(target_pb),
                "--app-data-root", str(target_app),
                "--package", str(package),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        connection = sqlite3.connect(target_db)
        assert connection.execute("SELECT count(*) FROM users").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM projects").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM project_events").fetchone()[0] == 2
        connection.close()
        assert (
            target_pb / "storage" / "projects_collection" / "project_a2" / "tenant-video.mp4"
        ).read_bytes() == b"tenant-video"

    print("tenant transfer contract passed")


if __name__ == "__main__":
    main()
