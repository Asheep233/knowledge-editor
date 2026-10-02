"""task-55 / R07（AstraNota 独立审查 2026-10-02 · SEC-1）：本机 API 写操作的**来源校验**。

审查实测（真实本机服务）：`Origin: https://untrusted.example` 的
  · multipart POST /api/import/markdown → 201，真的新增 Articles/untrusted.md
  · 无正文 POST /api/workspace/close     → 200，工作区真的被关闭
原因：CORS 只阻止「跨源读响应」，不阻止「跨源发请求」（multipart / text/plain /
无正文 POST 都是 CORS 简单请求，不触发预检）。

本文件锁定修复后的语义：
  1) 不可信 Origin 的写请求 → 403，且**副作用不发生**（文件没建、工作区还开着）
  2) Origin: null → 403（沙箱 iframe / data: 页面的来源）
  3) 受信任 Origin（tauri.localhost / dev 端口 / 同源）→ 照常可用
  4) 无 Origin（桌面原生调用 / curl / TestClient）→ 保持既有可用性
     （浏览器对非 GET 请求总会带 Origin，故这不构成 CSRF 面；也是避免重演
      「KE_API_TOKEN 半成品导致应用整体不可用」事故的关键约束）
  5) OPTIONS 预检不被本闸门拦截；/api/health 任何来源都可用（sidecar 握手依赖）
  6) 安全方法（GET/HEAD）不受影响
"""
from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app as fastapi_app

UNTRUSTED = "https://untrusted.example"
TAURI = "http://tauri.localhost"
DEV = "http://127.0.0.1:5173"


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    """真实工作区（打开后所有写端点可用）"""
    monkeypatch.setenv("KE_WORKSPACE", str(tmp_path))
    with TestClient(fastapi_app) as client:
        r = client.post("/api/workspace/open", json={"path": str(tmp_path)})
        assert r.status_code == 200, r.text
        yield client, tmp_path


def _upload(client: TestClient, name: str, origin: str | None):
    headers = {"Origin": origin} if origin is not None else {}
    return client.post(
        "/api/import/markdown",
        files={"file": (name, io.BytesIO(b"# x\n"), "text/markdown")},
        headers=headers,
    )


# --------------------------------------------------------------- 1. 攻击面被堵

class TestUntrustedOriginBlocked:
    def test_multipart_import_403_and_no_file(self, ws):
        client, root = ws
        r = _upload(client, "untrusted.md", UNTRUSTED)
        assert r.status_code == 403, f"不可信来源的导入必须被拒，实际 {r.status_code}: {r.text}"
        assert not (root / "Articles" / "untrusted.md").exists(), "副作用不得发生（文件不得被创建）"

    def test_null_origin_403_and_no_file(self, ws):
        client, root = ws
        r = _upload(client, "nullorigin.md", "null")
        assert r.status_code == 403
        assert not (root / "Articles" / "nullorigin.md").exists()

    def test_workspace_close_403_and_still_open(self, ws):
        client, _root = ws
        r = client.post("/api/workspace/close", headers={"Origin": UNTRUSTED})
        assert r.status_code == 403, "不可信来源不得关闭工作区"
        cur = client.get("/api/workspace/current")
        assert cur.status_code == 200
        assert json.loads(cur.text).get("open") is True, "工作区必须仍然打开"

    def test_create_dir_403(self, ws):
        client, root = ws
        r = client.post(
            "/api/fs/dir",
            json={"path": "Articles/csrf"},
            headers={"Origin": UNTRUSTED, "Content-Type": "text/plain"},
        )
        assert r.status_code == 403
        assert not (root / "Articles" / "csrf").exists()

    def test_delete_403(self, ws):
        client, root = ws
        # 先合法建一个文档
        ok = _upload(client, "keep.md", None)
        assert ok.status_code == 201, ok.text
        path = root / "Articles" / "keep.md"
        assert path.exists()
        aid = json.loads(ok.text)["path"]
        r = client.request("DELETE", f"/api/articles?id={aid}", headers={"Origin": UNTRUSTED})
        assert r.status_code in (403, 405)
        assert path.exists(), "不可信来源不得删除文档"

    def test_untrusted_preflight_not_500(self, ws):
        """预检不被本闸门拦（不可信来源由 CORS 层拒绝，语义为 400，不得 403/500）"""
        client, _root = ws
        r = client.options(
            "/api/import/markdown",
            headers={"Origin": UNTRUSTED, "Access-Control-Request-Method": "POST"},
        )
        assert r.status_code in (200, 400, 204), r.text


