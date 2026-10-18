# ADR-002 T14 接线决策：既有 EditorArea 保存链 → Core SaveCoordinator（适配器优先、flag 双轨）

- 决策 ID / 日期：ADR-002 / 2026-10-19
- 待解决问题：如何把**既有产品 EditorArea/SaveQueue 保存链**迁到 Core SaveCoordinator，同时
  不隐藏旧 App、不破坏既有保存行为、可回退、可在无 React 测试下验证 Core 行为。
- 关联证据：`P2-T14-product-adapter.md`（适配层 6 例 + session 29 例）、`P1-T10-e2e.md`（真实后端
  19/19）、`P1-T13-core-gate.md`（UI-free 21/21）、`P1-T12-write-domain-slice.md`（context 写域端点）。

## 背景/约束

- 现有保存链：`EditorArea.buildSaveFn` → `saveQueue.enqueueSave` → `saveArticle(docId, md)`（PUT）；
  内含恢复点登记、traits（BOM/CRLF）还原、`lastSavedRawRef` 回写、源码直存通道、外部改盘对话框、
  A→B→A 竞态处理等**大量已验证行为**。
- Core 保存语义：可信快照 (revision+diskHash)、三阶段 accepted/recovery_durable/file_durable、
  requestId 幂等、abort 可 reconcile、切库 epoch 屏障（T09/T10 已实现并 e2e 验证）。
- 红线：不得隐藏旧 App 来冒充 Core 抽离；不得在未验证情况下改变保存语义（数据安全第一）；
  不要求一次替换整条链路。

## 决策

1. **适配器优先，双轨可回退**：新增 `VITE_KE_CORE_SAVE=1` 构建/运行 flag（默认关闭）。
   - flag 关闭：完全走现有 `saveArticle` 链（零行为变化；当前产品默认）。
   - flag 开启：`EditorArea.buildSaveFn` 内**仅 WYSIWYG 直写分支**改为经
     `createCoreSaveFn`（`frontend/src/core/session/productAdapter.ts`）调用 Core；
     源码直存通道（`buildSourceSaveFn`）、导出、打印暂不迁移（各自独立任务）。
2. **禁止双写**：flag 开启时同一次保存**只**走 Core 路径（不得同时调用 `saveArticle`），
   避免 revision/恢复点/外部改盘语义冲突；如需保险，用「先 Core 成功后清理旧恢复点」而非双写。
3. **上下文解析**：Core 需要 (contextId, epoch, relPath, revision, diskHash)。
   - 复用 T09/T12 产品端点：`/api/workspace/info` 取 root → `/api/context/open`（id=`ke-default`）
     → `/api/context/snapshot` 取 revision/diskHash；缓存于模块级（进程内一次），切工作区时失效重建。
   - `relPath` 取当前文档 `article.path`；**仅对「编辑器仍载着当前文档」的保存**启用 Core 路径，
     非当前文档的延迟保存（切档快照）继续走旧链，直到 T14 后续单独验证。
4. **失败语义**：Core 返回 conflict/失败时，旧 UI 的 dirty/错误提示照常（`CoreSaveError` 已映射）；
   连续失败超过阈值（如 3 次）自动降级回旧链并上报 telemetry 日志（仅本地）。
5. **验收门槛**（满足才允许把 flag 默认值改为开启）：
   - 真实后端 e2e：保存/切档/外部改盘/abort 路径回归（T10/T13 门禁 + 产品 UI 手工验收）；
   - 保存字节一致性：与旧链对同一编辑产出的文件字节一致（canonical 规则 R1–R6 内）；
   - 恢复点/草稿/源码通道行为不回归；前端全量 + 后端全量测试绿；
   - Windows/WebView2 实机保存验收（含快速连续输入、切档、外部改盘）。

## 被拒方案

- **一次性替换整条保存链**：风险不可控（恢复点/源码通道/外部改盘/竞态均未回归），拒绝。
- **双写（旧链 + Core 同时写）**：revision/幂等/冲突语义冲突，且写放大，拒绝。
- **在 Renderer 里直接新增 IPC 绕过 SaveQueue**：绕过既有串行化/abort 语义，拒绝。

## 回滚方式

- 运行时取消 `VITE_KE_CORE_SAVE`（或缺省）；代码保留双轨，无需数据迁移；
- 若 Core 保存产生异常文件：用旧链读取（markdown-on-disk 单一事实源）即可恢复，无库结构变更。

## 下一步（实现顺序，供后续轮次）

1. 实现 `coreSaveBridge`（上下文解析 + snapshot + `createCoreSaveFn` 组合）；
2. `EditorArea.buildSaveFn` flag 分支（仅当前文档 WYSIWYG 保存；单测 + 真实后端 e2e）；
3. 产品 UI 手工验收 + Windows 实机 W 证据；通过后才考虑默认开启与迁移源码通道/导出。
