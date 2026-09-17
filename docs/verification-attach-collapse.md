# 独立验证报告：附件区默认收起（task-22 实现 / task-24 验证）

- **验证者**：`verifier-attach`（独立对抗验证；不分复述开发者自测）
- **验证时刻**：2026-09-17 11:32:02 → 11:33:27（+08:00），单批次完成
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），**git HEAD `96a34be55e31a41e1ee4edc1d88f04bbbfef755f`（`96a34be`）**
- **判据变更**：主理人裁决**附件区默认收起**（task-22）→ 本报告 §3 给出「改前 vs 改后」逐条对照

## 0. 所验证的 3 个文件（跑前/跑后各复算一次，完全一致 → 验证期间源码未变动）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `frontend/src/components/layout/LeftSidebar.tsx`（被验证） | `775c4b70117279357f5a178b6244a0dd83966442ff6ad3b44fa0688b8f91b485` |
| `frontend/src/components/layout/LeftSidebar.test.tsx`（开发者） | `b00c6b22f42923b9b5dbe5263a6fee1dc5afc14f65d33b7a952e8ac23eb636f4` |
| `frontend/src/components/layout/LeftSidebar.verify.test.tsx`（本验证套件，改判据后） | `e861daa14471b1eee298f040d72ae2a1931d8782c0c700baa741b3a771c1e430` |

Lead 告知的冻结 sha 与我独立复算**逐字节一致**（不采信转述）。

## 1. 结论摘要

| 项 | 判定 | 依据 |
|---|---|---|
| 默认收起语义（task-22） | **PASS** | 33/33 用例；收起态只留表头（计数 + 孤儿徽章 + 刷新），行/详情/孤儿块/底部说明零 DOM |
| 收起不得省掉数据请求 | **PASS** | 收起态首挂即 `listAttachments` / `listOrphans` 各 ≥1 次 |
| 收起态零残留 | **PASS** | 展开→详情→收起→数据+文档变化→再展开 无残留；卸载重挂仍为默认收起 |
| 收起态孤儿信号可达 | **PASS** | `aria-expanded=false` + 徽章文本「孤儿附件 1」可见 + **徽章在折叠按钮内**（点徽章即展开） |
| 其余判据未削弱 | **PASS** | task-14 的 25 条判据逐条保留（见 §3 对照），净新增 8 条 → 33 条 |
| 回归底线 | **PASS** | `tsc` exit 0；全量 **38 files / 548 passed + 1 skipped** exit 0（基线 546+1，只增不减） |

**未发现 FAIL。**

---

## 2. 实际命令与实际输出

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/components/layout/LeftSidebar.verify.test.tsx --reporter=verbose
npx vitest run
```

**`tsc` 全文**：

```
EXIT=0
```

**定向套件（33 条实际输出）**：

```
 ✓ L-1 默认收起语义 > 默认收起：不点击时只留表头（计数可见；行/详情/孤儿块/底部说明均不渲染） 52ms
 ✓ L-1 > 默认收起**不得**省掉首次数据请求（计数与徽章依赖数据） 12ms
 ✓ L-1 > 收起态计数与徽章来自真实数据（3 附件 + 1 孤儿） 14ms
 ✓ L-1 > 收起态无孤儿时表头不出现孤儿噪声 16ms
 ✓ L-1 > 收起态信号可达：aria-expanded=false 且徽章文本可见，徽章位于折叠按钮内（点徽章即展开） 26ms
 ✓ L-1 > aria-expanded 语义：默认 false → 点表头 true → 再点 false 23ms
 ✓ L-1 > 键盘可达性：折叠开关是原生 button 且可聚焦（Enter/Space 由浏览器原生激活） 27ms
 ✓ L-1 > 点表头 → 展开齐全；再点 → 收起（两态往返） 27ms
 ✓ L-1 > 收起态刷新按钮仍可用：点击会重新拉取附件数据 20ms
 ✓ L-2 数据源迁移 > tree.attachments 全空但 /api/attachments/list 有数据 → 展开后渲染（不依赖文件树） 22ms
 ✓ L-2 > 0 附件：收起态不显示空态文案，展开后显示「暂无附件」 21ms
 ✓ L-3 详情 > 迁移信息量不缩水：名称 / 大小 / 已引用徽章 / 全路径 / 修改时间 逐项可见 33ms
 ✓ L-3 > 3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]） 28ms
 ✓ L-3 > 详情内每条引用可跳转（onOpenArticle 收到正确 docRel，恰好 3 次） 30ms
 ✓ L-3 > 点附件行本身 = 就地展开，不得直接把用户跳走 21ms
 ✓ L-3 > 未引用附件：显示「未被…引用」+ 全路径 + 大小 + 修改时间 26ms
 ✓ L-3 > 同行两击 = 展开再收起（详情消失，列表不塌） 31ms
 ✓ L-3 > 点不同行 = 切换详情，上一个展开态不残留 33ms
 ✓ L-3 > 50 条引用不得被截断（防隐性上限） 42ms
 ✓ L-4 收起两态与无残留 > 两态成对：收起零行/零详情/零孤儿 DOM → 展开齐全 → 再收起零 DOM 28ms
 ✓ L-4 > 收起后不得残留上一轮展开行/详情：展开→点行详情→收起→数据+文档变化→再展开 47ms
 ✓ L-4 > 收起态不得渲染底部说明文案（不随笔记回滚） 29ms
 ✓ L-4 > 展开态不得被持久化：卸载重挂后仍为默认收起 32ms
 ✓ L-5 > 每个附件保留独立 <a href={attachmentUrl(rel)}> 且 target=_blank / rel=noreferrer 15ms
 ✓ L-5 > DOM 合法性：无 button 嵌套 button/a、无 a 嵌套 button 23ms
 ✓ L-6 > 确认删除 → deleteAttachment(路径) 被调用且列表刷新 38ms
 ✓ L-6 > 取消删除 → 不得发起 deleteAttachment，且全程零写请求 16ms
 ✓ L-7 > 只读流程零写请求 + 零裸 fetch + 无 alert（含默认收起→展开→详情→跳转→收起） 33ms
 ✓ L-7 > 展开/收起/点行详情不重复拉取列表（纯前端状态） 20ms
 ✓ L-8 边界 > referenced_by 为空数组：按未引用处理（显示未引用 + 不跳转） 13ms
 ✓ L-8 > 超长文件名/路径不破版（可渲染 + 行内保留截断样式） 9ms
 ✓ L-8 > refreshKey 变化 → 重新加载附件列表（收起态也须刷新计数） 14ms
 ✓ L-8 > 树里存在附件名但 API 无数据 → 不得从 tree 推断渲染附件（等价性反证） 8ms

 Test Files  1 passed (1)
      Tests  33 passed (33)
