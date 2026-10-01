from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from typing import Any


class AnalysisRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = str(database_path)
        self._lock = threading.Lock()
        Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_jobs (
                        id TEXT PRIMARY KEY,
                        api_version TEXT NOT NULL,
                        idempotency_key TEXT UNIQUE,
                        status TEXT NOT NULL,
                        method_id TEXT NOT NULL,
                        input_summary_json TEXT NOT NULL,
                        result_json TEXT,
                        error_json TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

    def create(self, job: dict[str, Any], idempotency_key: str | None) -> dict[str, Any]:
        with self._lock, closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO analysis_jobs (
                        id, api_version, idempotency_key, status, method_id,
                        input_summary_json, result_json, error_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        job["id"],
                        job["apiVersion"],
                        idempotency_key,
                        job["status"],
                        job["methodId"],
                        json.dumps(job["inputSummary"], ensure_ascii=False),
                        json.dumps(job.get("result"), ensure_ascii=False),
                        json.dumps(job.get("error"), ensure_ascii=False),
                        job["createdAt"],
                        job["updatedAt"],
                    ),
                )
        return job

    def get(self, job_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)
            ).fetchone()
        return self._row_to_job(row) if row else None

    def get_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM analysis_jobs WHERE idempotency_key = ?", (key,)
            ).fetchone()
        return self._row_to_job(row) if row else None

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> dict[str, Any]:
        job: dict[str, Any] = {
            "apiVersion": row["api_version"],
            "id": row["id"],
            "status": row["status"],
            "methodId": row["method_id"],
            "inputSummary": json.loads(row["input_summary_json"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        if row["result_json"] and row["result_json"] != "null":
            job["result"] = json.loads(row["result_json"])
        if row["error_json"] and row["error_json"] != "null":
            job["error"] = json.loads(row["error_json"])
        return job
