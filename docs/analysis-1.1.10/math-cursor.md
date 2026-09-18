# 分析② v1.1.10 公式编辑光标/换行优化（行内→公式后，块级→换行行首）

> 任务：task-26 · 只读分析（**不改任何源码**）· 产出：本文件
> 日期：2026-09-18 · HEAD：`04c7f93`（v1.1.9 已发布）· 分析人：dev-trash-fe
> 方法：代码级论证（全部给 `文件:行`）+ **隔离探针实测**（探针放 `/tmp/ke-math-probe/`，不进仓库；命令与原始输出见 §8）

---

## 0. 结论先行（TL;DR）

| 问题 | 结论 |
|---|---|
| **现状起点** | 保存公式**完全没有设置选区、也没有把焦点还给编辑器**：① 行内公式：若打开模态前是 NodeSelection，保存后**坍缩到公式「前」一位**（实测 `from=4`，公式占 4..5）；② 块级公式：NodeSelection **原地保留**（无换行、无 caret）；③ 编辑器保持失焦（**代码级**：模态打开即 `textarea.focus()`，关闭后无任何 `focus()` 归还） |
| **实现位置** | ✅ 唯一推荐：**EditorArea 的 `onSave`/`onDeleteEmpty` 事务内**（已是既有的「安全层」：根组件 + double-rAF 延后）。❌ 不要放 MathNodeView（`addKeyboardShortcuts`/NodeView 内），它虽不直接改文档，但真正的事务必须留在根层；❌ 也不要放模态 `close()` 回调（模态不含 editor 引用，且 `onClose()` 与事务的时序正是 #300 的历史触发点） |
| **事务原子性** | 「改 latex + 新起一行 + 设选区」全部放进**同一个 `tr`** → 一次 Ctrl+Z 同时回退内容与新增空行。实测：0-step 的 `setTextSelection` 独立事务不进 undo 栈（`prosemirror-history` `steps.length==0 → return history`），两种写法都安全，但合并更优 |
| **块级「自动换行」** | 不插重复空行：后继是**空段落**→复用；否则在 `pos+nodeSize` 插入 1 个 `paragraph` 并把 caret 放 `insertPos+1`。文档末尾的常见情形**已有** trailingNode 自动补的空段落（实测：保存事务后 doc children = `mathBlock,paragraph`），不会多插 |
| **红线** | ✅ 不触碰 `ke-*` 格式与序列化：`$...$` / `$$\n...\n$$` 输出**实测不变**；不新增 attrs/设置项/Rust。⚠️ 唯一副作用：块级公式后**可能新增一个空段落**（Markdown 多一个空行），且 v1.1.7 §3.2 曾定「保存后光标回到文档原型位置」——本项**推翻该决策**，按项目「规范先行」需先更新设计文档 |
| **估时** | 实现 0.5 人天 + vitest 0.5 人天 + 独立验证 0.5 人天 ≈ **1.5 人天**（2 人并行约 1 天） |
| **必须先拍板** | 5 个产品问题见 §7（最关键：块级公式后**已有正文段落**时，是「插一个空行」还是「光标落到既有段落行首」） |

---

## 1. 事实核查（每条给 `文件:行` + 摘录）

### 1.1 公式节点定义与 inline/block 分流

**行内 `math`**（`frontend/src/editor/extensions/MathExtension.ts`）：

```ts
17  export const MathExtension = Node.create({
18    name: 'math',
19    group: 'inline',
20    inline: true,
21    atom: true,
22    selectable: true,
23    draggable: false,
24
25    addAttributes() { return { latex: { default: '' }, id: { default: '' } } },
...
64    addNodeView() { return ReactNodeViewRenderer(MathNodeView) },   // ← 独立 React 根
77    markdownTokenName: 'math_inline',
78    markdownTokenizer: mathInlineTokenizer,
83    renderMarkdown: ({ attrs }) => `$${attrs?.latex ?? ''}$`,        // ← 序列化红线
```
- 行内公式**也是 atom + React NodeView**（`:64-66`）——「NodeView 独立 React 根」这条坑对行内/块级**同样成立**。
- 序列化只有 `$latex$`，**attrs.id 不进 Markdown**（实测往返也不含 id，见 §8 [B]）。

**块级 `mathBlock`**（`MathBlockExtension.ts`）：

