# 独立验证报告：F-S1-2 修复（切档内容快照恒假）—— task-18

**结论：PASS**（独立套件 18/18、组件级行为轨 7/7、判别性证明成立、接线四点逐点核实、回归 38 files / 512 passed + 1 skipped、tsc 0、范围无越界）
**另单列**：① 既有缺陷「>200KB 80ms 过期 timeout 覆盖编辑器」**证实**（非本轮引入）；② 其下游暴露「S-1 草稿登记在破坏态下以 C 的名义记录 B 的内容」**证实**（非本轮引入）；③ 新「放弃保存」分支在正常生产路径**不可达**，仅在上述既有缺陷破坏态下可达。

- **验证者**：`verifier`（独立于 task-17 实现者 dev-attach-ui；未修改任何源码）
- **HEAD**：`23ea588`
- **时刻**：run-start `2026-09-17T01:32:05Z` → run-end `2026-09-17T01:38:20Z`（UTC）
- **环境**：WSL2 / Node 24.19.0 / vitest 4.1.11 / happy-dom
- **验证员产物**：`frontend/src/state/docSwitch.verify.test.ts`（18 例）、本报告；
  补充树外组件轨（不入仓库）：`/tmp/ke-verify/editorarea-docswitch.test.tsx`（7 例）

## 0. 冻结修订（验证者自行复算，跑前/跑后一致）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `frontend/src/components/layout/EditorArea.tsx` | `66b7dc3d0b38d1fc5cd77a07630d2ce66ae5b34ce7e2ec72abd8bf106c592bff` |
| `frontend/src/state/docSwitch.ts` | `d87313a7e981f6398ab650b5b3f7b7806fb0ac2ae4021399393f0fe7f59caa92` |
| `frontend/src/state/docSwitch.test.ts`（开发者） | `bf813c83423656eae8b40a53eaa5db8345de4c2e2048a2741fabba915c71aafe` |

> 与 Lead 冻结值逐字一致；全部运行结束后再次复算，3 个文件哈希**无一变化**。

## 1. 结论摘要

| 验证面 | 结论 | 证据 |
|---|---|---|
| 判别性 / 非空性（最高优先） | **PASS** | §3：旧判据 → null；新语义 → A 内容；两者可区分（A3 自检） |
| 串写不变量（F14 红线） | **PASS** | §4：矩阵 12 组 + A→B→A + 连切 3 篇 + 组件级 DS1/DS2 请求日志 |
| 顺序不变量（快照→flush→cancel） | **PASS** | §5：C1–C3（flush 回调内快照已就绪、cancel 未发生） |
| 不拍快照条件（null / 同档 / 未载 prevId） | **PASS** | §6：D1–D4 + DS3/DS4/DS5（零 PUT） |
| 容积上限 / LRU | **PASS**（残余单列） | §7：E1（≤16、最旧驱逐）、E2（LRU 刷新）、E3（残余演示） |
| 接线四点 | **PASS** | §8：逐点行号 + 先后顺序 |
| 回归底线 | **PASS** | §2：tsc 0；38 files / 512 passed + 1 skipped |
| 改动范围 | **PASS** | §9：仅 task-17 三文件（+ 验证员文件）；`App.tsx`、`draftDebounce.ts` 未改 |
| 既有缺陷：>200KB 过期 timeout | **证实（既有）** | §10：DS6 实测 |
| 新「放弃保存」分支生产可达性 | 正常路径不可达 | §11：分析 + 证据 |

---

## 2. 回归底线（实测）

```
$ cd frontend && npx tsc -b --noEmit ; echo "TSC_EXIT=$?"
TSC_EXIT=0

$ npx vitest run src/state/docSwitch.verify.test.ts      # 验证员套件
 Tests  18 passed (18)

$ npx vitest run src/state/docSwitch.test.ts             # 开发者套件（独立跑一次）
 Tests  21 passed (21)

$ npx vitest run                                          # 全量
 Test Files  38 passed (38)
      Tests  512 passed | 1 skipped (513)
```
**对账**：既有基线 473 passed + 1 skipped，本轮 + dev 21 + 验证员 18 = **512**，skip 仍为 **1**，只增不减 ✓
（旁证：dev 自报 511 对应我加 E3 之前的 17 例，口径一致。）

---

## 3. 判别性 / 非空性（最高优先）

