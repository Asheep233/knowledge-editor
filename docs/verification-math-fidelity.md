# 独立验证报告：项② 公式光标 + F-1…F-5 保真修复（task-32）

> 验证员：**verifier-s2**（独立于开发者与 Lead；未修改任何被验证源码，只写验证产物）
> 任务：共享任务板 **task-32**（依赖 task-28 项② / task-31 保真修复）
> **冻结修订**：`cbac7dd`（`cbac7dda5451356ee57097edba6c5c5c230ad315`）
> 时刻：**跑前 `2026-09-18T09:15:15Z` / 跑后 `2026-09-18T09:23:17Z`（UTC）**
> 验证环境：WSL，`frontend/`（node ≥20、marked 17.0.6、tiptap 3.x）；未执行 `npm install`

## 0. 冻结文件校验（跑前 / 跑后各复算一次，全部一致）

| 文件 | sha256（Lead 冻结值 = 我两次复算值） |
|---|---|
| `editor/math/cursor.ts` | `2147c578b919b056576ca7fd0f897c5f5bbce9123540be07649dddef855b5f18` |
| `editor/math/cursor.test.ts` | `f72bfdc1a9878c9702360b1b1120d604b1d0728ac1e1bd6c00e5259012eec636` |
| `components/layout/EditorArea.tsx` | `f8f7480bf3a2efe94ab4bdbcf89a9d92716ccd20bd399a31d58a2645add0d5c3` |
| `editor/docTraits-wiring.test.ts` | `68b8667b1aad6665b673c469e628647daa75cdb708d9ae70a9c2281dae7b6d6a` |
| `editor/ke.ts` | `3e380ccbf1ae747a1d4eae34fab7a9cf018172d48b87f1daf41fd7be5ccd3df3` |
| `editor/tokenizers.ts` | `74948e76b0051d32f20162e92a4fabd0ed11e450212c5e14e9402cfa2246228e` |
| `editor/index.ts` | `b97841518034bc4e335c4c77f5381c61d2ca8b6ed27e49615b2be3a4b22a876a` |
| `editor/export-actions.ts` | `0f10f944905ba6cfc020ca40f8f24acfba775b705b8b9ee8ea1b4215860d50f5` |
| `editor/fidelity-constructs.test.ts` | `1ec3623d5216afa07c451c99d4188bf60a274d7d2379fae2a360c15ae6c86262` |

命令：`sha256sum <9 个文件>`（跑前 09:15 / 跑后 09:23 各一次）→ 9/9 两次均匹配。

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| **② 公式光标**（task-28） | ✅ **38/38 PASS**：三态裁决、**只读态零事务**（save+delete 两条路径）、一次撤销、序列化红线、列表/引用块不分裂、文末无 RangeError、连续编辑幂等、目标失效严格 0 事务 |
| **F-1…F-5**（task-31） | ✅ **68/68 PASS**（含 A 严格层、B 语义等价层、D 已声明偏差层、E 导出层）；`F-2 属性含 >` 新缺陷已修复并复验 |
| **导出侧 traits**（Lead 追加） | ✅ BOM+CRLF 源 → KE 单文件导出保留 BOM+CRLF；LF 源不得被改成 CRLF；文档包路径同样还原 traits。⚠️ 另实测：KE 导出**不携带源 frontmatter 中除 `ke_version` 外的键**（title/tags）→ 「diff=0」口径需修正（§6，**PRE-EXISTING**） |
| **回归底线** | ✅ `tsc -b --noEmit` **exit 0**；全量 vitest **48 files passed / 840 passed · 1 skipped · 24 todo (865)**（≥ 38 files / 548 passed + 1 skipped）；3 回归面 **89 passed**；pytest **630 passed · 2 skipped** |
| **新增缺陷发现** | 全程报出 **4 条**：F2-6 属性含 `>` 截断（**已修并复验**）、F1-5 混合列表松散 / F2-7 嵌套 HTML（**Lead 判定为已知偏差并写入规范 §2.6 D-1/D-2**）、KE 导出 frontmatter 丢键（**PRE-EXISTING，待裁决**） |
| **未验证** | EditorArea 组件级挂载、焦点归还的可观测行为、GUI 手工验收、cargo/desktop（§8 声明） |

## 2. 验证方法与局限（先声明手段，再给结论）

- **② 集成路径**：headless `new Editor({extensions, content, contentType:'markdown'})`；保存/删除按 **EditorArea 的生产调用序**复刻：`只读闸门 → locateMathById → isMathNode 预判 → chain().command(applyMath*).focus().run()`。事务计数用 `editor.on('transaction')`。
- **② 规划层**：直接单测 `planMathCursorAfterSave / locateMathById / applyMathSaveCursor / applyMathDeleteCursor`（纯函数）。
- **F 组**：生产同序扩展栈（含 F-1 的 `TaskList/TaskItem`）+ 生产口径 `stripFrontmatter → normalizeGfmFootnotes → setContent → getMarkdown`；文件级链 `captureDocTraits → … → withFrontmatter → applyDocTraits`。
- **判据分层**（避免把既有的语义等价规范化误判为 FAIL）：
  - **A 严格**：行尾换行不计差（项目既有口径）+ 表格前置空行归一 后逐字节，且幂等；
  - **B 语义等价**：`<br>`→硬换行、`<a>`→Markdown 链接、裸 `&`→`&amp;`、`[X]`→`[x]`（规范 §2.6 D-3）；
  - **C/D 已声明偏差**：D-1 混合列表松散、D-2 嵌套 HTML；（本文 §5.3 保留实测输出）
