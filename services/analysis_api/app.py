from __future__ import annotations

import json
import os
import re
import uuid
import hmac
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import API_VERSION, SERVICE_VERSION
from .analysis import AnalysisInputError, parse_request, run_analysis, summarize_input
from .storage import AnalysisRepository


MAX_BODY_BYTES = 10 * 1024 * 1024
JOB_PATH = re.compile(r"^/v1/analysis-jobs/([0-9a-f-]+)$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AnalysisApplication:
    def __init__(self, repository: AnalysisRepository) -> None:
        self.repository = repository

    def create_job(
        self, payload: Any, idempotency_key: str | None
    ) -> tuple[HTTPStatus, dict[str, Any]]:
        if idempotency_key:
            existing = self.repository.get_by_idempotency_key(idempotency_key)
            if existing:
                return HTTPStatus.OK, existing

        request = parse_request(payload)
        result = run_analysis(request)
        now = utc_now()
        job = {
            "apiVersion": API_VERSION,
            "id": str(uuid.uuid4()),
            "status": "completed",
            "methodId": request.method_id,
            "inputSummary": summarize_input(request),
            "result": {**result, "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)},
            "createdAt": now,
            "updatedAt": now,
        }
        return HTTPStatus.CREATED, self.repository.create(job, idempotency_key)


def create_handler(application: AnalysisApplication, api_key: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AnalysisAPI/0.1"

        def log_message(self, format: str, *args: object) -> None:
            # Keep access logs metadata-only. Request bodies and customer rows are never logged.
            super().log_message(format, *args)

        def _headers(self, status: HTTPStatus, content_length: int = 0) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(content_length))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()

        def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self._headers(status, len(body))
            self.wfile.write(body)

        def _error(self, status: HTTPStatus, code: str, message: str) -> None:
            self._json(
                status,
                {"apiVersion": API_VERSION, "error": {"code": code, "message": message}},
            )

        def _authorized(self) -> bool:
            if not api_key:
                return True
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(supplied, f"Bearer {api_key}")

        def _require_authorization(self) -> bool:
            if self._authorized():
                return True
            self._error(HTTPStatus.UNAUTHORIZED, "UNAUTHORIZED", "缺少或无效的 API Key")
            return False

        def do_OPTIONS(self) -> None:
            self._headers(HTTPStatus.NO_CONTENT)

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/health":
                self._json(
                    HTTPStatus.OK,
                    {
                        "status": "ok",
                        "service": "analysis-api",
                        "serviceVersion": SERVICE_VERSION,
                        "apiVersion": API_VERSION,
                    },
                )
                return
            if not self._require_authorization():
                return
            match = JOB_PATH.fullmatch(path)
            if match:
                job = application.repository.get(match.group(1))
                if job:
                    self._json(HTTPStatus.OK, job)
                else:
                    self._error(HTTPStatus.NOT_FOUND, "JOB_NOT_FOUND", "未找到分析任务")
                return
            self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "接口不存在")

        def do_POST(self) -> None:
            path = self.path.split("?", 1)[0]
            if path != "/v1/analysis-jobs":
                self._error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "接口不存在")
                return
            if not self._require_authorization():
                return

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._error(HTTPStatus.BAD_REQUEST, "INVALID_CONTENT_LENGTH", "Content-Length 无效")
                return
            if content_length <= 0:
                self._error(HTTPStatus.BAD_REQUEST, "EMPTY_BODY", "请求体不能为空")
                return
            if content_length > MAX_BODY_BYTES:
                self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "BODY_TOO_LARGE", "请求体超过 10 MB")
                return

            try:
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._error(HTTPStatus.BAD_REQUEST, "INVALID_JSON", "请求体不是有效 JSON")
                return

            idempotency_key = self.headers.get("Idempotency-Key")
            if idempotency_key and len(idempotency_key) > 200:
                self._error(HTTPStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "幂等键不能超过 200 个字符")
                return

            try:
                status, job = application.create_job(payload, idempotency_key)
                self._json(status, job)
            except AnalysisInputError as error:
                self._error(HTTPStatus.UNPROCESSABLE_ENTITY, error.code, error.message)
            except Exception:
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "分析任务执行失败")

    return Handler


def create_server(
    host: str,
    port: int,
    database_path: str | Path,
    api_key: str | None = None,
) -> ThreadingHTTPServer:
    repository = AnalysisRepository(database_path)
    application = AnalysisApplication(repository)
    return ThreadingHTTPServer((host, port), create_handler(application, api_key))


def main() -> None:
    host = os.getenv("ANALYSIS_API_HOST", "127.0.0.1")
    port = int(os.getenv("ANALYSIS_API_PORT", "8765"))
    database_path = os.getenv("ANALYSIS_DB_PATH", "data/analysis.db")
    api_key = os.getenv("ANALYSIS_API_KEY")
    if host not in {"127.0.0.1", "localhost", "::1"} and not api_key:
        raise SystemExit("拒绝启动：非本机监听必须设置 ANALYSIS_API_KEY")
    server = create_server(host, port, database_path, api_key)
    print(f"Analysis API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
