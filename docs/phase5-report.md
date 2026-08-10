# Phase 5 报告：模块系统

日期：2026-08-09

> 架构决策：模块 = `Workspace/Modules/` 下的普通 Markdown 文件，Markdown 是唯一事实源，SQLite 仅做索引。插入采用「内容复制 + 来源记录」模式：插入时生成 `ke-module` 标记（仅含 `source`），模块与文章之间**不建立任何动态关系**。

## 一、完成功能

| 功能 | 规格 | 实现要点 |
| --- | --- | --- |
| 5.1 模块目录结构 | `Modules/` 存放普通 Markdown 模块文件 | workspace 结构自动补齐 `Modules/`；模块正文仅存于真实 `.md` 文件，索引 `kind="module"` 仅记录路径 |
| 5.2 模块管理 | 复用文件树能力，无需独立管理页 | 侧栏「模块」区树形展示（文件夹分类）；右键菜单新建/重命名/移动/删除；单击/双击在现有编辑器打开并保存（复用文章 API，无目录限制） |
| 5.3 插入模块 | 读取 → Document Model → 光标插入 | 工具栏「模块」按钮下拉选择；`getModule` 读取原文（剥离 frontmatter）→ 前置 `<!-- ke-module: {"source":"Modules/...md"} -->` → `MarkdownManager.parse` 整体解析进 Document Model → `insertContent` 插入光标位置 |
| 5.4 模块内容支持 | 11 种内容保持解析效果 | 标题/粗体/斜体/列表/引用/公式/信息块/图片/视频/表格/代码块 插入后全部保留（前端 7 项测试覆盖复杂内容往返） |
| 5.5 信息块与模块关系 | 信息块属于 Markdown 本身 | 模块文件可内嵌 `ke-note` 注释，插入后由既有信息块系统渲染，模块系统不做任何定义 |
| 5.6 模块分类 | v1 文件夹分类 | `Modules/Math/`、`Modules/Physics/` 等子目录天然分类；未实现标签系统/模块数据库/分类算法 |

关键约束落实：

- **Markdown-first**：模块正文不落数据库、无二进制格式、不依赖编辑器内部状态。
- **插入模式**：内容复制 + 来源记录；修改模块不影响已插入文章，修改文章不影响模块（后端独立性测试验证）。
- **ke-module 来源标记**：插入生成的标记严格符合规格示例 `{"source":"Modules/Math/Definition.md"}`；标记仅记录来源，不参与同步；删除模块文件后文章内容完整（专项测试验证）。
- **附件引用**：模块内附件必须为 `Attachments/` 开头的 workspace 相对路径；插入时不复制附件文件、路径保持不变（附件数不变测试验证）；未实现 `./`、`../` 相对模块目录的路径支持。

未实现（规格禁止）：动态引用、模块同步更新、模块变量、模块嵌套、插件系统、模块市场、AI 自动生成。

## 二、修改文件列表

### 后端（修改 2，新建测试 1）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `backend/app/routers/modules.py` | 修改 | `GET /api/modules/{module_path:path}` 支持子目录路径（`Math/Definition`、`Math/Definition.md`、`Modules/Math/Definition.md` 三种写法）；解析后强制校验仍位于 `Modules/` 内（防 `../` 逃逸）；列表接口保持（`path` 为完整相对路径） |
| `backend/app/routers/fs.py` | 修改 | `POST /api/fs/doc` 的 `dir` 参数支持 `Modules`、`Modules/Math`（兼容完整路径），在 Modules 下创建普通 Markdown 模块文件；其余目录仍拒绝 |
| `backend/tests/test_modules.py` | 新建 | 12 项测试：创建/子目录/目录约束/列表/读取三种写法/404 与穿越/编辑/独立性/删除模块保文章/附件/复杂内容/重命名移动删除 |

