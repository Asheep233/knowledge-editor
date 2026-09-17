# 独立验证报告：F-S1-4 修复（过期 timeout / 恢复点 id-内容配对 / 不减少正常登记）—— task-20

**结论：PASS**（验证员套件 **34/34 passed、0 skipped**；全量 **38 files / 540 passed + 1 skipped**；tsc exit 0；修复前 7 例基线中的 DS6/DS7 **不再复现**；范围无越界、无临时 harness 残留）
**gate 已按 lead 硬要求翻正**：`F_S1_4_LANDED: false → true`，最终态 skip=1，G/I 组由 skip 转实跑（前后对照见 §2）。

- **验证者**：`verifier`（独立于 task-19 实现者 dev-attach-ui；未修改任何被验证源码）
- **HEAD**：`036003d`（F-S1-4 改动为工作树未提交态，以 lead 冻结 sha 为准）
- **时刻**：跑前冻结 sha 复算 + 翻 gate = `2026-09-17T01:52:03Z`；全部用例与 run-end sha 复算 = `2026-09-17T02:02:06Z`（本机时区 UTC+8）
- **环境**：WSL2 / Node 24.19.0 / vitest 4.1.11 / happy-dom
- **验证员产物**：`frontend/src/state/docSwitch.verify.test.ts`（34 例：原 18 + H3 + G3 + I3 + J7）、本报告；树外修复前基线轨 `/tmp/ke-verify/editorarea-docswitch.test.tsx`（7 例）

## 0. 冻结修订（验证者自行复算，跑前/跑后一致）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `frontend/src/components/layout/EditorArea.tsx` | `6e71d96960b2b94a589f90e03d820d5be212cb6c3756c6f7d5d9dbe8663c3f1f` |
| `frontend/src/state/docSwitch.ts` | `bb7bf912b2f5ca636d40038b7f20c74ee36f15bcecbc0a049446c1d0b3926f15` |
| `frontend/src/state/docSwitch.test.ts`（开发者） | `0945835cb5859ddfb961e57f463dc04e883d6562b4b693ffc0cd3125bb72f47b` |
| （验证员）`frontend/src/state/docSwitch.verify.test.ts` | `11cc0db7263694c75d6f0326f0f43ac45b1c52717df5673404cf6cfbdc20cf94` |

> 3 个冻结 sha 与 lead 给出的值逐字一致；全部运行结束后再次复算，**无一变化**。

## 1. 结论摘要

| 验证面 | 结论 | 证据 |
|---|---|---|
| gate 翻转 + skip 回落 | **PASS** | §2：我的文件 21p/6s → **34p/0s**；全量 7 skip → **1 skip** |
| `[DS6]` 过期 timeout 回归（G1） | **PASS** | §3：80ms 到点后编辑器仍为 C；UI 不停「正在解析大文档」；C 最终载入 |
| `[DS7]` id-内容配对回归（G2 + G4 + I1/I2/I3） | **PASS** | §4：组件观测级 + 缝级 18 组矩阵 + 判别性；无「C 的名义 + B 的正文」 |
| 正常登记不减少（H1） | **PASS** | §5：2999/3000ms 两窗口各 1 次、payload 属当前文档 |
| `createDeferredLoader` 代次语义（J1–J7） | **PASS** | §5：clearTimeout 失效靠代次、cancel 后到点无效、latest-wins、卸载清理 |
| 顺序不变量不回归（C1–C3） | **PASS** | §6（原 18 例判据未改、全绿） |
| tsc / 全量 vitest | **PASS** | §2：tsc exit 0；38 files / 540 passed + 1 skipped |
| 修复前基线前后对照 | **PASS** | §3/§4：DS6/DS7 的「缺陷断言」不再成立；DS1–DS5 仍通过 |
| 范围 + 临时 harness 残留 | **PASS** | §7：仅 dev 三文件 + 我的文件；`__tmp_dev_fs14.test.ts` 不存在 |

---

## 2. 回归底线与 gate 前后对照

```
$ cd frontend && npx tsc -b --noEmit ; echo "TSC_EXIT=$?"
TSC_EXIT=0

$ npx vitest run src/state/docSwitch.verify.test.ts --reporter=verbose
 Tests  34 passed (34)                     # G/H/I/J 全部实跑，0 skipped

$ npx vitest run
 Test Files  38 passed (38)
      Tests  540 passed | 1 skipped (541)
```
**gate 前后对照**（本文件实测 + dev 自报全量口径）：

| 状态 | `docSwitch.verify.test.ts` | 全量 vitest |
|---|---|---|
| `F_S1_4_LANDED=false`（第一段，gate 中） | 21 passed / **6 skipped**（27） | dev 报 527 passed / 7 skipped |
| `F_S1_4_LANDED=true`（冻结后，本报告） | **34 passed / 0 skipped** | 我实测 **540 passed / 1 skipped** |

