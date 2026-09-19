# 独立验证报告：D-1 混合列表 / D-2 嵌套未知标签 / EDGE-1 空 frontmatter（task-40）

> 验证员：**verifier-s2**（独立于开发者与 Lead；只写验证产物，未修改任何被验证源码）
> 任务：共享任务板 **task-40**（验证 task-39 的 D-1 / D-2 / EDGE-1，含我 task-32 报出的 D-1/D-2/K8）
> **冻结修订（最终）**：`0d91833`（`fix(editor): 修正 ADD-1 收紧过头 —— 开块后前导空行与顶层序列型 frontmatter 被误拒`）
> 首轮冻结：`9c9154a`（我在跑前复算时发现 `ke.ts` 已漂移 → 等 Lead 二次冻结后以本表为准）
> 时刻：跑前 `2026-09-19T16:14:10Z` / 二次冻结复算 `2026-09-19T16:16:17Z`（UTC）

## 0. 冻结文件 sha256（我复算；与 Lead 冻结值一致）

| 文件 | sha256 | 与 `9c9154a` |
|---|---|---|
| `editor/ke.ts` | `64f5c397c027c1372516a0dadb424f404ba6927a9d3cf6a9c03111ffe40d75f3` | **已变**（FAIL-1/2 修复） |
| `editor/fidelity-constructs.test.ts`（Lead 回归） | `e422a026c7f7c666dad4c3883410d0669c7d15d2356139d22cf1f2ef49d9c8d9` | **已变**（+4 例） |
| `editor/tokenizers.ts` | `71102ddc2caff38f6cf0296403d4022f546276d0a6cd8717245d4a73ed01d46e` | 未变 |
| `editor/extensions/KeBlockJoin.ts` | `6fe9c749690906d68f402d25a63e388555be9ebcbde95a52a1d4ebc69cb95a09` | 未变 |
| `editor/index.ts` | `365f8904f5b4f6e6f5592ab14efdae46c28313d7fb435e5b71383c03eefbc06e` | 未变 |
| `editor/extensions/ListExtension.ts` | `e376069f6f61c659688ab901186f6a3311548a087f1c1d8bc38b7e4f41bac72e` | 未变 |
| `editor/fidelity-fixes-120.test.ts`（dev 回归） | `77e24384da2167041c3f2906e5e448f78932cbba81ff5b10c42e3c639084813e` | 未变 |

## 1. 结论摘要

| 项 | 判定 |
|---|---|
| **D-1 混合列表紧凑** | ✅ **PASS**（14/14）：混排/有序混排/双向嵌套/引用块内/CRLF/三层/列表后接表格标题 全部紧凑且结构正确；**结构反例两连**（段落分隔=两个列表 ✅、仅空行=同一松散列表 ✅）与 **ADD-3 控制**（`- a\n\n- b` 仍为既有「压紧」行为 ✅）均未被改坏 |
| **EDGE-1 / ADD-1** | ✅ **PASS**（16/16）：空块 LF/BOM/CRLF/BOM+CRLF 全部识别；我报的**两例内容丢失**（`---\n---\n\n正文\n\n---\n\n更多` 吞正文、`---\n\n正文\n\n---` 整篇为空）已修复；**FAIL-1/FAIL-2**（我发现的 ADD-1 过度收紧：首行空行 / 顶层序列型合法 frontmatter 被拒 → 双区块）已由 Lead 修复并复验通过；合法 frontmatter 变体矩阵（注释/多行数组/嵌套映射/块标量/含冒号值/行尾空格/值含 `---`/闭合后无空行）不误拒；无闭合开块仍正确地不当 frontmatter |
| **ADD-2 有序任务项** | ✅ **PASS**：`1. [x] a\n2. b` 复选框不再被转义为 `\[x\]` |
| **D-2 嵌套未知标签** | ✅ **契约口径 PASS（47/47）**：未知标签保留（含属性/大小写/自闭合）+ 纯标准标签仍转 + 代码围栏字面 + 文本不丢 + 幂等；⚠️ **严格口径偏差记录在案（待裁决）**：`<em><span>x</span></em>` → `<span>*x*</span>`（未知标签被置于外层），见 §4 |
| **门禁（终态）** | `tsc -b --noEmit` **exit 0**；三回归面 **89 passed**；我的套件 **47/47**；全量 **55 files passed + 1 skipped / 1059 passed · 1 skipped · 45 todo（exit 0）**；`pytest` 未复跑（本任务未涉后端） |
| **41 构造矩阵（修后重测）** | **`EXACT=0 / TRAILING=24 / CHANGED=17（共 41）`**（原记录 `0/19/22`）；「字符串直存」结论仍成立，两条方法学注记见 §6 |

## 2. 验证方法与两条诚实留痕