- **归因方法**：`git archive HEAD(adc733a)` 建树外干净副本 `/tmp/ke-v112-baseline`，同一份探针在两棵树各跑一次逐构造对比（pre/post），判定 FIXED / PRE-EXISTING / CHANGED。
- ⚠️ **局限（如实标注）**：仓库无 `@testing-library/react`，**未挂载渲染 EditorArea**。因此「只读闸门」「目标预判」采用 **源码级断言（两处回调中 `isEditable` 与 `isMathNode` 均出现在 `.chain()` 之前）+ 等价调用序的行为断言（事务计数 0）**，**不是**组件级运行时证明。焦点归还（`focus()`）在 happy-dom 下不可观测（实测 `ed.isFocused=false`、`view.hasFocus()=false`），只验证了「focus 后 selection 未被重置」。

## 3. 项② 结果（38 用例，实际命令 + 输出）

```
$ cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
$ npx vitest run src/editor/math/cursor.verify.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  38 passed (38)
```

关键实测：

| 组 | 用例 | 实测 |
|---|---|---|
| 三态 | A1/A2 行内（段中/段首/段末/标题内） | `plan={insertParagraphAt:-1, selectionPos:pos+nodeSize}`；落点 `TextSelection.from===pos+1` |
| | A3/A4 块级 + 既有段落（空/非空） | **复用不插**（裁决口径）：`insertParagraphAt=-1`、`selectionPos=after+1`、文档块数不变 |
| | A5 块级 + 非段落块 | 标题/代码块/另一公式三种后继均 `insertParagraphAt=after`（新起一行），后继内容不变 |
| | A6 真文末（`$$\nx\n$$` 且无尾段落） | `insertParagraphAt=1`；B3 集成中 caret 落新段落行首、无 RangeError |
| 容器 | A7/A8/B5/B6 | 段落插 listItem / blockquote **内部**（`$at.parent.type.name` 断言）；`bulletList`/`listItem`/`blockquote` 数量不变（不分裂） |
| 退化 | A9/A12/B7 表格单元格 | 不抛、文档合法、表格结构不变（cell 序列化支持面外，仅兜底） |
| | A10/A11/B17/B17b | pos 越界/负值/NaN → 不抛且 clamp；目标非公式 → `applyMath*===false` 且 **事务计数 0** |
| | A15 重复 id | 取文档序第一个（确定性） |
| 只读 | B10 save / B11 delete | `ed.isEditable=false` → **事务计数 0**、doc JSON 与 selection 不变（既有漏洞已堵） |
| | B12 源码级 | `onSave`/`onDeleteEmpty` 两处 `isEditable` 与 `isMathNode` 均在 `.chain()` 之前 |
| 撤销 | B13/B14/B14b | 一次保存 = **1 个事务**；`undo()` 后 **doc JSON 深度等于编辑前**（隔离 `trailingNode` 的扩展栈下，插入的段落与 latex 同一步回退） |
| 序列化 | B18/B19/B20 | `$x+1$` / `$$\ny+1\n$$` 形式不变、无 id 泄漏、无新增 `ke-*`；latex 含反斜杠可再解析；空 latex 不崩 |
| 幂等 | B8/B9/B22 | 连续两次编辑同一公式：块数/光标稳定、不累积空段落 |

> 说明：块级撤销的生产栈形状是 `[mathBlock, paragraph]`（`trailingNode` 在 undo 事务后补段落）—— 属插件既有行为（dev-trash-fe 亦独立确认），故「一次撤销回退插入段落的原子性」在**隔离 trailingNode** 的等价栈上断言。

## 4. F-1…F-5 结果（68 用例）

```
$ npx vitest run src/editor/fidelity-constructs.verify.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  68 passed (68)
```

### 4.1 逐构造 pre-fix → 冻结修订（同一探针，两棵树）

| 构造 | pre-fix（HEAD `adc733a`） | 冻结 `cbac7dd` | 判定 |
|---|---|---|---|
| `- [x] 完成` / `- [ ] 未完成` | `- 完成` / `- 未完成`（复选框丢失） | 原样保留 | **FIXED** |
| `<span style="color:red">红</span>` | `正文 红 结尾`（标签丢弃） | 原样保留 | **FIXED** |
| 自闭合 `<img … />` / 大写 `<SPAN>` / 未闭合 `<span>` | 标签或整段丢失 | 原样保留 | **FIXED** |
| `&copy;` / `&#169;` / `&#xA9;` / `&notanentity;` | `&amp;copy;` 等二次转义 | 原样保留 | **FIXED** |
| `&amp;` | 不二次转义（原本即正确） | 不二次转义 | 无回归 |
| BOM + frontmatter | `## ---\nke\_version: 1…`（frontmatter 泄漏）**且二次往返不稳定** | 正文不含 frontmatter 痕迹；BOM 保留且不重复；**幂等** | **FIXED** |
| CRLF 文档 | 输出 LF | traits 还原后 **CRLF** | **FIXED** |
| 属性含 `>`（`title="a>b"`） | 标签整体丢弃 | **一度改写为 `<span title="a>b"&gt;x</span>`（我报 FAIL）→ 引号感知修复后原样保留** | **FIXED（含新缺陷修复）** |
| `<br>` / `<a href>` | `甲  \n乙` / `[链接](http://x)` | 同（标准 Markdown 转换） | PRE-EXISTING（契约允许） |
| 裸 `&` | `&amp;` | 同 | PRE-EXISTING（D-3，语义等价） |
| `[X]` | `[x]`（状态保留） | 同 | PRE-EXISTING（D-3） |
| `- [x]完成` / `- [ ]`（空项） | `- \[x\]完成` / `- \[ \]`（字面转义） | 同 | PRE-EXISTING（内容不丢） |
| `**<span>x</span>**` | `**x**` | `<span>**x**</span>`（两者保留、标记次序换位） | 改善（非逐字节） |
| 混合任务/普通列表 | `- a\n- b\n- c`（全丢框） | `- [x] a\n\n- b\n\n- [ ] c`（**松散列表**） | **D-1 已声明偏差** |
| `<em><span>x</span></em>` | `前 *x* 后` | 同 | **D-2 已声明偏差（既有）** |
| ke-* 六类快照 | 一致 | 一致 | 无回归 ✅ |