**A1 旧语义**（`articleRef.current?.id === prevId`，切档时为 false）→ 不拍快照 → `resolveSaveContent` 返回 **null**（保存被放弃）。
**A2 新语义**（`editorDocId === prevId`）→ 拍到 `A-BODY` → 返回 **A 的内容**。
**A3 判别性自检**：同一组输入下断言 `legacy === null`、`neu === 'A-BODY'` 且 `legacy !== neu`；两边等价即 FAIL（防空测试）。

```
$ npx vitest run src/state/docSwitch.verify.test.ts -t "判别性"
 ✓ A1 旧语义 → null / ✓ A2 新语义 → A 内容 / ✓ A3 旧≠新（可区分）
```
**旁证（修复前实测，来自我 task-3 的独立轨，非本次复算）**：旧实现下 `A 编辑→切 B` 的可观测结果是
`[T5] A 落盘 = false | A 登记恢复点 = false`（旧文档最后 <3s 编辑既不落盘也不登记）；
新实现在同一场景下必须出现指向 A 的 PUT（§4 DS1）——**同一场景、可区分的结果**，判别性成立。

---

## 4. 串写不变量（F14 红线）

- **B1 全矩阵**：`docId∈{A,B} × currentDocId∈{A,B} × 快照∈{∅,{A},{B}}`（12 组）逐组断言：
  `docId===currentDocId` → 实时内容；否则 → 该 docId 的快照；无快照 → `null`；
  并对每组 `docId≠currentDocId` **显式反向断言** `result !== 'EDITOR-BODY'`（绝不串写）。
- **B2** A→B→A：写盘序列严格 `[(A,'A-BODY'), (B,'B-BODY'), (A,'A-BODY-2')]`。
- **B3** A→B→C→D：三次 flush 各用各自快照。
- **B4** 无快照 + 非当前文档 → `null` 且 `not.toBe(编辑器内容)`；有旧快照 → 用旧快照。
- **组件级（真实 EditorArea + 真实 docSwitch/saveQueue，树外轨）**：
  ```
  [DS1] 请求 = POST /api/drafts/recovery | PUT /api/articles/Articles%2Fa.md | DELETE /api/drafts/recovery/Articles%2Fa.md
        → A 路径的 PUT 内容含 '# A-编辑中'，不含 '# B-disk'；A 的恢复点内容同为 A 的编辑
  [DS2] A→B→A → A 路径历次 PUT 均不含 B 内容；B 路径历次 PUT 均不含 A 内容；A1 已落盘
  ```
  DS1 的请求序列同时证明：切换后先行登记 A 的恢复点 → PUT A → 清除（S-1 链路与 F-S1-2 快照协同正常）。

---

## 5. 顺序不变量

- **C1** 事件序列必须 `[flush:prevId, cancelDraftTimer]`；
- **C2** 在 `flushPending` 回调内部读取 `snapshots.get(prevId)` 必须已是**本次**内容（快照先于 flush）；
- **C3** flush 期间 `cancel` 尚未发生（cancel 在 flush 之后）。
```
 ✓ C1 事件序 / ✓ C2 flush 时快照已就绪（=A-BODY） / ✓ C3 flush 期间 cancel 未发生、结束后已 cancel
```
源码一致性：`docSwitch.ts:73-91` — 先写快照（含 LRU 刷新）→ `flushPending(prevId)` → `cancelDraftTimer()`。

---

## 6. 不拍快照的条件

```
 ✓ D1 prevId=null（首挂载）→ 无快照 / 无 flush / 无 cancel
 ✓ D2 prevId===newId（reloadToken 同档重载）→ 无快照 / 无 flush / 无 cancel
 ✓ D3 editorDocId≠prevId（编辑器未载 prevId）→ 不拍快照；若仍 flush 则内容不得是当前编辑器内容（实测 null）
 ✓ D4 首挂载后再切档 → 第二次起才拍
```
组件级：`[DS3] 请求 = []`（切档但旧档无编辑，不产生 PUT）、`[DS4] 请求 = []`（reloadToken）、`[DS5] 请求 = []`（首挂载）。

---

## 7. 容积上限 / LRU

