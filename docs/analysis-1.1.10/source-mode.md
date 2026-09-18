# v1.1.10 优化项③「源码模式」可行性分析

> **性质**：只读分析（未修改任何源码）。事实均给 `文件:行号` + 摘录；与任务描述不符之处以实测为准并显式标注。
> **分析者**：`verifier`｜**HEAD**：`04c7f93`｜**时刻**：2026-09-17（本地 UTC+8）
> **复现探针**（树外，不入仓库）：`/tmp/ke-verify/fidelity-probe.test.ts`、`probe-ext.ts`（生产扩展栈全量镜像）

---

## 0. 结论（TL;DR）

1. **源码模式保存必须完全绕过 ProseMirror（字符串直存）**，否则无法保住「未知语法原样保留」与既有字节。实测 41 个构造成分经「加载 → PM → 序列化」往返后：**逐字节一致 0 项**；语义等价仅尾换行差异 19 项；**被规范化 22 项**，其中含**真实内容丢失**（任务列表复选框、行内 HTML 标签、HTML 实体二次转义、BOM+frontmatter 整块损坏、CRLF→LF）。
2. 后端保存链路**天然支持字符串直存**：`PUT /api/articles/{id}` 只做 frontmatter 行级合并 + 原子写，不做 Markdown 解析（`documents.py:259-285`）——这是源码模式最大的一处**无需改动**的复用点。
3. 但是，**唯一新增的高危边界不在保存，而在「视图共存」**：正文视图 ↔ 源码视图切换若把源码文本喂给 `setKeContent`（`editor/index.ts:320-333`，内部 `normalizeGfmFootnotes` + PM 解析），下一次从正文视图保存就会把用户刚写的未知语法规范化/丢失。这是 MVP 必须用「切换契约」锁死的点。
4. **推荐 v1.1.10 MVP = 档 B（可编辑源码 + 字符串直存 + 单视图排他 + 切换前 flush）**，配 `<textarea>`（零新依赖）。档 A（只读）只作为「规范/管线先决条件来不及」时的降级；档 C（分屏双向同步）**不建议进入 v1.1.10**（每次同步都要 serialize/parse，256KB 下 serialize 39–138ms、parse 7–14s，体验与保真双输）。
5. **红线判定：需要规范先行**（D 层）。至少要在 `docs/document-format.md` 新增「编辑通道与视图」章节、在 `docs/markdown-extension-spec.md` 澄清 P2「任何工具不得删除或改写未知 ke-* 标记」与**用户主动改写权**的关系。
6. **估时**：档 A ≈ 1–1.5 人日；**档 B MVP ≈ 开发 4–6 + 测试/独立验证 2–3 + 规范 0.5–1 ≈ 7–10 人日**（不含保真缺陷修复）；档 C ≈ 15–25 人日。

---

## 1. 现有正文 ↔ Markdown 管道（事实与出处）

### 1.1 加载（磁盘 → PM）
```
frontend/src/components/layout/EditorArea.tsx:333   const body = article ? stripFrontmatter(article.content).content : ''
frontend/src/editor/ke.ts:20-36                    stripFrontmatter（正则 ^---\r?\n…；**不处理 BOM**）
frontend/src/editor/index.ts:320-333               setKeContent：
  :322 命中 mdDocCache → setContent(JSON, {contentType:'json', emitUpdate:false})
  :331 未命中 → setContent(**normalizeGfmFootnotes(markdown)**, {contentType:'markdown', emitUpdate:false})
  :332 mdDocCache.set(markdown, editor.getJSON())
```
- **`normalizeGfmFootnotes`（S-2）介入时机 = 仅在加载**（`editor/index.ts:331`；生产调用点全仓仅此一处，另有测试）。它把 GFM 脚注 `[^1]: …` 转换为 ke 方言 `<!-- ke-footnotes:start -->` 区块（`gfm-footnote.ts:548`）——**这一步在 PM 之外就改写了文本**。
- `mdDocCache` 以「原始 markdown 字符串」为键缓存 PM JSON（`:332`），因此**同一字符串反复打开不会二次解析**，但缓存命中不改变规范化结果。

