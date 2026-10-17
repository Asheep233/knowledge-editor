"""61sol SD-R01：Origin 受信任集合的「生产/开发模式」区分回归。

背景：桌面 release 的 sidecar 由 Rust 注入 `KE_CORS_ORIGINS`（tauri 来源），但
`main.py` 的 Origin 写闸门仍**无条件**信任固定 dev 端口 localhost:5173。虽然利
用需要「本机存在恶意页面」这一前置条件（61sol 因此列为条件风险而非确认漏洞），
但 release 下凭空多信任一个网络来源属部署边界缺陷。
修复：仅在**未显式注入** KE_CORS_ORIGINS（开发模式）时信任固定 dev 端口。
"""
from __future__ import annotations

from types import SimpleNamespace

from app import config, main


def _req(host: str = "127.0.0.1:8000"):
    return SimpleNamespace(headers={"host": host})


def test_dev_mode_trusts_dev_port(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION_ORIGINS", False)
    allowed = main._trusted_origins(_req())
    assert "http://localhost:5173" in allowed
    assert "http://127.0.0.1:5173" in allowed
    assert "http://tauri.localhost" in allowed


def test_production_mode_drops_dev_port(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION_ORIGINS", True)
    monkeypatch.setattr(config, "CORS_ORIGINS", ["http://tauri.localhost"])
    allowed = main._trusted_origins(_req())
    assert "http://localhost:5173" not in allowed
    assert "http://127.0.0.1:5173" not in allowed
    assert "http://tauri.localhost" in allowed


def test_production_origin_write_rejected(client, monkeypatch):
    """生产模式 + Origin=localhost:5173 的写请求 → 403，副作用不发生。"""
    monkeypatch.setattr(config, "IS_PRODUCTION_ORIGINS", True)
    monkeypatch.setattr(config, "CORS_ORIGINS", ["http://tauri.localhost"])
    r = client.post(
        "/api/articles",
        json={"title": "origin-probe", "content": ""},
        headers={"Origin": "http://localhost:5173"},
    )
    assert r.status_code == 403, r.text
    # 副作用未发生：文档不存在
    assert client.get("/api/articles/Articles/origin-probe.md").status_code == 404


def test_dev_origin_write_allowed_in_dev_mode(client, monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION_ORIGINS", False)
    r = client.post(
        "/api/articles",
        json={"title": "origin-probe-dev", "content": ""},
        headers={"Origin": "http://localhost:5173"},
    )
    assert r.status_code == 201, r.text
