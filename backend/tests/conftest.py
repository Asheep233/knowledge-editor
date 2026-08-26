"""pytest 共享 fixture。

app.main 在首次 import 时读取 KE_WORKSPACE / KE_APP_CONFIG 环境变量并
固定为模块级常量，因此这里在 import 之前设置临时环境变量（避免污染用户真实
~/.knowledgeeditor/app_config.json）。

client 为函数级 fixture（P3-18 修复）：每个测试获得全新 TestClient +
独立临时 workspace。消除旧 session 级共享导致的顺序耦合（SQLite 双连接
泄漏、跨测试状态污染），使任意顺序/子集运行均确定。
"""
from __future__ import annotations

import os
import tempfile

import pytest

# 必须在 import app.main 之前设置
_CFG_DIR = tempfile.mkdtemp(prefix="ke-test-cfg-")
os.environ["KE_WORKSPACE"] = tempfile.mkdtemp(prefix="ke-test-ws-default-")
os.environ["KE_APP_CONFIG"] = os.path.join(_CFG_DIR, "app_config.json")
# 旧 Web 版位置同样隔离到临时目录（指向不存在的路径），避免迁移逻辑
# 把用户真实 ~/.knowledgeeditor/app_config.json 复制进测试环境
os.environ["KE_APP_CONFIG_LEGACY"] = os.path.join(_CFG_DIR, "legacy.json")

from app.services.indexer import WorkspaceIndexer  # noqa: E402
from app.services.workspace import ensure_workspace_structure  # noqa: E402
from app.store.db import IndexStore  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    """函数级客户端：每个测试独立的 workspace + 全新后端状态（P3-18）。"""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers.workspace import activate_workspace, close_workspace

    ws = ensure_workspace_structure(tmp_path / "ws")
    with TestClient(app) as c:
        activate_workspace(app, ws)
        try:
            yield c
        finally:
            close_workspace(app)


@pytest.fixture()
def default_ws_root(tmp_path):
    """每个测试独立的默认工作区根（str，与旧 session 版行为一致）。"""
    return str(ensure_workspace_structure(tmp_path / "ws"))


@pytest.fixture()
def ws_root(tmp_path):
    return ensure_workspace_structure(tmp_path / "ws")


@pytest.fixture()
def store(tmp_path):
    st = IndexStore(tmp_path / "idx" / "index.db").connect()
    yield st
    st.close()


@pytest.fixture()
def indexer(store, ws_root):
    return WorkspaceIndexer(store, ws_root)
