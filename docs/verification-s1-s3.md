# 独立验证报告：S-1 草稿恢复点防抖 + S-3 附件保留原名（task-3）

- **验证者**：`verifier`（独立于 task-1 实现者 lead、task-2 实现者 dev-attach；未修改任何被验证源码）
- **验证对象（冻结修订）**
  - S-1：`d8c0e61c40d56a807f2f8bb9d9bfa5f4f86d8f95`（含 `fc98a98` + 中止路径修复）
  - S-3：`1bb00a6e39611e0c6142481376658f579116492f`；`backend/app/routers/attachments.py` sha256 `fb1d1929c33d1bb730c21e2f9d17faf3d98283ccc9e3c4854aa504d08ee8597e`
  - 提交关系核对：`git diff --stat d8c0e61..1bb00a6` 仅含 backend（S-1 前端代码未被后续提交触及）
- **运行环境**：WSL2 / Python 3.14.4 / Node 24.19.0 / pytest 8.4.2 / vitest 4.1.11 / happy-dom
- **验证员产物**：`backend/tests/test_attach_naming_verify.py`（102 用例）、本报告
- **树外辅助轨（非仓库产物，命令见正文）**：`/tmp/ke-verify/{module-semantics.mjs, editorarea-s1.test.tsx, perf-serialize.test.ts}`
- **原则**：只报亲自跑出的结果；推测一律标注「未验证 + 原因」。

---

## 0. 结论摘要

| 验证项 | 结论 | 关键证据 |
|---|---|---|
| S-1 行为契约（≤3s 登记 / 保存成功清除 / 无孤儿 / 无串档 / 无泄漏） | **PASS** | §3.2 集成轨 9 项；§3.3 缺陷已修复复验 |
| S-1 性能（问题 4） | **PASS（有代价，已量化）** | §3.6；无每击键序列化；每 3s 一次 31–105 ms |
| S-3 路径穿越 / 越界写入 | **PASS** | §4.2–4.4：28+36+10 组 payload，父目录快照 + 双实现交叉扫描 + 金丝雀全绿 |
| S-3 原名保留 / 同名冲突 / 并发 | **PASS** | §4.5：CJK/空格/大小写保留；`Report.pdf`→`report-1.pdf`；8×3 并发无覆盖无丢失 |
| S-3 白名单 / 配额 / 半成品清理 / 内联策略 | **PASS** | §4.6 |
| 回归底线 pytest / vitest / tsc | **PASS** | §2：314 passed + 2 skipped / 262 passed + 1 skipped / 0 错 |
| 遗留：F-S1-2（F14 死分支，非 S-1 引入） | 不影响 S-1 结论 | §3.4 |
| 遗留：F-S1-3（abort 分支 cancel 语义过宽） | 当前不可达，建议加 `isCurrent` 守卫 | §3.5 |
| 遗留：W-S3-1/2/3（符号链接碰撞 400、前导点、尾点 400） | 非安全缺陷，观察项 | §4.9 |

**总判定：S-1 通过；S-3 通过。** 无可利用的路径穿越/越界写入/覆盖写入；无回归。

---

## 1. 冻结修订与写入边界

```
$ cd "/mnt/f/Work/KE Project/knowledge-editor" && git log --oneline -3 && git status --short
1bb00a6 feat(1.1.8/S-3): 附件上传保留原始文件名（含路径穿越防护 + 大小写不敏感去重）
d8c0e61 fix(1.1.8/S-1): R2 中止路径漏清未保存标记 → 产生与磁盘同内容的孤儿草稿
fc98a98 feat(1.1.8/S-1): 草稿恢复点扩展到编辑防抖——硬崩溃丢失窗口从「无界」收敛到 3s
?? backend/tests/test_attach_naming_verify.py
```

验证期间未修改 `backend/app/**`、`frontend/src/**`、`desktop/**`；仅新增 `backend/tests/test_attach_naming_verify.py` 与本报告。

---

## 2. 回归底线（实测）

```
$ cd backend && python3 -m pytest -o addopts="" -q -p no:warnings
314 passed, 2 skipped in 10.12s

$ cd frontend && npx tsc -b --noEmit ; echo "TSC_EXIT=$?"
TSC_EXIT=0

$ cd frontend && npx vitest run
 Test Files  26 passed (26)
      Tests  262 passed | 1 skipped (263)
```

| 口径 | 任务书基线 | 本次实测 | 对账 |
|---|---|---|---|
| pytest | 175 passed / 2 skipped | 314 passed / 2 skipped | 175 + 37（dev 的 `test_attach_naming.py`）+ 102（本验证文件）= 314 ✔ |
| vitest | 247 passed + 1 skipped | 262 passed + 1 skipped | 247 + 15（S-1 新增 `draftDebounce.test.ts`）= 262 ✔ |
| tsc | 0 错 | 0 错 | ✔ |

