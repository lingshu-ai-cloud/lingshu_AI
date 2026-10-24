"""Transport-only development callback bridge. Never serves business APIs."""
from http.client import HTTPConnection, HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore, Lock
from time import monotonic
from urllib.parse import parse_qsl, urlencode, urlsplit
import re
from result_page import CSP, RESULTS, render_result

CALLBACK = "/api/overseas/platform-ads/oauth/meta/callback"
ALLOWED = {"state", "code", "error", "error_reason", "error_description", "error_code"}


def create_server(bind="172.18.0.1", port=18893, upstream_port=18892):
    if not isinstance(upstream_port, int) or not 1 <= upstream_port <= 65535:
        raise ValueError("Invalid loopback port")
    limits = {"start": monotonic(), "count": 0}
    limit_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "DevCallback"
        sys_version = ""

        def log_message(self, *_args):
            pass  # URLs contain OAuth code/state: never log request lines.

        def reply(self, status):
            body = ("Callback received; return to the local preview." if status == 200
                    else "Development callback unavailable; return to the local preview.").encode()
            self.send_response(status)
            for key, value in {
                "Content-Type": "text/plain; charset=utf-8", "Content-Length": str(len(body)),
                "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff", "Connection": "close",
                "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            }.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def result(self, kind, redirect=True):
            status, body = render_result(kind)
            self.send_response(303 if redirect else status)
            headers = {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
                       "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
                       "Content-Security-Policy": CSP, "Connection": "close"}
            if redirect:
                # Remove code/state from the address before displaying a refreshable result.
                headers["Location"] = CALLBACK + "?result=" + kind
                body = b""
            headers["Content-Length"] = str(len(body))
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if len(self.path) > 12000:
                self.reply(413)
                return
            if self.path.split("?")[0] != CALLBACK:
                self.reply(404)
                return
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                self.reply(413)
                return
            try:
                pairs = parse_qsl(urlsplit(self.path).query, keep_blank_values=True,
                                  strict_parsing=True, max_num_fields=8)
                query = dict(pairs)
                if len(pairs) == 1 and "result" in query and query["result"] in RESULTS:
                    self.result(query["result"], redirect=False)
                    return  # Static result refresh never forwards or exchanges a code.
                if len(query) != len(pairs) or any(key not in ALLOWED for key in query):
                    raise ValueError()
                state, code, error = query.get("state", ""), query.get("code", ""), query.get("error", "")
                if not re.fullmatch(r"[A-Za-z0-9_-]{43}", state) or bool(code) == bool(error) or len(code) > 10000 or len(error) > 128:
                    raise ValueError()
            except ValueError:
                self.result("invalid")
                return
            with limit_lock:
                if monotonic() - limits["start"] >= 60:
                    limits.update(start=monotonic(), count=0)
                limits["count"] += 1
                permitted = limits["count"] <= 30
            if not permitted:
                self.result("limited")
                return
            connection = HTTPConnection("127.0.0.1", upstream_port, timeout=50)
            try:
                # Ignore incoming auth, cookies, proxy headers and error descriptions.
                params = {"state": state, **({"code": code} if code else {"error": error})}
                connection.request("GET", CALLBACK + "?" + urlencode(params), headers={"Accept": "text/plain"})
                response = connection.getresponse()
                kind = ({400: "invalid", 401: "expired", 403: "denied", 404: "expired", 409: "expired",
                         429: "limited", 500: "failed", 502: "upstream", 503: "unavailable", 504: "timeout"}
                        .get(response.status, "upstream"))
                if response.status == 200:
                    kind = "cancelled" if error else "received"
                self.result(kind)
            except (OSError, ValueError, HTTPException):
                self.result("unavailable")
            finally:
                connection.close()

        def unsupported(self):
            self.reply(405)

        do_POST = do_HEAD = do_OPTIONS = do_PUT = do_DELETE = do_PATCH = unsupported

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 8

        def __init__(self, *args):
            self.slots = BoundedSemaphore(8)
            super().__init__(*args)

        def get_request(self):
            socket, address = super().get_request()
            socket.settimeout(10)
            return socket, address

        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request)
                return
            try:
                super().process_request(request, client_address)
            except Exception:
                self.slots.release()
                raise

        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()

        def handle_error(self, _request, _client_address):
            pass  # No exception may log a credential-bearing request.

    return Server((bind, port), Handler)


if __name__ == "__main__":
    create_server().serve_forever()
