# S-2 独立验证报告（GFM 脚注 `[^1]` 等价解析）

> 验证员：**verifier-s2**（独立于开发者/Lead，只写验证产物，未修改任何被验证源码）
> 任务：共享任务板 **task-5**（依赖 task-4）· 日期：2026-09-14
> **最终冻结修订：`75273e5fb8844dfc517bf32900667e94c16687a4`**（"fix(1.1.8/S-2): 行首引用重建为 footnote 节点 + 图片 alt 掩码（verifier C26/C27/C28）"）
> 首轮冻结修订：`2f2eede7e4be6054aed8b76bff889a42b8a2b0ad`（本报告 §4 保留其 3 条 FAIL 与修复-复验全过程）
> 被验证源文件 md5（最终冻结时）：
>
> | 文件 | md5 |
> |---|---|
> | `frontend/src/editor/gfm-footnote.ts` | `cd8c295357500660234781c3a817a130` |
> | `frontend/src/editor/tokenizers.ts` | `3dc1d81a2cde6e86fbf0225d70031130` |
> | `frontend/src/editor/index.ts` | `6270fa6ef4430d663fd8bf90ba600105` |
> | `frontend/src/editor/plain-export.ts` | `80b23073613ee566066a4d0478c7d0f1` |
> | `frontend/src/editor/markdown-roundtrip.test.ts`（F06 用例被 Lead 加强，§4.4 有独立判定） | `64cb143a970bab686a7dc4745404e713` |
> | `frontend/src/editor/gfm-footnote.test.ts`（开发者） | `e0dfcfa0902cb442ac4e0c269a2aa496` |
> | `docs/document-format.md` | `2efc5673d39ca300094325e1bcd02b7b` |
> | 验证套件 `frontend/src/editor/gfm-footnote-verify.test.ts`（本报告作者，85 用例） | 见 §5 |

---

## 0. 结论摘要（最终）

| 项 | 结果 |
|---|---|
| **最终判定** | ✅ **通过**：对抗套件 **85 用例 85 PASS · 0 FAIL**；回归底线全绿；3 条首轮 FAIL（C26/C27/C28）已在 `75273e5` 修复并经我复验 |
| **回归底线** | ✅ `tsc -b --noEmit` **exit 0**；全量 vitest **28 files / 378 passed · 1 skipped · 0 failed (379)**；7 回归面 **126 passed / 7 files**；pytest **314 passed · 2 skipped**（最终提交未改 backend，见 §3） |
| **干净基线独立复现** | ✅ HEAD `c256515` 独立副本：**26 files / 262 passed · 1 skipped (263)**，与声称基线一致 |
| **方案书 §1.1 五个损坏 case** | ✅ A/B/C/G/H 全部转为不损坏（H 组独立复现） |
| **规范符合性** | ✅ 编号＝引用首次出现顺序、重复标签首个优先、未定义引用字面、定义行 ≤3 空格、续行 4 空格、懒续行；⚠️ 容器内定义、未引用定义保留、`[`/转义标签、超长标签按码元计数为**有意/边界偏离**（§6） |
| **首轮 3 FAIL 的最终状态** | C26/C27 行首引用 → 已重建为 `footnote` 节点（并新增 C29 验证 fallback 路径未漏内容）；C28 图片 alt → 已加掩码；归因均为**既有缺陷**（§4.1/§4.2 + §7） |
| **过程战果** | 本验证累计报出 **11 条缺陷**；**全部 11 条**在最终冻结修订前修复并复验（其中 3 条为 S-2 引入的保真退化：缩进代码块改写、行内/块级公式污染、HTML 注释提前终止；另 R1-R7 见 §7 状态列） |
| **未验证项** | cmark-gfm 逐字节对照 / GitHub·Typora 实际渲染 / GUI 手工粘贴 / cargo / 256KB 高脚注密度压测（§8 声明，未当结论） |

---

## 1. 规范核查（第一段独立工作，权威源优先）

### 1.1 一个必须先纠正的前提：GFM 官方规范**没有** footnotes 章节

```
$ curl -sS -m 60 -A verifier-s2 -o /tmp/gfm.html "https://github.github.com/gfm/" && wc -c /tmp/gfm.html
508310 /tmp/gfm.html
$ grep -o -i "footnote[^<]*" /tmp/gfm.html | sort | uniq -c
      1 footnotes, tables, and          ← 引言中的一句抽象
      3 footnoteRef > sup …             ← 3 处 CSS 选择器
$ grep -o 'id="[^"]*footnote[^"]*"' /tmp/gfm.html
（无输出：不存在 footnotes 章节）
```

→ 因此「以 GFM 官方规范为准绳」在本特性上**不可直接落地**；事实规范来源是：
**cmark-gfm 参考实现**（GitHub 实际使用的解析器）＋ 其官方测试套件 **`test/extensions.txt`** ＋ **GitHub Docs**。方案书 §1.2 说「GFM 规定未定义引用渲染为字面文本」只能由这些来源支撑。

### 1.2 原文引文（本次实际拉取的文件与行号）