> 口径说明（自查纠错）：14:10 我首次采集前端「基线」时得到 262 passed + 1 skipped，一度按任务书 247+1 判为不合。
> 随后核对文件数与出现时间：`frontend/src/state/*` 下 `draftDebounce.ts`/`draftDebounce.test.ts` 在采集前刚刚落盘（mtime 14:10/14:11，早于 vitest 收集 14:10:25），故该 262 实为「S-1 已含 15 项」的口径，与 lead 汇报一致；S-1 的纯基线是 247+1。
> pytest 基线我另在 130d35d 窗口实测：点阵 72+72+33=177 个用例（含 2 个 `s`）→ 175 passed + 2 skipped，与任务书基线一致（`pytest.ini` 的 `addopts = -q` 与命令 `-q` 叠加会吞掉统计行，需 `-o addopts=""` 才可见）。

---

## 3. S-1 验证（S-3 之前交付项，修订 d8c0e61）

### 3.0 方法（三层，互相独立）

1. **模块语义层**：直接 import 真实 `frontend/src/state/draftDebounce.ts`（Node 24 type-stripping），注入假时钟，不依赖任何框架。
2. **组件集成层**：树外 vitest 轨（`/tmp/ke-verify/editorarea-s1.test.tsx`）渲染**真实 `EditorArea.tsx`**，只 mock 编辑器门面（`useKeEditor`/`setKeContent`）、三个重子组件与 fetch；`draftDebounce`/`saveQueue`/`ke` 全部真实。用于驱动「登记计时器 ↔ 保存/中止/切档」的时序竞态。**不修改 `frontend/src`**。
3. **静态代码路径层**：`getMarkdown()` 调用点、effect 声明序、`saveQueue` 防抖语义（用于回答「每击键是否新增序列化」与「F14 快照分支是否可达」）。

### 3.1 模块语义（14/14 PASS）

```
$ node /tmp/ke-verify/module-semantics.mjs
RECOVERY_MAX_AGE_MS = 3000
PASS  A1 2999ms 未登记 / 3000ms 恰好 1 次  before=0 after=1 at=3000
PASS  A2 登记时刻 == 3000ms（自首笔，不因后续编辑顺延）
PASS  A3 第二窗口同样 3s 有界  mid=1 after=2
PASS  B1 markSaved(true) 后到点不再登记  flushes=0
PASS  C1 markSaved(false) 后到点仍登记  flushes=1
PASS  D1 flushNow 恰好 1 次且无重复
PASS  E1 cancel() 后无登记且计时器清空 / E2 dirty()===false
PASS  F1 dispose() 后无登记且计时器清空 / F2 dirty()===false
PASS  G1/G2 回调内 touch（重入）不丢下一窗口
PASS  H2 ★ 中止后 dirty() 仍为 true（模块无法感知恢复点已被清除）
PASS  H1 ★ 中止后到点仍会登记（clearRecoveryPoint 之后重新登记 → 孤儿草稿）
[ke-verify] 模块语义检查：14/14 PASS
```
H1/H2 是 **fc98a98 版本**下对缺陷 F-S1-1 的最小复现（模块本身无缺陷，缺陷在调用方未在中止分支清理标记）。

### 3.2 组件集成时序（d8c0e61 复验：7 PASS / 2 记录项）

```
$ cd /tmp/ke-verify && npx --prefix "/mnt/f/Work/KE Project/knowledge-editor/frontend" vitest run editorarea-s1.test.tsx
```

| 用例 | 断言 | 实测输出 | 判定 |
|---|---|---|---|
| T1 连续编辑有界性 | 0/1000/2000ms 连打：2999ms 前 0 次登记，3000ms 恰好 1 次；第二窗口再 3s 再 1 次 | 2999ms 无、3000ms 1 次、第二窗口 1 次 | PASS |
| T2 保存成功路径 | POST 登记 → PUT → DELETE 清除；其后 5s 无二次登记 | 序列 `POST \| PUT \| DELETE`，5s 内无新增 | PASS |
| T3 R2 中止路径（缺陷 F-S1-1） | DELETE 之后不得再出现恢复点登记 | `POST \| PUT \| DELETE`（修复前为 `… DELETE \| POST`） | PASS（修复后） |
| T4 串档 A→B | 不得把 B 内容登记到 A、或 A 内容登记到 B | 唯一登记 `Articles/b.md` + `# B-edit` | PASS |
| T5 无前置 flush 切档 | 潜伏缺口，见 §3.4 | `[T5] A 落盘 = false | A 登记恢复点 = false` | 已知遗留 |
| T5b App 前置 flush 切档（生产路径） | A 必须落盘 | `[T5b] A 落盘 = true | A 登记恢复点 = true` | PASS |
| T6 保存成功但已切走 | 不得误清当前文档 B 的未保存标记 | B 按时登记 | PASS |
| T7 卸载 dispose | 卸载后 10s 无登记（无计时器泄漏） | `[T7] 卸载后请求 = []` | PASS |
| T8 非当前文档 abort | 见 §3.5（修复语义过宽） | `[T8] B 的登记数 = 0` | 已知遗留 |