- 翻转即「G1/G2/G4 + I1/I2/I3 由 skip 转实跑」；skip 由 **7 → 1**（仅剩既有基线那 1 例）。
- 540 = 527（dev 基线）+ 6（G/I 转实跑）+ **7（本轮新增 J 组：`createDeferredLoader` 语义）**；1 skipped 为既有 skip，未变。
- **gate 未留在 false 入库**（符合 lead 硬要求）。

---

## 3. `[DS6]` 回归：过期 timeout 不再改动编辑器/UI

**G1（组件级，冻结版实跑通过）**：`A → B(>200KB，80ms 载入中) → 10ms 后切 C → 推进 200ms`：
- 断言切到 C 后编辑器内容 = `'# C-disk'`；
- **80ms 到点后编辑器仍为 `'# C-disk'`**（且 `startsWith('B-BODY-') === false`）；
- 断言 DOM 不含「正在解析大文档」占位（`parsingLarge` 未被旧 timeout 改动、未漏清）；
- 断言新文档最终正常载入（不能因加守卫而漏载）。

**修复前基线轨（/tmp，7 例）重跑前后对照**：
```
task-18（修复前）：[DS6] C 载入后 md = # C-disk | 80ms 后 md = B-BODY-xxxxx   ← 覆盖发生
本次（冻结版）    ：[DS6] C 载入后 md = # C-disk | 80ms 后 md = # C-disk      ← 覆盖消失
```
```
 Tests  2 failed | 5 passed (7)
 ✗ DS6（其断言是「覆盖必须发生」——现在不成立 → 缺陷已修）
 ✗ DS7（其前置是「编辑器承载 B」——现在不成立 → 破坏态不可构造）
 ✓ DS1 切档 A 的编辑落 A 路径 / ✓ DS2 A→B→A 无串写 / ✓ DS3 无编辑零 PUT / ✓ DS4 reloadToken 零 PUT / ✓ DS5 首挂载零 PUT
```

**源码级接线（冻结 sha）**：
```
109-110  const deferredLoadRef = useRef<DeferredLoader|null>(null); 懒创建 createDeferredLoader()
269      useEffect(() => () => { deferredLoadRef.current?.cancel() }, [])      // 卸载清理
427      deferredLoadRef.current?.schedule(() => { setKeContent(...); editorDocIdRef.current = article.id; setParsingLarge(false) })  // 大文档延迟分支
435      deferredLoadRef.current?.cancel()                                       // 立即载入分支：先作废未决延迟
442      deferredLoadRef.current?.cancel()                                       // article=null 分支
```

---

## 4. `[DS7]` 回归：恢复点 id 与内容永远同源

**G2（组件级）**：DS6 序列 + 编辑 + 推进 3s/超 autosave：
- 断言**不存在**「`doc_path=C` 而内容含 `B-BODY-`」的登记；
- **反向断言**：该序列必须**仍然登记 C**（`length > 0`）且内容含 `C-BODY-用户输入` → 安全修复不得变成「静默不登记」（S-1 语义回退）。

**G4（组件观测级配对矩阵）**：4 场景（正常编辑 / 切档完成 / **切档中：articleRef 已新、编辑器仍载旧文档** / 同档 reloadToken），对**每一条**恢复点登记断言 id 与内容同源（A/B/C 内容 marker 交叉检查）；并断言正常态 A、B、C **各自都登记过**。

**I 组（缝级矩阵，`resolveRecoveryTarget`）**：
- **I1**：`editorDocId × articleDocId × 有/无内容` = 3×3×2 = **18 组全跑**（用例内断言 `checked === 18`，防空转）：
  `editorDocId=null` 或内容 null → 放弃（null）；否则 `{docId: editorDocId, md}`；错配窗口绝不挂 `articleDocId` 名下。
- **I2 判别性（非空测试）**：把修复前组合（`articleDocId + 编辑器内容`）作反例，断言新旧结果**可区分**：
  `neu = {docId:'Articles/B.md', md:'B-BODY'}` vs `legacy = {docId:'Articles/C.md', md:'B-BODY'}` → `neu.docId !== legacy.docId`。
- **I3**：错配窗口仍按编辑器实际载入文档登记（同源）；仅「未载入/内容不可用」才 null。

**源码级接线**：`EditorArea.tsx:247-256` 的 `flushDraftRecovery` 已改为
`resolveRecoveryTarget({ editorDocId: editorDocIdRef.current, articleDocId: articleRef.current?.id ?? null, editorMarkdown: ed ? withFrontmatter(ed.getMarkdown(), KE_VERSION) : null })` → `null` 则放弃，否则 `registerRecoveryPoint(target.docId, target.md)`。
即：**id 与内容同源于 `editorDocIdRef`**，`articleDocId` 仅作诊断（不再参与配对）。

> 诚实边界：修复后「错配窗口」在组件路径上已不可构造（G2 只能验证终态正确），因此**守卫分支本身**由缝级 I1/I3 直接覆盖；两者互为交叉验证。

---

## 5. `createDeferredLoader` 代次语义（J1–J7）与「不减少登记」