### 4.2 F-4 / F-5 文件级契约实测（实际输出）

- **BOM**：`\ufeff---\r\nke_version: 1\r\n---\r\n\r\n正文\r\n` → `saveChain` 输出以 `\ufeff` 开头、`\ufeff` 计数 = 1、正文不含 `ke_version`/`## ---`、二次 `saveChain` 字节相同。
- **双 BOM** `\ufeff\ufeff# 标题…` → 归一为单个 `\ufeff`，且幂等。
- **无 BOM 文件** → 输出不得出现 `\ufeff`。
- **换行**：`captureDocTraits` 判定 `{bom,eol}` 与原文一致；`applyDocTraits(getMarkdown(), traits)` **逐字节等于原文正文**（LF / CRLF / CRLF+frontmatter / 围栏内 CRLF 全部）；混排（CRLF 多于 LF）→ CRLF；单个 CR → 按主导风格 LF 且内容不丢；**LF 文档输出不含 `\r`**（反向断言）。
- **组合**：BOM+CRLF+任务列表+实体 → traits 保留 + 幂等。

### 4.3 已声明偏差的实测留痕（规范 `docs/document-format.md` §2.6）

| # | 实测输出（我跑出） | 断言口径 |
|---|---|---|
| **D-1** | `- [x] a\n- b\n- [ ] c` → `- [x] a\n\n- b\n\n- [ ] c` | 断言「三条目文本与复选框状态不丢 + 二次往返稳定」，不要求逐字节（Lead 判定非 FAIL） |
| **D-2** | `前 <em><span>x</span></em> 后` → `前 *x* 后` | 断言「文字 `x`/`前`/`后` 不丢 + 幂等」，内层 `<span>` 丢失记为既有缺口 |
| **D-3** | `[X]→[x]`、裸 `&`→`&amp;`、`<br>`/`<a>` 标准转换 | 语义等价断言 |

## 5. 导出侧（Lead 追加要求）

```
$ npx vitest run src/editor/fidelity-constructs.verify.test.ts -t "F-6"
 → E1…E7 全 PASS
```

| 用例 | 实测 |
|---|---|
| E1 KE 单文件导出（BOM+CRLF 源） | `keExportPayload(ed, title, src)` 产物：`captureDocTraits === {bom:true,eol:'\r\n'}`、以 `\ufeff` 开头、无裸 LF、正文与 `ke_version` 在 |
| E2 LF/无 BOM 源 | 产物无 BOM、无 `\r` |
| E3 不传 sourceRaw | 默认 LF/无 BOM（内部产物口径） |
| E5 文档包路径（源码级） | `handleExportPackage` 内 `applyDocTraits(…, captureDocTraits(article.content))` 出现在 `packageExportAndSave` 之前；单文件导出为 `keExportPayload(editor, article.title, article.content)`；载入路径 `captureTraits(article.id, article.content)` |
| E6 文档包载荷（复刻生产表达式） | BOM+CRLF 保留；正文一致 |
| E7 普通 Markdown 导出 | 不套 traits（LF/无 BOM）——既定口径，外部可读派生文件 |

### 5.1 ⚠️ 「导出 vs 磁盘源文档 diff=0」的实测修正（**PRE-EXISTING**，请裁决）

E4 实测（同一源文档，导出后对比）：
```
E4-FM-SRC : "ke_version: 1\r\ntitle: 标题\r\ntags: [a]"
E4-FM-EXPT: "ke_version: 1"
```
→ **文件特征（BOM/CRLF）与正文一致**，但 **KE 导出只写入 `ke_version`，源 frontmatter 的 `title`/`tags` 被丢弃**；因此整文件 **diff ≠ 0**。
归因：**pre-fix 即如此** —— 基线副本（HEAD `adc733a`）实测 `keExportPayload(ed,'标题')` → `"---\nke_version: 1\n---\n\n正文"`（同样无 title/tags）。属既有导出实现（`withFrontmatter` 仅写版本键；`keExportPayload` 不接收 meta）。
影响：KE 格式导出件丢失文档元信息（标准 Markdown 导出路径 `plainExportPayload` 反而会写入 title/tags）。建议：要么让 KE 导出接收并写回源 frontmatter 其余键，要么把验收口径改为「正文 + 文件特征 diff=0」。