补充静态核验：`setKeContent` 使用 `emitUpdate: false`（`frontend/src/editor/index.ts:319-335`），外部版本重载不会触发 `onUpdate` → 不会 `touch()`。lead 的「第二成因排查」成立：故障期存活 `pendingDirty` 是唯一成因，T3 时序（孤儿 POST 恰好出现在 3s 计时点到点，而非重载瞬间）与之一致。

### 3.3 缺陷 F-S1-1：中止路径漏清未保存标记 → 孤儿草稿（**已修复并复验通过**）

- **修复前实测（`fc98a98`）**
  ```
  [T3] 请求序列 = POST /api/drafts/recovery | PUT /api/articles/Articles%2Fa.md | DELETE /api/drafts/recovery/Articles%2Fa.md | POST /api/drafts/recovery
  [T3] 清除之后新增的恢复点登记 = ["---\nke_version: 1\n---\n\n# disk-reloaded"]
  ✗ expected 1 to be +0
  ```
- **修复内容**（d8c0e61，`EditorArea.tsx`）：`if (signal?.aborted)` 分支在 `void clearRecoveryPoint(docId)` 后追加 `draftRegRef.current?.cancel()`。
- **修复后实测（d8c0e61）**：序列恢复为 `POST | PUT | DELETE`，清除后无新增登记（上表 T3）。源码三行 diff 已逐行核对，除该分支外无其他改动。
- **影响**：内容与磁盘一致的假恢复点 → 下次启动/「恢复检查」误弹「检测到未恢复的编辑内容」。

### 3.4 遗留 F-S1-2：F14 内容快照分支恒假（潜伏缺口，**非 S-1 引入**）

- **事实（集成轨 T5）**：无前置 flush 直接切档时，`[T5] A 落盘 = false | A 登记恢复点 = false`——A 的最后 <3s 编辑既不落盘也不登记。
- **机制**：`EditorArea.tsx` 中 `articleRef` 同步 effect（声明于 110 行）先于切档 effect（357 行）执行（React 按声明序），因此切档时 `articleRef.current?.id === prevId` 恒假 → `contentSnapshotRef` 从未赋值 → `flushPending(prevId)` 的 saveFn 因 `snap === undefined` 直接 return。`git show` 核对：`53803ca`（v1.1.2 引入 F14 时）/`130d35d`/`fc98a98` 三版声明顺序一致，即该分支自引入以来从未执行。
- **可达性**：生产唯一文档切换入口 `App.requestOpenArticle` 先 `flushWithTimeout(articleIdRef.current)`（`App.tsx:303-314`，另有 473/485/550 同款守卫），T5b 实测该路径正常落盘 + 登记。故**当前不可达**。
- **对 S-1 结论的影响**：**不影响**。S-1 的验收面是「编辑防抖登记链路」，其在生产切换路径上由 App 守卫兜底（T5b）；此为独立的历史遗留缺陷，应由主理人另立任务决策（修它等于启用一段从未执行过的历史敏感代码，需要独立验证周期）。

### 3.5 F-S1-3：中止分支 `cancel()` 语义过宽 —— **已修复（Lead，修订 `efdf5cc`）**

- **事实（集成轨 T8）**：A（**非当前文档**）的保存在途时中止，`draftRegRef.current?.cancel()` 无条件清空了共享调度器——B（当前文档）的未决登记被一起放弃：`[T8] B 的登记数 = 0`。
- **机制**：`draftRegRef` 是**单实例、与文档无关**的调度器；成功路径用 `articleRef.current?.id === docId` 守卫，中止分支未守卫。
- **可达性分析（verifier 判当前不可达）**：`abortPending` 生产唯一调用点 `App.tsx:383`（`handleReloadExternal`），其 `rel = extModal?.rel`；`extModal` 由 `handleFsEvent` 仅对**当前文档**的外部修改事件置位，且渲染为 `fixed inset-0 z-40` 全屏遮罩（`App.tsx:800`），遮罩期间无法点击文件树切换文档。→ 中止对象实际恒为当前文档。
- **verifier 建议**：与成功路径对称加 `if (isCurrent)` 守卫。

**Lead 处置（2026-09-14，修订 `efdf5ccf66e3a48f58ca32b42cde90c48733c674`）**：
按建议修复，但**第一次改法无效**——直接套用 `isCurrent` 仍为 `[T8] B 的登记数 = 0`。原因：
`isCurrent` 是 `buildSaveFn` 在**保存执行开始时**的快照，而本场景恰是「A 尚为当前时启动保存 →
切到 B → 才发生 abort」，快照已过期仍为 `true`。改用**中止时刻重读** `articleRef.current?.id === docId`
后转绿：`[T8] B 的登记数 = 1`，且 T3 保持通过（`清除之后新增的恢复点登记 = []`）。
该门控与成功路径 `markSaved` 同源（同样用完成时刻重读，而非起始快照）。

