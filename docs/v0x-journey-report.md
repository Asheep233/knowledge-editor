# v0.x 全流程总报告：从 Phase 0 设计到 v1.0.0 发布

> 范围：`docs/phase0-architecture.html`（Phase 0 架构设计）设想的落地回顾，覆盖 Phase 1-6 功能构建、6E 冻结审计、6U 真实环境迭代，至 Phase 7 桌面化发布 v1.0.0（Alpha 测试起点）
> 日期：2026-08-08 ~ 2026-08-11

## 1. 从设计到发布

Phase 0 于 2026-08-08 交付架构设计（技术方案、架构、数据结构、风险），此后每个阶段按「完成内容 / 测试结果 / 当前问题 / 下一阶段计划」输出报告，全程四天完成 v1.0.0 发布。

| 阶段 | 日期 | 核心交付 |
| --- | --- | --- |
| Phase 0 架构设计 | 08-08 | 技术方案 / 架构 / 数据结构 / 风险分析（phase0-architecture.html） |
| Phase 1 工程初始化 | 08-08 | Monorepo 骨架、FastAPI 后端（SQLite 索引）、三栏布局、扩展规范 v1.0、CI |
| Phase 2 编辑器核心 | 08-08/09 | 结构化 Document Model 所见即所得、公式可视化编辑、KE 扩展节点 |
| Phase 3 Markdown 文档系统 | 08-09 | 双向转换完善（表格/图片）；3E 往返冻结、3E.4 导入安全性增强 |
| Phase 4 Workspace 管理 | 08-09 | 文件树 / 文档 / 附件管理（8 个子阶段） |
| Phase 5 模块系统 | 08-09 | Modules/ 复用模块（内容复制 + 来源记录，无动态关系） |
| Phase 5E 环境统一 | 08-09 | start.ps1 / stop.ps1 一键启停与进程管理 |
| Phase 6 搜索与可靠性 | 08-09 | FTS 全文搜索、历史版本、自动保存、导入导出、崩溃恢复 |
| Phase 6E 冻结审计 | 08-09 | API 42 端点冻结、版本统一 v0.6.0、死代码清理 |
| Phase 6U 真实环境迭代 | 08-09/10 | 表格气泡菜单、拖拽附件、注释样式、信息块修复、26 项浏览器回归 |
| Phase 7 桌面化发布 | 08-10/11 | Tauri 集成、侧车、设置系统、NSIS 安装包、版本统一 v1.0.0 |

## 2. 产品定位与设计原则的兑现

Phase 0 的产品定位「知乎式所见即所得 × Obsidian 式本地文件组织 × 可复用模块系统」全程未偏移：编辑器由 Tiptap 结构化模型驱动，文章以 `Articles/` 下普通 .md 文件持久化，模块以 `Modules/` 下普通 .md 复用。五条设计原则逐条兑现：

| 原则 | 兑现 |
| --- | --- |
| 真正的所见即所得 | 编辑态真源为 ProseMirror JSON 文档树，Markdown 仅持久化；数据流单向「操作 → 模型 → 保存层 → Markdown」 |
| GUI 优先 | 公式用 math-field 可视化编辑（LaTeX 存取）、表格气泡菜单、拖拽上传附件、注释弹窗 |
| 数据主权 | Markdown 唯一事实源，SQLite 仅索引且可整体重建（`POST /api/index/rebuild`），卸载桌面版不清数据 |
| 可扩展性预留 | KE 节点注册表与扩展规范（ke_version=1），v1 未做完整插件系统，与设计一致 |
| 工程纪律 | 前端从不直接访问文件，全部经后端 API；往返转换全程「读 → 写 → 读不变性」测试保障 |

## 3. 技术选型落地对照

| 层级 | 计划（Phase 0） | 实际（v1.0.0） | 差异 |
| --- | --- | --- | --- |
| 前端框架 | React 18+ / TypeScript | React 19 / TS 5.8 | React 19 |
| 编辑器内核 | Tiptap 3.x | Tiptap 3.29（@tiptap/pm、markdown） | 一致 |
| 样式 | Tailwind CSS 4 | Tailwind 4 | 一致 |
| 状态管理 | Zustand 5 | 未采用（组件 state + context） | 未采用 |
| 后端服务 | Python 3.11+ / FastAPI | Python 3.10.11 / FastAPI | 3.10 |
| 桌面壳 | Tauri 2 | Tauri 2.11 | 一致 |
| 公式编辑 / 渲染 | MathLive / KaTeX | mathlive 0.110 / katex 0.18 | 一致 |
| 代码高亮 | highlight.js | 未采用 | 未采用 |
| 存储 | Markdown + SQLite FTS5 | Markdown + SQLite FTS5（trigram 五列） | 一致 |
| 构建 | Vite + pnpm | Vite 6 + npm | pnpm → npm |
| 测试 | 未规划 | vitest + happy-dom（70 用例）、pytest（102+）、OpenAPI 快照 | 补充 |

核心选型（Tiptap、FastAPI、Tauri、SQLite FTS5、MathLive/KaTeX）全部按计划落地；Zustand、highlight.js、pnpm 三项未采用，未影响既定架构。

## 4. 架构演进

Phase 0 设想的四进程层（WebView 前端 / Tauri 主进程 / FastAPI 后端 / 存储层）分两段落地：