| 编号 | 来源 | 原文 |
|---|---|---|
| **SRC-1** | `cmark-gfm/src/scanners.re:358` `_scan_footnote_definition` | `'[^' ([^\] \r\n\x00\t]+) ']:' [ \t]*` |
| **SRC-2** | `cmark-gfm/src/blocks.c:1220` | 定义行分支要求 `!indented`（`parser->indent < CODE_INDENT=4`），起点为 `first_nonspace` |
| **SRC-3** | `cmark-gfm/src/blocks.c:929` `parse_footnote_definition_block_prefix` | `if (parser->indent >= 4) { S_advance_offset(parser,input,4,true); return true; } else if (blank) return true; return false;` |
| **SRC-4** | `cmark-gfm/test/extensions.txt`「Footnotes」 | 未定义引用 `[^nope]` → 输出**字面** `<p>…[^nope].</p>`；未被引用的 `[^unused]` **不出现在输出**；编号 `[^1]`→1, `[^footnote]`→2, `[^other-note]`→3 … ＝**引用首次出现顺序**；同标签多次引用共享同一编号（多个 backref） |
| **SRC-5** | `cmark-gfm/src/map.c` `normalize_map_label` / `cmark_map_lookup` | case fold + trim + 内部空白折叠；`label->len > MAX_LINK_LABEL_LENGTH`（999）→ 返回 NULL |
| **SRC-6** | `cmark-gfm/src/map.c` `refcmp`/`sort_map` | label 相同时按 `age` 升序 → 去重保留 **age 最小者＝首个定义** |
| **SRC-7** | GitHub Docs「Footnotes」（raw 源） | `[^2]: To add line breaks within a footnote, add 2 spaces to the end of a line.` 换行 `This is a second line.` → **0 缩进懒续行**属于该脚注 |
| **SRC-8** | `cmark-gfm/test/extensions.txt` 多段落用例 | `[^footnote]:` + `    > Blockquotes can be in a footnote.` + `        as well as code blocks` + `    or, naturally, simple paragraphs.` → **续行 4 空格＝内容；8 空格＝脚注内代码块** |

### 1.3 与本项目决策/实现的差异表

| # | 方案书/实现主张 | 规范（SRC） | 判定 |
|---|---|---|---|
| 1 | 标签 `[^\s\]]+`（方案书 §4.3） | `[^\] \r\n\x00\t]+`（SRC-1） | 近似但**不等价**。cmark 排除集仅 6 类 ASCII；JS `\s` 还排除 NBSP 等。**实测**：`[^\u00A0a]` 被本实现识别（与 cmark 一致），方案书正则会拒绝。实现另**额外**排除 `[`（cmark 允许），并支持标签内 `\[ \] \\` 转义（cmark 扫描器不支持） |
| 2 | 定义行行首、≤3 空格前导 | SRC-2 | ✅ 一致（A2/A3 用例） |
| 3 | 4 空格缩进的 `[^1]:` 不识别（缩进代码块） | SRC-2 | ✅ 一致（A3） |
| 4 | 「多段落脚注 4 空格缩进会被当代码块」＝损坏 | SRC-3/SRC-8：**续行必须 4 空格**；8 空格才是代码块 | 方案书 §4.3 把「标记行缩进」与「续行缩进」混写；`plain-export.ts:231` 输出 4 空格续行本就是**正确 GFM**。已在 `document-format.md` §2.3.1 订正 |
| 5 | 续行仅 4 空格/Tab | SRC-7：0 缩进懒续行同样属于脚注 | 实现已支持（A7/C19 实测 PASS） |
| 6 | 编号「按定义顺序」（方案书 §4.5） | SRC-4：按**引用首次出现顺序** | 方案书文字与规范相反；**实现与规范一致**（A15）：`[^b]` 先出现 → n=1，`[^a]` 后出现 → n=2 |
| 7 | A1 无条件识别（方案书 §4.2/§9 决策 2） | SRC-4：未定义引用＝字面文本 | 实现改为 **A2 定义感知**，与规范一致；`document-format.md` 已记录该决策变更 |
| 8 | 孤立定义「整行消失」＝marked bug | SRC-4：未被引用定义在 cmark 中被 `unlink`（渲染层不输出） | marked 行为与 GFM **渲染语义一致**；缺陷根因是「渲染语义 vs 编辑器保真目标」的冲突，不是 marked 违反规范。项目选择保留内容（A18/E1）为**有意方言偏离** |
| 9 | 重复标签：首个优先 + 其余保留为文本 | SRC-6 首个优先 ✅；其余定义在 cmark 中同样被 unlink | 「首个优先」符合规范；「其余保留为文本」是**有意方言偏离**（A19/D6/F4 实测保留成功） |
| 10 | 容器内定义未提及 | SRC-2：相对缩进 <4 时容器（列表项/引用块）内也可定义 | 实现**不识别**容器内定义，改为转义中和为字面文本（C12/M5；无数据丢失但不符合 cmark） |
| 11 | 标签匹配「大小写不敏感 + 折叠空白」 | SRC-5 | 大小写折叠 ✅（A12 实测 `[^Note]`↔`[^note]:`）；因标签文法本身不允许 ASCII 空白，空白折叠无实际作用（**文档描述与实现能力不一致**，建议规范措辞收敛） |
| 12 | 标签长度上限 999 | SRC-5 为 **999 字节** | 实现按 **UTF-16 码元**计数。实测 L6：400 个 CJK 字符标签（1200 字节）被本实现识别，而 cmark 的引用查找会拒绝 → 边界偏离（无损坏） |

**方案书需订正的 4 处**（已在 `document-format.md` §2.3.1 吸收，此处留痕）：§4.5 编号语义、§4.3 缩进表述、§1.1 case C 定性、§9 决策 2（A1→A2）。

---

## 2. 验证方法

1. **生产等价路径**：`useKeEditor({content:''})` + `setKeContent(editor, md)`。已核实「Markdown 解析入口唯一」这一实现假设：
   ```
   $ grep -rn "contentType: 'markdown'" frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.'
   frontend/src/editor/index.ts:197:    contentType: 'markdown', // 字符串内容按 Markdown 解析进 Document Model
   frontend/src/editor/index.ts:331:    editor.commands.setContent(normalizeGfmFootnotes(markdown), { contentType: 'markdown', emitUpdate: false })
   $ grep -n -A3 "useKeEditor({" frontend/src/components/layout/EditorArea.tsx
   337:  const editor = useKeEditor({
   338:    content: '',
   ```
   → 197 行的初始 `content` 在生产中恒为 `''`；唯一的**带内容** Markdown 解析点是 331 行（已含规范化）。结论：解析入口唯一，规范化不会被绕过。