修复后全量：tsc 0 错 · vitest 262 passed + 1 skipped · pytest 314 passed + 2 skipped。
**性质说明**：该不变量此前只靠「遮罩恰为全屏」这一 UI 细节维持，属防御性修复而非当前可达缺陷。

### 3.6 S-1 性能（问题 4 的明确回答，不美化）

**(a) 击键路径上是否新增了 `ed.getMarkdown()`？——否。**

- 代码路径：`handleUpdate`（`EditorArea.tsx:313-323`）只做 `bumpSeq` → `setSaveState('dirty')` → `enqueueSave(...)` → `ensureDraftReg().touch()`；`touch()` 为 O(1)（`draftDebounce.ts:87-91`，仅置标记并按需装计时器），不触碰编辑器。
- `getMarkdown()` 的全部调用点：`235`（防抖登记回调 onFlush）、`264`（保存）、`363`（切档快照）、`449`（导出）、`496`（预览）——均不在击键路径。`buildSaveFn(docId)` 每次击键只**创建闭包**，不执行。
- 频率实测（T1）：3 次击键 → 3s 窗口内恰好 1 次登记；连续多窗口每次窗口 1 次。即「序列化 = 每 3s 一次」，与击键次数无关。

**(b) 每 3s 一次序列化是否构成可观测卡顿？——有真实成本，但量级小、占比低；判定 PASS（附代价）。**

独立测量（真实编辑器栈 + 项目全部扩展；`/tmp/ke-verify/perf-serialize.test.ts`；happy-dom/WSL，非生产 WebView2）：

```
$ cd /tmp/ke-verify && npx --prefix ".../frontend" vitest run perf-serialize.test.ts
[ke-verify-perf] 191KB (bytes=253270) parse=2367ms | serialize 序列=[105.5, 51.0, 39.8, 32.7, 30.9] min=30.9 median=39.8 max=105.5 ms | JSON.stringify(登记体) max=2.5 ms
[ke-verify-perf] 256KB (bytes=341670) parse=7252ms | serialize 序列=[86.2, 49.6, 54.9, 50.7, 68.8] min=49.6 median=54.9 max=86.2 ms | JSON.stringify(登记体) max=3.1 ms
```
（对照：项目自带 `perf-bench.test.ts` 在同环境打印 `serialize=138ms`，为冷启动单次值；我的 5 次采样显示首个样本显著高于稳态，稳态中位数 40–55ms。）

- **频率**：连续输入下每 3000ms 一次同步阻塞（此前 saveQueue 为纯尾沿防抖、无 maxWait，连续输入期间**从不**序列化——这是 S-1 为换取 3s 上界新增的代价）。
- **单次成本**：稳态 ~31–55ms（191–256KB），首个（冷）~86–105ms，另加登记体 `JSON.stringify` ~1–3ms。
- **输入延迟暴露**：某次击键恰好落在阻塞窗口内的概率 ≈ 31–55ms / 3000ms ≈ **1.0%–1.8%**（冷首发 2.9%–3.5%）；该次击键的额外延迟上界 = 阻塞时长（≤ ~105ms）。
- **判断**：**未达到「每次击键序列化」的卡顿量级**；稳态 40ms 级阻塞处于打字可感知阈值（约 50–100ms）的下沿，属于「可测但不显著」的周期性抖动；冷首发（86–105ms）在超大文档首屏后首次登记时可能被感知到一次。与同文档既有成本（256KB 首次解析 7.2–14s）不在一个量级。
- **不美化的两点**：(1) 这笔成本是 S-1 **新增**的（此前连续输入期无序列化），属于为「≤3s 丢失窗口」支付的确定代价；(2) 若后续把 `RECOVERY_MAX_AGE_MS` 调小，成本按同比例上升；若要在不影响 3s 上界的前提下进一步降低，需要缓存最近一次序列化结果或引入增量哈希，而非降低频率。
- 绝对数值受环境（happy-dom/WSL）影响，**生产 WebView2/Windows 的真实数值未测量**（见 §3.7）。

### 3.7 S-1 未验证项（明确列出）

| 项 | 原因 |
|---|---|
| 真实浏览器/DOM 的击键延迟端到端测量 | 写入边界禁止新增 `frontend/src/**` 测试文件；树外轨只能以「真实组件 + mock 编辑器/fetch」覆盖，无法产生真实键盘事件时延 |
| 生产 WebView2/Windows 上的绝对耗时 | 无桌面运行时；所有数值来自 WSL + happy-node/happy-dom 环境 |
| App（外层）+ EditorArea（内层）联动竞态 | 我只渲染 `EditorArea`，App 的 `flushWithTimeout`/`abortPending` 以等价调用驱动（T3/T5b/T6/T8） |
| 硬崩溃后重启恢复的端到端验证（真杀进程） | 需要真实 sidecar/桌面进程；已用后端 `/api/drafts/recovery` 协议层 + 前端时序替代（§3.2 + 下表 S-1 协议用例） |

