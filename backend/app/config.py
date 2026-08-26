"""全局配置：workspace 路径、端口、目录约定。

优先级：环境变量 > 项目默认值。
- KE_WORKSPACE: 工作区根目录（默认项目根下的 workspace/）
- KE_CORS_ORIGINS: 允许的 CORS 来源，逗号分隔
- KE_HOST / KE_PORT: 服务监听地址
"""
import os
from pathlib import Path

APP_NAME = "knowledgeeditor"

# 版本唯一来源：backend/app/__init__.py 的 __version__（Phase 6E 冻结）。
# 曾在此处维护 APP_VERSION，已删除避免与 __version__ 漂移。

# backend/app/config.py -> parents[0]=app, [1]=backend, [2]=KnowledgeEditor
_DEFAULT_WORKSPACE = Path(__file__).resolve().parents[2] / "workspace"
WORKSPACE_ROOT = Path(os.environ.get("KE_WORKSPACE", str(_DEFAULT_WORKSPACE))).resolve()

INDEX_DB_PATH = WORKSPACE_ROOT / ".knowledgeeditor" / "index.db"
SETTINGS_PATH = WORKSPACE_ROOT / ".knowledgeeditor" / "settings.json"

# 软件级配置文件（跨 Workspace 的最近列表等；与 workspace 无关，可独立于 KE_WORKSPACE）
# 默认用户目录 ~/.knowledgeeditor/app_config.json，测试可经 KE_APP_CONFIG 覆盖
_DEFAULT_APP_CONFIG = Path.home() / ".knowledgeeditor" / "app_config.json"
APP_CONFIG_PATH = Path(
    os.environ.get("KE_APP_CONFIG", str(_DEFAULT_APP_CONFIG))
).resolve()
# 旧 Web 版位置（Phase 7 M4：桌面版经 KE_APP_CONFIG 重定向到应用数据目录后，
# 首次启动把此处的 app_config.json 并入新位置，保留最近工作区/文档列表；
# 测试环境可经 KE_APP_CONFIG_LEGACY 重定向，避免读真实用户文件）
APP_CONFIG_LEGACY_PATH = Path(
    os.environ.get("KE_APP_CONFIG_LEGACY", str(_DEFAULT_APP_CONFIG))
).resolve()

HOST = os.environ.get("KE_HOST", "127.0.0.1")
PORT = int(os.environ.get("KE_PORT", "8000"))

# P2-16：本地 API 访问令牌（sidecar 启动时生成并注入前端；空 = 开发模式不校验）
API_TOKEN = os.environ.get("KE_API_TOKEN", "")

CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "KE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

# 目录约定（相对 workspace 根）
DIR_ARTICLES = "Articles"
DIR_MODULES = "Modules"
DIR_ATTACHMENTS = "Attachments"
DIR_ATTACH_IMAGES = "Attachments/images"
DIR_ATTACH_VIDEOS = "Attachments/videos"
DIR_ATTACH_FILES = "Attachments/files"
DIR_DRAFTS = "Drafts"
DIR_DRAFT_BACKUP = "Drafts/backup"
DIR_DRAFT_RECOVERY = "Drafts/recovery"
DIR_INTERNAL = ".knowledgeeditor"

# 附件类型 -> 子目录映射
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}

# 扩展节点语法前缀（见 docs/markdown-extension-spec.md）
EXT_PREFIX = "ke-"