| 用例 | 构造 | 断言 | 结果 |
|---|---|---|---|
| J1 | 注入 timers 且 `clearTimeout` **故意不真清**（回调仍入队） | 连续 2 次 schedule 后全部到点 → 仅最新一代执行（旧代次被守卫拦下） | ✓ |
| J2 | `cancel()` 后回调**仍到点** | 不得执行；`generation()` 自增 | ✓ |
| J3 | 连续 3 次 schedule | 只有最新生效、恰好一次 | ✓ |
| J4 | 正常路径 | 自定义/默认 `delayMs` 传给宿主（默认 = `DEFERRED_LOAD_MS`=80）、到点执行一次、代次自增 | ✓ |
| J5 | 卸载清理 | `cancel()` 必须调用 `clearTimeout` 且队列清空 | ✓ |
| J6 | `cancel()` 后重新 schedule | 不永久禁用，新代次正常执行 | ✓ |
| J7 | 「上一篇 B」与「切到 C 的新载入」两次 schedule 都到点 | 编辑器最终只被最后一次改动（防旧篇覆盖） | ✓ |

**H1 不减少登记**：连续编辑 + 2999ms（不登记）→ 3000ms（恰好 1 次，payload 属当前文档）→ 第二窗口再 1 次且内容为最新。与 task-17 基线一致，**未见减少**。

---

## 6. 顺序不变量不回归

原 18 例全部保留并实跑通过，其中 C1–C3 直接锁住「拍快照 → `flushPending` → `cancelDraftTimer`」顺序：
- C1 事件序 `[flush:prevId, cancelDraftTimer]`；
- C2 `flush` 回调内快照已就绪；
- C3 `flush` 期间 cancel 尚未发生。
B1–B4（串写矩阵/序列）、D1–D4（不拍快照边界）、E1–E3（容积/LRU）亦全绿——判据未删改、未弱化。

---

## 7. 范围核对

```
$ git status --porcelain
 M frontend/src/components/layout/EditorArea.tsx
 M frontend/src/state/docSwitch.test.ts
 M frontend/src/state/docSwitch.ts
 M frontend/src/state/docSwitch.verify.test.ts
?? docs/verification-f-s1-4.md            # 本报告（验证员产物）
$ ls frontend/src/state/__tmp_dev_fs14.test.ts
ls: cannot access '…/__tmp_dev_fs14.test.ts': No such file or directory
```
- 修改面 = task-19 的三个文件 + 我的验证文件（`docSwitch.verify.test.ts`）+ 本报告（新）✓
- `App.tsx` / `state/draftDebounce.ts` / `state/saveQueue.ts` **未改动** ✓
- dev 报备的临时自检 harness **无残留** ✓

---

## 8. 归因（本次引入 vs 既有）

| 项 | 归因 |
|---|---|
| 过期 timeout 覆盖编辑器（DS6） | **既有缺陷**（task-18 由我证实）→ 本轮修（代次守卫 + cancel 双保险） |
| 恢复点 id/内容错配（DS7） | **既有缺陷**（task-18 由我证实）→ 本轮修（`resolveRecoveryTarget` 同源裁决） |
| F-S1-2 切档快照语义 | task-17 引入/修复 → 本轮回归 H2 通过，**未回归** |
| 正常登记次数/payload 归属 | 与 task-17 基线一致（H1），**未减少** |
| 未发现本轮引入的新缺陷/新数据完整性缺口 | — |

---

## 9. 未验证项（明确列出，无推测结论）

| 项 | 原因 |
|---|---|
| 真实 Tiptap/浏览器/WebView2 下的时序 | 组件轨使用 mock 编辑器门面 + stub fetch；`setKeContent` 瞬时，真实 >200KB 解析（7–14s）会改变 80ms 窗口的阻塞/时序 |
| 真实事件循环中「clearTimeout 已失效、回调已入队」的竞态 | 用可注入 timers 手工队列精确构造（正是该 seam 的契约面）；未在真实浏览器事件循环里复现同一交错 |
| 组件路径上的「错配窗口」守卫分支 | 修复后该窗口不可构造；守卫由缝级 I1/I3 覆盖（交叉验证），组件级只能验证终态 |
| 多窗口/多标签、并发保存 | 未构造 |
| 真实崩溃-重启-恢复闭环 | 需真实进程；仅验证登记内容层面的同源不变式 |
| dev 的 `docSwitch.test.ts` 21→N 例的逐条判据 | 我只独立复核其**通过性**（全量绿），未逐条审其断言强度（不在我的验证对象内） |

---

## 10. 复现命令

```bash
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit                                   # exit 0
npx vitest run src/state/docSwitch.verify.test.ts     # 34 passed (0 skipped)
npx vitest run                                        # 38 files / 540 passed + 1 skipped

# 修复前基线轨（树外；其 DS6/DS7 断言「缺陷必须发生」现已不成立 → 前后对照）
cd /tmp/ke-verify && npx --prefix "/mnt/f/Work/KE Project/knowledge-editor/frontend" \
  vitest run editorarea-docswitch.test.tsx            # 5 passed | 2 failed（DS6/DS7 = 缺陷消失）
```