**S-1 协议层（后端可观测）用例（`test_attach_naming_verify.py::TestS1RecoveryProtocol`，5 项全 PASS）**：
登记即可见且草稿内容一致；保存成功 discard 后记录与草稿文件均消失；「登记→清除→再登记」序列无残留、磁盘文档不被污染；191KB+ 内容登记往返耗时 < 3s（实测见 §4 命令输出）。

---

## 4. S-3 验证（冻结修订 1bb00a6）

### 4.1 方法

- **全景越界扫描**：每次上传前后对 **workspace 根及其父目录**做全量 snapshot（`rel → sha256`，仅排除 `.knowledgeeditor/index.db*` 已知噪声）；新增/修改/删除任一越出 `root/Attachments/**` 即 FAIL。
- **双实现交叉校验**：主断言用相对路径坐标换算；另有**独立绝对路径扫描**（`Path.resolve().is_relative_to`，跟随符号链接）对同一批新增/修改文件再次判定——两套实现同时生效。
- **朴素实现目标比对**：对每个 payload 计算「朴素拼接实现」会写到的越界目标（`root/Attachments/files/<raw>`、`root/Attachments/<raw>`、`root/<raw>` 中落在 Attachments 之外者），上传前记录其存在性/哈希，上传后逐一比对（原本不存在 → 必须仍不存在；已存在 → 哈希不得变化，覆盖 `/etc/passwd`）。
- **金丝雀**：工作区父目录金丝雀文件、`/tmp` 随机金丝雀、`$HOME` 探针（不得出现）、`/etc/passwd` 哈希。
- **marker 扫描器**：以随机 marker 命名 payload，在 ws 各祖先目录、ws 递归、`/tmp` 浅层递归中搜索 marker，命中点必须全部位于 `ws/Attachments/`。

### 4.2 路径穿越矩阵（28 payload，全 PASS）

```
$ cd backend && python3 -m pytest tests/test_attach_naming_verify.py -o addopts="" -q -p no:warnings
102 passed in 2.86s
```
覆盖（含 whitelisted 扩展名的真穿越变体与 `.md` 白名单分支）：
`../../evil.pdf`、`..\..\evil.pdf`、`../evil.pdf`、`..\evil.pdf`、`a/../../evil.pdf`、`a\..\..\evil.pdf`、`....//evil.pdf`、`../../evil.md`、`..\..\evil.md`、`/etc/passwd`、`/tmp/ke-verify-<u>.pdf`、`C:\Windows\evil.pdf`、`C:/Windows/evil.pdf`、`C:evil.pdf`、`\\server\share\evil.pdf`、`//server/share/evil.pdf`、`%2e%2e%2f`、`..%2f..%2f`、`%252e%252e%252f`、`<u>../../../evil.pdf`、6/8 层深遍历、`~/.ke-verify-<u>.pdf`、RTL 覆写 + `../`、全角 `．．／．．／evil.pdf`、`Attachments/../../evil.pdf`、`evil.pdf/../../../<u>.pdf`。
每条断言：**无越界新增/修改/删除 + 金丝雀不变 + 朴素越界目标未创建/未修改 + 无 5xx + 2xx 时落盘唯一且在 `Attachments/<预期分类>/` 内 + 返回 path 与真实落盘一致 + 落盘名合法（无分隔符/控制字符/超长/保留名）**。

### 4.3 退化/特殊文件名矩阵（36 payload，全 PASS）

空名、`.`、`..`、`...`、`....`、`....pdf`、`.hidden.pdf`、`..pdf`、尾点/尾空格/前导空格、`\x01/\x07/\t/\r/\n/\x00/\x1b`、299/304 字符名、200 CJK（604 字节）、emoji、NFD `café`、RTL 覆写、ZWSP、`CON/con/NUL/nul/PRN/AUX/COM1/LPT1/NUL.tar/CON`。
每条断言：**不得 5xx**（退化名必须确定性回退）+ 2xx 时落盘名合法且唯一；被拒时不得落盘。

### 4.4 multipart 传输层转义与双重编码顺序差（10 payload，全 PASS）

```
[ke-verify] note: 'Attachments/files/%2522quote.pdf' GET 404 = TestClient 双重解码 artifact（名字含 %）
（同 note 另 3 条：%252e%252e%252fevil.pdf / ..%252fevil.pdf / %2e%2e%252fevil.pdf）
```
`evil%22quote.pdf`、`evil%0Dquote.pdf`、`evil%0Aquote.pdf`、`evil%0d%0aX-Injected.pdf`、`%2522quote.pdf`、`%252e%252e%252fevil.pdf`、`..%252fevil.pdf`、`%2522%2e%2e%2fevil.pdf`、`evil%00nul.pdf`、`%2e%2e%252fevil.pdf`。
结论：**先逆变换再净化**（`_decode_multipart_filename` → `_split_stem_suffix` → `sanitize_filename`）没有顺序差可绕——落盘名不含裸 `"`/CR/LF，GET 响应头无裸换行、无注入头；含 `%` 的字面量名保持单组件（无分隔符即无穿越）。
**校验串与落盘串一致性**（lead 关切）：`_create_unique` 把同一个 `name` 传给 `_attachment_target`（校验）并打开其返回的 `target`（`target.open("xb")`），不存在「校验 A、落盘 B」的变换差；分类也用 `f"{safe_stem}{final_ext}"` 与落盘名同源。