```ts
16  export const MathBlockExtension = Node.create({
17    name: 'mathBlock',
18    group: 'block',
19    atom: true,
20    selectable: true,
21    draggable: true,
...
55    addNodeView() { return ReactNodeViewRenderer(MathNodeView) },   // 同一个 NodeView
68    markdownTokenName: 'math_block',
74    renderMarkdown: ({ attrs }) => `$$\n${attrs?.latex ?? ''}\n$$`,
```

**inline vs block 的分流判定有三处，全部只看「节点类型名」**：
1. NodeView 渲染层：`MathNodeView.tsx:29` `const isBlock = node.type.name === 'mathBlock'`；
2. 编辑请求：`MathNodeView.tsx:50` `requestEdit({ pos, nodeSize, id, latex, isBlock })`；
3. 保存定位：`EditorArea.tsx:797 / 819` `(node.type.name === 'math' || node.type.name === 'mathBlock') && node.attrs.id === mathEdit.id`。

→ 本项不需要新增「是不是块级」的判定，沿用 `mathEdit.isBlock` 即可。

### 1.2 编辑入口与出口

**入口（3 条）——都经 `window` 自定义事件，不直接碰 PM**：

| 入口 | 位置 | 行为 |
|---|---|---|
| 双击公式渲染区 | `MathNodeView.tsx:58-61` | `onDoubleClick → openEdit()`（前态通常为 NodeSelection——`atom+selectable` + wrapper `contentEditable=false`，属代码层推断；探针在 state 层分别模拟了 NodeSelection 与普通 caret 两种前态）|
| 悬浮「编辑公式」按钮 | `MathNodeView.tsx:71-74` | `onClick → openEdit()` |
| Ctrl/⌘+N · Ctrl/⌘+M · 工具栏「插入公式 / 插入块级公式」 | `editor/index.ts:74-101`；`EditorToolbar.tsx:533-559` | 先 `insertContent` 再 `openMathEditorById(editor, id)`（`editor/index.ts:111-132`，内部 `setTimeout(0)` 后按 id 定位并派发 `ke:math-edit-request`）|

```ts
// MathNodeView.tsx:13-26
export interface MathEditRequest { pos: number; nodeSize: number; id: string; latex: string; isBlock: boolean }
export const MATH_EDIT_EVENT = 'ke:math-edit-request'
function requestEdit(req) { window.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT, { detail: req })) }
```
```ts
// EditorArea.tsx:377-385（编辑器根监听，安全层）
const onReq = (ev: Event) => { setMathEdit({ ...(ev as CustomEvent<MathEditRequest>).detail, open: true }) }
window.addEventListener(MATH_EDIT_EVENT, onReq)
```

⚠️ `MathEditRequest.pos` 是 NodeView `getPos()` 的**快照**，注释已声明可能过期（`MathNodeView.tsx:17-20`）；保存时以 **id 主定位、pos 兜底**（`EditorArea.tsx:793-803`）。**本项算 caret 位置必须用「按 id 定位后的 target」，不能用 `mathEdit.pos`。**

**出口：Esc / 完成 / ✕ 是同一路径 —— 没有「取消」**（`MathEditorModal.tsx`）：

```ts
82   const close = (save: boolean) => {
83     onClose()                                   // → EditorArea: setMathEdit(null)（先卸载模态）
84     if (save) {
85       const cleaned = stripSlots(latex).trim()
88       const op = window.requestAnimationFrame(() =>
89         window.requestAnimationFrame(() => {     // double-rAF：等跨根渲染落定，再发 PM 事务（防 #300）
90           if (cleaned === '') { onDeleteEmpty() } else { onSave(cleaned) }
...
183    if (e.key === 'Escape') { e.preventDefault(); close(true); return }   // Esc = 保存（空 = 删除）
249    onClick={() => close(true)}   // 完成
254    onClick={() => close(true)}   // ✕
```
→ **「Esc 退出」与「保存」是同一条代码路径**：把光标逻辑放进 `onSave`/`onDeleteEmpty`，三条出口一次性全覆盖；不存在「Esc 取消」分支需要另写。

**保存事务（现状）**：`EditorArea.tsx:789-811`，只 `setNodeMarkup`，**没有 setSelection、没有 focus**：

