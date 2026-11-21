#!/usr/bin/env python3
"""Arabic Typing Trainer - fully local server.

Stdlib only. Serves the web app and stores everything in data/trainer.db.
No network access beyond 127.0.0.1.
"""

import csv
import io
import json
import os
import sqlite3
import sys
import threading
import urllib.request
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA, "trainer.db")
PORT = int(os.environ.get("TRAINER_PORT", "8765"))

COLUMNS = {
    "sessions": ["id", "start", "end", "layout", "switched_keyboard",
                 "switch_seconds", "frust_rating", "notes", "tutor_rating"],
    "rounds": ["id", "session_id", "mode", "text_id", "start", "end",
               "exited_early", "continued", "accuracy", "cpm", "wpm",
               "chars", "mistakes", "clean_run", "items", "correct_items"],
    "keystrokes": ["id", "round_id", "session_id", "t", "appeared", "expected",
                   "key", "code", "shift", "correct", "error_class"],
    "texts": ["id", "source", "content", "date_added", "title"],
    "baselines": ["id", "date", "text_id", "seconds", "words", "errors_tehe",
                  "errors_ya", "errors_hamza", "note"],
    "signals": ["id", "session_id", "round_id", "t", "type", "at"],
    "bests": ["key", "value", "text_id", "achieved"],
    "meta": ["key", "value"],
}
PRIMARY = {
    "sessions": "id", "rounds": "id", "texts": "id", "baselines": "id",
    "signals": "id", "bests": "key", "meta": "key",
}
AUTOINCREMENT = {"keystrokes"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, start INTEGER, "end" INTEGER, layout TEXT,
  switched_keyboard INTEGER, switch_seconds REAL, frust_rating INTEGER,
  notes TEXT, tutor_rating INTEGER);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, session_id TEXT, mode TEXT, text_id TEXT,
  start INTEGER, "end" INTEGER, exited_early INTEGER, continued INTEGER,
  accuracy REAL, cpm REAL, wpm REAL, chars INTEGER, mistakes INTEGER,
  clean_run INTEGER, items INTEGER, correct_items INTEGER);
CREATE TABLE IF NOT EXISTS keystrokes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT, session_id TEXT,
  t INTEGER, appeared INTEGER, expected TEXT, key TEXT, code TEXT,
  shift INTEGER, correct INTEGER, error_class TEXT);