## 6. 回归底线（实际命令 + 输出）

```
$ npx tsc -b --noEmit                                        → exit 0
$ npx vitest run
 Test Files  48 passed (48)
      Tests  840 passed | 1 skipped | 24 todo (865)
$ npx vitest run src/editor/fidelity-regression.test.ts src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts
 Test Files  3 passed (3)     Tests  89 passed (89)
$ cd ../backend && python3 -m pytest
 630 passed, 2 skipped, 1 warning in 23.45s
```

- `1 skipped` 仍为 1（未增）；`24 todo` 为其它工作流的骨架，**我的两个套件已全部转为实测用例**（106）。
- 回归面含 `plain-export.test.ts` 的「marked（GFM）渲染导出的 .md」用例（1613ms）✅。
- **依赖卫生**：`frontend/package.json:18` 已显式声明 `"@tiptap/extension-list": "^3.29.2"`（此前仅靠 starter-kit 传递提升），已核实 ✅。

> 过程留痕（诚实记录）：我落盘实测版后，`tsc` 曾报 **2 个错误来自我自己的 `cursor.verify.test.ts`**（tiptap v3 `getJSON()` 返回类型不便直接索引）→ 我加了 `jsonOf()` 转换后 **tsc 归 0**；该 2 个错误不属被验证源码。

## 7. 未验证项声明（严禁把推测当结论）

| 项 | 原因 |
|---|---|
| **EditorArea 组件级挂载验证**（只读闸门 / 目标预判 / traits 接线的真实运行） | 仓库未安装 `@testing-library/react`，无法渲染组件；改用「源码级断言 + 等价调用序行为断言」，**不构成组件级运行时证明** |
| **焦点归还**（`.focus()` 后编辑器是否 `isFocused`） | happy-dom 下实测 `isFocused=false`、`view.hasFocus()=false`，该环境不可观测；仅验证 selection 未被重置 |
| GUI 手工验收（粘贴/双击公式 → 保存 → 光标落点观感） | 无 GUI 会话 |
| cargo / desktop 侧（`desktop/src-tauri/src/settings.rs` 有他人改动） | 非本任务范围，未复跑 cargo |
| 真实浏览器/印刷级渲染差异（松散列表渲染间距、`<br>` 硬换行视觉） | 未做浏览器截图对照 |

## 8. 结论与建议

1. **项② 通过**：三态裁决（行内落公式后一位；块级落既有段落行首，无则新起一行）全部符合；**只读态 0 事务**（save/delete 双路径）；撤销一次回退内容+插入段落；序列化红线不破；容器不分裂；文末无 RangeError；目标失效严格 0 事务。
2. **F-1…F-5 通过**：五类不可逆损坏全部修复（复选框、行内 HTML、实体、BOM+frontmatter、换行风格），且 `F-2 属性含 >` 新缺陷已修复复验；ke-* 快照与回归面无变化。
3. **D-1/D-2/D-3** 已入规范 §2.6，本文保留实测输出与断言口径；建议在后续版本按需再攻（逐字节目标）。
4. **待裁决一项**：KE 导出丢弃 `title`/`tags`（PRE-EXISTING）与「diff=0」验收口径冲突（§5.1）。
5. 复跑范围（若再改 S-2/项② 相关文件）：本文两个套件 106 用例 + 3 回归面 + `tsc`。

## 附录 A：106 用例逐条状态（命令与完整输出）

复现：`cd frontend && npx vitest run src/editor/math/cursor.verify.test.ts src/editor/fidelity-constructs.verify.test.ts --reporter=verbose`
（输出文件 `/tmp/s2-probe/final-suites.txt`；下列为逐条结果，全部 PASS）