### 1.2 序列化（PM → 文本）
```
editor/index.ts:192-197   Markdown.configure({indentation:{style:'space',size:2}}); contentType:'markdown'
editor/index.ts:6-8       注释即契约：Markdown ──(getMarkdown)──▶ Markdown 文本
EditorArea.tsx:293        buildSaveFn 内 withFrontmatter(ed.getMarkdown(), KE_VERSION)
```
- 序列化由 `@tiptap/markdown` 的 manager 完成；**块的间距/换行由 doc 级统一输出**（`docs/document-format.md:291`「块级节点的 renderMarkdown 不得自带首尾换行，块间距由 doc 级 `\n\n` 分隔符统一输出」）。

### 1.3 保存（文本 → 磁盘）
```
EditorArea.tsx:276-340  buildSaveFn：
  :289 resolveSaveContent({docId, currentDocId: editorDocId, editorMarkdown, snapshots})  // 快照/串写裁决
  :298 await registerRecoveryPoint(docId, md)        // S-1 恢复点（先登记）
  :299 const saved = await saveArticle(docId, md, signal)
  :283/:288 成功且 latest → clearRecoveryPoint / markSaved
EditorArea.tsx:358-361  enqueueSave(docId, buildSaveFn(docId), getAutosaveIntervalMs()) + ensureDraftReg().touch()
frontend/src/api/client.ts:58-65  saveArticle = PUT /api/articles/{id} {content}
backend/app/routers/documents.py:259-300  update_article：
  :276 merged = markdown_io.merge_frontmatter(old_raw, body.content)   // 仅 frontmatter 行级合并
  :280 _maybe_snapshot(...)   :281 atomic_write(full, body.content)     // 原子写，正文逐字节
  :282 indexer.update_file    :283 _mark_internal(request, rel)         // 自写抑制 watcher
```

### 1.4 导出（只导出不改原文件）
```
frontend/src/editor/plain-export.ts:1-11  纯函数、零网络、零副作用（文件头注释即契约）
frontend/src/editor/export-actions.ts     无 saveArticle/updateArticle 调用（grep 结果为空）
```
→ 导出链路与源码模式无冲突：它不写原文件。

---

## 2. 既有「视图切换」骨架：**任务描述与事实不符**

- 任务描述称「`EditorArea.tsx` 顶部那一排：正文 / 模块 / 导出」是视图切换骨架。**实测不是视图切换**：
  - `EditorToolbar.tsx:439-440` 的「正文 ▾」是**块样式下拉**（正文/标题1~6），不是视图 tab；
  - 「模块」「导出」分别是模块插入与导出动作按钮（`EditorToolbar.tsx:295-306` 的 props 列表）。
- **真实可复用点**（比我另造一个更省）：
  - `EditorToolbar.tsx:295` 已声明 `tabBar?: ReactNode`，并在 `:437 {tabBar}` 渲染 —— **全仓无任何调用者**（`grep -rn "tabBar" src/` 仅命中声明处）→ 这就是现成的「视图切换挂载位」。
  - 顶层布局 `AppShell.tsx:14-27` 为 `header/left/main/right/statusBar` 五槽，无 tab 概念 → 新增视图属于 `main` 槽内的事，不需要动 AppShell。
  - `EditorArea.tsx:680-{loading||parsingLarge}` 已有「同一区域按状态切换渲染」的模式（占位/编辑器），源码视图可沿用该条件渲染位置。
- **结论**：可以复用 `tabBar` 插槽 + `EditorArea` 的条件渲染，但**没有现成的视图状态机**（无 `viewMode`，`grep -rn "viewMode" src/` 为空）→ 新状态属新增分支，不是复用。

---

## 3. 保存 / 自动保存 / 恢复 / 历史 / 外部修改：复用点与新增分支

