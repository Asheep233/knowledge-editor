# Phase 5E 报告：开发环境统一启动入口与进程管理

- 状态：已完成
- 目标：提供一键开发启动流程（`start.ps1`），解决旧进程残留导致的「测试连接到旧代码」问题，并给出版本一致性提示。

## 1. 新增和修改文件列表

### 新增

| 文件 | 说明 |
|---|---|
| `scripts/start.ps1` | 一键启动入口：环境检查 → 旧进程清理 → 启动 backend → health 握手 → 启动 frontend → 写入进程记录 |
| `scripts/start.bat` | Windows 双击启动入口：切换到项目根目录后调用 `start.ps1`（GBK 编码 + CRLF，适配双击场景） |
| `scripts/stop.ps1` | 按 `runtime.json` 的 PID 记录停止本项目全部开发进程并清理记录 |
| `frontend/src/version.ts` | 前端项目版本常量 `APP_VERSION = '0.5.0'`（与后端 `__version__` 人工同步） |
| `docs/phase5e-report.md` | 本报告 |

### 修改

| 文件 | 改动 |
|---|---|
| `backend/app/__init__.py` | `__version__` 由 `0.1.0` 升级为 `0.5.0`（版本一致性检查的唯一后端版本来源） |
| `backend/app/main.py` | lifespan 中记录 `app.state.started_at`（UTC ISO 8601） |
| `backend/app/routers/health.py` | `/api/health` 响应增加 `version`、`started_at` 字段 |
| `backend/tests/test_api.py` | `test_health` 新增断言：`version`、`started_at` 非空字符串 |
| `frontend/src/types.ts` | `HealthInfo` 增加 `started_at: string` |
| `frontend/src/App.tsx` | 连接 backend 时做版本一致性展示型比对；header 增加「⚠ 版本不一致」提示；backend 未启动时保持原有「后端未连接」提示 |
| `README.md` | 新增一键启动 / 停止说明、单独启动方式、常见错误表、阶段状态表 |

### 保留未动

- `scripts/dev.ps1`（backend / frontend 单独启动方式，规格要求保留）
- `scripts/setup.ps1`、`scripts/build.ps1`

## 2. 启动流程说明

`start.ps1`（必须在项目根目录执行）按 4 步执行：

1. 环境检查（`[0/4]`）：Python 可用性、`backend/.venv` 是否存在、venv 内依赖（`import fastapi, uvicorn`）是否可导入、Node / npm 可用性、`frontend/node_modules` 是否存在。任一缺失即明确列出原因、给出 `.\scripts\setup.ps1` 等修复建议并以非零码退出，不静默失败。
2. 旧进程检测与清理（`[1/4]`）：读取 `workspace/.knowledgeeditor/runtime/runtime.json` 中的 PID 记录，对仍存活的 backend / frontend 进程显示类型、PID、端口、启动时间后停止；随后校验 8000 / 5173 端口，若仍被非本项目进程占用则提示 PID 并退出（不误杀）。
3. 启动与握手（`[2/4]`~`[3/4]`）：启动 backend（venv uvicorn，隐藏窗口，日志写入 `runtime/logs/`）；以 1 秒间隔轮询 `GET /api/health`（最长 30 秒），就绪（`status=ok`）后才启动 frontend；超时则打印错误日志并退出，不启动 frontend。
4. 记录与提示（`[4/4]`）：将 backend / frontend PID、端口、启动时间、运行版本写入 `runtime.json`；源码级版本常量不一致、或运行中 backend 版本与当前代码不一致时给出警告（仅展示，不自动修改、不同步代码）。

版本来源约定：后端唯一版本来源为 `backend/app/__init__.py::__version__`（health 接口直接返回）；前端展示常量在 `frontend/src/version.ts`，两者需人工同步，不一致时前后端均会给出提示。

## 3. 进程管理方案

