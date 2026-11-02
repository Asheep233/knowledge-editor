# AstraNota v1.3.0-pre.8（预发布）

> **预发布版本**：正式版仍为 `v1.2.18`（Latest）。本版落地 **Codex 独立性能审查的第 1 轮优化（4 项）**：
> PDF 量测离屏、表格 tokenizer 早拒绝、源码 no-op 往返复用驻留模型、PDF 等待真实打印完成。
> 实现说明：`docs/focus-ui/PERF-ROUND1.md`；证据：`docs/focus-ui/evidence/perf-round1/`。

## 相对 v1.3.0-pre.7 的变化

### 1. R1-1：PDF 专用量测移出日常渲染（首次 dirty 卡顿热点）
- 修复前：`<ExportPdfDialog>` 常驻 JSX，PDF 关闭时每次 EditorArea render 仍求值 `measureEditorContentWidth()`、
  `getComputedStyle(prose).color`、`readThemeTokens('light')`、`readThemeTokens('dark')`（后两者临时改 root `data-theme` 再强制读样式）。
  本地实测单次击键触发 **16 次 root data-theme 写入 / 27 次 getComputedStyle**。
- 修复后：对话框仅在打开时挂载，快照（主题令牌/正文色/内容宽）打开时采集一次；关闭时**零 PDF 量测**。
  本地 dev A/B：单次击键 root `data-theme` 写入 **16 → 0**，getComputedStyle **27 → 11**。

### 2. R1-table：表格 tokenizer 早期拒绝（大文档解析热点）
- 修复前：block tokenizer 第一步 `src.split('\n')` 处理**剩余全文**，每个块尝试都切一次长尾（20MiB CPU profile 中该函数 self 约 107.6s）。
- 修复后：先只读头两行判断「表头+分隔行」候选，不匹配立即返回；确认候选后才切行。语义由新增单测 + 全部表格保真套件锁定。
- 本地 dev 1MiB 纯 parse 中位 **294 → 228ms（−22.4%）**（dev 参考口径）。

### 3. R1-S：源码「原文未改」往返复用驻留模型
- 修复前：`exitSourceMode` 无条件 `setKeContent` → 整篇 Markdown 重新解析（审查实测 20MiB 返回 169.35s，其中 re-parse 156.73s，占 92.55%）。
- 修复后：进入源码记录 checkpoint（docId / 载入代次 / reloadToken / 驻留 PM doc 引用 / 进入时源文）；退出时全一致则直接复用 PM、
  跳过重解析，并用 0 步 history 事务保持「源码返回清 undo/redo」策略。任一条件不满足 / 源码有改动 → 仍走原重解析链路。
- 回归：`sourceReuse.test.ts` 6 类失效反例 + 集成测试（no-op 不调 `setKeContent`；有改动仍重解析）。

### 4. R1-D：PDF 等待真实打印完成（正确性修复）
- 修复前：`with_webview` 只把闭包**投递**给 UI 线程就返回，外层立刻读错误槽并最多轮询 3s —— 长文/UI 忙时完成回调晚于 3s 即误报「PDF 未出现」，
  前端回退 DOM 克隆/系统打印（可能产生整文副本与不一致内容）。
- 修复后：闭包在真实 COM 完成回调里回传 `(结果, 成功标志)`，异步命令等待该结果（180s 安全超时）后再校验文件；
  新增 PDF 打印全局串行锁；前端预览生成队列化（单飞 + 过期 seq 跳过），避免并发 `PrintToPdf`。

## 发布资产

（构建完成后补全）

## 验证

| 项 | 结果 |
|---|---|
| Rust | `cargo check` 通过（exit 0） |
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-pre.8`） |
| 前端全量测试 | **153/153 文件、2079 passed + 1 skipped**、EXIT=0 |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-pre.8` 与源码一致 ✔ |

## 性能验收状态（诚实标注）

本地仅做机制/方向复核（Linux dev preview + headless Chromium，**非产品验收**）：
- R1-1：PDF 关闭时单次击键 root `data-theme` 写入 16→**0**（机制达成）；
- R1-table：dev 1MiB 纯 parse 中位 294→228ms（**−22.4%**，dev 参考）；
- R1-S：1MiB no-op 返回不再调用 `setKeContent`（755ms；单测强制）；
- R1-D：Rust 编译通过 + 现有 PDF 对话框测试通过。

**UNVERIFIED（待 codex-agent 在 pre.8 Windows 真机用同语料同探针独立复测）**：
1/5 MiB 首次 dirty rAF p95 ≤100/250ms；原生 1MiB parse 中位降≥20%；20MiB no-op 返回 ≤20s 且 parse=0；
PDF 固定快照连续 2 次/累计 5 轮 0 误回退、页数/规范化正文一致。这些不构成本轮 PASS。

## 已知限制

- PDF 对话框「跟随当前主题」令牌在打开时快照；打开期间切换应用主题不实时更新（宽度会随 resize 更新）。
- 源码 no-op 返回不再提示「未知语法可能被规范化」（因为不发生重新解析）；有改动/不可复用时仍提示并重解析。
- 10k 首次激活、20MiB 默认排版保护、tree 单次遍历、原生句柄退出、Worker 解析、异步索引、lazy 加载/内存预算属第 2 轮/候选，本版未实施。

## 升级/回滚
- 预发布，可直接覆盖安装 pre.1–pre.7（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。