```
 ✓ math/cursor.verify.test.ts > A 规划层 > A1 行内（段中）→ 不插、selectionPos=pos+nodeSize
 ✓ math/cursor.verify.test.ts > A 规划层 > A2 行内（段末/段首/标题内）→ selectionPos=pos+nodeSize 且不越界
 ✓ math/cursor.verify.test.ts > A 规划层 > A3 块级 + 后继空段落 → 复用（不插）、selectionPos=after+1
 ✓ math/cursor.verify.test.ts > A 规划层 > A4 块级 + 后继非空段落 → 裁决：复用段落行首（不插空行）
 ✓ math/cursor.verify.test.ts > A 规划层 > A5 块级 + 后继非段落块（标题/代码块/另一公式）→ 新起一行
 ✓ math/cursor.verify.test.ts > A 规划层 > A6 块级在文档末尾（无尾段落）→ 新起一行且不越界
 ✓ math/cursor.verify.test.ts > A 规划层 > A7 listItem 内末尾块级 → 段落插 listItem 内部（不分裂列表项）
 ✓ math/cursor.verify.test.ts > A 规划层 > A8 blockquote 内末尾块级 → 段落插 blockquote 内部
 ✓ math/cursor.verify.test.ts > A 规划层 > A9 表格单元格内块级公式 → 不抛错、文档仍合法
 ✓ math/cursor.verify.test.ts > A 规划层 > A10 pos 越界 / 负值 / NaN → 不抛、安全位置
 ✓ math/cursor.verify.test.ts > A 规划层 > A11 nodeAt(pos) 指向非 math 节点 → applyMath* 返回 false
 ✓ math/cursor.verify.test.ts > A 规划层 > A12 isBlock 与节点真实类型不一致 → 不抛、文档合法
 ✓ math/cursor.verify.test.ts > A 规划层 > A13/A14 locateMathById：id 优先、回退 pos、无效 -1
 ✓ math/cursor.verify.test.ts > A 规划层 > A15 重复 id → 取文档序第一个（确定性）
 ✓ math/cursor.verify.test.ts > B 集成 > B1 行内保存：TextSelection.from===pos+nodeSize
 ✓ math/cursor.verify.test.ts > B 集成 > B2 块级 + 既有段落：caret 落段落行首且块数不变
 ✓ math/cursor.verify.test.ts > B 集成 > B3 块级 + 真文末（无尾段落）：新起一行、caret 行首、不抛 RangeError
 ✓ math/cursor.verify.test.ts > B 集成 > B4 块级后接非段落块：caret 在新段落行首，后继块不变
 ✓ math/cursor.verify.test.ts > B 集成 > B5 列表项内块级：列表项数不变、结构不分裂
 ✓ math/cursor.verify.test.ts > B 集成 > B6 引用块内块级：blockquote 结构不变
 ✓ math/cursor.verify.test.ts > B 集成 > B7 表格单元格内块级：不崩、表格结构不变
 ✓ math/cursor.verify.test.ts > B 集成 > B8 连续两次编辑同一块级公式 → 不累积空段落、caret 稳定
 ✓ math/cursor.verify.test.ts > B 集成 > B9 连续两次编辑同一行内公式 → caret 恒为公式后一位
 ✓ math/cursor.verify.test.ts > B 集成 > B10 只读态 save 路径：零事务，doc/selection 不变
 ✓ math/cursor.verify.test.ts > B 集成 > B11 只读态 delete 路径：零事务
 ✓ math/cursor.verify.test.ts > B 集成 > B12 源码级：只读闸门 + 目标预判都在 chain 之前（两处回调）
 ✓ math/cursor.verify.test.ts > B 集成 > B13 一次保存 = 恰好 1 个事务
 ✓ math/cursor.verify.test.ts > B 集成 > B14 撤销一次 → doc JSON 深度等于编辑前（行内）
 ✓ math/cursor.verify.test.ts > B 集成 > B14b 块级撤销（隔离 trailingNode）：新增段落与 latex 一起回退
 ✓ math/cursor.verify.test.ts > B 集成 > B15 删除空公式：caret 安全、无 NodeSelection 残留
 ✓ math/cursor.verify.test.ts > B 集成 > B16 删除文档唯一块（块级公式独占文档）→ doc 仍合法
 ✓ math/cursor.verify.test.ts > B 集成 > B17 目标失效 → 严格 0 事务（生产预判已落地）、doc 不变
 ✓ math/cursor.verify.test.ts > B 集成 > B17b 目标失效（delete 路径）→ 严格 0 事务
 ✓ math/cursor.verify.test.ts > B 集成 > B18 序列化红线：$x$ / $$\nx\n$$ 形式不变、无 id 泄漏、无新增 ke-*
 ✓ math/cursor.verify.test.ts > B 集成 > B19 latex 含反斜杠时序列化仍可再解析
 ✓ math/cursor.verify.test.ts > B 集成 > B20 空 latex 保存：不崩、markdown 可再解析
 ✓ math/cursor.verify.test.ts > B 集成 > B21 focus 归还后 selection 不被重置到文首
 ✓ math/cursor.verify.test.ts > B 集成 > B22 文末块级连续保存两次：不重复补段落
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-1 [x]：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-2 [ ]：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-4 嵌套：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-6 引用块内：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-7 含强调与代码：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-3 大写 [X]：勾选状态保留（大小写可规范化，语义不得翻转）
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > 既有：`- [x]完成`（GFM 非任务项）与空任务项 `- [ ]` 被转义为字面（pre/post 一致，内容不丢）
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > D-1（规范 §2.6）混合任务/普通列表：状态与文本不丢 + 幂等（方差：变松散列表，记录在案）
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1-10 任务列表 + 段落 + 表格混排：内容不丢 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-1 任务列表（A 层） > F1 反替代：状态不得被翻转
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-1 span+style：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-4 自闭合 img：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-5 大写标签：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-8 未闭合标签：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-11a 行内代码内字面：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-11b 围栏内字面：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-3b 属性含实体（不误伤）：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > C 层·F2-6 属性值含 `>` 不得被改写为非法标签（已知剩余偏差·本次新报）
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > D-2（规范 §2.6）嵌套 HTML：内层未知标签丢失属既有缺口（断言内容不丢 + 幂等）
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-9 行内 HTML 与强调混排：两者都保留
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-12 标签不得被转义成实体
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-2 `<br>` → 硬换行（既有规范化）：语义等价（既有规范化，非逐字节）
 ✓ fidelity-constructs.verify.test.ts > F-2 行内 HTML > F2-3 `<a href>` → Markdown 链接（既有规范化）：语义等价（既有规范化，非逐字节）
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-1 &copy;：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-2a 十进制实体：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-2b 十六进制实体：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-4 &amp; 不二次转义：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-5 未知实体：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-6a 行内代码内字面：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-6b 围栏内字面：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-7a 标题内实体：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-7b 表格单元格内实体：逐字节（表格前置空行归一）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-8 多实体混排：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-10 实体 + 行内 HTML 混排：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-反替代：&copy; 不得被解码为 ©：逐字节（行尾不计差）+ 幂等
 ✓ fidelity-constructs.verify.test.ts > F-3 HTML 实体 > F3-3 裸 `&` → `&amp;`（既有规范化，HTML 语义正确）：语义等价（既有规范化，非逐字节）
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-1 BOM+frontmatter(LF)：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-2 BOM+frontmatter(CRLF)：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-4 BOM+正文：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-6 BOM+CRLF 正文：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-9a BOM+任务列表：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-9b BOM+实体：frontmatter 不泄漏 + BOM 保留且不重复 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-3 BOM+frontmatter：二次往返稳定（pre-fix 非幂等）
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-7 双 BOM → 归一为单个
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-5 只有 BOM：不崩、输出确定
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-10 无 BOM 文件不得凭空出现 BOM
 ✓ fidelity-constructs.verify.test.ts > F-4 BOM > F4-8 文件中部（非行首）的 BOM 不得被吞
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-1 全 CRLF：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-2 CRLF+frontmatter：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-3a LF 文档：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-3b LF+frontmatter：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-4 混排（CRLF 多）：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-6 无尾换行 LF：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-7 围栏内 CRLF：风格判定 + traits 还原后逐字节 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-5 单个 CR：按主导风格 LF 处理（不要求逐字符保真）+ 内容不丢 + 幂等
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5 反向：LF 文档不得被改成 CRLF
 ✓ fidelity-constructs.verify.test.ts > F-5 换行（按文档保留原风格） > F5-9 组合：BOM + CRLF + 任务列表 + 实体
 ✓ fidelity-constructs.verify.test.ts > 交叉验证 > X1 ke-* 序列化快照逐字节不变
 ✓ fidelity-constructs.verify.test.ts > 交叉验证 > X2 防漂移：生产 index.ts 仍注册 TaskList/TaskItem，且顺序合理
 ✓ fidelity-constructs.verify.test.ts > 交叉验证 > X3 组合矩阵：BOM+CRLF+任务列表+实体+行内 HTML
 ✓ fidelity-constructs.verify.test.ts > 交叉验证 > X4 回归对照：正文/标题/列表/表格/公式样本
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E1 KE 导出：BOM + CRLF 源 → 导出保留 BOM 与 CRLF
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E2 KE 导出：LF/无 BOM 源 → 导出不得凭空出现 BOM/CRLF
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E3 KE 导出（未传 sourceRaw）→ 默认 LF/无 BOM（内部产物口径）
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E4 「diff=0」测量：正文与文件特征一致；frontmatter 仅 ke_version（如实记录差异）
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E5 文档包路径：EditorArea 在 packageExportAndSave 前按 article.content 还原 traits（源码级）
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E6 文档包载荷（复刻生产表达式）：BOM+CRLF 源 → 传给后端的 md 保留 traits
 ✓ fidelity-constructs.verify.test.ts > F-6 导出侧（KE 单文件 / 文档包） > E7 普通 Markdown 导出：不套 traits（既定口径：外部可读的派生文件）→ LF/无 BOM
```

