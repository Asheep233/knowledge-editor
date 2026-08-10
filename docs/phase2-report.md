# Phase 2 阶段报告：编辑器核心

> 阶段目标：实现基于结构化 Document Model 的所见即所得编辑器（含公式可视化编辑与 KE 扩展节点），打通「编辑 → Document Model → Markdown 序列化 → 原子保存」链路。

## 1. 完成内容

### 1.1 结构化 Document Model（约束 1）

数据流已按约束落地，HTML 不作为主要数据格式：

```
Markdown 文本 ──(marked tokenizer)──▶ ProseMirror JSON（Document Model）
ProseMirror JSON ──(editor.getMarkdown)──▶ Markdown 文本
```

- `frontend/src/editor/index.ts`：编辑器组装（`useKeEditor`），启用 `@tiptap/markdown` 双向转换，字符串内容按 `contentType: 'markdown'` 解析进 Document Model。
- Schema 由 Tiptap StarterKit 3 + 6 个 KE 扩展构成，覆盖：段落 / 标题 1-3 / 粗体 / 斜体 / 下划线 / 删除线 / 行内代码 / 代码块 / 引用 / 无序有序列表 / 链接 / 分割线 / 公式（行内+块级）/ 注释 / 模块 / 附件 / 视频。

### 1.2 公式所见即所得（约束 2）

- `MathNode`（行内 `$...$`）+ `MathBlockNode`（块级 `$$...$$`），存储格式恒为 LaTeX。
- `MathNodeView`：非编辑态 KaTeX 渲染最终效果；编辑态显示 MathLive `<math-field>` 可视化公式编辑器，实时把输入同步回 Document Model 的 `latex` 属性。
- 插入空公式后自动进入 MathLive 编辑态，用户全程无需手输 LaTeX；双击 / 悬浮编辑按钮随时进入编辑；Escape / 失焦退出并即时渲染。

### 1.3 KE 扩展节点（决策点 4 + 约束 3/4）

- `NoteExtension`：注释卡片，文本就地编辑，支持 5 种颜色。
- `ModuleExtension`：模块卡片（v1 仅展示，插入后为内容副本，不做动态引用 —— 约束 3）。
- `AttachmentExtension`：附件卡片按类型渲染（图片 / 文件 / 视频），`src` 存 workspace 相对路径（约束 4），经 `/api/attachments/{path}` 访问，移动知识库后仍有效。
- `VideoExtension`：本地视频引用与播放（含 controls/poster/循环选项）。
- 序列化：统一输出 `<!-- ke-note/module/attach/video: {json} -->`，符合 `docs/markdown-extension-spec.md` v1.0；对第三方编辑器友好，未知标记原样保留。

### 1.4 自定义 Markdown tokenizer

`frontend/src/editor/tokenizers.ts` 为 marked 注册 6 个 tokenizer（经 `@tiptap/markdown` 的 `markdownTokenizer` 扩展字段注入）：

- `math_inline`：`$...$`（排除 `$$` 与转义 `\$`）
- `math_block`：独占行 `$$...$$`
- `ke_note` / `ke_module` / `ke_attach` / `ke_video`：`<!-- ke-xxx: {json} -->`（贪婪 JSON 解析，兼容嵌套对象）

### 1.5 编辑器 UI 与保存链路

- `EditorToolbar`：标题 / 行内格式 / 列表 / 引用 / 公式 / 注释 / 附件上传（类型自动分类，返回相对路径）/ 撤销重做；状态经 `useEditorState` 实时订阅。
- `EditorArea`：三栏布局接入；保存链路 3s 防抖自动保存 + Ctrl+S 立即保存，带状态指示（未保存 / 保存中 / 已保存 / 保存失败 + 重试）；切换文档清理未决防抖并重载。
- 左栏新增全文搜索框（FTS5，350ms 防抖，结果带摘要片段，点击直达文档）。

## 2. 测试结果

| 测试 | 结果 |
|---|---|
| 前端构建（`tsc -b && vite build`） | 通过（111 模块） |
| Markdown ↔ Document Model 往返单测（8 例，vitest + happy-dom） | 全部通过 |
| 后端 API 单测（11 例，pytest） | 全部通过 |
| 端到端验证（健康检查 / 创建含公式+KE 节点文档 / 读取回验 / FTS5 搜索 / 保存更新） | 全部通过 |
| 前端模块即时转换（dev server 下 6 个关键模块） | 全部 200 |

往返单测覆盖：行内公式、块级公式、note / module（含嵌套 JSON）/ attach（相对路径）/ video、未知标记保留、混合文档整体往返。

## 3. 当前问题

1. **包体积**：主 bundle 1.77 MB（MathLive + KaTeX + marked），gzip 后 522 KB。v1 可接受；Phase 6 引入 `manualChunks` 拆分 + 按需加载优化。
2. **行内公式边界**：`$...$` 匹配对 LaTeX 内含 `$` 的转义场景（`\$`）有已知边界；块级公式要求独占行。后续可引入 `mdast` 级解析增强。
3. **搜索片段**：FTS5 `snippet()` 对中文片段截取为 24 token，展示效果一般；Phase 5 可改为自定义高亮 + 上下文窗口。
4. **KaTeX 字体**：KaTeX woff/ttf 全量打包（约 1 MB 字体资源），后续可按需子集化。

## 4. 下一阶段计划（Phase 3）

| 任务 | 说明 |
|---|---|
| 模块系统 v1 完善 | 模块列表面板 + 「插入为副本」交互（复用扩展规范）、模块增删改 |
| 编辑体验增强 | 拖拽图片/文件直接插入、粘贴图片自动上传、大纲（目录）侧栏、字数统计 |
| 表格节点 | 表格编辑（`@tiptap/extension-table`），序列化为 GFM 表格 |
| 文档元信息 | 标题 / 标签 frontmatter 编辑面板，更新索引 |
| 崩溃恢复 | 草稿自动备份 + 启动时恢复提示（SQLite recovery 表已就绪） |
