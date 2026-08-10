"""KnowledgeEditor backend 桌面侧车打包入口（Phase 7 M1）。

与 Web 版启动（start.ps1 -> `uvicorn app.main:app`）行为完全一致，仅宿主不同：
- Web 版：手工启动的 venv 进程，cwd=backend，KE_* 环境变量可缺省。
- 桌面版：Tauri 以 sidecar 拉起本文件打成的单文件 exe，注入 KE_* 环境变量。

设计约束（phase7-plan.md 第 5 章）：
- 不触碰任何路由与 API，不属于「修改后端 API」的禁止范围；
- 以对象方式 import app.main（而非 uvicorn.run 的字符串形式），
  使 PyInstaller 静态分析能沿依赖图收集 app 包全部模块；
- KE_WORKSPACE 未注入时（开发期直接 `python backend/run.py`），
  退到用户数据目录 %APPDATA%\\KnowledgeEditor\\workspace，
  避免 PyInstaller 解包临时目录（_MEIPASS）被当作工作区。
"""
from __future__ import annotations

import os
from pathlib import Path


def _ensure_env_defaults() -> None:
    """桌面侧车环境：KE_WORKSPACE 未注入时给用户数据目录默认值。

    必须在 `from app import config` 之前调用——config 模块导入时即
    读取 KE_WORKSPACE 并计算 WORKSPACE_ROOT / INDEX_DB_PATH / SETTINGS_PATH。
    """
    if os.environ.get("KE_WORKSPACE"):
        return
    base = os.environ.get("APPDATA") or str(Path.home())
    os.environ["KE_WORKSPACE"] = str(Path(base) / "KnowledgeEditor" / "workspace")


def main() -> None:
    _ensure_env_defaults()

    from app import config  # noqa: E402  环境变量必须先于 config 导入
    from app.main import app as fastapi_app  # noqa: E402  对象导入，供 PyInstaller 收集依赖树

    import uvicorn  # noqa: E402

    uvicorn.run(
        fastapi_app,
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