CREATE INDEX IF NOT EXISTS idx_ks_round ON keystrokes(round_id);
CREATE INDEX IF NOT EXISTS idx_ks_session ON keystrokes(session_id);
CREATE TABLE IF NOT EXISTS texts (
  id TEXT PRIMARY KEY, source TEXT, content TEXT, date_added INTEGER, title TEXT);
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY, date INTEGER, text_id TEXT, seconds REAL, words INTEGER,
  errors_tehe INTEGER, errors_ya INTEGER, errors_hamza INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY, session_id TEXT, round_id TEXT, t INTEGER, type TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS bests (
  key TEXT PRIMARY KEY, value REAL, text_id TEXT, achieved INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

_lock = threading.Lock()


def connect():
    os.makedirs(DATA, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def rows_to_dicts(cur):
    return [dict(r) for r in cur.fetchall()]


def read_all(days):
    """Return every table as a list of dicts, keystrokes limited by session age."""
    with _lock:
        conn = connect()
        try:
            out = {}
            for table in COLUMNS:
                if table == "keystrokes" and days > 0:
                    cutoff = int(time.time() * 1000) - days * 86400000
                    cut = conn.execute(
                        "SELECT MIN(start) FROM (SELECT start FROM rounds WHERE start >= ? "
                        "UNION ALL SELECT ?)", (cutoff, cutoff)).fetchone()[0]
                    cur = conn.execute(
                        "SELECT k.* FROM keystrokes k JOIN rounds r ON r.id = k.round_id "
                        "WHERE r.start >= ? ORDER BY k.id", (cut,))
                elif table in ("rounds", "sessions") and days > 0:
                    cutoff = int(time.time() * 1000) - days * 86400000
                    cur = conn.execute(
                        'SELECT * FROM %s WHERE start >= ? ORDER BY start' % table, (cutoff,))
                elif table == "signals" and days > 0:
                    cutoff = int(time.time() * 1000) - days * 86400000
                    cur = conn.execute(
                        "SELECT * FROM signals WHERE at >= ? ORDER BY at", (cutoff,))
                else:
                    cur = conn.execute("SELECT * FROM %s" % table)
                out[table] = rows_to_dicts(cur)
            return out
        finally:
            conn.close()


def insert_rows(table, rows):
    cols = COLUMNS.get(table)
    if not cols:
        raise ValueError("unknown table " + table)
    if not isinstance(rows, list):
        raise ValueError("rows must be a list")
    inserted = 0
    with _lock:
        conn = connect()
        try:
            for row in rows:
                use = [c for c in cols if c in row]
                if not use:
                    continue
                sql = "INSERT OR REPLACE INTO %s (%s) VALUES (%s)" % (
                    table, ",".join("'%s'" % c if c == "key" else c for c in use),
                    ",".join("?" * len(use)))
                try:
                    conn.execute(sql, [row[c] for c in use])
                    inserted += 1
                except sqlite3.IntegrityError:
                    pass
            conn.commit()
            return inserted
        finally:
            conn.close()


def update_row(table, row_id, patch):
    cols = COLUMNS.get(table)
    pk = PRIMARY.get(table)
    if not cols or not pk:
        raise ValueError("table not updatable")
    use = [c for c in cols if c in patch and c != pk]
    if not use:
        return 0
    with _lock:
        conn = connect()
        try:
            sets = ",".join("%s=?" % ("'%s'" % c if c == "key" else c) for c in use)
            cur = conn.execute(
                "UPDATE %s SET %s WHERE %s=?" % (table, sets, pk),
                [patch[c] for c in use] + [row_id])
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


def delete_row(table, row_id):
    cols = COLUMNS.get(table)
    pk = PRIMARY.get(table)
    if not cols or not pk:
        raise ValueError("table not deletable")
    with _lock:
        conn = connect()
        try:
            cur = conn.execute("DELETE FROM %s WHERE %s=?" % (table, pk), (row_id,))
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


def export_csv(table):
    cols = COLUMNS[table]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    with _lock:
        conn = connect()
        try:
            for row in conn.execute("SELECT * FROM %s" % table):
                writer.writerow([row[c] for c in cols])
        finally:
            conn.close()
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    # On Windows Python takes .js MIME types from the registry, where some
    # machines map .js to text/plain. The browser then refuses every ES module
    # and the page stays blank, so the types the app needs are pinned here.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _file(self, path, filename, ctype):
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            qs = parse_qs(parsed.query)
            if path == "/api/health":
                return self._json({"ok": True, "db": DB_PATH, "version": 1})
            if path == "/api/data":
                days = int((qs.get("days") or ["120"])[0] or 0)
                try:
                    return self._json(read_all(days))
                except Exception as exc:  # noqa: BLE001
                    return self._json({"error": str(exc)}, 500)
            if path.startswith("/api/export/"):
                table = path.rsplit("/", 1)[-1].replace(".csv", "")
                if table not in COLUMNS:
                    return self._json({"error": "unknown table"}, 404)
                body = export_csv(table).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition",
                                 'attachment; filename="%s.csv"' % table)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            if path == "/api/backup":
                return self._file(DB_PATH, "trainer-backup.db", "application/octet-stream")
            return self._json({"error": "not found"}, 404)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
        except Exception as exc:  # noqa: BLE001
            return self._json({"error": "bad json: %s" % exc}, 400)
        try:
            if path == "/api/insert":
                return self._json({"ok": True, "inserted": insert_rows(
                    body.get("table"), body.get("rows") or [])})
            if path == "/api/update":
                return self._json({"ok": True, "updated": update_row(
                    body.get("table"), body.get("id"), body.get("patch") or {})})
            if path == "/api/delete":
                return self._json({"ok": True, "deleted": delete_row(
                    body.get("table"), body.get("id"))})
        except Exception as exc:  # noqa: BLE001
            return self._json({"error": str(exc)}, 400)
        return self._json({"error": "not found"}, 404)

    def end_headers(self):
        if self.path.endswith((".js", ".css", ".html")) or self.path == "/":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def already_serving():
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % PORT, timeout=1) as res:
            return bool(json.loads(res.read().decode("utf-8")).get("ok"))
    except Exception:  # noqa: BLE001
        return False


def main():
    os.makedirs(WEB, exist_ok=True)
    connect().close()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as exc:
        if exc.errno not in (48, 98):  # EADDRINUSE on macOS / Linux
            raise
        if already_serving():
            print("The trainer is already running at http://127.0.0.1:%d" % PORT, flush=True)
            print("Nothing to do - open that address in the browser.", flush=True)
            return 0
        print("Port %d is taken by another program." % PORT, file=sys.stderr, flush=True)
        print("Quit that program, or run: TRAINER_PORT=8766 python3 server.py", file=sys.stderr, flush=True)
        return 1
    print("Arabic Typing Trainer running at http://127.0.0.1:%d" % PORT, flush=True)
    print("Database: %s" % DB_PATH, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
