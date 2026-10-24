"""Static transport results; never assert that an account has been connected."""
from base64 import b64encode
from hashlib import sha256
from html import escape

PREVIEW = "http://localhost:5197/?page=adsPlans"
STYLES = """body{margin:0;background:#fff;color:#171717;font:16px/1.6 system-ui,-apple-system,sans-serif}main{max-width:560px;margin:12vh auto;padding:32px 24px}small,p{color:#52525b}h1{font-size:26px;font-weight:600;line-height:1.4}a{display:inline-block;margin-top:16px;padding:10px 20px;border-radius:8px;background:linear-gradient(100deg,#2563eb,#7c3aed);color:#fff;text-decoration:none}a:focus-visible{outline:3px solid #2563eb;outline-offset:4px}@media(prefers-reduced-motion:no-preference){a{transition:opacity .15s}a:hover{opacity:.9}}"""
CSP = ("default-src 'none'; style-src 'sha256-" + b64encode(sha256(STYLES.encode()).digest()).decode()
       + "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
RESULTS = {
    "received": (200, "授权回调已处理", "请返回灵枢，继续选择广告账户和主页，或查看已保存的连接。"),
    "cancelled": (200, "已取消本次授权", "已有广告账户连接保持不变。你可以返回灵枢重新开始。"),
    "expired": (409, "此授权链接已使用或过期", "如果刚才已完成连接，已有连接仍会保留。请返回灵枢查看状态；如未完成，请重新授权。"),
    "invalid": (400, "授权链接不完整", "请从灵枢的“连接广告账户”入口重新开始。"),
    "denied": (403, "本次授权未能完成", "请返回灵枢核对账户权限，再重新开始。"),
    "limited": (429, "授权请求过于频繁", "请稍后返回灵枢检查授权进度，不要连续刷新此页。"),
    "failed": (500, "授权服务处理异常", "已有连接不会因此被删除。请返回灵枢检查状态后重试。"),
    "upstream": (502, "暂时无法连接本地授权服务", "请确认本地预览正在运行，再返回灵枢重试。已有连接会保留。"),
    "unavailable": (503, "开发授权通道暂不可用", "请确认本地预览和开发通道仍在运行，再返回灵枢重试。已有连接会保留。"),
    "timeout": (504, "授权服务响应超时", "请先返回灵枢检查授权是否已完成，不要重复提交。"),
}


def render_result(kind):
    status, title, detail = RESULTS[kind]
    body = ("<!doctype html><html lang=zh-CN><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>" + escape(title) + " · 灵枢</title><style>" + STYLES + "</style>"
            "<main><small>灵枢 · 广告账户连接</small><h1>" + escape(title) + "</h1><p>"
            + escape(detail) + "</p><a href='" + PREVIEW + "' referrerpolicy=no-referrer>返回本地灵枢</a>"
            "<p><small>本页不会启动广告。返回后可关闭此窗口。</small></p></main></html>").encode()
    return status, body