| 子系统 | 现有实现（复用点） | 源码模式需要的新增/改动 |
|---|---|---|
| 防抖自动保存 | `saveQueue.enqueueSave(docId, saveFn, debounce)` 尾沿防抖 + 单飞 + latest-wins（`saveQueue.ts:90-104`） | **仅替换 saveFn 的内容来源**（从 `ed.getMarkdown()` 换成 `sourceBuffer`），队列本身零改动 |
| S-1 有界年龄恢复点 | `draftDebounce.ts:33 RECOVERY_MAX_AGE_MS=3000`；`EditorArea.tsx:247-256 flushDraftRecovery` 用 `editorRef.getMarkdown()` | **必须新增分支**：源码模式下登记内容 = 源码缓冲原文（否则崩溃恢复会用 PM 规范化版本覆盖用户未知语法） |
| 切档快照（F-S1-2） | `docSwitch.onDocumentSwitch` 快照 `articleRef/editorMarkdown`（`EditorArea.tsx:388-446`） | **必须新增分支**：源码模式下快照源 = 源码缓冲（不同文档各自缓冲或切档即 flush，二选一） |
| 历史快照 `Drafts/backup` | 后端 PUT 内 `_maybe_snapshot`（`documents.py:280`）自动 | **零改动**（任何内容来源都经同一 PUT） |
| 外部修改检测 / 自写抑制 | 后端 `_mark_internal`（`documents.py:283`）+ 前端 fs 轮询 classify | **零改动**（源码模式保存走同一 PUT） |
| 外部重载 `reloadToken` | `App.handleReloadExternal` → `abortPending` → `flushPending` → `openArticle` → `reloadToken+1`；`EditorArea.tsx:446` effect 重载 | **新增分支**：若源码视图处于活跃态，重载后必须同步刷新源码缓冲（并丢弃未保存缓冲，沿用既有确认流程） |
| 恢复点「清除」 | `clearRecoveryPoint` + `markSaved(true)`（`EditorArea.tsx:300-309`） | 复用，仅需保证源码模式下 `latest/seq` 判定同样成立 |
| 文档切换 flush | 切档 effect `flushPending(prevId)`（`EditorArea.tsx:388+`） | 复用 |

**新增分支合计**：内容来源（saveFn/恢复点/切档快照/重载同步）4 处 + 视图状态 1 处。**保存链路的后端/队列/历史/自写抑制均可零改动复用。**

---

## 4. 保真风险（最重要）

### 4.1 实测矩阵：41 个构造成分经「加载口径 → PM → 序列化」

口径 = `stripFrontmatter` → `normalizeGfmFootnotes` → `setContent(markdown)` → `getMarkdown()`；比较采用项目 `fidelity-regression.test.ts` 同款「行尾换行不计差」归一化。

```
[ke-verify] 合计 EXACT=0 / TRAILING=19 / CHANGED=22（共 41）
```

**逐字节一致：0 项。** 即：**任何文档只要经过 PM 一次，字节就会变。**
（为公平起见：**普通段落文档仅差尾换行**——实测 `# 标题\n\n正文段落\n` → `# 标题\n\n正文段落`，属项目测试同口径的等价；即有损的是下列特殊构造，而非日常正文。）

**仅尾换行差异（19 项，语义等价）**：未知 ke-* 标记（未来 kind）、损坏 JSON 的已知 ke-*（`ke-attach` / `ke-module` 括号不匹配）、普通 HTML 注释、HTML 块 `<div>`、反引号围栏（带语言）、行内代码、`$行内$`、`$$块级$$`、嵌套引用块、嵌套无序列表、`3.` 起始有序列表、`~~删除线~~`、行尾两空格硬换行、`\*转义\*`、连续多空行、`![alt](src "title")`、YAML frontmatter（含未知键+注释）、`:::note` 未识别容器。
（补充实测，未计入 41 矩阵：**规范 ke 脚注区**——`<!-- ke-footnotes:start -->` + `ke-footnote-item`——一次/二次往返内容与结构一致且幂等，仅差尾换行。）

**被规范化（22 项）——分两类：**

**(a) 设计内规范化（13 项，规范可查，属「打开即规范化」的既定行为）**