- **生产栈镜像 + 漂移哨兵**：我的套件按 `index.ts` 的生产扩展栈构造（含 `TaskList/TaskItem`、`KeDocument/KeBlockquote`、`StarterKit.document=false/blockquote=false`）。**X0 用例**读源码断言该镜像仍与生产一致——因为我在本轮真实踩过这个坑（见下）。
- **诚实留痕 1（我的误判）**：首次在 `9c9154a` 上跑时，我的套件**未镜像新的 `KeDocument/KeBlockquote`**（仍在用 StarterKit 内置 document/blockquote 的序列化），导致 D-1 显示「仍未修」——**这是我的 harness 失真，不是产品 FAIL**。修正镜像后 D-1 全绿，并新增 X0 漂移哨兵（含导入对象身份断言）防止再次发生。
- **诚实留痕 2（冻结漂移）**：Lead 首次给出的 `9c9154a` 冻结 sha 中 `ke.ts = 076825d8…`；我在跑前复算时已经是 `64f5c397…`（FAIL-1/2 的修复已进工作树）→ 我按流程**停跑并等二次冻结**，最终以 `0d91833` 的 sha 表为准。
- **判据分层**：A 严格（trimEnd 归一后逐字节 + 幂等）；B 语义等价（D-3 保持现状）；C 结构断言（列表分离/归属/紧凑）；D 已声明偏差（本轮除 D-2 外的既往项）。
- **修前基线**：我在 `00568c4` 的树外副本逐条跑过同一套件 → **23 FAIL / 18 PASS（41 例）**，23 FAIL 精确落在 D-1(8)/D-2(7)/EDGE-1(8)，证明用例非空转。

## 3. D-1 混合列表（14/14 PASS）

| 用例 | 修前（`00568c4`） | 冻结 `0d91833` | 判定 |
|---|---|---|---|
| D1-1 `- [x] a\n- b\n- [ ] c` | `- [x] a\n\n- b\n\n- [ ] c`（松散） | 原样紧凑、状态与文本不丢 | **PASS** |
| D1-2 `1. [x] a\n2. b`（ADD-2） | `1. \[x\] a\n2. b`（复选框转义） | `1. [x] a\n2. b` | **PASS** |
| D1-3/D1-4 双向嵌套 | 已紧凑 | 同（+ 归属断言） | **PASS** |
| D1-5 引用块内 `> - [x] a\n> - b` | `> - [x] a\n>\n> - b` | `> - [x] a\n> - b` | **PASS** |
| D1-6 段落分隔=两个列表 | 2 个 ✅ | 2 个 ✅（`topLevelListCount===2`，含 taskList 计数） | **PASS** |
| D1-7 仅空行=同一松散列表 | 1 个 ✅ | 1 个 ✅ | **PASS** |
| D1-8 多段列表项 `- [x] a\n\n  second para\n- b` | 项内空行保留 | 保留（未被紧凑化压平） | **PASS** |
| D1-9（ADD-3 控制） `- a\n\n- b` | `- a\n- b` | **仍为 `- a\n- b`**（既有行为未被改坏） | **PASS** |
| D1-10 `[X]` 状态 | 勾选保留 | 勾选保留（归一为 `[x]`，D-3 允许） | **PASS** |
| D1-11 CRLF 混排 | 松散 | 紧凑 + traits 还原 + 幂等 | **PASS** |
| D1-12/13/14 幂等/三层/后接表格标题 | 松散/丢层级 | 紧凑、层级与状态不丢、不粘连 | **PASS** |

## 4. D-2 嵌套未知标签（契约口径 PASS；严格嵌套口径偏差留痕·待裁决）

| 用例 | 输入 | 冻结实测输出 | 严格期望 |
|---|---|---|---|
| D2-1 | `<em><span>x</span></em>` | `<span>*x*</span>` | `*<span>x</span>*` |
| D2-2 | `<strong><mark>x</mark></strong>` | `<mark>**x**</mark>` | `**<mark>x</mark>**` |
| D2-3 | `<a href="http://u"><kbd>k</kbd></a>` | `<kbd>[k](http://u)</kbd>` | `[<kbd>k</kbd>](http://u)` |
| D2-4 | `<em><strong><span>x</span></strong></em>` | `<span>***x***</span>` | `***<span>x</span>***` |
| D2-6 | `<em><span title="a>b">x</span></em>` | `<span title="a>b">*x*</span>` | `*<span title="a>b">x</span>*` |
| D2-8 | `<EM><SPAN>x</SPAN></EM>` | `<SPAN>*x*</SPAN>` | `*<SPAN>x</SPAN>*` |