EXIT=0
```

**全量回归**：

```
 Test Files  38 passed (38)
      Tests  548 passed | 1 skipped (549)
EXIT=0
```

四个相关文件（从全量输出逐文件解析）：

```
 ✓ src/components/layout/LeftSidebar.verify.test.tsx (33 tests)
 ✓ src/components/layout/LeftSidebar.test.tsx (22 tests)          ← 开发者
 ✓ src/components/layout/RightPanel.verify.test.tsx (13 tests)    ← 上一轮右栏净身（未受影响）
 ✓ src/components/layout/RightPanel.test.tsx (7 tests)            ← 开发者
```

计数关系：Lead 给的基线 **546 passed + 1 skipped**（当时我的文件 31 例）→ 本次 **548 passed + 1 skipped**（我的文件 33 例），**+2 全部来自我新增用例，零用例减少**；skip 恒为 1（`src/editor/perf-bench.test.ts` 既有 skip）。

---

## 3. 改前 vs 改后判据对照（本次只允许改「默认态」一族）

- **改前**：task-14 冻结版 **25 例**（其中默认态族 4 条：默认展开 / 展开态齐全 / 收起态零 DOM / 无孤儿噪声）
- **改后**：**33 例** = 25 条全部保留或等价改写（**无一条删除、无一条削弱**） + 净新增 8 条
- 唯一的**作废**判据：`默认展开：无需任何点击即可看到附件行与计数` → 语义反转为 `默认收起：只留表头 + 计数 + 徽章，行/详情/孤儿块/底部说明零 DOM`

| # | 改前（25 例） | 改后 | 处置 |
|---|---|---|---|
| 1 | 默认展开：无需点击即可见行与计数 | **L-1.1 默认收起：只留表头（计数可见；行/详情/孤儿块/底部说明零 DOM）** | **反转（唯一作废）** |
| 2 | `tree.attachments` 空但 API 有数据 → 附件仍渲染 | L-2.1 同断言 + **前置展开**（`openList()`） | 保留（仅适配默认态） |
| 3 | 表头带刷新/添加按钮 | **L-1.9 收起态刷新按钮仍可用：点击会重新拉取** | 保留 + 强化 |
| 4 | 0 附件：展开态显示「暂无附件」 | L-2.2 同断言 + **新增「收起态不显示空态文案」** | 保留 + 强化 |
| 5 | 迁移信息量不缩水（名称/大小/徽章/全路径/时间） | L-3.1 同 | 保留 |
| 6 | 3 篇引用全部列出 | L-3.2 同 | 保留 |
| 7 | 逐条跳转恰好 3 次 | L-3.3 同 | 保留 |
| 8 | 点行本身不误跳 | L-3.4 同 | 保留 |
| 9 | 未引用详情（路径/大小/时间） | L-3.5 同 | 保留 |
| 10 | 同行两击 = 收放 | L-3.6 同 | 保留 |
| 11 | 异行切换不残留 | L-3.7 同 | 保留 |
| 12 | 50 条不截断 | L-3.8 同 | 保留 |
| 13 | 收起态零行/零详情/零孤儿 DOM + 计数 + 徽章 | L-4.1 **两态成对**（默认收起零 DOM → 展开齐全 → 再收起零 DOM） | 保留 + 强化 |
| 14 | 展开态：行/孤儿块/删除按钮/底部说明全回来 | L-1.8（点表头展开齐全；再点收起） + L-4.1 | 保留（合并加强） |
| 15 | 无孤儿时收起态无噪声 | L-1.4 同 | 保留 |
| 16 | `<a href={attachmentUrl}>` 契约（数量/`target`/`rel`） | L-5.1 同 | 保留 |
| 17 | DOM 合法性（无 button 嵌套） | L-5.2 同 | 保留 |
| 18 | 确认删除 → `deleteAttachment` + 刷新 | L-6.1 同 | 保留 |
| 19 | 取消删除 → 零写 | L-6.2 同 | 保留 |
| 20 | 只读流程零写 + 裸 fetch 零 + 无 alert | L-7.1 同 + **默认收起态本身也先断言零写** | 保留 + 强化 |
| 21 | 展开/收起不重复拉取列表 | L-7.2 同 | 保留 |
| 22 | 空 `referenced_by` | L-8.1 同 | 保留 |
| 23 | 超长名 truncate | L-8.2 同 | 保留 |
| 24 | `refreshKey` 重载 | L-8.3 同 + **强化：收起态计数随新数据更新（1→2）** | 保留 + 强化 |
| 25 | 反向等价性（tree 有附件名 + API 空 → 不得渲染） | L-8.4 同 | 保留 |

**净新增 8 条（task-24 新攻击面）**：

| # | 新增用例 | 针对的风险 |
|---|---|---|
| N1 | L-1.2 默认收起**不得**省掉首次数据请求 | 收起态跳过加载 → 计数/徽章退化（Lead 最关心的信号丢失路径） |
| N2 | L-1.3 收起态计数与徽章来自真实数据（3 附件 + 1 孤儿） | 计数硬编码/取错数据源 |
| N3 | L-1.5 收起态信号可达：`aria-expanded=false` + 徽章文本可见 + **徽章在折叠按钮内**（点徽章即展开） | 徽章沦为兄弟节点 → 收起态信号"看得见点不动" |
| N4 | L-1.6 `aria-expanded` 语义往返（false→true→false） | 折叠态与 a11y 语义不同步 |
| N5 | L-1.7 键盘可达性（原生 button / 未 disabled / 可聚焦 / click 通路） | 用 div 充当开关 → 键盘不可达 |
| N6 | L-4.2 收起后**不得残留**上一轮展开行/详情（展开→详情→收起→数据+文档变化→再展开） | 陈旧 `expandedAttach` 残留到新数据 |
| N7 | L-4.3 收起态不得渲染底部说明（独立用例，展开/收起往返） | 底部说明未随 gate 收起 |
| N8 | L-4.4 展开态不得被持久化：**卸载重挂仍默认收起** | 展开态被写到持久层/nav 切换后残留 |

---

## 4. Lead 指定的三条重点核验（独立证据）

### 4.1 默认收起时数据请求照发

用例 L-1.2；断言 `listAttachments().mock.calls.length ≥ 1` **且** `listOrphans().mock.calls.length ≥ 1`，在**未做任何点击**的默认收起态下成立 → **PASS**。
配套 L-1.3：3 附件 + 1 孤儿的替身数据下，收起态表头文本匹配 `附件 3` 且孤儿信号可见 → 计数/徽章确实源自请求数据 → **PASS**。

### 4.2 收起态零残留

- L-4.1：默认收起态 `findClickable('共享图.png') === undefined`、`orphanScope() === undefined`、无删除入口；展开后齐全；**再收起后三者再次全部消失**。
- L-4.2：展开 → 点开「共享图」详情（DOM 含 `Articles/子文档B`）→ 收起 → 断言详情文本消失 → **切文档 + 换数据（`activeId` 变化 + `refreshKey` 变化，旧附件不再存在）** → 再展开：`[data-attachment-detail]` 计数 **0**、旧引用详情文本 **0** → **PASS**。
- L-4.3：底部说明「不随笔记回滚」在收起态不出现、展开态出现、再收起再次消失 → **PASS**。
- L-4.4：展开 → 卸载 → 重挂：`aria-expanded=false`、`rowCount()=0`、无孤儿块、无详情残留 → **PASS**（展开态未被持久化）。

### 4.3 收起态孤儿信号可达

用例 L-1.5；实测：`aria-expanded === 'false'` → 徽章 `[data-testid="orphan-badge"]` 存在且文本匹配 `孤儿附件 1` → **`toggle.contains(badge) === true`（徽章位于折叠按钮内部）** → 点击徽章后 `aria-expanded === 'true'` 且附件行渲染 → **PASS**。
（当前实现已把徽章放进 `<button>` 内；task-14 时它是按钮的兄弟节点 —— 本用例即为该结构的回归防线。）

---

## 5. `git status --porcelain` 范围核对

本次验证跑后实测：

```
 M backend/app/main.py
 M frontend/src/components/layout/LeftSidebar.test.tsx
 M frontend/src/components/layout/LeftSidebar.tsx
 M frontend/src/components/layout/LeftSidebar.verify.test.tsx
