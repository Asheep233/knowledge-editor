# KnowledgeEditor

本地优先（Local-first）的个人知识创作软件：知乎式所见即所得编辑体验 × Obsidian 式本地文件组织 × 可复用 Markdown 模块系统。

当前版本 **v1.1.2**（正式发布）· Windows 安装包见 [GitHub Releases](https://github.com/Asheep233/knowledge-editor/releases)

本项目开发过程包含 AI Agent 协作，透明性声明见 [docs/agent-collaboration.md](docs/agent-collaboration.md)。

## 安装（Windows 桌面版）

1. 从 [Releases](https://github.com/Asheep233/knowledge-editor/releases) 下载 `KnowledgeEditor_1.1.2_x64-setup.exe`（当前正式安装包）。
2. 双击安装：安装到 `%LOCALAPPDATA%\KnowledgeEditor`，开始菜单创建快捷方式。
3. 首次启动选择「使用已有工作区」或「创建新工作区」，即可开始写作。

程序与数据分离：文档存放在 `%APPDATA%\KnowledgeEditor\workspace\`，卸载软件不删除数据。安装包未签名，首次运行若出现「无法验证发布者」提示属正常现象（Windows 按路径记忆确认），确认即可。

## 目录结构

```
KnowledgeEditor/
├── frontend/          # React + TypeScript + Tiptap + Tailwind（编辑器 UI）
├── backend/           # Python + FastAPI（文档 / 文件 / 搜索 / 模块服务）
├── desktop/           # Tauri 桌面壳（窗口、侧车进程管理、NSIS 打包）
├── workspace/         # 用户数据目录（Markdown 唯一事实源，可脱离软件访问）
├── docs/              # 设计与规范文档
├── scripts/           # start / stop / setup / dev / build 脚本
└── .github/           # CI 基线
```

## 快速开始（开发环境）

要求：Python 3.10+、Node 20+。Rust 工具链仅在构建桌面安装包时需要（构建方式见 `docs/phase7-report.md` 第 6 节）。

```powershell
# 0. 安装依赖（创建 backend/.venv，安装后端与前端依赖）
.\scripts\setup.ps1

# 1. 一键启动完整开发环境（backend + frontend，含旧进程清理与健康握手）
.\scripts\start.ps1

# 2. 停止由 start.ps1 启动的全部开发进程
.\scripts\stop.ps1
```

启动后访问：前端 http://localhost:5173 ，后端 http://127.0.0.1:8000 。

### 双击启动（Windows）

在资源管理器中双击 `scripts\start.bat` 即可启动完整开发环境（等价于运行 `start.ps1`，所有逻辑仍由 PowerShell 脚本负责）。启动完成后窗口会保持打开显示结果，关闭窗口不影响已启动的 backend / frontend；停止服务请运行 `.\scripts\stop.ps1`。

### 单独启动方式（原方式保留）

```powershell
# 仅后端（终端 A）：http://127.0.0.1:8000
.\scripts\dev.ps1 backend

# 仅前端（终端 B）：http://localhost:5173
.\scripts\dev.ps1 frontend
```

### 一键启动说明

`start.ps1` 执行以下流程：

1. 环境检查：Python / backend 虚拟环境 / backend 依赖 / Node / npm / frontend 依赖，缺失时明确提示并给出修复建议，不静默失败。
2. 旧进程检测：读取 `workspace/.knowledgeeditor/runtime/runtime.json` 中的 PID 记录，停止本项目此前启动的旧 backend / frontend（不按进程名匹配、不按端口直接杀进程、不误关闭无关进程）。
3. 启动 backend，然后以 1 秒间隔轮询 `/api/health`（最长 30 秒）等待就绪；超时则输出原因并退出，不启动 frontend。
4. backend 就绪后启动 frontend，将 backend / frontend PID、启动时间、项目版本写入 `workspace/.knowledgeeditor/runtime/runtime.json`。
5. 启动前后端版本常量（`backend/app/__init__.py` 与 `frontend/src/version.ts`）不一致、或运行中 backend 版本与当前代码不一致时给出警告（仅展示，不自动修改、不同步代码）。

`stop.ps1` 仅依据 `runtime.json` 的 PID 记录停止本项目进程，停止后自动清理记录文件。

### 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `Python: 未找到 python 命令` | Python 未安装或不在 PATH | 安装 Python 3.10+，重新打开终端 |
| `backend 虚拟环境缺失` | 未执行初始化 | 运行 `.\scripts\setup.ps1` |
| `backend 依赖未安装` | venv 存在但依赖不全 | 运行 `.\scripts\setup.ps1` 重新安装 |
| `Node.js: 未找到 node 命令` / `npm: 未找到 npm 命令` | Node 未安装或不在 PATH | 安装 Node.js 18+（推荐 20+），重新打开终端 |
| `frontend 依赖缺失` | 未执行 `npm install` | 运行 `.\scripts\setup.ps1` |
| `frontend 依赖安装不完整` | `node_modules` 存在但缺 `vite`/`react` 等关键包（安装中断或目录损坏） | 运行 `.\scripts\setup.ps1`，或 `cd frontend; npm install` 重装 |
| `端口 8000（或 5173）被非本项目进程占用` | 其他服务占用端口 | 手动关闭占用进程（脚本给出的 PID），或改端口（backend 用 `KE_PORT`，frontend 改 `vite.config.ts`） |
| `backend 未在 30 秒内通过健康检查` | 启动异常或端口被占 | 查看 `workspace/.knowledgeeditor/runtime/logs/backend.err.log` |
| 前端提示「版本不一致」 | 前后端版本常量不同步或运行旧代码 | 同步两个版本常量，或 `stop.ps1` 后重新 `start.ps1` |

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/markdown-extension-spec.md` | Markdown 扩展规范（注释 / 模块 / 附件 / 视频标记） |
| `docs/document-format.md` | 文档格式手册（ke_version / KE_KINDS / 字段顺序，当前实现为准） |
| `docs/phase0-architecture.html` | Phase 0 架构设计（技术方案 / 数据结构 / 风险分析） |
| `docs/phase7-plan.md` | Phase 7 桌面化实施规划（总纲 / 里程碑 / 决策点） |
| `docs/phase7-report.md` | Phase 7 实施报告（桌面化与回归发布 v1.0.0，含构建方式与已知限制） |
| `docs/v0x-journey-report.md` | v0.x 全流程总报告（Phase 0 设计 → v1.0.0 发布） |
| `docs/phase6u-report.md` | Phase 6U 报告（v0.6.0 后 → v0.7.3，真实环境迭代） |
| `docs/phase6e-report.md` | Phase 6E 冻结审计（API 冻结清单 / 迁移测试 / 侧车交接） |
| `docs/agent-collaboration.md` | AI Agent 协作声明（开发过程透明度说明） |
| `docs/knowledge-editor-plain-export-design.md` | 导出为普通 .md 设计（KE 方言 → 朴素 Markdown 降级规则） |
| `docs/backlog-1.1.x.md` | v1.1.x 延后项清单（K3 审查 K3-I1/I2/T1/B1，含拍板记录） |
| `docs/iteration-plan-1.1.x.md` | v1.1.x 迭代计划（合并为 v1.1.2 正确性 / v1.1.3 体验 两版排期，v1.1.1 后起草） |
| `docs/release-acceptance-checklist.md` | 发布验收清单（NSIS 实机安装 7 步闭环 + 通用门禁 B1-B4 + 红线复核） |
| `docs/tauri-build-env-notes.md` | Tauri 构建环境备忘（WSL 挂载盘 symlink 坑与 NSIS 绕行方案） |
| `docs/agent-handoff-v1.1.0.md` | 主 Agent 交接文档（状态基线/拍板决策/环境坑/发布剧本/backlog） |
| `docs/reports/` | 审查与冲突分析报告（v1.1.0-pre.1 审查总汇报 / visual-diff / conflict-analysis） |
| `docs/evidence-1.1.0/` | v1.1.0 UI 证据截图（浅色/深色/设置/启动器/节点/右栏/搜索框/工具栏） |
| `docs/report/` | 审计清单与版本交付报告归档（v1.0.1 / v1.0.2） |

## 阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 架构设计 | 已完成（6 项决策点已确认） |
| Phase 1 | 工程初始化 | 已完成（见 `docs/phase1-report.md`） |
| Phase 2 | 编辑器核心 | 已完成（见 `docs/phase2-report.md`） |
| Phase 3 | Markdown 文档系统 | 已完成（见 `docs/phase3-report.md`） |
| Phase 4 | Workspace 与知识库管理 | 已完成（见 `docs/phase4-report.md`） |
| Phase 5 | 模块系统 | 已完成（见 `docs/phase5-report.md`） |
| Phase 5E | 开发环境统一启动与进程管理 | 已完成（见 `docs/phase5e-report.md`） |
| Phase 6 | 搜索与可靠性增强 | 已完成（见 `docs/phase6-report.md`） |
| Phase 6E | 发布前冻结审计与桌面化准备 | 已完成（基线版本 v0.6.0，见 `docs/phase6e-report.md`） |
| Phase 6U | 真实环境测试迭代 | 已完成（v0.6.1 → v0.7.3，见 `docs/phase6u-report.md`） |
| Phase 7 | 桌面化与发布（Tauri） | 已完成（v1.0.0，2026-08-11，见 `docs/phase7-report.md`） |
| Phase 8 | 搜索增强 | 未开始 |

版本约定：v1.0.0 及以后版本算入 Alpha 测试期，版本号按 v1.x.y 递增；UI 阶段徽标对外统一为 Alpha。

## 功能速览

- 全文搜索：左侧栏顶部全局搜索（300ms 防抖、回车确认、结果高亮上下文片段），搜索区内置「重建索引」按钮（`POST /api/index/rebuild`）。
- 异常恢复：启动时检测未恢复的编辑内容并弹窗，可恢复（草稿写回原 Markdown + 刷新索引）或丢弃；保存失败保留编辑内容并支持重试。
- 历史版本：编辑区工具栏「历史」按钮，查看最近 30 份自动快照（只读预览），可一键恢复；恢复前如有未保存修改会先提醒。快照存于 `Drafts/backup`（不进入索引、不属于事实源）。
- 附件：工具栏「附件」按钮或直接拖拽文件到编辑区上传（图片/视频/文件按类型归档存储）；右侧「附件」面板查看全部附件与引用关系，孤儿附件（未被任何 Markdown 引用）仅支持手动删除、绝不自动，被引用附件后端返回 409 拒绝删除。
- 信息块与脚注：信息块左上角徽章文字可自定义；「注释」弹窗支持两种脚注样式（原样式：正文上标 + 文末灰底脚注区域；纯 Markdown：上标 + 普通段落，可自由编辑），选择会被记住。信息块内容为可编辑内容节点，Markdown 存储为包裹格式 `<!-- ke-note: {json} -->` + `<!-- /ke-note -->`。
- 文档属性：右侧「属性」面板展示文档创建/修改时间、字数、大小，保存后即时刷新。
- 导出（v1.0.2 新增）：编辑区「导出 ▾」三项——「导出 Markdown（KE 格式）」（保留 ke_version 与 ke-* 扩展标记）、「导出普通 Markdown (.md)」（KE 方言降级为朴素 Markdown：信息块/模块/附件/视频/脚注转标准语法，任何 Markdown 工具可干净渲染，未知标记保留）、「导出文档包 (.zip)」。
- 桌面版（v1.0.0）：原生窗口与应用图标、原生菜单（文件 / 编辑 / 视图 / 帮助）、最近工作区列表、设置面板（默认工作区、自动保存间隔、主题、维护），后端以侧车随程序启动，无需安装 Python。
- 桌面版（v1.0.1 / v1.0.2 起）：单实例互斥、关窗保存握手、深色主题（跟随系统）、会话级解析缓存与代码分割（主包 1.96MB → 122KB）、watcher 空闲退避；v1.0.2 新增普通 Markdown 导出。

## 设计原则

1. 真正的所见即所得：编辑态真源是结构化文档模型，Markdown 只是存储格式。
2. GUI 优先：任何需要记忆语法的功能都提供图形化操作（如可视化公式编辑）。
3. 数据主权：Markdown 文件是唯一事实源，SQLite 索引可整体重建，卸载软件不删数据。
4. 可扩展性预留：KE 扩展节点注册表与扩展规范，未知标记不破坏文档。
5. 工程纪律：前端不直接操作系统文件，所有文件访问经后端服务。
