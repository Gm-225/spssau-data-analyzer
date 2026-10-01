import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from services.analysis_api.app import create_server


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.server = create_server("127.0.0.1", 0, database_path, "test-secret")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def request(self, path, method="GET", payload=None, headers=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read())
            finally:
                error.close()

    @staticmethod
    def payload():
        return {
            "methodId": "descriptive",
            "data": {
                "headers": ["score"],
                "rows": [{"score": 10}, {"score": 20}, {"score": 30}],
            },
            "variables": {"analysis-variables": ["score"]},
            "source": "api-test",
        }

    def test_health_does_not_require_api_key(self):
        status, body = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["apiVersion"], "v1")

    def test_job_requires_api_key(self):
        status, body = self.request("/v1/analysis-jobs", "POST", self.payload())
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "UNAUTHORIZED")

    def test_create_persist_get_and_idempotent_retry(self):
        headers = {"Authorization": "Bearer test-secret", "Idempotency-Key": "order-42"}
        status, created = self.request("/v1/analysis-jobs", "POST", self.payload(), headers)
        self.assertEqual(status, 201)
        self.assertEqual(created["status"], "completed")
        self.assertNotIn("rows", created["inputSummary"])

        status, fetched = self.request(
            f'/v1/analysis-jobs/{created["id"]}', headers={"Authorization": "Bearer test-secret"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(fetched, created)

        status, repeated = self.request("/v1/analysis-jobs", "POST", self.payload(), headers)
        self.assertEqual(status, 200)
        self.assertEqual(repeated["id"], created["id"])

    def test_invalid_request_returns_stable_error(self):
        status, body = self.request(
            "/v1/analysis-jobs",
            "POST",
            {"methodId": "descriptive"},
            {"Authorization": "Bearer test-secret"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "INVALID_DATA")


if __name__ == "__main__":
    unittest.main()