---

# 增量复验（task-36）：KE 导出保留源 frontmatter 键

> 本节为**追加**，不改变上文 §0–§8 的任何结论（§5.1 报出的 PRE-EXISTING 缺口即本节复验对象）。
> 验证员：verifier-s2 · 时刻：**`2026-09-18T09:34:10Z`（sha 复算）** · **HEAD / 冻结：`4d605e8`**

## 附9.1 复验对象与 sha256（我复算值；与 task-32 冻结值对比）

| 文件 | sha256（我实测） | 与 task-32 冻结值 |
|---|---|---|
| `editor/ke.ts` | `38835e1b807db3c74f73803779f5d9242407f64f7eea6ac254dd01bdf6e6213d` | **已变化**（`3e380ccb…` → `38835e1b…`，新增 `frontmatterBlockOf`） |
| `editor/export-actions.ts` | `168a3353b678a60794f5bbdcd05814e081ba8483c025f219f4569a196d26396f` | **已变化**（`0f10f944…` → `168a3353…`，`keExportPayload` 拼回源 frontmatter 区块） |
| `editor/fidelity-constructs.test.ts`（Lead 回归） | `0d7342d8c4b6cc930e33f3b72c1c511d06c9675c7ded6daa04a492c7532dc43b` | **已变化**（`1ec3623d…` → `0d7342d8…`，+2 例） |

判据（Lead 口径，已采纳）：**正文与既有键逐字节一致 + `ke_version` 更新为当前值 = PASS**；顺序/尾换行差异单列。

## 附9.2 单文件路径 `keExportPayload(editor, title, sourceRaw)` —— **PASS**

```
$ npx vitest run src/editor/fidelity-constructs.verify.test.ts
（F 组 79 例：77 passed / 2 failed —— 2 failed 即附9.3 的 K10/K11，与单文件路径无关）
```