2. **三层验证**：纯函数层（`normalizeGfmFootnotes` 直接喂入，`esbuild --bundle` 后 node 运行）＋ 解析/序列化整链（`Editor` 实测）＋ 导出闭环（`plainExportPayload` 真实 Blob）。
3. **归因方法（既有 vs S-2 引入）**：用 `git archive HEAD | tar -x -C /tmp/ke-baseline` 复制 HEAD `c256515` 干净工作副本（symlink `node_modules`），以**原生 ke 方言**复跑同一场景，与冻结修订的 GFM 场景对照；`git archive` 不触碰工作树/索引。
4. **注册顺序核实**（task-5 指定重点）：读 `marked@17.0.6` 源码实证 `use()` 中 `t[level].unshift(i.tokenizer)` 与 `Lexer.blockTokens` 的 `extensions.block.some(...)`：「**后注册先执行（LIFO）**」为真；且块级扩展在**每个 block 位置**都会被调用（`start` 只参与段落截断）。本实现最终**未新增 marked tokenizer**（改为解析入口前置纯函数），故抢占面显著缩小；C 组用例仍保留为回归护栏。
5. 仅报实跑结果；未跑/不可跑项集中在 §8 声明。

---

## 3. 回归底线（实际命令 + 实际输出）

```
$ cd "/mnt/f/Work/KE Project/knowledge-editor/frontend" && npx tsc -b --noEmit ; echo "tsc_exit=$?"
tsc_exit=0
```

```
$ npx vitest run                    # 最终冻结 75273e5
 Test Files  28 passed (28)
      Tests  378 passed | 1 skipped (379)
```

```
$ npx vitest run src/editor/phase3-roundtrip.test.ts src/editor/fidelity-regression.test.ts \
    src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts \
    src/editor/export-actions.test.ts src/editor/dom-render.test.ts src/editor/phase5-module.test.ts
 ✓ src/editor/plain-export.test.ts (8 tests)
 ✓ src/editor/dom-render.test.ts (2 tests)
 ✓ src/editor/markdown-roundtrip.test.ts (29 tests)
 ✓ src/editor/phase3-roundtrip.test.ts (15 tests)
 ✓ src/editor/export-actions.test.ts (6 tests)
 ✓ src/editor/fidelity-regression.test.ts (52 tests)
 ✓ src/editor/phase5-module.test.ts (14 tests)
 Test Files  7 passed (7)
      Tests  126 passed (126)
```

```
$ cd ../backend && python3 -m pytest
314 passed, 2 skipped, 1 warning in 11.67s
$ git diff --name-only 2f2eede..75273e5
frontend/src/editor/gfm-footnote.ts
frontend/src/editor/markdown-roundtrip.test.ts
frontend/src/editor/tokenizers.ts
   ← 最终提交未触 backend/desktop，故 pytest 结果对最终修订同样成立
```

**干净基线独立复现**（`/tmp/ke-baseline`，HEAD `c256515`）：

```
$ git archive HEAD | tar -x -C /tmp/ke-baseline && ln -s …/frontend/node_modules /tmp/ke-baseline/frontend/node_modules
$ cd /tmp/ke-baseline/frontend && npx vitest run
 Test Files  26 passed (26)
      Tests  262 passed | 1 skipped (263)
```

> 说明：`perf-bench.test.ts` 本次全量运行 PASS（`gateFirst` 内），未触发 Lead 提示的偶发超限；按建议未将其波动计为回归。

---

## 4. 对抗套件与缺陷详情（首轮 3 FAIL → 修复 → 复验）

**套件文件（本报告作者独立编写，与开发者 `gfm-footnote.test.ts` 相互独立）**：`frontend/src/editor/gfm-footnote-verify.test.ts`

```
$ npx vitest run src/editor/gfm-footnote-verify.test.ts      # 最终冻结 75273e5
 Test Files  1 passed (1)
      Tests  85 passed (85)

（历史）首轮冻结 2f2eede：Tests  3 failed | 81 passed (84)
```

> 判定变更留痕（诚信记录）：C26 的第三条断言最初写为「纯文本必须等于 trim 后的正文」，首轮据此判 FAIL。
> 在 `75273e5` 复验时我复核语义：`[^1]` 之后的空格是**原文内容**，保留它才是保真，trim 反而不对 →
> 已把我的断言改为「纯文本 === `' 开头引用。'`（保留标记后空格）」。这是**修正我自己的过度断言**，
> 不是放宽验收项；C26 的前两条断言（无 `keFallback`、`footnoteRefs===1`）自始未变。

### 4.1 FAIL-1/2（**已在 75273e5 修复并复验 PASS**）：行首（块级起始位置）的脚注引用被块级 fallback 消费 —— C26 / C27

**最小复现**（`npx vitest run src/editor/gfm-footnote-verify.test.ts -t C26`）：

| | |
|---|---|
| 输入 | `[^1] 开头引用。\n\n[^1]: 定义\n` |
| 规范化输出 | `<!-- ke-footnote: {"kind":"footnote","id":"ke-66fe4755e166","n":1} --> 开头引用。\n\n<!-- ke-footnotes:start -->…` |
| 实测 `getJSON()` | `[{"type":"keFallback","raw":"<!-- ke-footnote: {…} -->"},{"type":"paragraph","content":[{"text":" 开头引用。"}]},{"type":"footnotes","items":[{"n":1,"text":"定义"}]}]` |
| 实测 `getMarkdown()` | `<!-- ke-footnote: {…} -->\n\n 开头引用。\n\n<!-- ke-footnotes:start -->…` |
| 断言 | `keFallback` 应为 0（实测 1）／`footnoteRefs` 应为 1（实测 0）／纯文本应为 `开头引用。`（实测前导空格 ` 开头引用。`） |

C27（`[^1][^2] 开头。`）实测产生 **2 个 `keFallback` 块**。