```tsx
789  onSave={(v) => {
790    const ed = editorRef.current
791    if (ed && mathEdit) {
792      ed.commands.command(({ tr }) => {
793        // 主定位 = 节点 id（mount 期 getPos 可能过期）；备选 = pos
794        let target = -1
795        tr.doc.descendants((node, pos) => { ... target = pos ... })
803        if (target < 0) target = mathEdit.pos
804        const node = tr.doc.nodeAt(target)
805        if (!node) return false
806        tr.setNodeMarkup(target, undefined, { ...node.attrs, latex: v })
807        return true
808      })
809    }
810    setMathEdit(null)
811  }}
```
`onDeleteEmpty`（`:812-833`）同样只有 `tr.delete(target, target + node.nodeSize)`，无选区处理。

**焦点归谁**：
- 打开模态即抢焦点：`MathEditorModal.tsx:66-78` `t.focus(); t.setSelectionRange(len, len)`；
- 关闭后**无人归还焦点**：`EditorArea.tsx:834` `onClose={() => setMathEdit(null)}` 只卸载模态；全文件 `focus()` 命中仅 `:145`（输入框）、`:715`（点击正文）；
- 而点击正文聚焦的分支**明确排除** NodeView：`EditorArea.tsx:713-715`
  ```tsx
  if (t.closest('[contenteditable="false"], textarea, input, select, button, math-field')) return
  if (!editor.isFocused) editor.commands.focus()
  ```
  → **点公式节点本身不会给编辑器焦点**（NodeView wrapper 是 `contentEditable={false}`，`MathNodeView.tsx:54`）。

**结论（代码级）**：保存后编辑器处于**失焦 + 选区停滞**状态，用户必须再点一次正文才能继续输入。这是本项要修的核心体验问题。

### 1.3 保存后选区到底落在哪（★ 探针实测）

用与仓库同类脚手架（`new Editor({ extensions, content, contentType:'markdown' })`，同 `markdown-roundtrip.test.ts:59-61`）在 happy-dom 下复刻 `EditorArea` 的 onSave 事务，直接读 `editor.state.selection`：

| 场景 | 保存前 | **现状保存后** | 说明 |
|---|---|---|---|
| 行内，段落中间 `前文 $x$ 后文` | `NodeSelection {from:4,to:5}` | `TextSelection {from:4,to:4,empty}` | **坍缩到公式「前」一位** |
| 行内，段末 `前文$x$`（mathPos=3） | `NodeSelection` | `TextSelection {from:3,to:3}` | 同样落在公式**前** |
| 行内，打开模态时 caret 在别处（`from=8`） | `TextSelection {from:8}` | `TextSelection {from:8}` | 原地不动（`setNodeMarkup` 尺寸不变 → mapping 恒等） |
| 块级，文档末尾 `$$x$$` | `NodeSelection {from:0,to:1}` | `NodeSelection {from:0,to:1}` | **块级 NodeSelection 保留**：无换行、无 caret |
| 块级，`$$x$$\n\n后续文字` | `NodeSelection` | `NodeSelection` | 同上 |

两条附带事实（同批实测）：
- 文档末尾的块级公式，在**任意事务**之后 trailingNode 会自动补一个空段落：`doc children = mathBlock,paragraph`（`editor/index.ts:145-151` 配置 `trailingNode: { node:'paragraph', notAfter:['paragraph','footnotes'] }`）；但**直接 `new Editor` 初始状态不会**（appendTransaction 只在事务后跑）——所以实现必须自己兜底插入，不能假设空段落一定存在。
- 插入路径在**模态打开前** caret 已经落好：`insertMathBlock('')` → `sel.from=2`（落在自动尾段落行首）、`insertMath('')` → `sel.from=2`（紧跟公式后）。**是模态把焦点/光标拿走了**，本项相当于「保存后把它还回来」。

### 1.4 既有相关能力

**① 公式自动补全的 Tab 占用**（不要顺手拿 Tab 当跳转键）：
- 开关：`settings.ts:21` `mathAutocomplete?: boolean`；`:63` 默认 `true`；`:179` 白名单化校验；UI `SettingsPanel.tsx:263-265`。
- 消费点只在模态 textarea 内：`MathEditorModal.tsx:36` 读设置 → `:167-182` `if (e.key === 'Tab') { preventDefault(); 有补全→applyCompletion(); 否则→槽位跳转 }`。
- 结论：**Tab 从未到达 ProseMirror**；模态关闭后 Tab 回到 PM 默认。因此跳转**必须由保存事务自动完成**，不得设计成「按 Tab 跳到公式后」。