### 4.5 原名保留 / 冲突 / 大小写 / 并发（全 PASS）

```
（用例 test_s3_original_name_preserved 实测 6 例全过）
我的 报告 v2.pdf → Attachments/files/我的 报告 v2.pdf
Photo 1.PNG     → Attachments/images/Photo 1.PNG（大小写保留）
MixedCase Name.Mp4 → Attachments/videos/MixedCase Name.Mp4
```
- **同名二次上传**：`report.pdf` 两次 → 不同路径、第一份 sha256 不变、第二份内容正确、去重名承接原名与扩展名；第三次 → 三个不同文件。
- **大小写变体实测**：
  ```
  [ke-verify] 大小写变体实测: 'Report.pdf' -> 'report-1.pdf'
  ```
  → NFC+casefold 去重在 **ext4（大小写敏感）** 上即生效；在 NTFS 上同样不会互相覆盖（FS 层 + 显式 casefold 双重保障）。
- **并发压力**：8 线程 `Barrier` 同步 × 3 轮同名 `stress.pdf`（另预置 1 份哨兵）→ 25 个文件全部为常规非空文件，哨兵 sha256 不变，12 份并发内容全部可寻回，无覆盖/无丢失/无半成品。
- **TOCTOU 判定**：实现使用 `O_EXCL`（`open("xb")`）创建，`FileExistsError` 时记录该键并尝试下一后缀（`_DEDUP_MAX=1000`）。**结论：不存在可被并发利用的覆盖窗口**；最坏情况是全部 1000 个后缀被占用 → 409，而非覆盖。

### 4.6 白名单 / 配额 / 半成品清理 / 内联（全 PASS）

- 白名单：`.exe/.md/.sh/.bat/.py/.HTML5` → 400；`.PDF/.Zip/.JSON/.PNG/.MP4` → 201 且分类正确（小写比对）。
- 配额：`MAX_UPLOAD_SIZE=1024` 时上传 4KB → 413，且**同名既有文件内容 sha256 不变**（确定性命名下最易踩的「先 truncate 再查配额」被 O_EXCL 去重规避），无半成品残留。
- 内联策略：`.png` 内联、`.pdf` 内联（S-3 前既有 `_INLINE_EXTS` 行为）；`.html/.svg/.txt` 强制 `Content-Disposition: attachment`。

### 4.7 CJK Content-Disposition（RFC 6266，PASS）

