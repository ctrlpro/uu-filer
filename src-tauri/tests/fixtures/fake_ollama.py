"""Protocol fixture only: no model, no external requests, no production use."""
import http.server
import json
import os
import sys

assert os.environ.get("OLLAMA_NO_CLOUD") == "1"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data, status=200):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.reply({"models": [{"name": "fixture-local"}]})

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/show":
            return self.reply({"capabilities": ["completion", "vision"],
                               "remote_host": "https://example.invalid" if data["model"] == "fixture-cloud" else ""})
        with open(sys.argv[1], "a", encoding="utf-8") as log:
            log.write(json.dumps(data, ensure_ascii=False) + "\n")
        if "ordered, reusable" in data["messages"][0]["content"]:
            return self.reply({"message": {"content": json.dumps({"rules": [{"kind": "prefix", "params": {"text": "项目 A_"}}, {"kind": "spaces", "params": {"separator": "_"}}], "explanation": "先加前缀，再替换空格"}, ensure_ascii=False)}})
        suggestions = []
        for line in data["messages"][1]["content"].splitlines():
            try:
                item = json.loads(line)
                if "id" in item and "name" in item:
                    suggestions.append({"id": item["id"], "name": "整理_" + item["name"], "reason": "测试协议返回"})
            except (json.JSONDecodeError, TypeError):
                pass
        self.reply({"message": {"content": json.dumps({"suggestions": suggestions}, ensure_ascii=False)}})


server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
print(server.server_port, flush=True)
server.serve_forever()