**② 撤销/重做**：
- 现状 onSave = **1 个事务**（`EditorArea.tsx:792-808`）→ 一次编辑 = 一个 undo 步。
- `prosemirror-history`：`frontend/node_modules/prosemirror-history/dist/index.js:264-266`
  ```js
  let appended = tr.getMeta("appendedTransaction");
  if (tr.steps.length == 0) { return history; }      // ← 0-step（纯选区）事务不进历史
  ```
  探针验证：先编辑再发一个独立 `setTextSelection`（0-step），`undo()` 仍回退到**编辑前内容**（`前文 $x$ 后文`）。
- 建议：把选区（和块级插入的空段落）并入**同一个 tr** → 一次 Ctrl+Z 内容与空行一起回退。

**③ 既有测试对公式的断言**（本项不得改动这些口径）：
- `markdown-roundtrip.test.ts:64-90`：行内解析 `math` + `getMarkdown()` 含 `$E=mc^2$`；块级解析 `mathBlock` + 含 `$$\nE = mc^2\n$$`（`:458` 另有类型断言）。
- `fidelity-regression.test.ts:249`、`:538`：表格单元格内行内公式往返保留 `$E=mc^2$`。
- 两者都**只断言解析/往返文本**，不涉及选区/光标 → 本项不会破坏它们；反之，本项必须保证不改变序列化。
- 现有测试**零覆盖**公式模态与保存后选区（全仓 `MathEditorModal` 相关测试只出现在 `state/docSwitch.verify.test.ts:72` 的 mock 里）→ §5 的用例全是新增。

### 1.5 与既有设计决策的关系（⚠️ 规范先行）

`docs/design-v1.1.7-math-editor.md:92`（主理人已拍板）写着：

> | 复用 | MathNodeView 现有编辑态 UI 迁移为模态；**保存后光标回到文档原型位置** |

→ **本项「行内移到公式后、块级移到新行行首」推翻了 v1.1.7 的这一条决策**（且实现在 v1.1.7 就未兑现：探针显示现状既不回原位、也不在公式后，而是坍缩到公式前/保持 NodeSelection）。按项目规矩「规范先行」，**动手前必须先更新设计文档**（修订 v1.1.7 §3.2 该行，或在 v1.1.10 设计文档里显式覆盖并注明替代关系）。

---

## 2. 实现位置候选（3 档，含坑 1 核对）

**坑 1 原文**（`docs/agent-handover-v1.1.8.md:174-175`）：
> **React #300（白屏）**：tiptap nodeview = 独立 React 根；在其中（或其后代 portal）触发 PM 事务 → update-during-render 崩溃。**规则**：需要改文档的 UI（模态/面板）放 EditorArea 层。

历史背景：`docs/design-v1.1.7-math-editor.md:179` 记录了模态**从 MathNodeView 上移到 EditorArea** 正是为了修 #300；现在 `MathEditorModal` 由 `EditorArea.tsx:784-836` 渲染（portal 到 `document.body`，但 **React 树上属于 EditorArea**），且事务经 double-rAF 延后（`MathEditorModal.tsx:86-96`）。

| 档 | 做法 | 改动面 | #300 风险 | 可测性 | 结论 |
|---|---|---|---|---|---|
| **① 模态关闭回调内直接 `setTextSelection`** | 在 `MathEditorModal.close()` 里调编辑器 | 模态需新增 `editor`/回调 prop | ⚠️ **高**：`onClose()`（卸载模态）与 PM 事务同 tick，正是 v1.1.7 踩过的 update-during-render 形态；且模态拿不到 `editor` | 差（需渲染模态 + 真编辑器） | ❌ 否 |
| **② 节点 `addKeyboardShortcuts` / NodeView 内处理** | `MathBlockExtension.addKeyboardShortcuts({ Escape: ... })` | 扩展层 | ⚠️ **高**：MathNodeView 是独立 React 根（`MathExtension.ts:64`/`MathBlockExtension.ts:55`）；且 Esc 被模态 textarea 先 `preventDefault` 吃掉（`MathEditorModal.tsx:183-187`），保存又是 double-rAF 异步的，keymap **根本不知道事务何时发生** | 差 | ❌ 否 |
| **③ 抽纯函数 + 在 EditorArea 的保存事务里执行（推荐）** | 新增 `editor/math/cursor.ts`（纯规划函数）；`EditorArea.onSave/onDeleteEmpty` 的**同一个 `tr`** 内：`setNodeMarkup` →（块级）插空段落 → `setSelection` → 事务外 `chain().focus()` | 2 文件（新纯函数 + EditorArea 两处回调 ≤40 行） | ✅ **无**：在既有安全层（根组件、post-unmount、任务队列外）；纯函数不含 PM 事务 | ✅ 纯函数单测 + `new Editor(...)` 集成测试（探针已验证可行） | ✅ |

