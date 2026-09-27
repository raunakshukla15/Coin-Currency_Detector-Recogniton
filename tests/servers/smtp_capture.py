"""Minimal SMTP capture server for Contact-Us email tests (stdlib only).

Python 3.12+ removed the smtpd module, so this speaks SMTP directly over
sockets. It is deliberately plaintext: the backend is pointed here with
SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_STARTTLS=0 (2525 is not a submission
port, so SMTP_STARTTLS defaults to off — see backend/config.py).

Run:
    python tests/servers/smtp_capture.py --port 2525 --mode accept \
        --jsonl tests/servers/.smtp_capture.jsonl

Modes:
    accept   AUTH/MAIL/RCPT/DATA all succeed; each message is appended to the
             JSONL file (subject, from, to, body) for test assertions.
    reject   SMTP conversation works but DATA is answered with 550 — the
             backend's send_email() must return False (emailSent=false) while
             the contact row stays persisted.

"Email failed because the server is unreachable" is tested by simply NOT
running this server (or pointing SMTP_PORT at a closed port).
"""

import argparse
import base64
import json
import socket
import socketserver
import threading
import time

JSONL_PATH = "smtp_capture.jsonl"
MODE = "accept"
SAVE = True


def _append_message(record: dict) -> None:
    if not SAVE or not JSONL_PATH:
        return
    with open(JSONL_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


class SMTPHandler(socketserver.BaseRequestHandler):
    def handle(self):
        sock: socket.socket = self.request
        sock.settimeout(30)
        try:
            self._session(sock)
        except (ConnectionResetError, BrokenPipeError, socket.timeout, OSError):
            pass

    def _send(self, sock: socket.socket, line: str) -> None:
        sock.sendall((line + "\r\n").encode("utf-8"))

    @staticmethod
    def _recv_line(sock: socket.socket, buf: bytearray) -> str | None:
        # Persistent per-connection buffer: clients pipeline multiple lines in
        # one TCP segment, and bytes beyond the first '\n' must not be lost.
        while True:
            idx = buf.find(b"\n")
            if idx != -1:
                line = bytes(buf[: idx + 1])
                del buf[: idx + 1]
                return line.decode("utf-8", "replace").rstrip("\r\n")
            chunk = sock.recv(4096)
            if not chunk:
                return None
            buf.extend(chunk)

    def _session(self, sock: socket.socket) -> None:
        self._send(sock, "220 coinscan-capture ESMTP ready")

        buf = bytearray()
        state = {"in_data": False, "mail": "", "rcpts": [], "data": []}
        while True:
            line = self._recv_line(sock, buf)
            if line is None:
                return

            if state["in_data"]:
                if line == ".":
                    state["in_data"] = False
                    body = "\n".join(state["data"])
                    if MODE == "reject":
                        state["mail"], state["rcpts"], state["data"] = "", [], []
                        self._send(sock, "550 5.7.1 Message rejected by capture server")
                        continue
                    headers = body.split("\n\n", 1)
                    raw_headers = headers[0] if headers else ""
                    text = headers[1] if len(headers) > 1 else ""
                    subject = ""
                    for hl in raw_headers.split("\n"):
                        if hl.lower().startswith("subject:"):
                            subject = hl.split(":", 1)[1].strip()
                    _append_message({
                        "ts": time.time(),
                        "from": state["mail"],
                        "rcpts": list(state["rcpts"]),
                        "subject": subject,
                        "body": text,
                        "raw": body,
                    })
                    state["mail"], state["rcpts"], state["data"] = "", [], []
                    self._send(sock, "250 2.0.0 Ok: queued by capture server")
                else:
                    # Dot-unstuffing: a leading '.' is literal.
                    state["data"].append(line[1:] if line.startswith("..") else line)
                continue

            cmd = line.strip()
            upper = cmd.upper()

            if upper.startswith("EHLO"):
                self._send(sock, "250-coinscan-capture")
                self._send(sock, "250-AUTH PLAIN LOGIN")
                self._send(sock, "250-8BITMIME")
                self._send(sock, "250 OK")
            elif upper.startswith("HELO"):
                self._send(sock, "250 coinscan-capture")
            elif upper.startswith("AUTH PLAIN"):
                # Credentials are accepted for any base64 blob.
                self._send(sock, "235 2.7.0 Authentication successful")
            elif upper.startswith("AUTH LOGIN"):
                self._send(sock, "334 VXNlcm5hbWU6")
                if self._recv_line(sock, buf) is None:
                    return
                self._send(sock, "334 UGFzc3dvcmQ6")
                if self._recv_line(sock, buf) is None:
                    return
                self._send(sock, "235 2.7.0 Authentication successful")
            elif upper.startswith("MAIL FROM"):
                if MODE == "reject":
                    self._send(sock, "553 5.1.7 Sender address rejected")
                    continue
                state["mail"] = cmd.split(":", 1)[1].strip().strip("<>")
                self._send(sock, "250 2.1.0 Ok")
            elif upper.startswith("RCPT TO"):
                if MODE == "reject":
                    self._send(sock, "550 5.1.1 Recipient rejected")
                    continue
                state["rcpts"].append(cmd.split(":", 1)[1].strip().strip("<>"))
                self._send(sock, "250 2.1.5 Ok")
            elif upper == "DATA":
                if not state["rcpts"]:
                    self._send(sock, "554 5.5.1 No valid recipients")
                else:
                    state["in_data"] = True
                    state["data"] = []
                    self._send(sock, "354 End data with <CR><LF>.<CR><LF>")
            elif upper == "RSET":
                state["mail"], state["rcpts"], state["data"] = "", [], []
                self._send(sock, "250 2.0.0 Ok")
            elif upper == "NOOP":
                self._send(sock, "250 2.0.0 Ok")
            elif upper == "QUIT":
                self._send(sock, "221 2.0.0 Bye")
                return
            elif upper.startswith("STARTTLS"):
                # Plaintext capture server: refuse TLS so misconfiguration in
                # tests fails loudly instead of hanging.
                self._send(sock, "454 4.7.0 TLS not available on capture server")
            else:
                self._send(sock, "250 2.0.0 Ok")


class ThreadedTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    global JSONL_PATH, MODE, SAVE
    parser = argparse.ArgumentParser(description="SMTP capture server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2525)
    parser.add_argument("--mode", choices=["accept", "reject"], default="accept")
    parser.add_argument("--jsonl", default="tests/servers/.smtp_capture.jsonl")
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args()

    MODE = args.mode
    JSONL_PATH = args.jsonl
    SAVE = not args.no_save

    server = ThreadedTCPServer((args.host, args.port), SMTPHandler)
    print(
        f"smtp_capture listening on {args.host}:{args.port} mode={MODE} "
        f"jsonl={JSONL_PATH if SAVE else '(not saving)'}",
        flush=True,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
