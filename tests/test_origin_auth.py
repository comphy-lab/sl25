"""Origin isolation and public-calculator compatibility checks."""

import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

from werkzeug.test import Client
from werkzeug.wrappers import Response

from origin_auth import OriginAuthentication


TOKEN = "ab" * 32  # Deliberately fixed test-only credential.
DIGEST = hashlib.sha256(TOKEN.encode("ascii")).hexdigest()
HEADER = {"X-SL25-Origin-Token": TOKEN}
ROOT = Path(__file__).resolve().parents[1]


class OriginBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.verifier = Path(self.temporary.name) / "verifier.json"
        self.verifier.write_text(json.dumps({"version": 1, "token_sha256": DIGEST}))
        self.calls = []

        def application(environ, start_response):
            self.calls.append(environ["PATH_INFO"])
            return Response("accepted")(environ, start_response)

        self.application = application

    def client(self):
        return Client(OriginAuthentication(self.application, self.verifier), Response)

    def test_denies_every_path_and_method_before_dispatch(self):
        client = self.client()
        for path in ["/", "/add", "/%61dd", "//regime", "/%2Fadd", "/batch",
                     "/static/site.css", "/regime-diagram.svg", "/missing",
                     "/socket.io/?EIO=4&transport=polling"]:
            for method in ["GET", "HEAD", "POST", "OPTIONS", "PUT", "DELETE"]:
                with self.subTest(path=path, method=method):
                    response = client.open(path, method=method)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.calls, [])

    def test_wrong_malformed_and_duplicate_credentials_are_denied(self):
        client = self.client()
        for token in ["", "cd" * 32, " " + TOKEN, TOKEN + "," + TOKEN,
                      TOKEN.upper(), "é" * 64, "x" * 10000]:
            with self.subTest(token_length=len(token)):
                response = client.post("/add", headers={"X-SL25-Origin-Token": token})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.calls, [])

    def test_authorized_request_reaches_application(self):
        response = self.client().post("/add", headers=HEADER)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, ["/add"])

    def test_missing_or_malformed_verifier_fails_closed(self):
        for content in ["invalid", "null", "[]", "{}",
                        json.dumps({"version": True, "token_sha256": DIGEST}),
                        json.dumps({"version": 1, "token_sha256": "bad"}),
                        json.dumps({"version": 2, "token_sha256": DIGEST})]:
            with self.subTest(content=content):
                self.verifier.write_text(content)
                self.assertEqual(self.client().get("/", headers=HEADER).status_code, 503)
        self.verifier.unlink()
        self.assertEqual(self.client().get("/", headers=HEADER).status_code, 503)
        self.assertEqual(self.calls, [])


class CalculatorCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app as module
        cls.module = module
        cls.original = module.app.wsgi_app
        cls.temporary = tempfile.TemporaryDirectory()
        path = Path(cls.temporary.name) / "verifier.json"
        path.write_text(json.dumps({"version": 1, "token_sha256": DIGEST}))
        module.app.wsgi_app = OriginAuthentication(cls.original.application, path)
        cls.client = module.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.module.app.wsgi_app = cls.original
        cls.temporary.cleanup()

    def test_imported_application_and_socketio_are_protected_without_platform_flags(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsInstance(self.original, OriginAuthentication)
            for path in ["/add", "/socket.io/?EIO=4&transport=polling"]:
                self.assertEqual(self.client.post(path).status_code, 403)

    def test_calculations_and_validation_preserve_results(self):
        data = {"weberNumber": 10, "ohnesorgeNumber": 0.1}
        response = self.client.post("/add", json=data, headers=HEADER)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"result": 31.62})
        response = self.client.post("/regime", json=data, headers=HEADER)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"regime": "II", "predBeta": 1.38})
        response = self.client.post("/add", json={"weberNumber": -1}, headers=HEADER)
        self.assertEqual(response.status_code, 400)

    def test_batch_upload_and_size_limit_still_work(self):
        response = self.client.post("/batch", headers=HEADER, data={
            "file": (io.BytesIO(b"We,Oh\n10,0.1\n20,0.1\n"), "input.csv")
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"We,Oh,beta", response.data)
        self.assertEqual(len(response.data.splitlines()), 3)
        response.close()
        response = self.client.post("/batch", headers=HEADER, data={
            "file": (io.BytesIO(b"x" * (1024 * 1024 + 1)), "large.csv")
        })
        self.assertEqual(response.status_code, 413)
        response.close()

    def test_home_assets_diagram_and_preflight_remain_available(self):
        for path in ["/", "/static/site.css", "/regime-diagram.svg?theme=dark"]:
            with self.client.get(path, headers=HEADER) as response:
                self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.options("/add", headers=HEADER).status_code, 200)

    def test_explicit_local_entry_preserves_anonymous_local_use(self):
        with patch.dict(os.environ, {"HOST": "0.0.0.0", "PORT": "8150", "FLASK_DEBUG": "0"}), \
                patch("flask_socketio.SocketIO.run") as run:
            local = runpy.run_path(str(ROOT / "app.py"), run_name="__main__")
        self.assertNotIsInstance(local["app"].wsgi_app, OriginAuthentication)
        self.assertEqual(local["app"].test_client().get("/").status_code, 200)
        self.assertEqual(run.call_args.kwargs["host"], "0.0.0.0")
        self.assertEqual(run.call_args.kwargs["port"], 8150)
        with patch.dict(os.environ, {"HOST": "0.0.0.0", "FLASK_DEBUG": "1"}), \
                patch("flask_socketio.SocketIO.run") as run:
            with self.assertRaises(SystemExit):
                runpy.run_path(str(ROOT / "app.py"), run_name="__main__")
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