**推荐 ③ 的硬理由**：
1. 事务必须发生在**已卸载模态之后**（`close()` 先 `onClose()` 再 double-rAF；`EditorArea.tsx:785-836`）——该时序已由现有实现保障；
2. 只有 EditorArea 同时拿到「按 id 定位后的 target」（`:793-803`）与 `editorRef`；
3. 把「算 pos」抽成纯函数后，边界（列表/引用/表格/文末）可用无 DOM 的 headless Editor 穷举（探针已证明可行），不必渲染 UI。

**注**：`MathNodeView.tsx:84-87` 的删除按钮直接 `deleteNode()` 是**用户事件路径**（非 render 期），不在本项范围内，也**不要**往它上面加保存后的光标逻辑。

---

## 3. 实现草案（伪代码级）

### 3.1 新增纯函数（建议 `frontend/src/editor/math/cursor.ts`）

```ts
import type { Node as PMNode } from '@tiptap/pm/model'

export interface MathCursorPlan {
  /** ≥0：在该 pos 插入一个空 paragraph；-1：不插 */
  insertParagraphAt: number
  /** 事务结束后的 caret 位置 */
  selectionPos: number
}

/**
 * 公式保存后的光标规划（纯函数，可在 headless Editor 上穷举测试）。
 * 约定：pos = 公式节点起始位置（调用方已按 id 定位）；doc = tr.doc（setNodeMarkup 之后调用）
 */
export function planMathCursorAfterSave(doc: PMNode, pos: number, isBlock: boolean): MathCursorPlan {
  const node = doc.nodeAt(pos)
  if (!node) return { insertParagraphAt: -1, selectionPos: Math.min(pos, doc.content.size) }

  const after = pos + node.nodeSize
  // 行内：光标移到公式后一位（段末=段落 end，仍在 textblock 内，合法）
  if (!isBlock) return { insertParagraphAt: -1, selectionPos: after }

  // 块级：新起一行
  const next = after <= doc.content.size ? doc.nodeAt(after) : null
  if (next && next.type.name === 'paragraph' && next.content.size === 0) {
    return { insertParagraphAt: -1, selectionPos: after + 1 }   // 复用已有空行（幂等，防连按多次多插）
  }
  // 边界：仅当父节点允许插 paragraph 才插（doc=block+ / blockquote=block+ / listItem=paragraph block* / tableCell=block+，实测均可）
  const $after = doc.resolve(after)
  const para = doc.type.schema.nodes.paragraph.create()
  if (!$after.parent.canReplace($after.indexAfter(), $after.indexAfter(), para)) {
    return { insertParagraphAt: -1, selectionPos: after }        // 兜底：只把 caret 放到公式后
  }
  return { insertParagraphAt: after, selectionPos: after + 1 }   // 新起一行，caret 在行首
}
```

### 3.2 EditorArea 接线（`EditorArea.tsx:789-833` 两处回调）

```tsx
onSave={(v) => {
  const ed = editorRef.current
  if (ed && mathEdit && ed.isEditable) {                 // ← 只读闸门（见 §3.3 边界 9）
    ed.chain()
      .command(({ tr }) => {
        const target = locateMathById(tr.doc, mathEdit.id, mathEdit.pos)   // 复用现有 :793-803 逻辑
        if (target < 0) return false
        const node = tr.doc.nodeAt(target)
        if (!node) return false
        tr.setNodeMarkup(target, undefined, { ...node.attrs, latex: v })
        const plan = planMathCursorAfterSave(tr.doc, target, mathEdit.isBlock)   // ★ 唯一新增
        if (plan.insertParagraphAt >= 0) tr.insert(plan.insertParagraphAt, tr.doc.type.schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.near(tr.doc.resolve(plan.selectionPos), 1)) // near 防 RangeError
        return true
      })
      .focus()                                            // ★ 归还焦点（模态已卸载）
      .run()
  }
  setMathEdit(null)
}}

onDeleteEmpty={() => {
  /* 同构：tr.delete(target, target + node.nodeSize)
     然后 tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target, tr.doc.content.size)), 1))
     —— 删除后 caret 停在原位置（块级在文末时会自动落进 trailingNode 补的空段落） */
}}
```