- 归属判断唯一依据：`workspace/.knowledgeeditor/runtime/runtime.json` 中的 PID 记录。禁止按进程名匹配、禁止按端口直接 kill、禁止模糊匹配 Python / Node 进程。
- `start.ps1`：只清理记录在案的旧进程；对无记录但占用端口的进程仅提示并中止，交由用户处置。
- `stop.ps1`：逐项读取记录，优先 `taskkill /T /F` 停止进程树（覆盖 vite→node 子进程链），`taskkill` 不可用时回退 `Stop-Process`；停止后删除记录文件，并提示（不关闭）端口残留的非本项目进程。
- 记录内容：backend PID / frontend PID / 各自端口 / 启动时间 / 运行版本 / 项目版本，另保存启动日志至 `runtime/logs/`。
- `runtime/` 位于 `workspace/.knowledgeeditor/` 下，已被 `.gitignore` 排除，不进入版本控制。

## 4. 测试结果

### 自动化测试

| 项目 | 命令 | 结果 |
|---|---|---|
| 后端全量 | `pytest -q`（backend 目录） | 90 通过 |
| 后端 health | `tests/test_api.py::test_health` | 通过（含 version / started_at 断言） |
| 前端类型 | `npm run typecheck` | 通过 |
| 前端单测 | `npx vitest run` | 55 / 55 通过 |

### 脚本实测（真实执行 start / stop）

| 场景 | 验证内容 | 结果 |
|---|---|---|
| 1. 新环境启动 | `start.ps1` 完整启动 backend + frontend，写入 runtime 记录 | 通过 |
| 2. 旧进程检测 | 再次运行 `start.ps1`：检测到旧 backend / frontend（显示类型 / PID / 端口 / 启动时间）→ 停止 → 以新代码重启 → 记录更新 | 通过 |
| 3. 停止 | `stop.ps1` 停止记录中进程、删除记录、端口释放 | 通过 |
| 3b. 停止（混合） | backend 存活 + frontend 已退出的混合记录 | 通过（正确提示「未在运行」，不报错） |
| 4a. 健康检查 | `/api/health` 返回 status / version / started_at；前端页面 200；vite 代理 `/api/health` 连通正确 backend | 通过 |
| 4b. 无关进程保护 | 端口 8000 被无关进程（`python -m http.server`）占用时，`start.ps1` 提示 PID 并退出，未误杀无关进程 | 通过 |
| 5. 原有方式 | `dev.ps1 backend` / `dev.ps1 frontend` 单独启动仍有效 | 通过 |
| 6. 双击入口 | `start.bat` 切换到项目根目录并调用 `start.ps1`，完整启动 backend + frontend 并写入记录；`stop.ps1` 可正常停止 | 通过 |

说明：环境检查「缺失分支」（如 `node_modules` 缺失）的实测受当前执行环境文件系统镜像行为干扰（目录改名被复制而非移动），未能做干净的端到端演示；该分支逻辑与已验证的「就绪」路径共用同一 `Test-Path` 判定，经代码审查确认提示与退出行为正确，建议在用户本机快速复验。

## 5. 当前风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 版本常量人工同步 | 后端 `__version__` 与前端 `APP_VERSION` 无自动联动 | 两端不一致时 `start.ps1` 与前端 UI 均给出明确警告，仅提示不自动修改 |
| 手动启动的进程不受管理 | `dev.ps1` 启动的进程不在 runtime 记录中，`stop.ps1` 不会关闭它们 | 文档明确说明：手动启动的进程需在各自终端 Ctrl+C 停止 |
| 沙箱/受限环境缺 `taskkill` | 极端受限环境可能无 `taskkill` 命令 | `stop.ps1` 已回退 `Stop-Process`；进程树清理的完整性依赖 `taskkill` 可用 |
| 端口冲突 | 其他服务占用 8000 / 5173 时启动中止 | 脚本给出占用 PID 与处理建议（`KE_PORT` / `vite.config.ts` 换端口） |
| 前端提示仅展示 | 版本不一致提示不阻塞、不同步代码，可能被忽略 | 提示文案给出明确处置建议（`stop.ps1` 后重新 `start.ps1`） |