| 构造 | 输入 → 输出（实测） | 出处 |
|---|---|---|
| GFM 脚注 | `正文[^1]。` + `[^1]: 脚注内容` → `正文<!-- ke-footnote: {"kind":"footnote","id":"ke-66fe4755e166","n":1} -->。` + ke 脚注区 | S-2 方言转换（document-format §2.3.1） |
| 孤立脚注定义 | `[^1]: 孤立定义` → `<!-- ke-footnotes:start -->…` | 同上 |
| 合法 `ke-note` | 补默认字段：`{"id":"n1","title":"注"}` → `{"kind":"note","id":"n1","title":"注","color":"blue"}` | markdown-extension-spec:234（按字段顺序重建，未知属性不丢） |
| 合法 `ke-attach` | 补 `kind/id/type` 默认值 | 同上 |
| Obsidian 式 `1)` | `1) 第一` → `1. 第一` | v1.1.5 ⑥（有注释） |
| 表格 | `\|---\|---\|` → `\| --- \| --- \|`，且**前置一个空行**；转义管道符与列数保留 | P1-4 |
| 引用式链接 | `[文字][ref]` + `[ref]: url "标题"` → 行内 `[文字](url "标题")` | marked 默认 |
| 角括号自动链接 | `<https://x>` → `[https://x](https://x)` | 同上 |
| Setext 标题 | `标题\n====` → `# 标题` | 同上 |
| 波浪线围栏 | `~~~js` → ` ```js ` | 同上 |
| 缩进代码块 | `    code` → ` ```code``` ` | 同上 |
| 行尾多余空格 | 3 空格 → 2 空格（硬换行仍保留） | 序列化器 |
| ke 脚注引用（自造标记组合） | `[^1]` 在无规范定义时 → `\[^1\]` | 解析器降级（非规范方言组合） |

**(b) 保真缺陷 / 内容丢失（9 项，最小复现见下）**

| # | 构造 | 输入 → 输出（实测） | 后果 |
|---|---|---|---|
| F-1 | **任务列表** | `- [x] 完成` / `- [ ] 未完成` → `- 完成` / `- 未完成` | **复选框状态丢失**（生产无 TaskList 扩展） |
| F-2 | **行内 HTML** | `正文 <span style="color:red">红</span> 结尾` → `正文 红 结尾` | **标签被丢弃**（`HtmlPassthroughInline` 只覆盖注释类） |
| F-3 | **HTML 实体** | `&copy;` → `&amp;copy;` | 二次转义（内容变形） |
| F-4 | **BOM + frontmatter** | `\ufeff---\r\nke_version: 1\r\n---\r\n\r\n正文` → `## ---\nke\_version: 1\n\n正文` | `stripFrontmatter` 不识别 BOM → **frontmatter 整块被当正文**，保存时还会再套一层新 frontmatter |
| F-5 | **CRLF 全文** | `# 标题\r\n\r\n正文\r\n` → `# 标题\n\n正文` | 行尾统一为 LF（工作区文件被改写；规范未声明换行策略） |
| F-6 | 表格前导空行 | 文档以表格开头时输出多一个空行 | 字节变化（语义不变） |
| F-7 | 缩进/波浪围栏风格 | 见 (a) | 字节变化（语义不变） |
| F-8 | 引用式链接/角括号链接 | 见 (a) | 字节变化（语义不变） |
| F-9 | 行尾 3 空格 | 见 (a) | 字节变化（语义不变） |

> 说明：F-6…F-9 属「语义保留、字节变化」，在多轮往返后**收敛**（幂等）；F-1…F-5 属**首轮即丢/即坏**，且**不可逆**。

### 4.2 明确回答：源码模式保存是否必须完全绕过 ProseMirror？

**是，必须。** 论据三条：
1. **加载期就已改写**：`setKeContent` 内 `normalizeGfmFootnotes(markdown)`（`editor/index.ts:331`）在进入 PM 之前就替换了 GFM 脚注结构。
2. **序列化期统一重建**：已知 ke-* 节点按字段顺序重新生成 JSON（补默认字段）、块间距由 doc 级重排、表格 separator 重写（实测 (a) 13 项）。
3. **存在不可逆丢失**：F-1/F-2/F-3/F-4/F-5 —— 经 PM 一次即丢复选框/标签/实体正确性/frontmatter 结构/换行风格。**0/41 逐字节一致**是这一结论的量化形式。

**推论**：源码模式的保存若走 `ed.getMarkdown()`，等于「用户刚写的原文被规范化后再落盘」——那源码模式就失去存在意义。**B 档的字符串直存不是优化项，而是该功能的定义本身。**

### 4.3 后端直存的两个静默行为（源碼模式必须写进规范）

实测 `markdown_io.merge_frontmatter(old, new)`（`markdown_io.py:280-318`）：

| 用户在源码模式的编辑 | 实际落盘 | 判定 |
|---|---|---|
| 改 frontmatter 某键的值 | 逐字节 = 用户输入 ✓ | 保留 |
| 新增自定义键 | 逐字节 = 用户输入 ✓ | 保留 |
| **删除某 frontmatter 键**（如 `tags:`） | **旧键被回填**（`---\ntitle: 标题\nke_version: 1\n---` → 落盘多出 `tags: [a, b]`） | **静默撤销**（P0-1 保护元信息的既定行为） |
| **整块删除 frontmatter** | **旧 frontmatter 被整块回填** | **静默撤销** |
| 改写/删除未知 ke-* 标记（正文内） | 逐字节 = 用户输入 ✓ | 保留（与 P2 的张力见 §6） |