**通过的部分（同批）**：D2-5 未知外→标准内 `<span><em>x</em></span>` → `<span>*x*</span>` ✅（与 Lead 给的参照形态一致）；D2-9 **纯标准标签仍转 Markdown**（`<em>x</em>`→`*x*`、`<strong>`→`**`、`<del>`→`~~`）✅ 未回归；D2-10 代码/围栏内字面 ✅；D2-11 兄弟混排 ✅；D2-12 文本不丢 ✅；D2-13 幂等 ✅；**D2-14 集合保全口径**（两标签 + 文本 + mark 全在）✅。

**终态口径说明（2026-09-19 更新，保留上表原始实测）**：本套件最终以**书面契约**断言（未知标签保留 + 标准标签转换 + 文本/mark 不丢 + 幂等）→ **47/47 PASS**；上面「严格期望」一列所代表的**嵌套方向忠实性**属我在对抗推导中提出的**更严读法**，任务描述与 §2.6 的书面条文均未显式要求嵌套顺序，故**不判为任务 FAIL**，而是作为**已记录偏差**留痕（每次运行会打印 `D2-x-FORM` 实际形态，便于持续观察）。**请 Lead 裁决是否需要嵌套忠实**：若需要，dev 把标准标签转换放回外层，我随即恢复严格断言并复跑。

**严格口径对照（不替实现美化也不夸大）**：
- 按**严格口径**（§2.6 + 裁决「内层未知标签原样保留」）→ 6 条 FAIL：未知标签从「内层」被提到「外层」，嵌套方向与源相反；对 `<a>`/`<kbd>` 这类语义标签，DOM 嵌套关系改变（链接在 kbd 内 vs kbd 在链接内）。
- 按**集合保全口径**（标签、属性、文本、Markdown 标记都不丢）→ PASS（D2-14）。
- **请 Lead 裁决**：若接受「未知标签外置」为等价形态，我会把这 6 条改为集合保全断言（并保留实际输出与本次留痕），全量随即归零；若要求嵌套忠实，则 dev 需把标准标签的转换放回外层。

## 5. EDGE-1 / ADD-1 空 frontmatter 与定界符边界（16/16 PASS）

| 项 | 修前 | 冻结 | 判定 |
|---|---|---|---|
| E1-1 空块 `---\n---\n\n正文` | 整篇当正文、双区块 | `content=正文`、block 识别、单区块 | **PASS** |
| E1-2/3/4 空块 + BOM / CRLF / 两者 | 同上 | 识别 + BOM/CRLF traits 保留 | **PASS** |
| **E1-5（我报·发现1-a）** `---\n---\n\n正文\n\n---\n\n更多` | `content="更多"`（**正文被吞**） | 正文与「更多」完整 | **PASS** |
| **E1-6（我报·发现1-b）** `---\n\n正文\n\n---` | `content=""`（**整篇为空**） | 整篇视为正文 | **PASS** |
| E1-7 只有空块 `---\n---` | 双区块（4 条 `---`） | 单区块、`ke_version` 仅一次 | **PASS** |
| E1-8 三条定界符 | 不丢正文 | 同 | **PASS** |
| E1-9 三函数一致性（`frontmatterBlockOf` 块剥离后 == `stripFrontmatter.content`） | 空块不一致 | 一致 | **PASS** |
| E1-10/E1-11 保存后 `ke_version` 恰一次 / 幂等 | 双区块、不幂等 | 通过 | **PASS** |
| E1-12 非空 frontmatter 回归 | — | 通过 | **PASS** |
| **E1-13（我报·FAIL-1）** `---\n\nke_version: 1\n---\n\n正文` | 冻结首版：整篇当正文 → **双 frontmatter 区块** | 识别、`content=正文`、`ke_version` 仅一次 | **PASS（Lead 修复 + 复验）** |
| **E1-14（我报·FAIL-2）** `---\n- a\n- b\n---\n\n正文` | 冻结首版：未识别 | 识别、`content=正文` | **PASS（Lead 修复 + 复验）** |
| E1-15 合法 frontmatter 变体矩阵（注释/多行数组/嵌套映射/块标量/键值含冒号/开闭行尾空格/值含 `---`/闭合后无空行） | — | 8/8 不误拒、正文正确 | **PASS** |
| E1-16 无闭合 `---\ntitle: x\n\n正文` | — | 仍正确地**不**当 frontmatter | **PASS** |

> 归因：E1-13/E1-14 属「**Lead 修复回归 + 已修 + 复验通过**」（Lead 已确认根因是其 ADD-1 规格未写「跳过前导空行」与序列表）；E1-5/E1-6 属「既有内容丢失，被本次 ADD-1 修复消除」。

## 6. 41 构造矩阵 · 修后重测（供 pre.2 规范引用）