```
 ✓ E1 连续 17 次切档 → size ≤16、d00 被驱逐、d16 保留
 ✓ E2 刷新同一 key（l00）后新增一条 → 驱逐 l01（最旧），l00 保留且内容为刷新值
 ✓ E3 残余演示：X 的快照被驱逐后，对 X 的延迟 flush → resolveSaveContent 返回 null
```
**E3 的生产可达性判断（不夸大）**：正常切档时 `flushPending(prevId)` 会在同一次同步 drain 内立即消费快照，不存在窗口；要触发「已驱逐又被延迟 flush」，需要**单次在途 PUT 往返期间完成 ≥17 次切档**（才凑满 LRU 驱逐）且该 doc 在途中仍有 latest-wins 第二棒排队。属**理论残余、实际不可达的低风险**，仅作留痕。

---

## 8. 接线四点（冻结 sha 逐点证据）

`grep -n "editorDocIdRef.current = \\|setKeContent(" EditorArea.tsx`（冻结修订）：
```
302:              setKeContent(ed, savedBody)
305:              editorDocIdRef.current = docId
411:          setKeContent(editor, body)
413:          editorDocIdRef.current = article.id
418:        setKeContent(editor, body)
420:        editorDocIdRef.current = article.id
559:        setKeContent(editor, stripFrontmatter(doc.content).content)
```
| # | 载入点 | 证据 | 判定 |
|---|---|---|---|
| 1 | 常规切档分支 | `411 setKeContent` → **紧接** `413 ref = article.id` | ✅ 内容先载入、ref 后更新 |
| 2 | >200KB 80ms 延迟分支 | `418 setKeContent` → `420 ref = article.id`，**两者都在 `window.setTimeout(..., 80)` 回调内** | ✅ 顺序正确（内容真正载入后才更新 ref） |
| 3 | reloadToken 外部重载 | 走**同一个**切档 effect（`[article?.id, reloadToken]`）；`prevId===newId` → `onDocumentSwitch` no-op，随后 `411-420` 更新 ref | ✅ 覆盖 |
| 4 | F15 保存后对齐 | `302 setKeContent(ed, savedBody)` → `305 ref = docId`，且仅在 `isCurrent && latest && ed && 内容不一致` 时进入 | ✅ 覆盖 |
| 附 | 首挂载 | effect 以 `prevId=null` 运行 → 不拍快照；随后 `411-420` 载入并更新 ref（初始 ref=null） | ✅ 无缺口 |
| 附 | 历史版本恢复 `559` | `restoreHistory(article.id, …)` 是**同文档**版本恢复（id 不变）→ ref 语义不变，无需更新 | ✅ 无缺口（按调用上下文核对，非推测：`doc.id` 来自同一 `article.id` 请求） |

**结论：四点全覆盖，无漏点。**

---

## 9. 改动范围核对

```
$ git status --porcelain
 M frontend/src/components/layout/EditorArea.tsx
?? frontend/src/state/docSwitch.test.ts
?? frontend/src/state/docSwitch.ts
?? frontend/src/state/docSwitch.verify.test.ts
```
`App.tsx`、`state/draftDebounce.ts`、`state/saveQueue.ts`、后端、desktop **均未改动** ✓

---

## 10. 【既有缺陷，单列】>200KB 80ms 过期 timeout 覆盖编辑器 —— **证实**

组件级构造（树外轨 DS6）：`A(小) → B(>200KB，进入 80ms 延迟分支) → 10ms 后切到 C → 200ms 后观察`：
```
[DS6] C 载入后 md = # C-disk | 80ms 后 md = B-BODY-xxxxx | 期望 C = # C-disk
 ✓ DS6（断言：过期 timeout 确实覆盖了编辑器内容）
```
**证实**：切换后未被清除的 B 延迟 timeout 仍执行 `setKeContent(B 的正文)`，把编辑器内容换成 B（UI 显示 C）。
**归因**：本缺陷与本次修复**无关**（延迟分支与 `setKeContent` 时序在 task-17 前即如此）；修复只是在延迟分支里**额外**同步了 ref（`420`），未消除覆盖本身。**建议 backlog 登记**（切档时清理上一个延迟 timeout / 用代次令牌守卫）。

**新实现是否让它产生串写？** ——**save 路径没有串写**（dev 声明成立），但**S-1 草稿登记路径会**（见 §11-B）。

---

## 11. Lead 关注点 1：新「放弃保存」分支的可达性

分支定义（`EditorArea.tsx:271-280`）：`editorDocId = editorDocIdRef.current`；只有 `editorDocId === docId` 才取实时内容，否则取快照；**无快照 → `md === null` → `return`**（不 save、不 `registerRecoveryPoint`）。