→ 源码模式若允许编辑 frontmatter，**删除类操作会被后端静默撤销**；MVP 建议：**源码模式只暴露正文（frontmatter 折叠/只读）**，或规范明确「frontmatter 由属性面板管理，源码模式不承担删除语义」。

---

## 5. UI / 交互问题（逐条回答）

| 问题 | 结论与建议 |
|---|---|
| 切换时未决编辑怎么办 | **切换前必须 flush**（复用 `flushWithTimeout`，App.requestOpenArticle 同款 3s 超时 + 确认兜底）。切到源码前 flush → 从磁盘/保存结果取原文；切回正文前 flush 源码保存 → 再 `setKeContent` 解析。**不允许带着未决编辑切换**，否则两套内容来源分叉。 |
| 两视图同时打开会不会双写 | **MVP 必须单视图排他**（同一 doc 同时只有一个编辑通道）。档 C 的"同时可见"会引入双写与循环同步，v1.1.10 不做。 |
| 切换是否入撤销栈 | 视图切换本身**不入** PM 撤销栈（`setKeContent` 已 `clearUndoRedoHistory`，`fidelity-regression.test.ts` P0-4 已锁定）；源码 textarea 的撤销用浏览器原生栈，**切回正文会清空**——需在 UI 提示或规范写明。 |
| 只读态/版本预览是否允许源码编辑 | **不允许**：历史预览是只读（`EditorArea.tsx:947-960` 预览分支）；源码模式仅在「打开的文档」态启用。 |
| ≥256KB 大文档性能 | PM 路径：项目自带 `perf-bench.test.ts` 同机输出 `256KB: first=8510ms … serialize=138ms`；我的独立测量（task-20）191KB serialize 稳态中位 39.8ms/冷 105.5ms、256KB 中位 54.9ms。**源码视图用 `<textarea>` 无解析成本**（只需把字符串塞进 DOM）；CodeMirror 6 会带来增量解析/高亮（更友好）但新增依赖与包体，且大文档仍需小心。**MVP 用 textarea；CodeMirror 留 v1.1.11** |

---

## 6. 三档方案对比

| 维度 | **A 只读源码预览** | **B 可编辑源码 + 字符串直存**（推荐 MVP） | **C 可编辑 + 分屏双向同步** |
|---|---|---|---|
| 交互 | 「源码」只读查看（<pre>/readonly textarea） | 单视图排他切换；textarea 可编辑；切换前 flush | 左 PM 右源码，双向实时同步 |
| 内容来源 | 打开时从磁盘读（`article.content`，含 frontmatter），或切换时 GET 刷新 | 切换时 GET 刷新（保证 = 磁盘原文）；编辑进源码缓冲 | 两侧实时互转 |
| 保存 | 不保存 | **字符串直存**：`saveArticle(docId, withFrontmatter(buffer, KE_VERSION))`，**完全不经过 PM** | 任一侧变更都要 serialize/parse → **必然经 PM**（规范化 + 丢失） |
| 保真风险 | 无（不动文件） | **低**（保存不动原文）；**唯一风险在切回正文时的解析规范化** → 用「切换契约 + 提示」承担 | **高且不可控**：每次同步都等价于 §4.1 的 PM 往返；F-1…F-5 必丢 |
| 自动保存/恢复/历史 | 零交互 | 复用同一队列；**恢复点与切档快照需新增「源码内容来源」分支**；历史/自写抑制零改动 | 同步节流与自动保存叠加，时序复杂；恢复点语义需重新定义 |
| 外部修改/reloadToken | 无 | 需新增「重载后刷新源码缓冲」分支 | 需新增双向重载仲裁 |
| 可测性 | 高（纯展示，快照测试） | **高**：字符串直存可做字节级断言；视图切换可做组件轨（可沿用我 task-18/20 的树外 harness 范式） | 低（时序/光标/回环） |
| 性能（256KB） | 无额外成本 | textarea 无解析成本；切换时才解析（也可选择不解析） | 每次同步 serialize 39–138ms + parse 7–14s → **不可用** |
| 依赖 | 0 | 0（textarea） | CodeMirror + 同步层 |
| 红线（D 层/规范先行） | 不需要改格式；建议文档补一句只读视图说明 | **需要规范先行**：新增「编辑通道/视图」章节 + 澄清未知标记改写权 | 同 B，且需额外定义同步语义 |
| 工程量 | 0.5–1 人日 | **4–6 人日开发 + 2–3 人日测试/独立验证 + 0.5–1 人日规范** | 15–25 人日 |