# --------------------------------------------------------------- 2. 合法来源不受影响

class TestTrustedOriginsUnaffected:
    @pytest.mark.parametrize("origin", [TAURI, "https://tauri.localhost", DEV, "http://localhost:5173"])
    def test_trusted_origin_import_ok(self, ws, origin):
        client, root = ws
        r = _upload(client, f"ok-{abs(hash(origin))}.md", origin)
        assert r.status_code == 201, f"受信来源 {origin} 必须可用：{r.status_code} {r.text}"

    def test_same_origin_ok(self, ws):
        client, _root = ws
        r = client.post(
            "/api/fs/dir",
            json={"path": "Articles/same"},
            headers={"Origin": "http://testserver"},
        )
        assert r.status_code == 201, f"同源调用必须可用：{r.status_code} {r.text}"

    def test_no_origin_keeps_working(self, ws):
        """桌面原生调用 / curl / 既有测试客户端：无 Origin 一律放行（不得回归）"""
        client, root = ws
        r = _upload(client, "no-origin.md", None)
        assert r.status_code == 201
        assert (root / "Articles" / "no-origin.md").exists()

    def test_trailing_slash_origin_normalized(self, ws):
        client, _root = ws
        r = client.post(
            "/api/fs/dir",
            json={"path": "Articles/slash"},
            headers={"Origin": TAURI + "/"},
        )
        assert r.status_code == 201, "尾部斜杠不应导致误拒"


# --------------------------------------------------------------- 3. 豁免面

class TestExemptions:
    def test_health_any_origin(self):
        with TestClient(fastapi_app) as client:
            for origin in (None, UNTRUSTED, "null", TAURI):
                headers = {"Origin": origin} if origin else {}
                r = client.get("/api/health", headers=headers)
                assert r.status_code == 200, f"健康检查必须任何来源可用：{origin} → {r.status_code}"

    def test_safe_methods_not_gated(self, ws):
        client, _root = ws
        for path in ("/api/health", "/api/workspace/current", "/api/tree"):
            r = client.get(path, headers={"Origin": UNTRUSTED})
            assert r.status_code == 200, f"{path} 是安全方法，不得被来源闸门拦截：{r.status_code}"

    def test_preflight_trusted_origin_not_blocked_by_gate(self, ws):
        """受信来源预检不得被**本闸门**拦截（不得出现 403）。
        注：桌面形态下 `KE_CORS_ORIGINS` 含 tauri.localhost 时预检 200 —— 该路径由
        task-55 的真实 uvicorn HTTP 探针实测（probe: I2 预检 受信 → 200），
        这里不 reload 模块以免污染同进程其它用例。"""
        client, _root = ws
        r = client.options(
            "/api/import/markdown",
            headers={"Origin": TAURI, "Access-Control-Request-Method": "POST"},
        )
        assert r.status_code != 403, f"预检不得被来源闸门拒绝：{r.status_code}"
        assert r.status_code in (200, 204, 400)


# --------------------------------------------------------------- 4. 配置卫生

class TestConfigHygiene:
    def test_no_credentials_and_origin_gate_present(self):
        from app import main as main_mod

        src = open(main_mod.__file__, encoding="utf-8").read()
        assert "allow_credentials=False" in src
        assert "verify_request_origin" in src
        # 不得再引入 token 校验（避免重演半成品事故）
        assert "X-KE-Token" not in src and "x-ke-token" not in src

    def test_api_token_documented_dead(self):
        from app import config as config_mod

        src = open(config_mod.__file__, encoding="utf-8").read()
        assert "API_TOKEN" in src
        # 误导性旧注释必须已更正
        assert "sidecar 启动时生成并注入前端" not in src
        assert "已废弃的死配置" in src
