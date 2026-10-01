from __future__ import annotations

import json
import os
import urllib.request


base_url = os.getenv("ANALYSIS_API_URL", "http://127.0.0.1:8765").rstrip("/")
api_key = os.getenv("ANALYSIS_API_KEY")
payload = {
    "methodId": "descriptive",
    "source": "smoke-test",
    "data": {
        "headers": ["score"],
        "rows": [{"score": 1}, {"score": 2}, {"score": 3}, {"score": 4}],
    },
    "variables": {"analysis-variables": ["score"]},
}
headers = {"Content-Type": "application/json", "Idempotency-Key": "smoke-descriptive-v1"}
if api_key:
    headers["Authorization"] = f"Bearer {api_key}"
request = urllib.request.Request(
    f"{base_url}/v1/analysis-jobs",
    data=json.dumps(payload).encode("utf-8"),
    headers=headers,
    method="POST",
)
with urllib.request.urlopen(request, timeout=10) as response:
    body = json.loads(response.read())

assert body["status"] == "completed", body
assert body["result"]["tables"][0]["rows"][0][2] == "2.500", body
print(json.dumps({"ok": True, "jobId": body["id"], "status": body["status"]}, ensure_ascii=False))

