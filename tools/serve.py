"""Dev server for web/ with browser caching off, so edited modules and data always reload."""
import functools
import http.server
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
WEB = Path(__file__).resolve().parents[1] / 'web'


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(NoCache, directory=str(WEB))).serve_forever()
