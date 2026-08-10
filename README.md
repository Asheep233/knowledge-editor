# KnowledgeEditor

本地优先（Local-first）的个人知识创作软件：知乎式所见即所得编辑体验 × Obsidian 式本地文件组织 × 可复用 Markdown 模块系统。

## 目录结构

```
KnowledgeEditor/
├── frontend/          # React + TypeScript + Tiptap + Tailwind（编辑器 UI）
├── backend/           # Python + FastAPI（文档 / 文件 / 搜索 / 模块服务）
├── desktop/           # Tauri（Phase 7 启用：窗口、侧车进程、打包）
├── workspace/         # 用户数据目录（Markdown 唯一事实源，可脱离软件访问）
├── docs/              # 设计与规范文档
├── scripts/           # start / stop / setup / dev / build 脚本
└── .github/           # CI 基线
```

## 快速开始（开发环境）

要求：Python 3.10+、Node 20+。Rust 工具链仅在 Phase 7（Tauri 桌面化）时需要。

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
| `docs/phase1-report.md` | Phase 1 工程初始化阶段报告 |
| `docs/phase2-report.md` | Phase 2 编辑器核心阶段报告 |
| `docs/phase6-report.md` | Phase 6 搜索与可靠性增强阶段报告 |
| `docs/phase6e-report.md` | Phase 6E 发布前冻结审计与桌面化准备报告（API 冻结清单 / 迁移测试 / 侧车交接） |
| `docs/phase0-architecture.html` | Phase 0 架构设计（技术方案 / 数据结构 / 风险分析） |

## 阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 架构设计 | 已完成（6 项决策点已确认） |
| Phase 1 | 工程初始化 | 已完成（见 `docs/phase1-report.md`） |
| Phase 2 | 编辑器核心 | 已完成（见 `docs/phase2-report.md`） |
| Phase 5 | 模块系统 | 已完成（见 `docs/phase5-report.md`） |
| Phase 5E | 开发环境统一启动与进程管理 | 已完成（见 `docs/phase5e-report.md`） |
| Phase 6 | 搜索与可靠性增强 | 已完成（见 `docs/phase6-report.md`） |
| Phase 6E | 发布前冻结审计与桌面化准备 | 已完成（基线版本 v0.6.0，见 `docs/phase6e-report.md`） |
| Phase 7–8 | 桌面化（Tauri）/ 搜索增强 | 未开始 |

## 功能速览

- 全文搜索：左侧栏顶部全局搜索（300ms 防抖、回车确认、结果高亮上下文片段），搜索区内置「重建索引」按钮（`POST /api/index/rebuild`）。
- 异常恢复：启动时检测未恢复的编辑内容并弹窗，可恢复（草稿写回原 Markdown + 刷新索引）或丢弃；保存失败保留编辑内容并支持重试。
- 历史版本：编辑区工具栏「历史」按钮，查看最近 30 份自动快照（只读预览），可一键恢复；恢复前如有未保存修改会先提醒。快照存于 `Drafts/backup`（不进入索引、不属于事实源）。
- 附件（v0.6.1）：工具栏「附件」按钮或直接拖拽文件到编辑区上传（图片/视频/文件按类型归档存储）；右侧「附件」面板查看全部附件与引用关系，孤儿附件（未被任何 Markdown 引用）仅支持手动删除、绝不自动，被引用附件后端返回 409 拒绝删除。
- 信息块与脚注（v0.6.2/v0.6.3/v0.6.4/v0.6.5/v0.7.0）：信息块左上角徽章文字可自定义（默认「信息」）；「注释」弹窗支持两种脚注样式——原样式（正文上标 [n] + 文末灰底脚注区域）或纯 Markdown（正文同样插入上标 [n]，文末 # 参考 + [n] 内容为普通段落、无连接、可自由编辑），选择会被记住。v0.6.4 起插入上标不再产生多余换行（光标停留上标后同一行），上标编号可点击直接修改（仅影响正文显示，不影响底部参考栏）。v0.6.5 修复光标状态与 DOM 错位问题：插入后光标准确落于上标之后，按 Backspace 不会再误删上标（主动删除上标仍为正常操作），上标样式行高调整消除行尾视觉错位。v0.7.0 信息块内容改为 PM 可编辑内容：块内文字可直接插入注释上标（不再因整块选中被替换删除），Markdown 存储改为包裹格式 `<!-- ke-note: {json} -->` + `<!-- /ke-note -->`，旧格式自动迁移兼容。v0.7.1（phase 6U）修复信息块内无法输入文本（wrapper 误设禁编辑导致块内 contentDOM 继承不可编辑，改为控件单独禁编辑）；徽章颜色与块背景同步同一色系，徽章默认空文本（不再显示「信息」占位）。v0.7.2 修复信息块内占位文字「输入信息块内容…」错误渲染到每个空颜色按钮上（CSS 属性选择器误命中 contenteditable="false" 的空控件；内容区占位符改由内容是否为空驱动，输入文字后自动消失）。
- 文档属性（v0.7.3）：修复保存正文后右边栏「属性」的创建/修改时间、字数、大小显示为「—」——保存接口此前未返回这些元信息，前端保存成功后用空值整体替换了文档状态；现保存响应与读取接口一致返回完整元信息。

## 设计原则

1. 真正的所见即所得：编辑态真源是结构化文档模型，Markdown 只是存储格式。
2. GUI 优先：任何需要记忆语法的功能都提供图形化操作（如可视化公式编辑）。
3. 数据主权：Markdown 文件是唯一事实源，SQLite 索引可整体重建。
4. 前端不直接操作系统文件，所有文件访问经后端服务。