**归因（既有缺陷，非 S-2 引入）** —— 用 HEAD 干净副本以**原生 ke 方言**复跑：

```
BASE-LINESTART JSON: {"type":"doc","content":[{"type":"keFallback","attrs":{"raw":"<!-- ke-footnote: {…} -->"}},
  {"type":"paragraph","content":[{"type":"text","text":" 开头引用。"}]},{"type":"footnotes",…}]}
```

→ HEAD 与冻结修订产出**同一结构**，故属既有缺陷；S-2 使其对普通 GFM 文档（行首引用）可达。
**机制**：`keFallbackTokenizer` 是块级扩展，marked 在**每个 block 位置**先调用块级扩展；当段落起始位置即为该注释时，其 `tokenize()` 因「注释后有同行内容」返回块级 `ke_fallback`（F06 分支），段落被切开，行内 `footnoteTokenizer` 再无机会执行。`start: () => -1` 只解决了「段落中途截断」（A22/A16 已修），未解决「起始位置抢先」。
**建议方向**：当 `ke-footnote` 注释后同行仍有内容时，块级 fallback 应返回 `undefined` 让段落规则接管（行内 tokenizer 会正确产出 `footnote` 节点），而非返回块级 token；未知 kind 的原文保留可由行内 fallback 承担（需同时回归 fidelity-regression P1-2/P1-3）。

### 4.2 FAIL-3（**已在 75273e5 修复并复验 PASS**）：图片 alt 内的引用被写成 HTML 注释文本 —— C28（边界/保真）

| | |
|---|---|
| 输入 | `![图[^1]](a.png)\n\n[^1]: 定义\n` |
| 实测 `image.attrs.alt` | `图<!-- ke-footnote: {"kind":"footnote","id":"ke-66fe4755e166","n":1} -->` |
| 实测 `footnoteRefs` | `0`（引用丢失，定义成为孤立条目） |
| 实测 `getMarkdown()` | `![图<!-- ke-footnote: {…} -->](a.png)\n\n<!-- ke-footnotes:start -->…`（稳定，不再变化） |

**归因**：HEAD 更差（整张图片被毁）：

```
BASE-L2: "图^1"                                  ← HEAD：![图[^1]](a.png) + 定义 → 图片结构完全消失
BASE-L1: "[点我^1](http://example.com)"          ← HEAD：链接文本内引用同样被吃
```

冻结修订保住了图片与链接节点，但把机器注释写进了用户 alt 文本，且引用未成为 `footnote` 节点。属**边界保真退化**（低影响，相对 HEAD 为改善）。
**建议方向**：把 `![…]` 的 alt 段纳入掩码（与已修的链接目标 `](…)` 掩码同源），使 alt 内 `[^1]` 保持字面。

> 相关但**未判 FAIL** 的行为（规范对照见 §8）：链接文本内引用（L1）实测 `[点我[^1]](url)` → `[点我](url)<!-- ke-footnote -->`（链接文本与引用分离，节点保留）。

### 4.3 修复与复验（修订 `75273e5`，仅改 3 个 frontend 文件）

| FAIL | 修复方式（Lead 实现，摘要） | 我的复验 |
|---|---|---|
| C26/C27 | 块级 `keFallbackTokenizer`「注释后同行有正文」分支：能解析为 `ke-footnote` 时**直接产出 `ke_footnote` token**（复用 `FootnoteExtension.parseMarkdown`），其余 kind/损坏 JSON 仍原样保留 | C26/C27 **PASS**；实测 `[footnote{id,n}, paragraph(" 开头引用。"), footnotes[…]]`，`keFallback`=0，`footnoteRefs`=1 |
| C28 | `inlineMaskRanges` 新增 `![…]` alt 段掩码 | C28 **PASS**；实测 `image.attrs.alt="图[^1]"` 保持字面 |
| 回归 | 未掩码链接文本（保持 cmark 行为） | C23/L1 复验 PASS；未定罪项仍列 §8 |

**新增 C29（我自己的防漏测试）**：C26 把「行首注释 + 同行正文」的处理搬进块级后，**必须确认 fallback 原文保留路径没被漏掉**。四组输入实测均保留注释与 kind、正文不丢：

```
<!-- ke-future: {"a":1} -->正文照常。
<!-- ke-NOTE: {"id":"x"} -->正文照常。
<!-- ke-footnote: {broken -->正文照常。      ← 损坏 JSON 走原样保留
<!-- ke-module: {"name":"M"} -->正文照常。
→ C29 PASS（正文照常。/ 注释原文/kind 三项断言全过）
```

### 4.4 独立判定：Lead 修改既有用例 `markdown-roundtrip.test.ts` F06 —— **属加强，成立**

被改用例：`段首脚注（注释后同行有正文）`，`2f2eede → 75273e5` diff 要点：

- 旧断言：`blocks.find(n => n.type === 'keFallback')` 为真 + `fb.attrs.raw` 含 `ke-footnote` + 存在 paragraph + 往返含正文/`ke-footnote`。
- 新断言：`blocks.find(n => n.type === 'footnote')` 为真 + `attrs.id === 'f4'`（**新增**）+ 存在 paragraph + 往返含正文/`ke-footnote` + **往返含 `"id":"f4"`（新增）**。

我的判定（独立跑 `npx vitest run src/editor/markdown-roundtrip.test.ts` → 29 passed）：
1. 旧断言把「只能退化为 fallback 块」这一**实现局限**写成了不变量；新行为解除该局限后，旧断言必然红 —— 修断言而非修行为是正确的方向。
2. 原不变量**全部保留**（注释不静默丢失 → 由「footnote 节点存在且 id 正确」更强地保证；正文照常成段；往返内容保留），并**新增** id 保真断言 → **净加强**。
3. 唯一被移除的是「节点类型必须是 keFallback」这一实现细节断言，与产品语义无关；且 fallback 原文保留路径另有覆盖：`fidelity-regression`（P1-2/P1-3，52 用例全绿）+ 我的 C20 + 新增 C29（未知 kind/大小写变体/损坏 JSON/其他已知 kind）。
4. 该文件仍在我必须复跑的 7 回归面清单内 → 修改后全绿（见 §3）。