### 推荐：**档 B（MVP）**，边界如下（即「源码模式 = 第二个编辑通道，但不是第二个真相源」）

1. 单视图排他：同一文档同时只有一个编辑通道；切换 = **flush → 换通道**。
2. 进源码：`flushWithTimeout` → `GET /api/articles/{id}` 取**磁盘原文**（不取 `ed.getMarkdown()`）→ 填充 textarea（frontmatter 折叠/只读，见 §4.3）。
3. 源码编辑：与正文同样的 `enqueueSave`（尾沿防抖）+ S-1 有界年龄恢复点（内容 = 源码缓冲）+ 历史/自写抑制（经同一 PUT）。
4. 保存：`withFrontmatter(buffer, KE_VERSION)` 字符串直存；**不调用任何 PM API**。
5. 切回正文：flush 源码保存 → `setKeContent(原文)`（会规范化）→ **一次性提示「未知语法可能被规范化」**；若用户要求 100% 保真，应保持在源码模式。
6. 只读/预览态禁用源码编辑；无 `viewMode` 记忆（全局开关，不做按文档记忆——减少状态）。
7. 实施顺序（风险从高到低）：先落**保真基线测试**（把 §4.1 的 9 个缺陷构建成回归用例并决定修/记录）→ 规范 → 后端零改动 → 前端通道。

---

## 7. 红线判定：为什么必须规范先行

项目规矩：**改 D 层必须先改规范再改代码**。源码模式触碰 D 层的点：

1. **P2「幂等性」条款**：`docs/markdown-extension-spec.md:30` 明确「未知 `ke-*` 标记必须原样保留，**任何工具不得删除或改写**」。源码模式让**用户**直接改写/删除未知标记——必须澄清「工具不得改写」与「用户有权改写」的边界（建议限定：管线不得改写；用户显式编辑允许，且保存前给出影响提示）。
2. **`docs/document-format.md:55/276-291`** 定义了「未知标记 → `raw` 原样保留」与「块间距由 doc 级统一输出」。源码模式引入第二条**不经节点模型**的写盘通道，需要在同一份文档里说明：
   - 两个视图各自的保真承诺（正文视图 = 语义保真 + 规范化；源码视图 = **字节保真**）；
   - 切换契约（flush-first、解析即规范化的提示）；
   - 源码模式对 frontmatter 的权限（建议只读，避免 §4.3 的静默回填）。
3. **换行策略缺位**：规范未声明 LF/CRLF；实测 F-5 会把 CRLF 文档改成 LF。源码模式要么承诺「源码保存按用户字节写」（本档 B 的默认），要么规范明确「CRLF 会被规范化」。

→ **需要新增/修改的规范**：`docs/document-format.md` 新章节「§6 编辑通道与视图（正文 / 源码）」+ `docs/markdown-extension-spec.md` P2 条款注记。**两份都是 D 层文档，必须在动代码前先改。**

---

## 8. 先决条件清单（进代码前必须完成）

1. **保真基线测试先行**：把 §4.1 的 41 构造（尤其 F-1…F-5）固化成回归用例，并逐条决策「修复 / 记录为已知规范化」——否则源码模式的「字节保真」承诺无处落地。
2. **规范先行**（§7）：`document-format.md` 新增编辑通道章节；`markdown-extension-spec.md` 澄清未知标记改写权；补换行策略。
3. **主理人拍板 §9 的产品问题**（尤其「是否允许保存未知语法」与「是否允许编辑 frontmatter」）。
4. **数据安全兜底设计**：源码保存前必须已有恢复点（S-1 链路复用）+ 历史快照（后端自动）→ 需要一条**字节级**回归测试证明「源码保存后原文逐字节不变」。
5. **视图状态归属**：明确 `viewMode` 放 `EditorArea` 还是 `App`（影响 reloadToken/切档两个 effect）；建议 EditorArea 局部状态 + `tabBar` 插槽。
6. **降级预案**：若 1–3 在 v1.1.10 窗口内无法完成 → **降级为档 A（只读）**，把「可编辑」推到 v1.1.11。

---