?? backend/app/services/self_heal.py
?? backend/tests/test_self_heal.py
?? backend/tests/test_self_heal_verify.py
```

- **属于本任务范围**：`LeftSidebar.tsx`（dev）、`LeftSidebar.test.tsx`（dev）、`LeftSidebar.verify.test.tsx`（verifier，`M`）。报告 `docs/verification-attach-collapse.md` 为新增 verifier 产物。
- **不属于本任务范围（其它任务的并行工作）**：`backend/app/main.py`、`backend/app/services/self_heal.py`、`backend/tests/test_self_heal.py`、`backend/tests/test_self_heal_verify.py` —— **我未触碰这些文件**（整个验证过程只写入 §0 所列我自己的 verify 文件与本报告）。
- 范围核对结论：**除上述 backend 并行项外，工作区改动与 task-24 预期范围完全一致，无越界写入**。

---

## 6. 归因与未验证项

**归因**

| 类别 | 项目 | 说明 |
|---|---|---|
| 本次引入（需求变更） | 默认态由「展开」反转「收起」 | 主理人裁决；我已同步判据并留「改前 vs 改后」对照（§3） |
| 本次引入（无缺陷） | 收起态数据照发、零残留、徽章在按钮内可达 | 33/33 PASS |
| 既有（非本次，正常） | 全量 1 个 skipped | `editor/perf-bench.test.ts` 既有 skip |
| 既有（非本次，环境） | happy-dom 不合成 Enter/Space → click | 实测 `PROBE_ENTER_AFTER=false`、`PROBE_SPACE_AFTER=false`；故键盘用例只断言「原生 button + 可聚焦 + click 通路」，不构造环境假红 |
| 范围外（并行任务） | `backend/**` self_heal 相关改动 | 非本任务写入；已在 §5 声明 |

**未验证项（如实列出，不含推测）**

| 项 | 原因 |
|---|---|
| **真实浏览器中的键盘激活**（Tab 聚焦 + Enter/Space 展开） | happy-dom 不合成键盘激活事件（已实测并留痕）；已断言结构前提（原生 `<button type="button">` 未 disabled、可聚焦）与 click 通路，但未在真实浏览器验证 |
| **GUI 目视验收**（收起后左栏观感、徽章可读性、点击热区） | 归 Lead（主理人/Lead 自述做 GUI 目视）；本报告为组件级 + 程序化证据 |
| **真实后端跨层端到端** | 本套件为组件级替身测试；后端 pytest 由并行任务覆盖，未做 UI↔后端联调 |
| **真实像素布局**（超长名是否真溢出、徽章是否被裁） | happy-dom **无布局引擎**；仅校验 `truncate` 样式类存在 |
| **跨进程/跨会话持久化**（若未来把展开态写入 localStorage/设置） | 当前实现为组件内 state；已验证「卸载重挂仍默认收起」，但未覆盖磁盘/设置层持久化（当前不存在该路径） |
| **绕过 `api/client` 的 XHR/WebSocket 写请求** | 已覆盖 27 个写函数替身 + 裸 `fetch` 绊线；未对 WebSocket/`sendBeacon` 做运行时拦截 |

---

## 7. 复跑指引

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
sha256sum src/components/layout/LeftSidebar.tsx src/components/layout/LeftSidebar.test.tsx src/components/layout/LeftSidebar.verify.test.tsx
# 期望 775c4b70… / b00c6b22… / e861daa1…（我改判据后的版本）
npx tsc -b --noEmit                                   # 期望 exit 0
npx vitest run src/components/layout/LeftSidebar.verify.test.tsx   # 期望 33 passed
npx vitest run                                        # 期望 38 files / 548 passed + 1 skipped
```

**验证产物**：本报告 + `frontend/src/components/layout/LeftSidebar.verify.test.tsx`（33 例）。
验证者全程**未修改任何源码**（`LeftSidebar.tsx`、`LeftSidebar.test.tsx`、`RightPanel*`、`App.tsx`、`api/client.ts`、`backend/**`、`desktop/**`、`scripts/**` 均未触碰）。