**结论：接受该测试修改；不要求回退或另建覆盖。**

---

## 5. 关键 PASS 用例的实际输出摘录

纯函数层（`node /tmp/s2-probe/probe-normalize*.mjs`，输入 → 实际输出）：

| 用例 | 实际输出（节选） |
|---|---|
| N3 懒续行（GH Docs 官方形态） | `正文<!-- ke-footnote: {…} -->。\n\n<!-- ke-footnotes:start -->\n<!-- ke-footnote-item: {…,"text":"第一行  \n未缩进第二行"} -->…` |
| N7 定义行后紧跟 GFM 表格 | 区域行插入 + `\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|` 原样保留 |
| N8 定义行后紧跟 ke-note | `<!-- ke-note: {"id":"n","label":"提示"} -->` 原样保留 |
| N9 大小写折叠 | `引用[^Note]。` + `[^note]: 定义` → 同一 `id=ke-82ee8be03ae8`、`n=1` |
| N10 CRLF | 区域与条目以 `\r\n` 保持，无多余空行漂移 |
| N12 `[^]`/`[^ ]`/`[^]:` | 全行原样返回（零改动） |
| N13 4 空格缩进定义行 | 原样返回（识别为缩进代码块） |
| N15 1000 字符标签 | 原样返回（不崩、不吞行） |
| M1 HTML `<div>` 块内引用 | `<div class="x">\n[^1] 在 HTML 块里\n</div>` 原样保留 |
| M2 HTML 注释内引用 | `<!-- 注释里的 [^1] -->` 原样保留（早期版本会嵌套 `-->` 提前终止注释，已修） |
| M5/M6 容器内定义 | `> \[^1\]: 引用块里的定义` / `- \[^1\]: 列表项里的定义`（转义中和，内容不丢） |
| M13 `-->`/`}`/引号 | `"text":"内容含 --> 与 } 与 \" 引号"`；自解析走括号平衡 JSON，不经 HTML 注释语义（F10 往返稳定） |
| I2 行内公式内引用 | `式子 $x[^2]$ 与引用<!-- ke-footnote … -->`（math 内**不再**被改写） |
| I8 数学块后紧跟定义 | `$$\nE=mc^2\n$$\n\n<!-- ke-footnotes:start -->…`（正确分离） |
| J4 围栏 info 字符串 | ```` ```js [^1] ```` 原样保留 |

整链（`Editor`）与闭环：

| 用例 | 结果 |
|---|---|
| A22（1 字符前缀） | `一[^1]。` → `[text "一", footnote(n=1), text "。"]`，无 `keFallback`（早期版本 refs=3→2，已修） |
| C4/C5 公式 | `$x[^2]$` latex 恰为 `x[^2]`；`$$…[^1]: x…$$` 仍为单个 `mathBlock` 且 latex 不含 `ke-footnotes` |
| C16 混排压力 | 标题/表格/行内公式/块级公式/ke-note/HTML 注释/围栏/脚注同篇全部节点在位 |
| D1–D10 | 第 2/3 次 open→save 逐字节稳定；两次独立解析 JSON 深度相等（含 id）；重复标签文档两轮一致且仅 1 个区域 |
| E1–E8 | `plainExportPayload` 产物回读后 `(n,text)` 集合等价、再导出差值 0 字节、脚注内 8 空格代码块缩进保留、导出 `[^n]` 与 `[^n]:` 配对 |
| H-A/B/C/G/H | 方案书五个损坏 case 全部转好（无假链接 `[^1](…)`、孤立定义不丢行、续行不产代码块） |
| C24 性能 | 2000 唯一标签解析在门限内；纯函数 8000 标签 / 276KB = 177ms（线性，无爆炸） |

`marked@17.0.6` 原生探针（`node /tmp/s2-probe/probe-marked.mjs`）**独立复现方案书 §1.2 全部证据**：A 案 `正文<a href="%E7%AC%AC%E4%B8%80…">^1</a>。`、C 案定义行完全消失、G 案续行 `<pre><code>续行</code></pre>`、K/L/M 案代码上下文不受影响；补充新证据：未定义引用 marked 本就输出字面 `[^nope]`（与 SRC-4 一致），重复标签 marked 取**首个**定义（与 SRC-6 一致）。

---

## 6. 规范差异表（不判 FAIL，但需留档）

| 项 | 规范 | 本实现 | 性质 |
|---|---|---|---|
| 未引用定义 | 渲染层丢弃（SRC-4） | 保留为条目（`n` 追加在引用者之后） | 有意方言偏离（编辑器不丢作者内容）✅ |
| 重复定义其余内容 | 丢弃 | 保留为普通文本 | 有意方言偏离（决策 4）✅ |
| 容器内定义（`> [^1]:` / `- [^1]:`） | cmark 可识别（SRC-2 相对缩进） | 转义中和为字面文本，不识别 | 偏离规范，但**无数据丢失**（优于 HEAD 的「内容消失+假链接」）⚠️ |
| 标签含 `[` | cmark 允许（SRC-1） | 不识别（原样保留） | 边界偏离，无损坏 ⚠️ |
| 标签内 `\[ \] \\` 转义 | cmark 扫描器不支持 | 支持（额外能力） | 超集，无损坏 ✅ |
| 标签长度上限 | 999 **字节**（SRC-5） | 999 **UTF-16 码元**（实测 400 CJK 标签=1200 字节仍识别） | 边界偏离 ⚠️ |
| BOM + 定义在首行 | CommonMark 允许文档首 BOM | 不识别 → 全文退化为字面文本（不丢内容、不产生假链接） | 边界偏离 ⚠️（L3 实测 `\uFEFF\[^1\]: 定义`） |
| `[^ a]: 内容`（标签含 ASCII 空格） | 不是脚注定义 → cmark 当 link-ref-def | 同（不识别；marked 会据此产生链接） | 与 cmark 一致 ✅ |
| `[^\u00A0a]`（NBSP 标签） | cmark 允许 | 识别 | 与 cmark 一致；与方案书 `[^\s\]]+` 不一致（方案书正则需订正）✅ |
| 打开即转 ke 方言 | —— | 打开 GFM 文档保存后重写为 ke 方言 | 决策 3 已接受 ✅ |

---

## 7. 既有缺陷 vs S-2 引入（归因表，全部有基线证据）

| 场景 | HEAD `c256515` 实测 | 冻结修订实测 | 归因 |
|---|---|---|---|
| 引用+定义（方案书 A） | 引用变链接 `[^1](定义)`、定义消失 | 正常 `footnote`+`footnotes` | S-2 目标，已修 ✅ |
| 孤立定义 | 整行消失 | 保留为条目 | S-2 目标，已修 ✅ |
| 4 空格续行 | 变代码块 | 并入脚注文本 | S-2 目标，已修 ✅ |
| 1 字符前缀引用（`一[^x] 二[^x] 三[^x]。`） | refs=2 + `keFallback`=1 | refs=3 | **既有**，S-2 附带修复 ✅ |
| 行首引用（`[^1] 开头…`） | `keFallback` + 段落切碎（原生 ke 方言复现） | `footnote` 节点 + 段落 `" 开头引用。"`、无 fallback | **既有**，已在 `75273e5` 修复并复验 ✅（C26/C27） |
| 4 空格缩进代码块内容 | 保留（但定义被吃、引用变链接） | 保留 | 中途修订曾改写（S-2 引入），冻结修订已恢复 ✅ |
| `$x[^2]$` 行内公式 | 保留（公式正常，定义被吃） | latex 恰为 `x[^2]` | 中途修订曾污染（S-2 引入），已修 ✅ |
| `$$…[^1]: x…$$` 块级公式 | `mathBlock` latex 完整 | 完整 | 中途修订曾拆块（S-2 引入），已修 ✅ |
| HTML 注释内引用 | 保留 | 保留 | 中途修订曾产生嵌套 `-->`（S-2 引入），已修 ✅ |
| HTML `<div>` 块内引用 | 保留 | 保留 | 中途修订曾改写（S-2 引入），已修 ✅ |
| 链接目标 / 引用式链接定义 / 图片目标 URL 内引用 | `[点我^1](url)` / `图^1`（内容被毁） | URL 完好 | 中途修订曾改写 URL（S-2 引入），已修 ✅ |
| 跨行 code span 内引用 | —— | 保持字面 | 中途修订曾改写（S-2 引入），已修 ✅ |
| 重复标签第 2 条内容 | 全部消失 | 保留为文本 | S-2 改善 ✅ |
| 已有 ke 区域 + GFM 定义 | 双双被转义为字面、1 区域 | 并入既有区域为第 2 条目、1 区域 | 中途修订曾产生 2 区域（S-2 引入），已修 ✅ |
| blockquote 内定义 | 内容消失 + 假链接 | 转义保留（不识别） | S-2 改善 ✅ |
| 脚注内代码块缩进（导出） | `plain-export` `tl.trim()` 压平 | `    ${tl}` 保留 | **既有** plain-export 缺陷，已修 ✅ |
| 图片 alt 内引用 | 图片整体被毁 `图^1` | alt 保持 `图[^1]`（掩码） | **既有**，已在 `75273e5` 修复并复验 ✅（C28） |

**R1–R7（第二批量，2026-09-14 已报 → 已于冻结前修复，并在 `75273e5` 纳入复验范围）**：
R1 懒续行 → A7/C19 PASS；R2 一字符前缀 fallback → A22 PASS；R3 重复标签文本被吃 → A19/D6/F4 PASS；
R4 双 footnotes 区域 → C7 PASS；R5 HTML `<div>` 改写 → C8 PASS；R6 blockquote 定义内容丢失 → C12 PASS；
R7 导出续行 trim 压平 → E3/E8 PASS。以上 7 条 + 最终 3 条（C26/C27/C28）= **11 条全部闭环**。

---

## 8. 未验证项声明（严禁把推测当结论）

| 项 | 原因 |
|---|---|
| cmark-gfm **逐字节**对照（尤其：链接文本内 / 图片 alt 内的 `[^1]` 是否构成 GFM 脚注引用） | 本环境无 cmark-gfm 二进制；任务明令**不得** `npm install`（双平台原生二进制互毁），无法安装 JS 端 GFM 脚注实现。相关行为已在 §4.1/§4.2 按「实测行为记录」处理，未按规范定罪 |
| GitHub / Typora 真实渲染结果 | 无可用的外部渲染环境；marked 本身无脚注支持，无法替代 |
| 方案书 P4「GUI 手工粘贴 GFM 文档」验收 | 无 GUI 会话（Web GUI 仅用于本会话交互），未做人工粘贴验证 |
| desktop / cargo 侧 | 本任务范围外（S-2 未改 `desktop/**`），未复跑 cargo；采信范围仅限前端 |
| 256KB 级超大文档的 GFM 脚注密度压力 | 未独立构造 256KB 且高脚注密度的样本；仅验证纯函数线性曲线（8000 标签/276KB=177ms）与 `perf-bench` 既有门限 |
| CRLF→LF 归一化是否为 S-2 引入 | 冻结修订 D7 实测「往返稳定、内容保留、输出为 LF」；HEAD 同场景被 S-2 缺陷掩盖，未能取得干净对照 → 不判定归因 |

---

## 9. 结论与建议

1. **最终判定：通过**。对抗套件 **85 用例全绿**（`npx vitest run src/editor/gfm-footnote-verify.test.ts` → 85 passed）；首轮 3 条 FAIL（C26/C27/C28）已于 `75273e5` 修复，我按同套用例复跑确认，并另加 C29 证明 fallback 原文保留路径未被该修复漏掉。
2. **S-2 达成方案书承诺**：§1.1 五类损坏全部消除；A2（定义感知）比方案书原推荐 A1 更贴规范且零误判；编号语义（按引用首次出现顺序）、id 确定性、幂等收敛、导出闭环均实测通过；「生产解析入口唯一」这一实现假设已核实。
3. **回归底线全绿（最终冻结 75273e5）**：tsc 0；全量 vitest **378 passed · 1 skipped · 0 failed**；7 回归面 126 passed；pytest 314 passed · 2 skipped；干净基线 262+1 独立复现。
4. **对 Lead 修改既有测试的独立判定**：`markdown-roundtrip.test.ts` F06 用例的修改属**加强**（原不变量全部保留 + 新增 id 保真断言），接受（§4.4）。
5. **必须处理的 3 条 FAIL —— 状态：均已在 `75273e5` 修复并复验通过**（保留原始判定供追溯）：
   - **C26/C27（既有缺陷）**：行首（块级位置）引用曾退化为 `keFallback`、正文段落被切碎；修复后实测为 `footnote` 节点 + 段落 `" 开头引用。"`（§4.3）。
   - **C28（边界）**：图片 alt 曾被写入 ke 注释；修复后 `![…]` alt 段纳入掩码，alt 保持字面（§4.3）。
6. **规范留档建议（不影响通过判定）**：`document-format.md` §2.3.1 中「label 文法＝非 `[` `\` `]`」与实现（额外排除 ASCII 空白 / 拒绝含 `[` / 支持标签内转义）需对齐；「折叠内部空白」在当前标签文法下不可达，建议删改；「GFM 规范」措辞建议改为「cmark-gfm 参考实现（GFM Spec v0.29 无 footnotes 章节）」；容器内定义 / 未引用定义保留 / 超长标签按码元计数这三条**有意或边界偏离**建议在规范中显式声明（§6）。
7. 若后续再改动 S-2 相关文件，复跑范围：`gfm-footnote-verify.test.ts` 全量 85 用例 + 7 回归面 + `tsc`（附录 B 为可复制命令清单）。

---

## 附录 A：85 用例逐条状态（最终冻结 `75273e5`：**85 PASS · 0 FAIL**）

复现命令：`cd frontend && npx vitest run src/editor/gfm-footnote-verify.test.ts --reporter=verbose`
（`✓`=PASS，`×`=FAIL；下列为最终状态；C26/C27/C28 在首轮 `2f2eede` 曾为 `×`，已修复复验）

```
A. 规范符合性
 ✓ A1 行首定义（0 缩进）识别为 footnotes 条目、引用为 footnote 节点
 ✓ A2 1/2/3 空格前导的定义行均识别
 ✓ A3 4 空格缩进的定义行不识别（= 缩进代码块），且内容不得丢
 ✓ A4 4 空格续行并入同一脚注（GFM 正确形态，方案书 case G 的根因）
 ✓ A5 空行 + 4 空格续行 = 脚注内第二段（换行保真）
 ✓ A6 空行 + 8 空格续行 = 脚注内代码块（缩进内容保真，不得丢字）
 ✓ A7 0 缩进懒续行并入脚注（GitHub Docs 官方多行示例）
 ✓ A8 标签字符集：命名/数字/-/_/. 标签均可识别
 ✓ A11 `[^]`、`[^ ]`、`[^]:` 不识别为脚注且字面保真
 ✓ A12 标签匹配大小写不敏感（[^Note] 命中 [^note] 定义）
 ✓ A15 编号按引用首次出现顺序（定义顺序打乱）
 ✓ A16 同一标签多次引用共享同一编号
 ✓ A22 行内引用前恰有 1 个字符时仍须解析为 footnote 节点（不得变块级 fallback）
 ✓ A17 未定义引用保持字面文本（GFM 语义；A1 无条件识别会违背）
 ✓ A18 未被引用定义：项目红线=不丢行（规范渲染层本会丢弃）
 ✓ A19 重复标签定义：首个优先，其余不得静默消失
 ✓ A20 前向引用（引用在定义之前）生效
 ✓ A21 容器内定义（cmark 允许相对缩进<4）：至少不得静默丢内容
B. 消歧与代码上下文
 ✓ B1 字面量 a[^1] + 同名定义 → 判为脚注（记录为相对 GFM 的偏差）
 ✓ B4 转义 \[^1] 保持字面（逃生舱有效）
 ✓ B5 行内代码 `[^1]` 保持字面
 ✓ B6 行内代码 `[^1]: x` 保持字面
 ✓ B7 围栏代码块内 `[^1]: x` 保持字面，且不成为定义
 ✓ B8 4 空格缩进代码块内的 `[^1]` 不得被改写（同名定义存在时）
C. 抢占
 ✓ C1 定义行之后的 GFM 表格不被吞（表格结构完好）
 ✓ C2 定义行之前的 GFM 表格结构不受影响
 ✓ C3 表格单元格内的 [^1] 不破坏表格结构
 ✓ C4 `$行内公式$` 内含 [^2] 时仍是 math 节点且 latex 不被污染
 ✓ C5 `$$块级公式$$` 内的 `[^1]: x` 行不得被识别为定义、公式结构不得破坏
 ✓ C6 定义行后紧跟 `<!-- ke-note: … -->`：信息块节点不得被吞
 ✓ C7 已有 ke-footnotes 区域与 GFM 定义混排：不得产生重复/空壳区域
 ✓ C8 普通 HTML 注释/HTML 块内的 [^1] 不得被改写
 ✓ C9 标题内的引用 `# 标题[^1]` 仍是 heading + footnote
 ✓ C10 形如定义的标题 `## [^1]: 文本` 必须仍是标题
 ✓ C11 列表项内 `- [^1]: x` 不破坏列表且内容不丢
 ✓ C12 引用块内 `> [^1]: x` 不破坏 blockquote 且内容不丢
 ✓ C13 setext 标题不被干扰
 ✓ C14 定义行紧邻围栏代码块：围栏内容完好
 ✓ C15 定义行后紧跟 ATX 标题（段落可被打断）不被吞
 ✓ C16 混排压力样本：脚注 + 表格 + 公式 + ke-note + HTML 注释 + 围栏
 ✓ C17 防漂移：VERIFY_EXTENSIONS 的 tokenizer 承载顺序与 index.ts 生产顺序一致
 ✓ C18 4 空格缩进代码块整体内容不被任何新规则消费
 ✓ C19 懒续行不得吞掉紧随其后的块级结构（blockquote / 列表 / 围栏 / 表格 / 标题）
 ✓ C20 未知/大小写变体 ke-* 注释仍原样保留（fallback start 改动后的回归）
 ✓ C21 链接目标 URL 内的 [^1] 不得被改写（否则 URL 损坏）
 ✓ C22 跨行行内代码内的 [^1] 不得被改写
 ✓ C23 自动链接 / HTML 标签属性内不得被改写
 ✓ C25 引用式链接定义 / 图片目标 URL 内的 [^1] 不得被改写
 ✓ C26 行首（块级起始位置）的引用仍须是 footnote 节点，不得变块级 fallback   ← 首轮 × ，已于 75273e5 修复复验
 ✓ C27 相邻两个行首引用不产生多余块级节点                                     ← 首轮 × ，同上
 ✓ C28 图片 alt 内的 `[^1]` 不得被写成 HTML 注释文本（alt 是用户内容）        ← 首轮 × ，同上
 ✓ C29 行首注释 + 同行正文时，未知 kind / 损坏 JSON 仍须原样保留（C26 修复不得漏内容）
 ✓ C24 唯一标签规模 2000 时规范化不发生超线性爆炸（性能门）
D. 幂等性与确定性
 ✓ D1 open→save 第二次起字节稳定        ✓ D2 连续 3 次 open→save 全部相同
 ✓ D3 id 确定性：两次独立解析 → JSON 深度相等
 ✓ D5 GFM 文档 → 保存为 ke 方言 → 再次 open→save 收敛
 ✓ D6 重复标签后二次解析稳定，且不得新增/复制 footnotes 区域
 ✓ D7 CRLF 输入往返稳定且不吞行         ✓ D8 无尾随换行输入不产生尾部漂移
 ✓ D9 空文档 / 仅空白文档不因新路径产生异常且稳定
 ✓ D10 编号稳定：文档头部插入新脚注后既有脚注 id 不变
E. plain-export 闭环
 ✓ E1 plainExportPayload → 重新解析：条目 (n,text) 等价
 ✓ E2 导出→回读→再导出：字节不动点
 ✓ E3 多行脚注（含空行/代码块）导出→回读文本等价
 ✓ E4 导出产物引用/定义配对            ✓ E7 GFM → ke → 导出 → 回读结构等价
 ✓ E8 脚注 text 首行缩进导出→回读仍等价
F. 退化输入
 ✓ F1 空定义  ✓ F2 仅定义无引用  ✓ F3 仅引用无定义（可收敛）  ✓ F4 重复标签 ×3
 ✓ F5 超长标签  ✓ F6 特殊字符标签  ✓ F7 畸形语法  ✓ F8 尾随空白
 ✓ F9 内容含 `]`/`[`/`^`/花括号不全  ✓ F10 内容含 `-->`  ✓ F11 文末定义  ✓ F13 自/互引用
H. 方案书验收用例
 ✓ H-A 引用+定义不得变链接    ✓ H-B 仅引用无定义幂等    ✓ H-C 孤立定义不丢行
 ✓ H-G 多行续行不产代码块    ✓ H-H 命名标签不变链接
```

## 附录 B：复现命令清单

```bash
# 冻结修订
cd "/mnt/f/Work/KE Project/knowledge-editor" && git rev-parse HEAD   # 2f2eede…

# 回归底线
cd frontend && npx tsc -b --noEmit
npx vitest run
npx vitest run src/editor/phase3-roundtrip.test.ts src/editor/fidelity-regression.test.ts \
  src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts \
  src/editor/export-actions.test.ts src/editor/dom-render.test.ts src/editor/phase5-module.test.ts
cd ../backend && python3 -m pytest

# 对抗套件（85 用例；最终冻结 85 PASS）
cd ../frontend && npx vitest run src/editor/gfm-footnote-verify.test.ts --reporter=verbose

# 纯函数层探针（不修改仓库）
npx esbuild src/editor/gfm-footnote.ts --bundle --format=esm --platform=node --outfile=/tmp/s2-probe/gfm-footnote.mjs
node /tmp/s2-probe/probe-normalize.mjs   # N1..N15
node /tmp/s2-probe/probe-normalize2.mjs  # M1..M14
node /tmp/s2-probe/probe-normalize3.mjs  # I1..I8 + 性能曲线
node /tmp/s2-probe/probe4.mjs            # J1..J5
node /tmp/s2-probe/probe5.mjs            # 标签字符集边界

# marked 原生行为
node /tmp/s2-probe/probe-marked.mjs

# 干净基线归因（HEAD c256515）
mkdir -p /tmp/ke-baseline && git archive HEAD | tar -x -C /tmp/ke-baseline
ln -s "$PWD/frontend/node_modules" /tmp/ke-baseline/frontend/node_modules
cd /tmp/ke-baseline/frontend && npx vitest run
```