### 前端（修改 6，新建测试 1）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `frontend/src/editor/ke.ts` | 修改 | `KE_FIELD_ORDER.module` 增加 `source` 字段（字段序 `id,name,version,mode,params,source`） |
| `frontend/src/editor/extensions/ModuleExtension.ts` | 修改 | `ModuleAttrs` 增加 `source`；addAttributes/parseHTML/renderHTML/parseMarkdown 全链路支持；renderMarkdown 在含 `source` 时输出规格示例格式 `{"source":"..."}`，旧标记（id/name/version/params）保持兼容 |
| `frontend/src/components/editor/nodeviews/ModuleNodeView.tsx` | 修改 | 来源卡片展示：主标签显示 `Math/Definition`，hover 显示完整 `Modules/Math/Definition.md` 来源路径 |
| `frontend/src/api/client.ts` | 修改 | 新增 `listModules()` / `getModule(relPath)`（子目录路径按段编码）及 `ModuleInfo`/`ModuleListPayload`/`ModuleContent` 类型 |
| `frontend/src/components/editor/EditorToolbar.tsx` | 修改 | 「模块」按钮 + 下拉列表（懒加载）；`insertModule`：读取模块 → 构造来源标记 → `MarkdownManager.parse` → 光标插入 |
| `frontend/src/components/layout/LeftSidebar.tsx` | 修改 | 「模块」区改为文件夹分类树（`buildFileTree` 复用），根含 `Modules/`；「＋新建」入口；右键菜单复用文件树能力（新建/重命名/移动/删除） |
| `frontend/src/editor/phase5-module.test.ts` | 新建 | 7 项测试（见「五、测试结果」） |

## 三、模块数据流

```
Modules/Math/Definition.md（唯一事实源）
      │  5.2 管理：文件树 新建/重命名/移动/删除；双击在编辑器打开（复用文章 API）
      ▼
GET /api/modules/{path}            → { content: 正文（已剥离 frontmatter） }
      │  5.3 工具栏「模块」→ 选择
      ▼
构造 Markdown：`<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->` + 正文
      │  MarkdownManager.parse（同一套 tokenizer/扩展）
      ▼
Tiptap Document Model：module 节点（来源卡片，用户不可感知底层注释）+ 普通内容节点
      │  保存 renderMarkdown → getMarkdown
      ▼
Articles/xxx.md  ←─ ke-module 标记 + 复制内容（此后与源模块完全独立）
```

要点：

- 插入时只做一次复制，来源信息仅落在 `ke-module` 标记的 `source` 字段。
- 保存后的文章可独立打开、编辑、移动、删除；模块文件的任何变化（含删除）均不影响文章。
- 附件引用保持 `Attachments/` 相对路径原样写入，不复制附件实体。

## 四、ke-module 处理方式

| 环节 | 行为 |
| --- | --- |
| 生成 | 插入模块时生成 `<!-- ke-module: {"source":"Modules/Math/Definition.md"} -->`，仅含 `source`（符合规格示例）；不带 `kind`/`id` |
| 解析 | 既有 `keCommentTokenizer('module')` 括号平衡解析 JSON → `module` 节点 `attrs.source` |
| 渲染 | `ModuleNodeView` 渲染为不可见占位（`display:none`）：用户在编辑器中感知不到来源标记；Markdown 注释随序列化原样保留 |
| 序列化 | 含 `source` 时输出 `{"source":"..."}`（零漂移往返）；不含 `source` 的旧标记（`kind/id/name/version/mode/params`）走兼容路径原样输出 |
| 语义 | 纯来源记录：不参与同步、无动态字段（测试断言不含 `sync/ref/updated`）、模块删除后文章内容完整 |
| 索引 | SQLite 仅索引模块文件本身（`kind="module"`），ke-module 标记不入库、不建关系表 |

## 五、测试结果

### 后端 pytest：90/90 通过

新增 `tests/test_modules.py` 12 项：

