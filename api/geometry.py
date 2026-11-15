"""Vercel function exposing the project's SPICE geometry calculation."""

from http.server import BaseHTTPRequestHandler
from pathlib import Path
import json
import sys
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from geometry_server import GEOMETRY_LOCK, KERNELS, calculate, load_kernels  # noqa: E402

_KERNELS_LOADED = False


def _load_kernels_once():
    global _KERNELS_LOADED
    if not _KERNELS_LOADED:
        load_kernels()
        _KERNELS_LOADED = True


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") != "/api/geometry":
            self._json(404, {"error": "Unknown endpoint"})
            return
        try:
            with GEOMETRY_LOCK:
                _load_kernels_once()
            self._json(200, {"ok": True, "service": "LUNA SPICE geometry", "kernels": KERNELS})
        except Exception:
            self._json(503, {"error": "SPICE kernels are unavailable"})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/geometry":
            self._json(404, {"error": "Unknown endpoint"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 500_000:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("A JSON object is required")
            with GEOMETRY_LOCK:
                _load_kernels_once()
                result = calculate(payload)
            self._json(200, result)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)[:300]})
        except Exception as error:
            traceback.print_exc()
            self._json(503, {"error": f"{type(error).__name__}: {error}"[:300]})

    def _json(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass
