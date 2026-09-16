# v1.1.x Backlog（延后项 · 不阻断 v1.1.0）

> 来源：v1.1.0-pre.1 两阶段审查（第一轮 + K3 对抗式）延后项；K3 判定「功能安全」，
> 全部排入 1.1.x 迭代，不阻断本次正式发布。

| ID | 问题 | 根因 | 影响 | 优先级 | 备注 |
|---|---|---|---|---|---|
| K3-I1 | indexer 增量更新不刷新扫描签名，reconcile 退化为永久全量重建 | `_SIGNATURE_KEY` 仅 `rebuild()` 写入，`update_file` 不更新 | 启动性能退化（每次启动全量扫描） | P1 | 已拍板接受进 1.1.x；hash 入签名 |
| K3-I2 | rename/move 非原子、无 fsync，崩溃窗口内文件名与索引不一致 | 写路径一致性只在正文保存落实 | 极端崩溃下标题改名半完成 | P2 | 建议引用计数 + 原子 rename 先行 |
| K3-T1 | applyTheme 每次调用累积注册 matchMedia change 监听器 | 函数体内 addEventListener 无去重 | 内存泄漏累积、系统切换重复执行 | P2 | 改为单例注册 + unlisten |
| B1 | reconcile 签名判据（size+mtime_ns）在「等长+同 tick」时漏更索引 + flaky 测试 | `indexer.py:141-152` 判据粒度不足 | 搜索结果过期、测试偶发失败 | P1 | 可先修 flaky 测试再改判据；hash 入签名 |

## 拍板记录（K3 默认建议已确认）

- **O4 自定义强调色覆盖侧栏主色**：接受为预期（深色默认 #0065fd 路径不受影响），关闭。
- **B1 / K3-I1**：接受进 1.1.0（功能安全）；hash 入签名排 1.1.x。
- **F1 / F2**：随 1.1.0 一起修（已落地）。

## 验收备注

- v1.1.0 发布验收：七处版本源 = 1.1.0 且无旧版本串残留 ✓；RC-VERSION 关闭 ✓；
  F1/F2/K3-V3 修复落地且有测试（slug.test.ts 8 项）✓；六项硬约束 PASS ✓。


---


## v1.1.8 已落地（**v1.1.8 正式版已发布 · 2026-09-15**；原 pre.1 于 2026-09-08）

| 项 | 说明 | 验证 |
|---|---|---|
| **文件名保留原标题** | 新建/导入/改名/导出统一「仅替换非法字符」策略（不再 slug 化）| pytest 175 / vitest 248 / GUI 实测 |
| **S-1 草稿恢复点扩展到编辑防抖**（2026-09-14）| 登记节奏与保存防抖解耦：自首笔未登记编辑起至多 3s 必登记一次，**不因后续编辑重置**。根因比原描述严重——`saveQueue.enqueueSave` 是纯尾沿防抖且无 maxWait，连续输入时计时器被反复重置永不触发，丢失窗口**无界**（并非「一个 autosave 周期」）| pytest 314 / vitest 262+1skip / tsc 0；独立对抗验证 T1-T8 全过（`docs/verification-s1-s3.md`）|
| **S-3 附件保留原始文件名**（2026-09-14）| 上传保留原名（CJK/空格/大小写）。因 `file.filename` 用户可控，新增「净化层 + 路径层」双防线（复用 `sanitize_filename` + resolve 父目录校验 + `O_EXCL` 去重），并附带修 CJK 名 `Content-Disposition` latin-1 500（升级 RFC 6266）与 multipart `%22/%0D/%0A` 逆变换 | pytest 314 / 独立对抗验证 28 穿越 + 36 退化名 + 10 编码变体全过 |

## v1.1.8 候选（2026-09-08 全量测试产出）

| ID | 建议 | 价值 | 来源 | 状态 |
|---|---|---|---|---|
| S-1 | 草稿恢复点从「保存进行中」扩展到「编辑防抖」| 硬崩溃最多丢 3s 输入 | test-report-v1.1.8-pre §7 | ✅ 已落地（2026-09-14）|
| S-2 | 明确 GFM 脚注 `[^1]` 是否纳入支持（当前仅 ke 自有格式，外部文档粘贴会降级为纯文本）| 兼容性 | 同上 | ✅ 已落地（2026-09-14，方案 A/A2；见 `design-s2-gfm-footnote.md`）|
| S-3 | 附件上传保留原始文件名（当前时间戳重命名，用户难以对应）| 可发现性 | 同上 | ✅ 已落地（2026-09-14）|

## 移动路径 4 项已修（2026-09-15，F9b/F9c/F11/F12）

来源：`docs/design-file-management-feasibility.md` 的实测登记；验证留痕 `docs/verification-move-fixes.md`。

| ID | 修复 | 证据 |
|---|---|---|
| **F9c** | 移动目标末段走 v1.1.8 统一净化（复用 `markdown_io.sanitize_filename`，扩展名单独拼回），**扩展名收敛到源文件类型**（文档恒 `.md/.markdown`，附件随源）；净化后**重新**校验顶层/业务目录；NUL 在 `_guard_rel` 之前拦成 400（原先 `Path.resolve()` 抛 ValueError → 500） | 尾空格 `Articles/文档.md ` 旧 `文档.md.md ` → 新 `文档.md`；`....md/.md/..md/.. .md` 旧 `md`/`.md.md`（隐藏）→ 新 `untitled.md`/`md.md`；NUL 旧 `ValueError` → 新 `400 非法路径：含 NUL 字符` |
| **F9b** | dst 是**已存在目录**时给可操作提示（「请在目标路径里带上文件名」），与「已存在文件 → 409」区分；检查顺序固定在**顶层/同区校验之后、F9c 收口之前**（否则 `Articles/子目录` 会被补成 `子目录.md` 而绕过提示） | `dst='Articles/子目录'` → 409 文件夹提示，且硬断言 `Articles/子目录.md` **不存在**；`dst='Articles/.'` 仍 400（F8 语义） |
| **F11** | `app_config.rename_recent_document()`（原位替换，保 title/顺序/去重/上限 20）+ `_sync_after_move` 调用；目录移动按前缀逐条平移 | 移动后 `/api/workspace/recent-documents` 同步新路径；移动失败（4xx）时列表逐字节不变 |
| **F12** | 草稿文件改名 + `store.move_recovery()` 迁移 DB 记录（保留 id/saved_at/session_id，不新增表/不改 schema）；目录移动遍历迁移；目标草稿名已占用时**不覆盖**；无草稿 no-op | 新路径可恢复、旧路径不残留、草稿**逐字节不变**（SQLite 行级 + 文件字节双核验） |

**门禁**：`pytest` **597 passed + 2 skipped**（既有基线 462+2 + 开发者 42 + 独立验证 93，只增不减）；openapi 快照 3 passed（无新端点）；
`markdown_io.py` 未改；F8 归一化 400 与 P2-15 引用保护 409 均未回归。

**两条如实保留的 WARN（本轮新引入语义，非缺陷）**：
- **W1**：API 调用者显式写 `报告.PDF` / `新名.txt` 会**静默收敛**为 `报告.md` / `新名.md`。前端 `LeftSidebar.handleMove` 用 `` `${target}/${node.name}` `` 构造 dst（只换目录、保留源名）→ **UI 路径不可达**；响应 `to` 即权威实际路径。
- **W2**：附件 `photo.jpeg` → 目标 `photo.jpg` 会收敛回 `photo.jpeg`（同目录同主名 → 409），即**用 move 改附件扩展名不再可行**（修复前允许）。无数据丢失、UI 不可达。

**仍未做**：**F10**（移动模块文档不校验 `ke-module source` → 悬空引用）——方案已定「仅检测」，但「检测到之后拦截(409) 还是放行+警告」待主理人裁决。

## 本轮（2026-09-14）发现的独立遗留项

| ID | 项 | 事实 | 影响 | 建议 |
|---|---|---|---|---|
| **F-S1-2** | `EditorArea` 的 F14 内容快照分支恒假（自 `53803ca` 起）| 切档 effect 中 `articleRef.current?.id === prevId` 因 ref 同步 effect 声明更早而恒为 false → `contentSnapshotRef` 从未赋值 → `flushPending(A)` 的 saveFn 因 `snap === undefined` 直接 return | 潜伏：绕过 App 前置 flush 直接切档时，A 最后 <3s 的编辑**既不落盘也不登记**。生产路径被 `App.requestOpenArticle` 的 `flushWithTimeout` 挡住（T5b 实测正常）| 另立任务修复（涉及共享保存路径的历史敏感区，需独立验证周期）|
| **F-S1-3** | 中止分支 `cancel()` 语义过宽 | `draftRegRef` 为单例、与文档无关；中止非当前文档的保存会误清当前文档的未决登记 | 当前不可达（`abortPending` 唯一入口受全屏遮罩约束）| ✅ 本轮已修（`efdf5cc`，verifier T8 复测转绿）|
| W-S3-1/2/3 | 符号链接同名碰撞走 400（fail-closed）；`.. evil.pdf` 前导点残留；`trailing.pdf.` 400 | 行为观察，非安全缺陷 | 无 | 记录备查；W-S3-2 若要清除中间点串需改 `sanitize_filename`（共享），须主理人批准 |

## 状态更新（2026-09-08）

| ID | 状态 |
|---|---|
| B1 | ✅ 已修（签名判据加入内容 hash，v1.1.2 批次）|
| K3-I1 | ✅ 已修（update_file/move/delete 增量同步签名）|
| K3-T1 | ✅ 已修（F13：applyTheme 监听器模块级单例）|
| K3-I2 | ⏳ 未修（rename/move 原子性；极端崩溃窗口，P2）|