**pos 计算表**（`nodeSize` = 1，atom 叶节点）：

| 场景 | caret 位置 |
|---|---|
| 行内 | `target + node.nodeSize`（= 公式后一位） |
| 块级 · 后继空段落 | `after + 1`（复用，`after = target + node.nodeSize`） |
| 块级 · 其他 | 先 `tr.insert(after, paragraph)`，再 `after + 1`（新段行首） |

**为什么必须显式插段落**：不能只 `setTextSelection(after + 1)` —— 文档末尾无后继块时 `after = doc.content.size`，`after + 1` 越界会抛 `RangeError`（PM 事务异常 = 白屏风险）；也不能依赖 trailingNode 在事务**后**补的段落（事务内选区设不进去）。

### 3.3 边界语义（实测/代码判定）

| # | 边界 | 结论 |
|---|---|---|
| 1 | 行内 · 段落末尾 / 块首 | caret = `target+1`；段末是合法 TextSelection（实测 `前文$x$` → `from=4`）；块首即公式前若有文字，光标落公式与原文字之间（产品问题 ②） |
| 2 | 行内 · 段中 | caret 紧跟公式，后续文字被推到右侧（同 ②） |
| 3 | 块级 · 文档末尾 | 常见路径：保存事务触发 trailingNode 自动补空段落（实测 children=`mathBlock,paragraph`）；我们仍按 §3.1 插入兜底——若插入成功，末尾已是 paragraph，trailingNode **不会**重复补 |
| 4 | 块级 · 后继空段落 | **复用**（实测：两次连续保存 children 稳定 `mathBlock,paragraph`、caret 恒为 2，不累积空行） |
| 5 | 块级 · 后继有内容段落 | 插入一个空段落（实测 JSON 变为 `mathBlock,paragraph(空),paragraph(后续文字)`）→ **会多一个空行**，见产品问题 ① |
| 6 | 块级 · 列表项内 | 段落插在 **listItem 内部**（`canReplace=true` 实测），不会分裂成两个列表项；caret 在新段行首 |
| 7 | 块级 · 引用块内 | 同样插在 blockquote 内部（实测 JSON：`blockquote[paragraph, mathBlock, paragraph]`）|
| 8 | 块级 · 表格单元格 | schema 上 `block+` 允许插段落，但本仓 `TableMarkdownExtension.ts:23-24` 的序列化按「cell.content = [paragraph]」展开 → 单元格内块级公式本就不在支持面内；`canReplace` 兜底即可，不额外处理 |
| 9 | 只读 / 预览态 | ⚠️ **必须显式 `ed.isEditable` 闸门**：实测 `isEditable=false` 时命令**仍会改文档**（latex 被改成 `x+9`）。EditorArea 的只读态由 `:454-458` 同步；无 article 时 `EditorArea.tsx:839+` 不渲染 EditorContent，正常不可达，但闸门必须有 |
| 10 | 连续两次编辑同一公式 | 幂等（实测：children 与 caret 两次完全一致，不叠加空段落） |
| 11 | 撤销 | 合并为 1 个 tr → 一次 Ctrl+Z 回退 latex **与**新增空段落；实测 0-step 选区事务本身不进历史 |
| 12 | Esc / 完成 / ✕ | 三条出口都走 `close(true)` → 同一 `onSave`，自动全覆盖；不存在「Esc 取消」分支 |
| 13 | Tab | 模态内被补全/槽位占用（`MathEditorModal.tsx:167-182`），**不作为跳转键**；关闭后回 PM 默认，不受影响 |

---

## 4. 需新增 vitest 用例清单