| # | 用例 | 实测（实际输出） | 判定 |
|---|---|---|---|
| K1 | `title`/`tags`/自定义键 + **过期 `ke_version: 0`** | frontmatter 保留 `title: 我的标题`、`tags: [alpha, beta]`、`custom_key: keep-me`；`ke_version: 1`（旧值消失）；正文逐字节一致 | **PASS** |
| K2 | 未知键 + YAML 注释 + 嵌套映射 + 多行数组 + 带冒号字符串 | `K2-FM-SRC` = `"title: 标题\n# 这是注释\nnested:\n  a: 1\n  b: two\nlist:\n  - x\n  - y\nweird-key_2: \"val:with:colon\"\nke_version: 1"`；`K2-FM-OUT` **与之完全相同**（`expect(out).toBe(src)` 通过） | **PASS（逐字节）** |
| K3 | 键顺序 `title, ke_version, tags` | 导出后键序仍为 `['title','ke_version','tags']` | **PASS** |
| K4 | 源无 `ke_version` | 实测 frontmatter = `"ke_version: 1\ntitle: T\ntags: [a]"` → 作为**首键**插入（顺序变化，如实记录；符合口径） | **PASS** |
| K5 | 源无 frontmatter | 导出 frontmatter 恰为 `ke_version: 1`，未引入任何多余键 | **PASS** |
| K6 | BOM + CRLF + frontmatter | 产物以 `\ufeff` 开头、无裸 LF、`title`/`tags` 保留、`ke_version: 1`、正文一致 | **PASS** |
| K7 | 整文件严格 diff | `K7-STRICT-DIFF identical=false`；逐行差异**仅两处**：`LINE 1: src="ke_version: 0" out="ke_version: 1"`、`LINE 7: src="" out=undefined`（源尾多一个换行，属既有「行尾不计差」口径） | **PASS**（按口径） |
| K9 | frontmatter 后多余空行 | `K9-OUT: "---\nke_version: 1\ntitle: T\n---\n\n正文"` → 多空行被规整为单空行（既有规则，已记录） | **PASS** |
| K8 | **空 frontmatter 区块** `---\n---\n\n正文` | `stripFrontmatter(src).content` = `"---\n---\n\n正文"`（**整块被当正文**）；导出产物仍正常（含 `ke_version: 1` + `正文`，traits 保留） | **documented-edge（PRE-EXISTING）** |

**K8 最小复现与影响**（不计 task-36 FAIL，Lead 已确认）：正则 `/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/` 在「首行即闭合」的空块上匹配失败（`[\s\S]*?` 之后仍需一个 `\n---`）；我在 task-32 的基线副本（HEAD `adc733a`）用同一正则复现 → 既有行为。影响：载入后 `---`/`---` 两行会成为正文内容（用户可见两条分割线）；**导出侧不受影响**（产物为规范的 `---\nke_version: 1\n---\n\n正文`）。

## 附9.3 文档包（.zip）路径 —— **FAIL（已上报，修法中）**

| # | 用例 | 实测 | 判定 |
|---|---|---|---|
| K10 | 复刻 `EditorArea.handleExportPackage` 的生产表达式 | 源 `---\nke_version: 0\ntitle: 我的标题\ntags: [alpha]\ncustom: x\n---\n\n正文段落\n` → `K10-ZIP-FM: "ke_version: 1"`（**title/tags/custom 全部丢失**） | **FAIL** |
| K11 | 源码级：文档包接线须使用源 frontmatter 区块 | `K11-PKG-BLOCK` = `"const md = applyDocTraits(\n  withFrontmatter(editor.getMarkdown(), KE_VERSION),\n  captureDocTraits(article.content),\n)\nawait packageExportAndSave(article.title, md)"` → **未使用 `frontmatterBlockOf`**；`grep -rn frontmatterBlockOf src` 仅命中 `export-actions.ts:28`（单文件路径）与 `ke.ts:44`（定义） | **FAIL** |

最小复现命令：`npx vitest run src/editor/fidelity-constructs.verify.test.ts -t "K10|K11"`。
归因：**本次修复（`4d605e8`）漏接 zip 路径**（非 PRE-EXISTING 之外的新问题——zip 路径此前同样丢键，属「已报缺口的未修完部分」）。
已上报 Lead（附最小复现 + 源码证据）；Lead 已派 task-35（dev-attach-ui，同文件同冻结）修复，并倾向把 `sourceRaw` 传入 `packageExportAndSave` 在库内统一实现以防再次漂移。**待新 sha 复跑 K10/K11。**

## 附9.4 回归状态（`4d605e8`，含本次新增 13 例）

```
$ npx tsc -b --noEmit                                        → exit 0
$ npx vitest run src/editor/fidelity-regression.test.ts \
    src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts
 Test Files  3 passed (3)      Tests  89 passed (89)
$ npx vitest run src/editor/math/cursor.verify.test.ts
      Tests  38 passed (38)                       ← task-32 ② 套件无回归
$ npx vitest run src/editor/fidelity-constructs.verify.test.ts
      Tests  77 passed | 2 failed (79)            ← 2 failed = K10/K11（已上报）
$ npx vitest run
 Test Files  2 failed | 46 passed (48)
      Tests  890 passed | 2 failed | 1 skipped (893)
```

- ② 套件 38/38 无回归；F 套件在 task-32 的 68 例之外新增 11 例（K1–K11），其中 9 例 PASS。
- 全量唯一失败即 K10/K11；`1 skipped` 仍为 1。

## 附9.5 未验证项（本节）

