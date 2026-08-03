import mitmproxy.http
import json
import threading
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import random
import string
import time


class ExtractSetCookie:
    def __init__(self):
        self.cookies = {}

    def response(self, flow: mitmproxy.http.HTTPFlow):
        if flow.request.pretty_host != "mp.weixin.qq.com":
            return

        parsed_url = urlparse(flow.request.url)
        query_params = parse_qs(parsed_url.query)
        biz = query_params.get('__biz', [None])[0]
        pass_ticket = query_params.get('pass_ticket', [None])[0]
        uin = query_params.get('uin', [None])[0] or flow.request.headers.get("x-wechat-uin")
        key = query_params.get('key', [None])[0] or flow.request.headers.get("x-wechat-key")
        if not all([biz, pass_ticket, uin, key]):
            return

        set_cookie_headers = flow.response.headers.get_all("Set-Cookie")
        timestamp = int(time.time() * 1000)
        self.cookies[biz] = {
            "url": flow.request.url,
            "set_cookie": ", ".join(set_cookie_headers),
            "biz": biz,
            "uin": uin,
            "key": key,
            "pass_ticket": pass_ticket,
            "exportkey": flow.request.headers.get("exportkey", ""),
            "user_agent": flow.request.headers.get("user-agent", ""),
            "referer": flow.request.headers.get("referer", ""),
            "acct_mode": flow.request.headers.get("x-wechat-acctmode", ""),
            "cookie": flow.request.headers.get("cookie", ""),
            "timestamp": timestamp,
        }
        with open("credentials.json", "w", encoding="utf-8") as file:
            json.dump(list(self.cookies.values()), file, ensure_ascii=False, indent=4)


addons = [
    ExtractSetCookie(),
]

# 生成一个长度为36的随机字符串作为会话密钥
session_key = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
print(f"本次会话的密钥: {session_key}")


# 创建一个简单的 HTTP 服务器来提供 credentials.json 文件
def start_http_server():
    class CustomHandler(SimpleHTTPRequestHandler):
        def end_headers(self):
            # 添加 CORS 头
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(200)
            self.end_headers()

        def do_GET(self):
            print(self.path)
            auth_header = self.headers.get("Authorization")
            if auth_header != session_key:
                self.send_response(401)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"Unauthorized")
                return

            if self.path == "/authorize":
                self.send_response(200)
                self.end_headers()
                return
            elif self.path == "/credentials":
                self.path = "/credentials.json"
                return SimpleHTTPRequestHandler.do_GET(self)
            else:
                self.send_response(403)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"Forbidden")
                return

    server_address = ('', 8088)
    httpd = HTTPServer(server_address, CustomHandler)
    # print("API server listening *:8088")
    httpd.serve_forever()


# 在一个单独的线程中启动 HTTP 服务器
threading.Thread(target=start_http_server, daemon=True).start()