**A. 纯函数**（`frontend/src/editor/math/cursor.test.ts`，无需 DOM）：
1. 行内 → `{insertParagraphAt:-1, selectionPos:pos+1}`；
2. 块级 + 后继空段落 → 不插、`selectionPos=after+1`；
3. 块级 + 后继有内容段落 → `insertParagraphAt=after`；
4. 块级 + 后继为 null（文末）→ `insertParagraphAt=after`；
5. 块级 + 后继为 `mathBlock`（连续两个公式）→ 插段落；
6. `pos` 越界 / `nodeAt(pos)=null` → 不抛、返回安全位置。

**B. 集成（headless `new Editor(...)`，同 `markdown-roundtrip.test.ts:59-61` 脚手架）**（`frontend/src/editor/math/math-cursor.test.ts`）：
7. **行内 → caret 在公式后一位**：NodeSelection 打开 → 保存 → `selection.kind==='TextSelection' && from===pos+nodeSize`；
8. **块级 → 新起一行且 caret 在行首**：文档末尾 `$$x$$` → `getMarkdown()` 含 `$$\nx+1\n$$` 且 doc 末尾存在 paragraph、`from===after+1`；
9. **块级后接正文段落**：断言新空段落插在公式与正文之间（或按拍板结果改断言）；
10. **列表内块级公式**：caret 在 listItem 内部新段落行首（不分裂列表）；
11. **文档末尾 / 段末行内**：`前文$x$` → caret === 段落 end；
12. **撤销一次回到编辑前**：`undo()` 后 latex 复原、且（若插了段落）段落数回退、markdown 与编辑前逐字一致；
13. **只读态不生效**：`setEditable(false)` → 文档与选区都不变；
14. **撤销/序列化红线**：`getMarkdown()` 输出仍为 `$...$` / `$$\n...\n$$`，不含 `id`/不新增 `ke-*`。

（可选，若想覆盖模态三条出口：渲染 `MathEditorModal` + `vi.useFakeTimers` 驱动 double-rAF，断言 Esc/完成/✕ 都调用 `onSave`。属加分项，非阻断。）

---

## 5. 工作量估时

| 项 | 内容 | 估时 |
|---|---|---|
| 实现 | `cursor.ts` 纯函数（~60 行） + `EditorArea.tsx` 两处回调接线（~40 行）+ 设计文档先行修订 | **0.5 人天** |
| 测试 | A 组 6 例 + B 组 8 例（新增 2 个测试文件，不动既有断言）| **0.5 人天** |
| 独立验证 | 对抗式：列表/引用/表格/文末/连续编辑/只读/撤销/序列化红线 + 回归（tsc 0、vitest 只增不减） | **0.5 人天** |
| **合计** | 串行 1.5 人天（实现与验证可并行 → 约 1 天） | **≈1.5 人天** |

回归底线（**实测于 2026-09-18 HEAD `04c7f93`**）：`npx tsc -b --noEmit` exit 0；`npx vitest run` → **38 files / 548 passed + 1 skipped**（命令与输出见 §8）——实施后只增不减。

---

## 6. 红线检查

| 红线 | 判定 | 依据 |
|---|---|---|
| `ke-*` 格式 / 自定义标记 | ✅ 不触碰 | 不新增/修改节点、attrs、tokenizer；只动选区与一个空 `paragraph` |
| Markdown 序列化（`$...$` / `$$\n...\n$$`） | ✅ 不变（**实测**） | 探针保存前后 `getMarkdown()` 仅 latex 变化，形如 `前文 $x+1$ 后文`、`$$\nx+1\n$$`；attrs.id 不落盘 |
| 设置项三处同步（前端 `settings.ts` → Tauri IPC → `settings.rs`） | ✅ 无需新增字段 | 本项无设置项 |
| Rust / desktop / 后端 | ✅ 不触碰 | 纯前端编辑器行为 |
| 输入框非受控 / v1.1.6 光标复位教训 | ✅ 不触碰 | `MathEditorModal.tsx:264-284` 保持 `defaultValue` 非受控，只加保存后**文档**光标逻辑 |
| 规范先行 | ⚠️ **需先改设计文档** | v1.1.7 §3.2「保存后光标回到文档原型位置」被本项替代（§1.5） |
| 用户可见副作用 | ⚠️ 需主理人确认 | 块级公式后**可能新增一个空段落**（Markdown 多一个空行）；文末场景因 trailingNode 已有空段落，通常无额外副作用 |

---

## 7. 需主理人拍板的产品问题

