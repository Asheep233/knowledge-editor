# Phase 1 工程初始化报告

日期：2026-08-08
状态：已完成

---

## 1. 概述

Phase 1 将 Phase 0 架构落地为可运行、可验证、可继续迭代的工程骨架。核心目标达成：后端服务真实可用（含 SQLite 索引与搜索）、前端三栏布局可运行、Markdown 扩展规范成文、脚本与 CI 基线就绪。

## 2. 已确认的 6 项决策（决策点落地）

| 决策点 | 确认内容 | 落地位置 |
| --- | --- | --- |
| DP1 | A1：Tauri 管理 Python FastAPI 生命周期，Python 以 sidecar 运行 | `docs/phase0-architecture.html`；后端以独立服务方式运行，`/api/health` 提供握手信号 |
| DP2 | CommonMark + GFM + 数学公式；新增 KE 扩展规范（note/module/attach/video），未知标记不破坏文档 | `docs/markdown-extension-spec.md`（v1.0） |
| DP3 | SQLite 集中索引；Markdown 唯一事实源，索引可重建 | `backend/app/store/db.py`（IndexStore）、`backend/app/services/indexer.py`（启动时全量 rebuild） |
| DP4 | 注释与附件卡片入 v1；视频节点入 v1 但仅本地引用与展示 | 扩展规范 3.1/3.3/3.4 节；附件上传按类型分类 |
| DP5 | 附件按类型分类：`Attachments/{images,videos,files}/` | `backend/app/config.py`、`services/workspace.py`、`routers/attachments.py` |
| DP6 | 单窗口三栏布局，右侧面板可折叠 | `frontend/src/App.tsx`（右栏折叠/展开按钮） |

## 3. 完成内容

### 3.1 Monorepo 骨架

```
KnowledgeEditor/
├── .editorconfig / .gitignore / README.md
├── frontend/    React 19 + Vite 6 + TypeScript + Tailwind v4
├── backend/     Python 3.10 + FastAPI + SQLite (FTS5)
├── workspace/   用户数据目录（Articles / Modules / Attachments{images,videos,files} / Drafts{backup,recovery} / .knowledgeeditor）
├── docs/        markdown-extension-spec.md / phase1-report.md / phase0-architecture.html
├── scripts/     setup.ps1 / dev.ps1 / build.ps1
└── .github/workflows/ci.yml
```

### 3.2 Backend（FastAPI sidecar）

- 生命周期：启动时初始化 workspace 结构 → 打开 SQLite 索引 → 全量重建索引
- API：
  - `GET /api/health`（sidecar 握手）、`POST /api/workspace/init`、`GET /api/workspace/info`
  - `GET /api/tree`、文章 CRUD（`/api/articles`，原子写入 + 增量索引）
  - `GET /api/search?q=`（FTS5 trigram，短词 LIKE 降级）
  - `GET /api/modules`、`POST/GET /api/attachments`（按类型分类 + 流式落盘 + 路径越界防护）
  - `GET/POST/DELETE /api/drafts/recovery`
- 存储：`files` + `files_fts`（external content，trigram）+ `settings` + `recovery` 表；WAL 模式
- 原子写入：临时文件 + `os.replace`，防止写坏文档

### 3.3 Frontend（三栏布局）

- `App.tsx`：顶栏（工作区路径 + 后端健康状态）+ 左栏文件树 + 中间编辑区 + 右栏（可折叠，DP6）
- 左栏：Articles / Modules / Attachments 三类文件树，真实调用 `/api/tree`
- 右栏：大纲 / 属性 / 注释三个标签占位（随 Phase 2 充实）
- Vite 代理 `/api` → `127.0.0.1:8000`，dev 期前端无跨域问题

### 3.4 Markdown 扩展规范（v1.0）

四类节点（ke-note / ke-module / ke-attach / ke-video）以单行 HTML 注释承载 JSON；宽容解析规则保证未知标记原样保留；附兼容性矩阵、EBNF 与完整示例。详见 `docs/markdown-extension-spec.md`。

### 3.5 脚本与 CI

- `setup.ps1`：venv 创建（venv 缺失时自动退回 virtualenv）+ 依赖安装
- `dev.ps1 backend|frontend`：分别启动两个 dev 服务
- `build.ps1`：pytest + vite build
- `ci.yml`：GitHub Actions 双 job（backend pytest / frontend build）

## 4. 测试结果

| 验证项 | 方法 | 结果 |
| --- | --- | --- |
| 依赖导入 | `.venv` 内 `import fastapi/uvicorn/pydantic/pytest/httpx` | 通过（fastapi 0.141.1 / uvicorn 0.52.1） |
| SQLite 能力 | `sqlite_compileoption_used('ENABLE_FTS5')`、trigram 建表 | FTS5 可用 |
| trigram 边界 | 3 字符以上命中、2 字符不命中（已加 LIKE 降级） | 确认并处理 |
| 单元/集成测试 | `pytest`（11 项：健康检查、workspace 初始化、文章 CRUD、中文搜索、附件分类上传、未知标记保留、原子写入等） | 11/11 通过 |
| 真实服务冒烟 | uvicorn + httpx：health / tree / 创建 / 搜索 / 上传 | 全部通过 |
| 前端构建 | `npm run build`（tsc + vite） | 通过（33 模块，JS 202KB / CSS 13KB） |
| 端到端三线 | 前端页面 200 + Vite 代理 `/api/health`、`/api/tree`、创建与搜索 | 全部通过 |

## 5. 当前问题与已知限制

1. **Rust 工具链未安装**：`desktop/`（Tauri）目录尚未创建，Phase 7 前需安装 Rust（rustup + MSVC 工具链）。
2. **trigram 短词限制**：SQLite FTS5 trigram 对 2 字符及以下查询不命中，已用 LIKE 降级；大规模工作区下 LIKE 性能需后续评估。
3. **前端为占位实现**：编辑区当前展示 Markdown 原文，Tiptap 接入、文档模型转换（`convert/` 目录为空）在 Phase 2。
4. **模块系统为读取级**：模块定义/引用解析（ke-module）尚未实现，仅提供列表与原文读取接口。
5. **PowerShell 5 控制台中文乱码**：脚本输出中文在重定向时显示乱码（不影响执行，建议终端用 UTF-8）。
6. **环境差异**：开发用 Python 3.10.11 来自 TRAE 沙箱（`C:\Users\y8882\AppData\Roaming\TRAE SOLO CN\...\vm\tools\python`），非系统 Python；项目依赖均装在 `backend\.venv`，不污染全局环境。

## 6. 下一阶段计划（Phase 2：编辑器核心）

1. 引入 Tiptap + ProseMirror，建立 16 节点 / 7 marks 的 schema（对应扩展规范）
2. 实现 Markdown ↔ ProseMirror JSON 双向转换（`backend/app/convert/` + 前端序列化插件）
3. 实现 ke-note / ke-attach 节点渲染与卡片交互（DP4 范围内）
4. 保存链路：编辑态 → 文档模型 → 后端原子写入 → 增量索引（3 秒防抖 + Ctrl+S）
5. 前端搜索框接入 `/api/search`，结果点击定位文档
6. 补充崩溃恢复草稿流（Drafts/recovery 接口已预留）
