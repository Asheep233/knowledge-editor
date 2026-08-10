"""pytest 共享 fixture。

注意：app.main 在首次 import 时读取 KE_WORKSPACE / KE_APP_CONFIG 环境变量并
固定为模块级常量，因此这里在 import 之前设置 session 级临时 workspace 与
临时软件配置文件（避免污染用户真实 ~/.knowledgeeditor/app_config.json）。
"""
from __future__ import annotations

import os
import tempfile

import pytest

# 必须在 import app.main 之前设置
_WS = tempfile.mkdtemp(prefix="ke-test-ws-")
os.environ["KE_WORKSPACE"] = _WS
os.environ["KE_APP_CONFIG"] = os.path.join(
    tempfile.mkdtemp(prefix="ke-test-cfg-"), "app_config.json"
)
# 旧 Web 版位置同样隔离到临时目录（指向不存在的路径），避免迁移逻辑
# 把用户真实 ~/.knowledgeeditor/app_config.json 复制进测试环境
os.environ["KE_APP_CONFIG_LEGACY"] = os.path.join(
    tempfile.mkdtemp(prefix="ke-test-legacy-"), "app_config.json"
)

from app.services.indexer import WorkspaceIndexer  # noqa: E402
from app.services.workspace import ensure_workspace_structure  # noqa: E402
from app.store.db import IndexStore  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def default_ws_root():
    """session 级默认工作区根（conftest 创建的临时目录）。"""
    return _WS


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