| 项 | 原因 |
|---|---|
| **zip 打包的后端产物**（真实 `.zip` 内正文文件的字节） | 未调用后端 `exportPackage`；本轮只验证「传给后端的 `md` 载荷」与源码接线。后端是否另有 frontmatter 合并逻辑未测 → 建议在 task-35 修复后由我或 verifier-attach 复跑后端打包路径 |
| 导出 UI 端到端（点击菜单 → 保存对话框） | 无 GUI 会话 |
| `withFrontmatter` 对非法 YAML（重复键、非字符串键）的行为 | 未构造；K2 覆盖了注释/嵌套/多行数组/特殊字符 |

## 附9.6 本节结论

1. **单文件 KE 导出（`keExportPayload`）：PASS** —— 源 frontmatter 其余键（title/tags/自定义/注释/嵌套/多行数组）**逐字节保留**，`ke_version` 正确更新，BOM/CRLF/正文同时保留；严格 diff 仅剩「ke_version 值 + 源尾换行」两处已知差异。
2. **文档包（.zip）路径：FAIL** —— 修未完（K10/K11），已上报并派 task-35；修复后需复跑。
3. 既有边界：空 frontmatter 区块不被 `stripFrontmatter` 识别（PRE-EXISTING，documented-edge）。
4. 待 Lead 发新 sha 后，我会复跑 K10/K11 + 全套件 + 三回归面，并在本节内追加复跑结果（不改动上述判定留痕）。

## 附9.7 复跑（task-35 zip 路径修复后）—— **K10/K11/K12 全 PASS**

> 时刻：**`2026-09-18T09:46:41Z`** · **HEAD：`5d126c3`**（`EditorArea.tsx` 的修复在工作树内，未提交）
> 变更 sha256（我复算）：
> `components/layout/EditorArea.tsx` = `8fa8cba677ca035e557b3fbbd64d6c7cc84f8b1f0cd1c279a563168b227a3ac5`（task-35 修复版；相对 task-32 冻结值 `f8f7480b…` 已变化）
> `editor/ke.ts` = `38835e1b…`（未再变化）· `editor/export-actions.ts` = `168a3353…`（未再变化）

生产接线（修复后，我读源码确认）：
```ts
const fmBlock = frontmatterBlockOf(article.content)
const md = applyDocTraits(
  withFrontmatter(fmBlock ? fmBlock + editor.getMarkdown() : editor.getMarkdown(), KE_VERSION),
  captureDocTraits(article.content),
)
await packageExportAndSave(article.title, md)
```

| # | 用例 | 实测 | 判定 |
|---|---|---|---|
| K10 | zip 路径键保留（生产表达式复刻） | `K10-ZIP-FM: "ke_version: 1\ntitle: 我的标题\ntags: [alpha]\ncustom: x"` → title/tags/custom 保留、`ke_version` 更新 | **PASS** |
| K11 | 源码级接线守卫 | `handleExportPackage` 区块含 `frontmatterBlockOf` 且位于 `packageExportAndSave` 之前 | **PASS** |
| K12 | **强断言**：zip 载荷逐字节 = 源文件（仅 `ke_version` 值与尾换行不同） | `norm(md) === norm(src)` 通过；BOM 保留、无裸 LF | **PASS** |

**本次新增「漂移哨兵」（防复刻过期假绿）**：K10 现在除了复刻表达式，还会读 `EditorArea.tsx` 并断言该区块依次包含
`frontmatterBlockOf(article.content)` → `fmBlock ? fmBlock + editor.getMarkdown() : editor.getMarkdown()` → `withFrontmatter(` → `KE_VERSION` → `captureDocTraits(article.content)` → `applyDocTraits(`；
任一环节缺失即报错并提示「本复刻过期，需重写 K10」——避免「生产改了、复刻没跟上」导致的假 PASS。（此改动由 dev-attach-ui 指出 K10 是复刻而非读源码后新增。）

### 附9.7.1 门禁复跑

```
$ npx tsc -b --noEmit                                                     → exit 0
$ npx vitest run src/editor/math/cursor.verify.test.ts \
    src/editor/fidelity-constructs.verify.test.ts
 Test Files  2 passed (2)      Tests  118 passed (118)        ← ② 38 + F 80，无回归
$ npx vitest run src/editor/fidelity-regression.test.ts \
    src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts
 Test Files  3 passed (3)      Tests  89 passed (89)
$ npx vitest run
 Test Files  48 passed (48)
      Tests  894 passed | 1 skipped (895)
```

> 瞬时不复现项（如实记录）：复跑前的一次全量运行出现 `1 failed | 893 passed`，未及捕获文件名；同一时段该工作树正被其它工作流修改（随后一次运行测试总数由 893 → 894），紧接的重跑 **0 failed**。按「瞬时/并发编辑」记录，**不判 FAIL**，也**不排除**是他人在飞改动的中间态。

### 附9.7.2 本节最终判定

| 项 | 判定 |
|---|---|
| 单文件 KE 导出 frontmatter 保留 | **PASS**（K1–K7/K9，含逐字节 frontmatter 一致性） |
| 文档包（zip）frontmatter 保留 | **PASS**（K10/K11/K12，含强断言与漂移哨兵） |
| 空 frontmatter 区块 | **documented-edge（PRE-EXISTING）**，非本任务 FAIL |
| 回归 | ② 38/38、F 80/80、三回归面 89 passed、tsc 0、全量 894 passed · 1 skipped · 0 failed |
| 未验证 | zip 的**后端产物**（真实解包内容）与导出 UI 端到端（同附9.5） |
