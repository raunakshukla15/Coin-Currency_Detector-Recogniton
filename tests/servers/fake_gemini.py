"""Fake Google Gemini upstream for AI failure-path tests (no network, no quota).

Run:
    python tests/servers/fake_gemini.py --port 9099

Emulates the official REST shape the google-genai SDK speaks:
    POST {base}/v1beta/models/{model}:generateContent   (header X-Goog-Api-Key)

Control endpoints (used by tests, not by the app):
    POST /__control   {"scenario": "ok", "content": "...", "fail_first": 0}
    GET  /__stats     -> {"requests": n, "models": [...], "scenario": "..."}
    GET  /__reset     -> reset counters

The app is pointed here with config.GEMINI_API_URL
(backend reads env GEMINI_API_URL). Scenarios:

    ok            200 JSON answer (default: generic text reply;
                  set "content" for custom payloads, e.g. an identify JSON)
    quota         429 with "per day" quota text -> ai fail-fast quota message
    ratelimit     429 generic (per-minute) -> next model in queue
    e503          503 for every request
    e404          404 model not found -> ai rotates to the next free model
    keyerr        400 "API key not valid" -> ai must fail fast, clean message
    timeout       sleeps far longer than the client per-attempt timeout
    malformed     200 with a non-JSON HTTP body
    empty         200 valid envelope but empty content
    nonjson       200 valid envelope, content is plain prose (fails require_json)
    flaky         first `fail_first` requests 503, then behave like ok
"""

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

STATE = {
    "scenario": "ok",
    "content": None,   # None -> default prose reply
    "fail_first": 0,
}
LOCK = threading.Lock()
STATS = {"requests": 0, "models": []}

DEFAULT_CONTENT = (
    "Hello from the fake Gemini upstream. This is a deterministic test reply."
)


def _success(model: str, text: str) -> bytes:
    return json.dumps(
        {
            "modelVersion": model,
            "candidates": [
                {
                    "content": {"role": "model", "parts": [{"text": text}]},
                    "finishReason": "STOP",
                }
            ],
        }
    ).encode("utf-8")


def _error(code: int, status: str, message: str) -> bytes:
    return json.dumps(
        {"error": {"code": code, "status": status, "message": message}}
    ).encode("utf-8")


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Tests deliberately time out mid-request; suppress the socket noise."""

    def handle_error(self, request, client_address):
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # silence per-request logging
        pass

    # ---------- control endpoints ----------
    def do_GET(self):
        if self.path == "/__stats":
            with LOCK:
                payload = dict(STATS, scenario=STATE["scenario"])
            self._reply(200, json.dumps(payload).encode("utf-8"))
        elif self.path == "/__reset":
            with LOCK:
                STATS["requests"] = 0
                STATS["models"] = []
            self._reply(200, b'{"ok": true}')
        else:
            self._reply(404, _error(404, "NOT_FOUND", "not found"))

    def do_POST(self):
        if self.path == "/__control":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self._reply(400, b'{"detail": "bad json"}')
                return
            with LOCK:
                STATE.update({k: v for k, v in body.items() if k in STATE})
            self._reply(200, json.dumps({"ok": True, "state": STATE}).encode("utf-8"))
            return
        if ":generateContent" in self.path and self.path.startswith(("/v1beta/", "/models/")):
            self._handle_generate()
            return
        self._reply(404, _error(404, "NOT_FOUND", "not found"))

    # ---------- upstream emulation ----------
    def _handle_generate(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            json.loads(raw)
        except json.JSONDecodeError:
            pass

        if not (self.headers.get("X-Goog-Api-Key") or "").strip():
            self._reply(403, _error(403, "PERMISSION_DENIED", "Permission denied."))
            return

        # /v1beta/models/<model>:generateContent  ->  <model>
        path = unquote(self.path)
        model = path.split("/models/", 1)[-1].split(":generateContent", 1)[0] or "unknown"

        with LOCK:
            scenario = STATE["scenario"]
            content = STATE["content"]
            fail_first = int(STATE["fail_first"])
            STATS["requests"] += 1
            nth = STATS["requests"]
            STATS["models"].append(model)

        if scenario == "flaky" and nth <= fail_first:
            self._reply(503, _error(503, "UNAVAILABLE", "Service temporarily overloaded"))
            return

        if scenario == "quota":
            self._reply(429, _error(
                429, "RESOURCE_EXHAUSTED",
                "You exceeded your current quota. Quota exceeded for quota "
                "metric 'Generate Content requests per day' and quota limit "
                "'Generate Content requests per day'.",
            ))
            return

        if scenario == "ratelimit":
            self._reply(429, _error(
                429, "RESOURCE_EXHAUSTED",
                "Resource has been exhausted (e.g. check quota).",
            ))
            return

        if scenario == "e503":
            self._reply(503, _error(503, "UNAVAILABLE", "The service is currently unavailable."))
            return

        if scenario == "e404":
            self._reply(404, _error(
                404, "NOT_FOUND", f"models/{model} is not found for API version v1beta."
            ))
            return

        if scenario == "keyerr":
            self._reply(400, _error(
                400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."
            ))
            return

        if scenario == "timeout":
            time.sleep(30)
            self._reply(200, _success(model, DEFAULT_CONTENT))
            return

        if scenario == "malformed":
            self._reply(200, b"<html>this is not JSON</html>", content_type="text/html")
            return

        if scenario == "empty":
            self._reply(200, _success(model, ""))
            return

        if scenario == "nonjson":
            self._reply(200, _success(
                model,
                "Sure, I would be happy to help you with that. "
                "Let me explain in plain prose instead of JSON.",
            ))
            return

        # ok / flaky (past fail_first)
        text = content if isinstance(content, str) and content else DEFAULT_CONTENT
        self._reply(200, _success(model, text))

    def _reply(self, status: int, payload: bytes, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description="Fake Google Gemini upstream")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9099)
    args = parser.parse_args()

    server = QuietThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"fake_gemini listening on http://{args.host}:{args.port} "
        f"(POST /v1beta/models/{{model}}:generateContent, "
        f"control: /__control /__stats /__reset)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