`中文 报告.csv` / `数据 汇总.txt` / `矢量 图.svg` / `网页 页.html` / `纯 文本.docx`：GET 200，头以 `attachment; filename="<ASCII 回退>"; filename*=UTF-8''<pct>` 形态出现，可 latin-1 编码，`unquote(filename*)` **等于落盘名**；ASCII 回退段仅 `[\x20-\x7e]`；`.png`/`.pdf` 不强制 attachment。
`_attachment_disposition` 对 ASCII 回退做了 `"`/`\`/非 ASCII → `_` 替换，`filename*` 承载真实名——净化层 + 编码层双保险，未见头注入面。

### 4.8 符号链接 / 悬空链接 / 目录碰撞（安全不变量全 PASS，行为观察见 §4.9）

```
[ke-verify] 符号链接同名碰撞实测状态码: [('link.pdf', 400), ('dangling.pdf', 400), ('dir.pdf', 400)]（400=失败关闭，201=去重）
```
预置「指向工作区外文件/不存在目标/工作区外目录」的符号链接后再上传同名：
- 外部文件内容未被改写、悬空目标未被创建、外部目录保持空、符号链接本身未被删除或替换；
- `_create_unique` 先在 i=0 候选上执行 `_attachment_target`（`target.resolve()` 跟随符号链接 → 判定越界）→ **400 拒绝（fail-closed）**，不会跟随链接写出。
（常规文件同名走 201 去重后缀，安全等价。）

**Windows Junction 未验证**：本环境测试目录位于 WSL2 ext4（`tmp_path`），无法构造 NTFS Junction；POSIX 符号链接覆盖了 `resolve()` 路径判定的等价风险面，但 Junction 本体**未能验证（原因：环境不提供 NTFS Junction 构造与原语）**，不作推测结论。

### 4.9 观察项 / WARN（非安全缺陷，不阻塞）

| 编号 | 观察 | 证据 | 影响判断 |
|---|---|---|---|
| W-S3-1 | 符号链接同名碰撞返回 400 而非去重后缀 | 上表三个 400 | **失败关闭**，无外部写入；仅与「确定性去重」文档语义不一致（用户手动在附件目录建了同名链接才会遇到）。建议：把 `key in taken` 判断前置到 `_attachment_target` 之前 |
| W-S3-2 | `../../evil.pdf` 落盘为 `.. evil.pdf`（前导点未再次剥离） | `[ke-verify] ../../evil.pdf -> 201 ['.. evil.pdf']` | 单组件、受限目录内，无安全影响；文件名以点开头不规范（`sanitize_filename` 的 `lstrip(".")` 对「点+空格+点」输入不幂等） |
| W-S3-3 | `trailing.pdf.` → 400（后缀 `.` 不在白名单） | 观察表 `'trailing.pdf.' -> 400` | 拒绝而非净化；极罕见输入，行为安全 |
| W-S3-4 | `.pdf` 属内联白名单（GET 无 Content-Disposition） | §4.6/§4.7 | S-3 前既有行为，非本次回归；如需收紧另立任务 |
| W-S3-5 | 长名净化为 80 字符（前缀截断），扩展名因「拆分后单独拼回」而保留 | 观察表 299 字符 → 80 字符 + `.pdf`；200 CJK → 80×3+4=244 字节 ≤255 | 符合 Windows 路径预算；无缺陷 |
| W-S3-6 | 含 `%` 的字面量名在 TestClient 下 GET 404 | 4 条 note | **测试轨 artifact**：starlette `_TestClientTransport` 对 `path` 二次 `unquote`；前端 `attachmentUrl` 逐段 `encodeURIComponent`（`client.ts:216`），uvicorn 单次解码，生产无此问题。已用「200 才校验头、含 `%` 且 404 允许」的方式显式记录，未掩盖其他失败 |

### 4.10 S-3 未验证项（明确列出）

| 项 | 原因 |
|---|---|
| Windows Junction 场景 | WSL2/ext4 无法构造 Junction（§4.8） |
| 真实 NTFS 大小写不敏感文件系统上的覆盖行为 | `tmp_path` 在 ext4；已用 NFC+casefold 逻辑 + casefold 实测（`Report.pdf`→`report-1.pdf`）覆盖决策逻辑，FS 层行为未直接观测 |
| 真实 uvicorn + 浏览器 URL 往返（含 `%` 名） | 用 TestClient 时受二次解码 artifact 限制；仅前端编码实现（逐段 `encodeURIComponent`）与后端路由守卫经代码核验 |
| 超大附件（数百 MB）流式落盘 | 未构造大文件；配额逻辑用 monkeypatch `MAX_UPLOAD_SIZE` 覆盖 |

---

## 5. 独立性问题回答：夹具 52 红复盘（如实回答 lead 的质询）

**① 那 52 红是我的夹具 bug 吗？——是。** 我自己的推导（不是复述 dev-attach 结论）：

`_snapshot(base)` 以 `base = ws.parent` 为根，键形如 `ws/Attachments/files/x.pdf`；而 `_assert_contained` 用 `_under_attachments(rel)`（判定 `rel.startswith("Attachments/")`，是 **ws 相对**语义）去判定它。两个坐标系不一致 → 每条合法落盘都被判为「Attachments/ 之外的新增文件」。我在动手前用 dev-attach 给出的单测命令独立复现：
```
$ python3 -m pytest "tests/test_attach_naming_verify.py::test_s3_traversal_never_writes_outside_attachments[rel-up2]" -o addopts="" --tb=short
E   AssertionError: [traversal '../../evil.pdf'] 检测到 Attachments/ 之外的新增文件: ['ws/Attachments/files/.. evil.pdf']
E     快照根: /tmp/pytest-of-.../test_s3_traversal_never_writes0
```
被点名的路径实际位于 `ws/Attachments/files/` 之内 → 是断言的坐标换算错误。次生症状：`new_inside[0] == rel_path` 也在拿「base 相对」比「ws 相对」，同样假红。
> 诚实边界：dev-attach 报告的「52 红」计数**不是我的实测**——我没有在修复前整跑该文件。我独立复现并取证的是上述 `[rel-up2]` 这一条的失败输出，以及「同类坐标错配必然造成遍历 28 条 + 退化 36 条中所有 2xx 分支 + 观察矩阵 1 条假红」的推导；「另 4 条 GET/头相关失败、dev-attach 修实现后已过」同样来自其汇报，我复核的是修复后我的完整套件（含这 4 类断言）102 全绿。

**② 我具体改了什么？有没有放宽断言？**

| 改动 | 性质 |
|---|---|
| 新增 `_inside_attachments(rel, base, ws)`：用 `Path.relative_to(ws)` 把 base 相对键换算成 ws 相对，再套用**同一个** `Attachments/` 判定 | 修正坐标系，**断言强度不变**（判定谓词与安全边界完全一致） |
| `_assert_contained` 返回 ws 相对的新增文件列表 | 修正后 `new_inside[0] == 返回体 path` 从「坐标错配」变为**真正的强一致性断言**（此前这条其实是弱的/恒假的） |
| 删除不再使用的 `_under_attachments` | 清理 |
| 观察矩阵改用 `_snapshot(ws)` | 等价（该用例只需工作区内视角） |
| **`_naive_escape_targets` 只保留落在 `ws/Attachments/` 之外的朴素目标** | 这是唯一一处「收紧范围」的改动，必须明说：坐标修复后剩余 2 条假红（`[fullwidth-nfkc-dots]`、`[url-double-pct]`）源于 payload 不含 POSIX 分隔符（全角 `．／`、字面量 `%2e%2e%2f`），朴素拼接结果**恰好就是合法落盘位置**，却被当作「必须不存在」。我过滤掉「位于 Attachments 内」的朴素目标。**强度分析**：被过滤的只可能是「落在 Attachments 内但分类目录不对」的情形，而该情形由每条 2xx 用例中已有的硬断言 `rel_path.startswith(f"Attachments/{预期分类}/")` 覆盖；Attachments 之外的越界目标全部保留。→ 无净削弱 |

**③ 96 passed 是否意味沿用同一套可能有同样偏差的断言？——不。** 我新增了两套**不同实现**的越界判定并与主断言同时生效：
1. **绝对路径交叉扫描**：`(base/rel).resolve().is_relative_to((ws/"Attachments").resolve())`，对所有新增/修改文件二次判定（与字符串前缀换算不同实现）；
2. **marker 扫描器**：随机 marker 命名 payload，扫描 ws 各祖先目录 + ws 递归 + `/tmp` 浅层递归，命中点必须全部位于 `ws/Attachments/` 内（`test_s3_independent_marker_scan_outside_workspace`，含「扫描器必须命中工作区内合法落点」的自校验，防止扫描器空转假绿）。
重跑后：**102 passed**（含新增的 multipart 转义、CJK 头、符号链接、目录碰撞、并发压力、独立扫描 6 组用例）。

---

## 6. 复现命令汇总

```bash
# 后端（S-3 + S-1 协议层，独立验证套件）
cd "/mnt/f/Work/KE Project/knowledge-editor/backend"
python3 -m pytest tests/test_attach_naming_verify.py -o addopts="" -q        # 102 passed
python3 -m pytest tests/test_attach_naming.py -o addopts="" -q               #  37 passed（开发者自测）
python3 -m pytest -o addopts="" -q                                          # 314 passed, 2 skipped

