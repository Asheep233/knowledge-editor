"""Phase 7 M4：app_config.json 旧 Web 版位置并入应用数据目录的迁移测试。

桌面版侧车注入 KE_APP_CONFIG 指向 %APPDATA%\\KnowledgeEditor\\app_config.json；
首次启动若旧位置（~/.knowledgeeditor/app_config.json，测试可经
KE_APP_CONFIG_LEGACY 重定向）存在，自动复制到新位置并保留最近列表。
迁移只复制，不动源文件；失败不阻塞（回退默认配置）。
"""
from __future__ import annotations

import json
from pathlib import Path

from app import config
from app.services.app_config import AppConfig


def _write_config(path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def test_legacy_migrated_to_new_location(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy" / ".knowledgeeditor" / "app_config.json"
    _write_config(
        legacy,
        {
            "recent_workspaces": ["D:/old/ws1", "D:/old/ws2"],
            "recent_documents": [{"rel_path": "Articles/a.md", "title": "旧文档"}],
        },
    )
    new = tmp_path / "appdata" / "KnowledgeEditor" / "app_config.json"
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", legacy)

    cfg = AppConfig(path=new)

    assert new.is_file(), "旧配置应复制到新位置"
    assert legacy.is_file(), "迁移只复制，源文件必须保留"
    assert cfg.list_recent_workspaces() == ["D:/old/ws1", "D:/old/ws2"]
    docs = cfg.list_recent_documents()
    assert docs[0]["rel_path"] == "Articles/a.md"
    assert docs[0]["title"] == "旧文档"


def test_existing_new_file_not_overwritten(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy.json"
    _write_config(legacy, {"recent_workspaces": ["D:/old/ws"]})
    new = tmp_path / "new.json"
    _write_config(new, {"recent_workspaces": ["D:/new/ws"]})
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", legacy)

    cfg = AppConfig(path=new)

    assert cfg.list_recent_workspaces() == ["D:/new/ws"], "新位置已存在时不得被旧数据覆盖"


def test_same_location_no_migration(tmp_path, monkeypatch):
    """Web 版（KE_APP_CONFIG 未设置）新旧同位置，不触发迁移。"""
    p = tmp_path / "app_config.json"
    _write_config(p, {"recent_workspaces": ["D:/same/ws"]})
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", p)

    cfg = AppConfig(path=p)

    assert cfg.list_recent_workspaces() == ["D:/same/ws"]


def test_no_legacy_no_file_created(tmp_path, monkeypatch):
    legacy = tmp_path / "no-such-legacy.json"
    new = tmp_path / "appdata" / "app_config.json"
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", legacy)

    cfg = AppConfig(path=new)

    assert not new.exists(), "旧位置不存在时不得创建新文件"
    assert cfg.list_recent_workspaces() == []


def test_migrated_then_save_preserves_legacy_items(tmp_path, monkeypatch):
    """迁移后再新增记录：旧列表保留，新记录插入头部。"""
    legacy = tmp_path / "legacy.json"
    _write_config(legacy, {"recent_workspaces": ["D:/old/ws"], "recent_documents": []})
    new = tmp_path / "appdata" / "app_config.json"
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", legacy)

    cfg = AppConfig(path=new)
    cfg.add_recent_workspace("D:/new/ws")

    # add_recent_workspace 内部 resolve（Windows 反斜杠），与既有行为一致
    assert cfg.list_recent_workspaces() == [str(Path("D:/new/ws").resolve()), "D:/old/ws"]


def test_corrupt_legacy_does_not_block(tmp_path, monkeypatch):
    """旧文件内容损坏（JSON 解析失败）不应导致迁移/加载失败。"""
    legacy = tmp_path / "legacy.json"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text("{not-valid-json", encoding="utf-8")
    new = tmp_path / "appdata" / "app_config.json"
    monkeypatch.setattr(config, "APP_CONFIG_LEGACY_PATH", legacy)

    cfg = AppConfig(path=new)

    # 复制成功（文件级复制不校验内容），但加载回退默认
    assert new.is_file()
    assert cfg.list_recent_workspaces() == []