1. **块级公式后已经有正文段落时**：插入一个空段落（保留原文不动，但 Markdown 多一个空行）还是把 caret 放到既有段落行首（不新增空行，但接着输入会插到原文前面）？—— 本分析默认前者（更符合「自动换行」直觉）。
2. **行内公式后紧跟文字时**：caret 落在公式与后续文字之间（后续文字被推右），是否符合预期？还是希望把后续文字保持原地、光标只在其前闪烁（两者在 PM 里是同一语义）。
3. **Esc 语义**：目前 Esc/完成/✕ **都是保存**，没有「取消编辑」。本次「Esc 退出」是否仍按保存处理？是否要借机提供一个真正的取消键（如 `Shift+Esc`）？
4. **删除空公式路径**：空内容 Esc/完成 → 删除节点；是否也要一并规范「删除后 caret 停在原位置」（建议要，否则会留一个悬空 NodeSelection）。
5. **是否所有出口都要跳转**：「完成/✕」按钮（鼠标点击）也一律跳到公式后，还是只有键盘 Esc？—— 本分析建议统一（三条出口本就是同一 `close(true)`）。

---

## 8. 附录：探针实测命令与原始输出

探针**不在仓库内**（守住 task-26「不得修改任何源码」），放在 `/tmp/ke-math-probe/`：

```
/tmp/ke-math-probe/vitest.config.ts      # root 指向 frontend；environment: happy-dom
/tmp/ke-math-probe/math-cursor-probe.test.ts   # 第一轮（现状 / 草案 / 边界）
/tmp/ke-math-probe/round2.test.ts              # 第二轮（插入路径 / 复用它 / 只读闸门）
```
执行：
```bash
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx vitest run --config /tmp/ke-math-probe/vitest.config.ts     # 10 tests（1 例断言「保持 NodeSelection」的预期被实测推翻，见下）
npx vitest run --config /tmp/ke-math-probe/vitest.config.ts /tmp/ke-math-probe/round2.test.ts   # 7 tests 全绿
```

关键原始输出（截取）：

```
# 回归基线（HEAD 04c7f93，2026-09-18）
npx tsc -b --noEmit                          → exit 0
npx vitest run                               → Test Files 38 passed (38); Tests 548 passed | 1 skipped (549)
[A] inline before= {"kind":"NodeSelection","from":4,"to":5,...} after= {"kind":"TextSelection","from":4,"to":4,"empty":true}
[A] markdown= "前文 $x+1$ 后文"
[A] block after= {"kind":"NodeSelection","from":0,"to":1,...} / children= mathBlock,paragraph
[B] inline after fix= {"kind":"TextSelection","from":5,"to":5,"empty":true} md= "前文 $x+1$ 后文"
[B] after undo latex= x md= "前文 $x$ 后文"
[B] doc-end children= mathBlock（直接 new Editor，appendTransaction 未跑 → 无尾段落）; 保存事务后 children= mathBlock,paragraph（trailingNode 补出）
[B] block fix sel= {"from":2,...} md= "$$\nx+1\n$$\n\n\n\n后续文字"
[C] in-list canInsertParagraphAfter= true / json listItem=[paragraph, mathBlock, paragraph]
[C] readonly isEditable= false latexAfter= x+9          ← 只读闸门必须显式写
[C] after undo md= "前文 $x$ 后文"（0-step 选区事务不进历史）
[R2] insertMathBlock → sel={"from":2} mathPos=0 children=mathBlock,paragraph
[R2] caret-elsewhere before={"from":8} after={"from":8}
[R2] para-end inline current → from=3（公式前）；草案 → from=4（公式后=段末）
[R2] reuse-empty-para children= mathBlock,paragraph,paragraph sel={"from":2}
[R2] readonly guarded run= false latex= x
```
> 第一轮那条「保持 NodeSelection」的断言**失败是有效发现**：它把「现状行内保存后坍缩到公式前」这个反直觉行为钉了出来——正是本项要修的对象（已在 §1.3 记录）。

探针依赖的脚手架与仓库既有测试一致（`markdown-roundtrip.test.ts:59-61` 的 `new Editor({ extensions: [...], content, contentType:'markdown' })`），扩展集为 `StarterKit(trailingNode 同 config) + MathExtension + MathBlockExtension + Markdown`；探针配置不写回仓库、`cacheDir` 也在 `/tmp`。
