"""Require the public Worker's credential before dispatching the hosted WSGI app."""

import hashlib
import hmac
import json
import re
from pathlib import Path

from werkzeug.wrappers import Response


class OriginAuthentication:
    """Verify a high-entropy bearer against its non-secret SHA-256 digest."""

    def __init__(self, application, verifier_path=None):
        self.application = application
        self.expected_digest = None
        path = verifier_path or Path(__file__).with_name("origin-auth.json")
        try:
            config = json.loads(Path(path).read_text(encoding="utf-8"))
            digest = config["token_sha256"]
            if (type(config["version"]) is int and config["version"] == 1
                    and isinstance(digest, str)):
                if re.fullmatch(r"[0-9a-f]{64}", digest):
                    self.expected_digest = bytes.fromhex(digest)
        except (OSError, ValueError, KeyError, TypeError):
            pass

    @staticmethod
    def reject(environ, start_response, status, message):
        response = Response(
            json.dumps({"error": message}),
            status=status,
            mimetype="application/json",
            headers={"Cache-Control": "no-store"},
        )
        return response(environ, start_response)

    def __call__(self, environ, start_response):
        if self.expected_digest is None:
            return self.reject(
                environ, start_response, 503, "Origin authentication is unavailable."
            )

        token = environ.get("HTTP_X_SL25_ORIGIN_TOKEN", "")
        if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
            return self.reject(environ, start_response, 403, "Forbidden.")
        digest = hashlib.sha256(token.encode("ascii")).digest()
        if not hmac.compare_digest(digest, self.expected_digest):
            return self.reject(environ, start_response, 403, "Forbidden.")
        return self.application(environ, start_response)