**A. 正常生产路径：不可达（证据充分）**
- 不变式：正常态下 `editorDocId` 恒等于当前文档 id（接线四点保证，且每次载入都同步）。
- 切档 A→B 时 `prevId=A`、`editorDocId=A` → `docSwitch` **先**写 A 的快照 **再** `flushPending(A)`，drain 同步消费 → 不会出现「无快照」。
- 组件级证据 DS1/DS2：A 的未决编辑全部落到 A 的 PUT（旧实现下为 0 次 PUT）。
- 矩阵 B1/B4：只有 `docId≠currentDocId && 无快照` 才 null；该组合在正常切档流程中被「先拍快照」排除。

**B. 既有缺陷破坏态：可达（单列，非本轮引入）**
破坏态 = §10 的过期 timeout 已把编辑器换成另一篇文档（`editorDocId=B`，当前文档=C）：
```
[DS7] 请求 = ["POST /api/drafts/recovery"]
       → ① C 的 PUT = 0（save 路径挡住串写，dev 声明成立）
       → ② 但出现 1 条以 C 名义的恢复点，内容前 40 字 = ---\nke_version: 1\n---\n\nB-BODY-xxxxxxxxxx
```
- **save 路径**：放弃（无 PUT）——这正是 F14 红线要的取舍：**宁可少一次保存，也不把 B 的内容写进 C 的路径**。
- **S-1 草稿登记路径**（`flushDraftRecovery` 用 `articleRef.current.id` + 编辑器实时内容，**未经 `editorDocId` 守卫**）：以 C 的名义登记了**含 B 正文**的恢复点。若此后崩溃并由用户「恢复」，会把 B 的内容写回 C 的路径 → **跨文档内容污染**。该路径未被 task-17 改动，根因是 §10 既有缺陷。
- **新增静默丢字？**：在**正常路径没有**；仅在破坏态下，save 被放弃（同时 S-1 仍留下一条被污染的恢复点，故不是完全无痕，但内容不可用）。
- **建议（不属本轮修复范围）**：① 修复 §10 的过期 timeout（根因）；② `flushDraftRecovery` 增加 `editorDocIdRef.current === doc.id` 守卫，与 save 路径同源。

**C. LRU 驱逐后再 flush 旧 doc**：见 §7 E3 —— **理论残余、实际不可达**（需单次 PUT 往返内 ≥17 次切档）。

**判定**：新放弃分支**不构成正常生产路径的新静默丢字** → 不判 FAIL；残余与根因如上登记。

---

## 12. 未验证项（明确列出，无推测结论）

| 项 | 原因 |
|---|---|
| 真实 Tiptap/浏览器/WebView2 时序 | 组件级轨用 **mock 编辑器门面 + stub fetch**（`setKeContent` 瞬时）；未挂载真实编辑器（真实解析 >200KB 需 7–14s，会显著改变 80ms 窗口的时序与阻塞行为） |
| 真实大文档下 §10 缺陷的完整表现 | 同上：mock 下 `setKeContent` 不阻塞、不产生真实解析；只证实了「过期 timeout 仍会执行并覆盖」这一机制 |
| LRU 驱逐的真实端到端可达性 | 仅做机制演示（E3）+ 推理；未构造真实「17 次切档挤进一次 PUT 往返」 |
| 多窗口/多标签、并发保存 | 未构造 |
| App 层联动（`requestOpenArticle` 前置 flush 与切换的交互） | 我是驱动 `EditorArea` 单组件；App 侧路径在 task-16 已单独核验过 |
| 真实崩溃-重启-恢复闭环 | 需真实进程；仅验证了恢复点登记内容层面 |

---

## 13. 复现命令

```bash
# 验证员套件（仓库内，18 例）
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx vitest run src/state/docSwitch.verify.test.ts
npx vitest run src/state/docSwitch.test.ts        # 开发者 21 例
npx tsc -b --noEmit                               # exit 0
npx vitest run                                    # 38 files / 512 passed + 1 skipped

# 组件级行为轨（树外，7 例；mock 编辑器 + stub fetch）
cd /tmp/ke-verify && npx --prefix "/mnt/f/Work/KE Project/knowledge-editor/frontend" vitest run editorarea-docswitch.test.tsx
```