- **测量**：`2026-09-19`（同批第二段运行），HEAD `0d91833`，harness `/tmp/ke-verify/fidelity-probe-post120.test.ts`
- **口径**（与 `source-mode.md` §4.1 完全一致）：`stripFrontmatter → normalizeGfmFootnotes → setContent(markdown) → getMarkdown()`；分类 `norm = 去尾换行`（项目 `fidelity-regression` 同口径）
- **扩展栈**：生产同序栈（**含 F-1 的 `TaskList/TaskItem`**；未含 traits 还原，见注记 1）
- **结果**：**`EXACT=0 / TRAILING=24 / CHANGED=17（共 41）`**，原记录 `EXACT=0 / TRAILING=19 / CHANGED=22` → **CHANGED 减少 5**（任务列表、行内 HTML span、HTML 实体、BOM 前缀等由 CHANGED 转 TRAILING）
- **仍 CHANGED 的 17 条（「字符串直存」结论的支撑面）**：合法 ke-note（补默认字段）、ke-attach（补 kind/id/type）、GFM 脚注（定义+引用 / 命名多段）、孤立脚注定义、ke 脚注标记（无定义→转义）、表格 ×3（separator 重写 / 前置空行 / 无首尾管道）、波浪围栏→反引号、缩进代码块→围栏、`1)`→`1.`、引用式链接→行内链接、Setext→ATX、行尾 3 空格→2、CRLF 全文、零宽空格行
- **注记 1**：本矩阵是**正文级**口径（不含 `captureDocTraits/applyDocTraits`）→ 「CRLF 全文」在此表仍记 CHANGED，但**生产保存/导出路径已会还原 CRLF/BOM**（task-34/35），该行不可读作「落盘会丢换行」。
- **注记 2**：harness 扩展栈已更新为当前生产栈；正式附图须注明测量 HEAD、时刻与扩展栈版本，否则「任务列表」等行会因栈差异失真。

## 7. 门禁（实际命令 + 输出）

```
$ npx tsc -b --noEmit                                                 → exit 0
$ npx vitest run <9 个保真套件>
 Test Files  1 failed | 8 passed (9)
      Tests  6 failed | 414 passed (420)        ← 6 failed = D2-1/2/3/4/6/8（本报告 §4）
$ npx vitest run src/editor/fidelity-regression.test.ts \
    src/editor/markdown-roundtrip.test.ts src/editor/plain-export.test.ts
 Test Files  3 passed (3)      Tests  89 passed (89)
$ npx vitest run
 Test Files  1 failed | 54 passed | 1 skipped (56)
      Tests  6 failed | 1053 passed | 1 skipped | 45 todo (1105)
```

- 门槛要求「≥50 files / 920 passed + 1 skipped」→ **56 files / 1053 passed + 1 skipped ✅**（跳过量未增）。
- **唯一失败即 §4 的 6 条 D-2 严格用例**；若 Lead 裁决「未知标签外置」为可接受形态，我改断言后全量归零。
- `pytest` 未复跑（本轮未改后端）。

## 8. 未验证项（如实声明）

| 项 | 原因 |
|---|---|
| D-2 在**真实浏览器**中的渲染差异（`<span>*x*</span>` vs `*<span>x</span>*` 的 DOM 嵌套与 CSS 继承） | 未做浏览器截图/计算样式对照；我只比较 Markdown 文本形态 |
| `KeBlockJoin` 对**表格单元格内列表**、**多级引用块**的组合行为 | 未纳入本轮用例（表格单元格的列表序列化支持面外） |
| 源码模式（pre.2）通道与本次三个修复的交互 | 不在 task-40 范围；该通道仍在飞 |
| `pytest` / cargo | 本轮未改后端与桌面侧 |

## 9. 结论与建议

1. **D-1 ✅**：混排紧凑、状态与文本不丢、结构反例（两个列表 / 同一松散列表）与 ADD-3 控制项均正确；ADD-2 有序任务项已修。
2. **EDGE-1/ADD-1 ✅**：空块全变体识别；我报出的两例**内容丢失**（吞正文 / 整篇为空）已消除；我报出的**过度收紧**（FAIL-1/2）已修并复验；合法 frontmatter 变体矩阵不误拒。
3. **D-2 ✅ 契约口径通过 / ⚠️ 严格口径偏差待裁决**：未知标签保留、标准标签转换、文本与 Markdown 标记不丢、幂等 —— 全部满足书面契约；唯一偏差是**嵌套方向反转**（未知标签外置，`<span>*x*</span>`）。我按书面条文判 PASS 并把偏差留痕（每次运行打印实际形态）；**若 Lead 要求嵌套忠实，改完给我 sha，我立即恢复严格断言并复跑**。
4. 41 矩阵已重测并附两条方法学注记，可直接替换 `source-mode.md`/规范里的「待重测」措辞。
5. 若再改本批文件，复跑范围：`fidelity-fixes-120.verify.test.ts`（47 例）+ `fidelity-constructs.verify.test.ts` + 三回归面 + `tsc`。