| 测试 | 覆盖 |
| --- | --- |
| `test_create_module_via_fs_doc` | 创建：`Modules/定义.md` 真实 Markdown，文件树/索引一致 |
| `test_create_module_in_subfolder` | 文件夹分类：`Modules/Math/定理.md` |
| `test_create_module_rejects_non_module_dir` | 目录约束：`Drafts/`、`Attachments/` 拒绝 |
| `test_list_modules_nested` | 列表含子目录完整路径 |
| `test_get_module_nested_variants` | 读取三种写法（含/不含 `.md`、带 `Modules/` 前缀）+ 扁平旧写法 |
| `test_get_module_404_and_traversal` | 不存在 404；`../` 逃逸 `Modules/` 被拒 |
| `test_module_edit_via_article_api` | 双击打开（GET）/ 编辑保存（PUT）真实模块文件 |
| `test_module_independent_from_article` | 独立性：改模块文章不变，改文章模块不变 |
| `test_delete_module_keeps_article` | 删除模块文件后文章内容完整 |
| `test_module_attachment_refs` | 附件：`Attachments/` 路径保留、附件实体不复制（数量不变） |
| `test_module_complex_content` | 公式/信息块/图片/视频/表格/代码块全部保留 |
| `test_module_rename_move_delete` | 管理：重命名/移动/删除（复用 Phase 4 文件树 API） |

回归：既有 78 项全量通过（含 `fs.py` 改动影响的 `test_file_tree.py`）。

### 前端 vitest：49/49 通过，tsc --noEmit 通过，npm run build 通过

新增 `src/editor/phase5-module.test.ts` 7 项：

| 测试 | 覆盖 |
| --- | --- |
| `KE_FIELD_ORDER.module 包含 source` | 字段序含 `source` 且位于末位 |
| `toKeComment 生成含 source 的注释` | `<!-- ke-module: {"kind":"module","source":"..."} -->` |
| `parseKeComment 解析 source` | 标记解析出 `attrs.source` |
| `仅含 source 的标记往返零漂移` | 规格示例格式解析/序列化一致 |
| `旧格式标记保持兼容` | 含 `id/name/version/params` 的旧标记不受影响 |
| `复杂内容进入 Document Model 并完整往返` | module/heading/mathBlock/note/image/video/table/codeBlock 全部入模型并保留 |
| `插入模块时剥离自动生成的标题` | 模块开头 `# 名称`（创建时自动生成）不随内容插入 |
| `仅标题的空模块插入后不产生正文内容` | 空模块插入后正文为空，仅保留来源标记 |
| `stripModuleTitle` 4 项 | 剥离/空行/仅标题/不剥离（`##` 章节标题保留） |

## 六、当前风险

| 风险 | 级别 | 说明 |
| --- | --- | --- |
| 模块编辑保存会重写 frontmatter | 中 | 模块经编辑器保存时走文章保存链路，原 `title/tags` frontmatter 会退化为 `ke_version`。当前模块普遍无 frontmatter，影响面小；需保留则要扩展保存逻辑 |
| 插入内容无视觉边界 | 低 | 复制内容与手写内容在文档中无区分（仅前置来源卡片）。符合「用户不可感知」设计，但长模块插入后不易定位来源边界 |
| 下拉列表一次性加载 | 低 | 工具栏「模块」下拉懒加载全量列表，模块数量大时列表长（已加 `max-h` 滚动），v1 可接受 |
| 前端列表不随文件树实时刷新 | 低 | 下拉在打开时拉取一次，文件树新建模块后需重新打开下拉刷新 |
| 运行中后端版本 | 低 | 已验证当前运行实例含新路由；如用户重启后端需用最新代码（沿用 Phase 4 教训：开发期用 `--reload`） |

## 七、下一阶段建议

1. **Phase 6 候选**：文档导出（HTML/PDF）或检索增强（搜索结果摘要跳转正文位置）。
2. **模块体验增强**：插入前模块预览；最近使用模块置顶；模块插入边界弱提示（不影响「不感知底层标记」原则）。
3. **frontmatter 保留策略**：统一模块/文章保存时 frontmatter 合并规则（保留 `title/tags`，仅追加/更新 `ke_version`）。
4. **性能**：模块下拉改虚拟滚动或按分类懒加载；`list_modules` 可加分页。
