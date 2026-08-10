# PROJECT_STRUCTURE.md

> 项目目录结构与关键路径记录。目标：更换开发机器 / 更换 Agent / 丢失上下文后仍可恢复。
> 最后更新：2026-08-10（Phase 7 M4）

## 源代码结构

```
D:\Agent\KnowledgeEditor\
├── backend/                  # FastAPI 后端（Python）
│   ├── app/
│   │   ├── config.py         # 全局配置（KE_WORKSPACE/KE_APP_CONFIG/目录约定）
│   │   ├── main.py           # 应用入口
│   │   ├── routers/          # API 路由（workspace/documents/tags/...）
│   │   ├── services/         # 业务服务（app_config/indexer/markdown_io/...）
│   │   └── store/            # SQLite 存储（index.db）
│   ├── tests/                # pytest 测试（含 test_app_config_migration）
│   └── requirements.txt
├── frontend/                 # 前端（React + Vite + TS）
│   ├── src/
│   │   ├── api/client.ts     # API 客户端（apiBase 注入）
│   │   ├── components/       # 组件（layout/settings/...）
│   │   ├── editor/           # Markdown 编辑器与渲染
│   │   ├── App.tsx           # 根组件（M4 firstRun 引导判定）
│   │   ├── desktop.ts        # M4：isDesktop() + pickDirectory()
│   │   └── settings.ts       # M3 设置（localStorage 降级）
│   ├── dist-build/           # 构建产物（M3.1 起，内嵌进 release 二进制）
│   └── package.json
├── desktop/src-tauri/        # Tauri v2 桌面壳（Rust）
│   ├── src/
│   │   ├── lib.rs            # 命令注册
│   │   ├── sidecar.rs        # sidecar 启动/health 握手/环境注入
│   │   ├── settings.rs       # M3 settings.json 读写
│   │   └── main.rs
│   ├── binaries/             # sidecar 后端二进制（externalBin）
│   ├── capabilities/         # 权限（shell/dialog/core）
│   ├── target/release/       # release 构建产物（knowledgeeditor.exe）
│   └── tauri.conf.json       # frontendDist=../../frontend/dist-build
├── docs/                     # 阶段报告与规格（phase7-plan.md 等）
├── scripts/                  # 构建/启动脚本（build.ps1/dev.ps1/...）
├── workspace/                # 默认工作区（示例数据，勿混入用户数据）
├── CHANGELOG_DEV.md          # 开发日志（最新在上）
├── DEVELOPMENT_ENVIRONMENT.md# 环境/依赖/工具链记录
├── PROJECT_STATE.md          # 项目状态唯一参考
└── README.md
```

## 开发运行路径

- 前端启动：`frontend/` 下 `npm run dev`（vite，端口 5173；Web 模式无桌面壳）
- 后端启动：项目根 `python backend/run.py`（或 `uvicorn app.main:app`，`backend/` 下）
- 桌面 dev：`desktop/` 下 `npm run tauri -- dev`（WebView + sidecar，Vite devUrl）
- 桌面 release 构建：`desktop/` 下 `npm run tauri -- build`（构建链：前端 build → dist-build → cargo release → NSIS）
- 构建目录：`frontend/dist-build`（release 二进制内嵌资源，不要手动改名/删除）
- 测试路径：
  - 后端：项目根 `python -m pytest backend/tests -q`
  - 前端：`ke-frontend` 镜像内 `npm run test`（vitest）→ 真实 `frontend/dist-build` 同步
  - Rust：`desktop/src-tauri` 下 `cargo test`（需 RUSTUP/CARGO 环境变量）

## 用户数据路径

> 明确区分：程序文件（应用安装/源码）与用户数据（配置/日志/缓存/Workspace）。禁止混淆。

| 类别 | 路径 | 说明 |
| --- | --- | --- |
| 程序文件 | `D:\Agent\KnowledgeEditor\` | 源码、构建产物、二进制 |
| 配置目录 | `%APPDATA%\KnowledgeEditor\` | settings.json（M3）、app_config.json（M4）、logs、runtime |
| 日志目录 | `%APPDATA%\KnowledgeEditor\logs\` | 运行日志（设置面板「查看日志」打开） |
| 缓存/临时 | `%APPDATA%\KnowledgeEditor\runtime\` | sidecar 握手记录等临时数据，**退出时清空** |
| 软件级配置 | `%APPDATA%\KnowledgeEditor\app_config.json` | 最近工作区/最近文档（跨 Workspace，M4 起） |
| Workspace（默认） | `D:\Agent\KnowledgeEditor\workspace\` | 示例工作区；用户实际工作区由 KE_WORKSPACE 或选择器指定 |
| 旧 Web 配置 | `~/.knowledgeeditor/app_config.json` | 迁移源（M4 首次启动并入新位置，不动源文件） |

关键约定：

- Workspace 内部结构：`Articles/`、`Modules/`、`Attachments/{images,videos,files}/`、`Drafts/{backup,recovery}/`、`.knowledgeeditor/{index.db,settings.json}`
- Workspace 的 `.knowledgeeditor/settings.json` 与软件级 `settings.json`（`%APPDATA%`）职责不同：前者是工作区内部状态，后者是应用偏好
- 应用安装目录与用户数据目录永不混用：升级/卸载程序文件不影响 `%APPDATA%\KnowledgeEditor`

## 目录结构变更规则

修改目录结构、数据存储位置、构建链时必须同步更新：本文件、`DEVELOPMENT_ENVIRONMENT.md`、`CHANGELOG_DEV.md`。