## 9. 主理人必须拍板的 3–5 个产品问题

1. **未知语法/损坏 `ke-*` 标记的所有权**：源码模式下是否允许用户保存对它们的改写/删除？（影响 `markdown-extension-spec.md` P2 的修订；若不允许 → 源码模式需拦截或只读，工作量与体验都变。）
2. **frontmatter 在源码模式的权限**：可编辑（但后端会静默回填被删键，需改 merge 语义 = D 层变更）还是只读/折叠？（建议只读，可零后端改动。）
3. **切换视图是否自动保存**：本文建议「切换前必须 flush + 切回正文时提示解析会规范化」。是否接受「切回正文即把源码解析进 PM 并标记 dirty」？还是要求用户显式点「应用」？
4. **视图记忆粒度**：全局开关 vs 按文档记忆？（建议全局，减少状态与竞态；按文档记忆会让外部重载/切换路径多一套状态。）
5. **大文档与编辑器控件**：≥256KB 是否仍允许源码模式（textarea 无压力，但建议给出上限与提示）？是否接受为更好的体验引入 CodeMirror 依赖（包体 + 离线打包影响），还是 v1.1.10 先用 textarea？
6. （备选）**导出/源码的关系**：源码模式下「导出普通 Markdown」是否仍走 `plainExportPayload`（会对 ke 方言降级）？两者语义差异需在 UI 上区分。

---

## 10. 估时（人日，含测试与独立验证）

| 档位 | 规范 | 开发 | 测试/独立验证 | 合计 | 备注 |
|---|---|---|---|---|---|
| A 只读源码预览 | 0.2 | 0.5–0.8 | 0.3–0.5 | **1–1.5** | 无保真风险；可作为降级选项 |
| **B MVP（推荐）** | 0.5–1 | 4–6（含通道/切换/恢复点/切档/重载 5 处分支 + textarea 组件） | 2–3（字节级保真 + 组件轨 + 与 S-1/F-S1-2/F-S1-4 的交互回归） | **6.5–10** | 不含 F-1…F-5 的修复；若一并修保真缺陷 +3–5 |
| C 分屏双向同步 | 2–3 | 10–15 | 3–7 | **15–25** | **不建议 v1.1.10**（保真必输、性能不可用） |

**关键路径**：保真基线测试 → 规范修订 → 前端通道实现 → 独立验证（建议沿用我 task-18/20 的树外 EditorArea harness + task-23 的启动自愈式字节断言）。

---

## 附录 A：复现命令

```bash
# 保真往返矩阵（生产扩展栈；41 构造）
cd /tmp/ke-verify && npx --prefix "/mnt/f/Work/KE Project/knowledge-editor/frontend" vitest run fidelity-probe.test.ts
# 单构造 raw 前后对照（表格/任务列表/围栏/实体/引用式链接等）
cd /tmp/ke-verify && npx --prefix ".../frontend" vitest run raw-check.test.ts raw2.test.ts raw3.test.ts
```

## 附录 B：关键出处索引

| 事实 | 出处 |
|---|---|
| 加载即 normalize GFM 脚注 | `frontend/src/editor/index.ts:320-333`；`gfm-footnote.ts:548` |
| `stripFrontmatter` 不处理 BOM | `frontend/src/editor/ke.ts:20-36` |
| 保存链（登记→PUT→清除） | `EditorArea.tsx:247-256, 276-340, 358-361`；`api/client.ts:58-65` |
| 后端仅 frontmatter 合并 + 原子写 | `backend/app/routers/documents.py:259-285`；`markdown_io.py:280-318, 409-431` |
| 未知 ke-* 原样保留（P2/P3） | `docs/markdown-extension-spec.md:30-31, 58-64`；`docs/document-format.md:55, 276-278` |
| 块间距由 doc 级统一输出 | `docs/document-format.md:291` |
| 视图切换挂载位（未使用） | `frontend/src/components/editor/EditorToolbar.tsx:295, 437`（全仓无调用者） |
| 无 viewMode / 无 tab 视图 | `grep -rn "viewMode\|segmented\|role=\"tab\"" frontend/src/` → 空 |
| 256KB 性能基线 | `src/editor/perf-bench.test.ts`（同机实测 `first=8510ms … serialize=138ms`）+ 本人 task-20 独立测量 |
| 导出不改原文件 | `plain-export.ts:1-11`；`export-actions.ts` 无 `saveArticle` |
