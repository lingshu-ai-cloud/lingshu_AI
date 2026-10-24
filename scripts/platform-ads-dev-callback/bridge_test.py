import contextlib
import io
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from bridge import CALLBACK, create_server
from result_page import CSP, PREVIEW


class BridgeTests(unittest.TestCase):
    def test_transport_is_callback_only_and_never_logs_credentials(self):
        requests = []
        upstream_status = 200

        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, dict(self.headers)))
                self.send_response(upstream_status)
                self.end_headers()
                self.wfile.write(b"secret-upstream-body")

            def log_message(self, *_args):
                pass

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        bridge = create_server("127.0.0.1", 0, upstream.server_port)
        for server in [upstream, bridge]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{bridge.server_port}"
        query = "?state=" + "a" * 43 + "&code=secret-test-code"

        def request(path, method="GET", headers=None):
            try:
                return urlopen(Request(base + path, method=method, headers=headers or {}), timeout=3)
            except HTTPError as error:
                return error

        logs = io.StringIO()
        try:
            with contextlib.redirect_stderr(logs):
                for path in ["/", "/api/collections", "/api/overseas/auth/login", CALLBACK + "/", CALLBACK.replace("callback", "%63allback")]:
                    self.assertEqual(request(path).status, 404)
                self.assertEqual(request(CALLBACK + query, "POST").status, 405)
                for suffix in ["&state=duplicate", "&next=https://evil.invalid", "&error=denied"]:
                    self.assertEqual(request(CALLBACK + query + suffix).status, 400)
                self.assertEqual(request(CALLBACK).status, 400)
                self.assertFalse(requests)
                result = request(CALLBACK + query, headers={"Authorization": "Bearer secret", "Cookie": "private=session"})
                self.assertEqual(result.status, 200)
                self.assertEqual(result.headers["Cache-Control"], "no-store")
                self.assertEqual(result.headers["Content-Security-Policy"], CSP)
                body = result.read().decode()
                self.assertIn("授权回调已处理", body)
                self.assertIn(PREVIEW, body)
                self.assertNotIn("secret", body)
                self.assertNotIn("<script", body)
                self.assertTrue(result.url.endswith("?result=received"))
                self.assertNotIn("state=", result.url)
                count = len(requests)
                self.assertEqual(request(CALLBACK + "?result=received").status, 200)
                self.assertEqual(len(requests), count, "refresh never replays the callback")
                self.assertNotIn("Authorization", requests[0][1])
                self.assertNotIn("Cookie", requests[0][1])
                result = request(CALLBACK + "?state=" + "a" * 43 + "&error=denied&error_description=private")
                self.assertEqual(result.status, 200)
                self.assertNotIn("private", requests[-1][0])
                upstream_status = 409
                replay = request(CALLBACK + query)
                self.assertEqual(replay.status, 409, "expired callback must not pretend success")
                self.assertIn("已使用或过期", replay.read().decode())
                count = len(requests)
                self.assertEqual(request(CALLBACK + "?result=expired").status, 409)
                self.assertEqual(len(requests), count)
                self.assertEqual(request(CALLBACK + "?result=received&code=secret").status, 400)
                self.assertEqual(request(CALLBACK + "?result=unknown").status, 400)
                upstream.shutdown()
                upstream.server_close()
                offline = request(CALLBACK + query)
                self.assertEqual(offline.status, 503)
                self.assertIn("开发授权通道暂不可用", offline.read().decode())
            self.assertEqual(logs.getvalue(), "")
        finally:
            bridge.shutdown()
            bridge.server_close()
            upstream.server_close()


if __name__ == "__main__":
    unittest.main()