- Web 阶段（Phase 1-6）：React（Vite dev server）+ FastAPI（uvicorn 独立进程），Vite 代理 `/api`，start.ps1/stop.ps1 管理双进程生命周期。
- 桌面阶段（Phase 7）：React 前端编译进 Tauri 主程序（WebView2 加载），FastAPI 经 PyInstaller 打成单文件侧车由 Rust 管理（拉起 / health 握手 / 动态端口 / 崩溃自动拉起 / 退出清理），运行时注入 API 基址与 CORS。桌面版与 Web 版架构同构，前端依旧不直接访问文件。

两条数据链路不变：保存链路「用户操作 → 文档模型 → 保存层 → Markdown 原子写入 → 索引更新」；打开链路逆过程，Markdown 解析在服务端完成，前端只消费结构化 JSON。

## 5. 核心能力交付

| Phase 0 章节 | 交付情况 |
| --- | --- |
| 4 结构化文档模型 | Tiptap schema 化节点（ke-note / ke-module / ke-attach / ke-video / footnote），往返转换冻结（ke_version=1） |
| 5 数据结构设计 | workspace 目录 + `index.db`（files v2 / files_fts v2 / settings / recovery，WAL），与设计一致 |
| 6 核心功能技术方案 | 公式（math-field + KaTeX）、表格（气泡菜单行列级编辑）、附件（按类型分类、孤儿仅手动删除）、注释（两种样式）、信息块（块内可编辑 + 五色联动） |
| 7 模块系统 | 模块 = Modules/ 普通 .md，插入为「内容复制 + source 记录」，不建立动态关系，与设计一致 |
| 8 保存与恢复 | 原子写入（tmp + os.replace）、自动保存（3s 防抖，桌面版可调）、快照 30 份、崩溃恢复草稿 |
| 9 本地搜索 | FTS5 trigram 五列，短词 LIKE 降级，索引可重建 |
| 10 桌面应用与打包 | Tauri 2 + PyInstaller 侧车 + NSIS 安装包（v1.0.0 交付） |
| 11 后端 API 设计 | 42 端点于 6E 冻结（v1 无前缀），桌面侧车未新增接口 |

## 6. 与 Phase 0 设计的差异

6E 冻结审计记录 6 处结构性差异（设计稿保留，以实现为准，见 `docs/phase6e-report.md` 2.1）：

| # | 差异 | 处理 |
| --- | --- | --- |
| 1 | files 表 v2 增加 `kind`/`meta` 列 | 设计稿未覆盖，schema 冻结 |
| 2 | files_fts 为 FTS5 trigram 五列（schema v2） | 同上 |
| 3 | recovery 主键结构按实现冻结 | 同上 |
| 4 | 新增 `.knowledgeeditor/runtime/` 目录（runtime.json 握手） | 设计稿未覆盖 |
| 5 | Drafts/backup 实际命名 `YYYYMMDD-HHMMSS-mmm.md`，保留 30 份 | 设计稿未细化 |
| 6 | module 字段 `source` | 已补文档（document-format.md） |

选型层面另有四处偏差：Zustand、highlight.js、pnpm 未采用，Python 实际 3.10.11（计划 3.11+）。

## 7. 版本演进

| 版本 | 内容 |
| --- | --- |
| 内部迭代（常量 0.1.0 → 实际 0.5.0） | Phase 1-5 功能构建，无逐版本发布记录 |
| v0.6.0 | 6E 冻结基线：42 端点、格式与数据结构冻结、版本统一 |
| v0.6.1 | 拖拽添加附件 |
| v0.6.2 / v0.6.3 | 注释样式（脚注区域 / 纯 Markdown） |
| v0.6.4 / v0.6.5 | 脚注上标光标与换行修复 |
| v0.7.0 | 信息块改为可编辑内容节点（包裹格式冻结） |
| v0.7.1 / v0.7.2 | 块内输入修复、占位符修复 |
| v0.7.3 | 属性面板元信息、stop.ps1 兜底（6U 终态，桌面化基线） |
| v1.0.0 | Phase 7 发布基线，UI 徽标 Alpha，进入 Alpha 测试 |

版本唯一来源为 `backend/app/__init__.py`，前端 `version.ts`、`package.json` 与桌面工程同步；数据格式版本独立（ke_version=1、settings schema 1、FTS schema 2）。

## 8. 决策点回顾

Phase 0 的 DP1-DP6 经 Phase 1 确认后全部落地：A1 侧车形态（Tauri 管理 Python 生命周期）、KE 扩展规范（note/module/attach/video）、SQLite 集中索引、注释/附件/视频节点入 v1、附件按类型分类、单窗口三栏布局。Phase 7 新增 D1-D7 亦全部按默认方案冻结：PyInstaller 单文件侧车、仅 NSIS（currentUser）、动态端口 3 次重试、设置落盘 `%APPDATA%`、默认 workspace 在数据目录、.md 文件关联 v1.0.0 不做、发布版本 v1.0.0。

## 9. 收尾

v1.0.0 及以后版本算入 Alpha 测试期。Phase 0 的两项工程承诺——Markdown 唯一事实源、前端不直接访问文件——在 Web 与桌面两个形态下均保持成立；桌面侧车把 Python 后端与前端一并收进安装包（NSIS 20.5 MB），用户机器无需任何开发环境。后续按 v1.x.y 递增迭代，回归与发布流程已固化：版本三同步 + vitest/pytest/OpenAPI 快照 + NSIS 构建 + GitHub Releases 分发。