# 前端回归
cd "../frontend" && npx tsc -b --noEmit && npx vitest run                   # 0 错 / 262 passed + 1 skipped

# S-1 模块语义（真模块 + 假时钟）
node /tmp/ke-verify/module-semantics.mjs                                     # 14/14 PASS

# S-1 组件时序（树外 vitest，真实 EditorArea + mock 编辑器/fetch）
cd /tmp/ke-verify && npx --prefix "/mnt/f/Work/KE Project/knowledge-editor/frontend" vitest run editorarea-s1.test.tsx

# S-1 序列化成本
cd /tmp/ke-verify && npx --prefix ".../frontend" vitest run perf-serialize.test.ts
```

## 7. 最终判定

- **S-1：PASS。** 连续编辑 ≤3s 登记（不因后续编辑顺延）、保存成功清除、无孤儿（含 abort 路径修复后复验）、无串档、无计时器泄漏；击键路径无新增序列化；每 3s 一次 31–105ms 的同步序列化已完成量化并给出判断（§3.6）。遗留 F-S1-2（F14 死分支）**不改不影响本轮结论**，建议另立任务；F-S1-3 已由 Lead 在本轮修复（§3.5，修订 `efdf5cc`）。
- **S-3：PASS。** 28 组穿越 payload + 36 组退化名 + 10 组编码变体均无越界写入/无 5xx；原名（CJK/空格/大小写）保留；同名与大小写变体不覆盖；O_EXCL 无 TOCTOU 覆盖窗口；白名单/配额/清理/内联不回归；CJK Content-Disposition 合规。WARN 项（符号链接碰撞 400、前导点、尾点拒绝）为非安全行为观察，附最小复现与建议。
- 回归底线：pytest 314 passed / 2 skipped、vitest 262 passed + 1 skipped、tsc 0 错——均不低于基线。

> **Lead 补注（2026-09-14）**：本报告 §3.5 所列 F-S1-3 由 Lead 在 verifier 报告之后修复
> （`efdf5cc`），T8 复测转绿、T3 保持通过；§3.5 标题与正文已同步更新为「已修复」。
> §7 中 verifier 原文写「F-S1-3 建议另立任务」——该句对应修复前状态，现以本补注为准。
> S-1 最终验收修订：`efdf5cc`；S-3 最终验收修订：`1bb00a6`。
