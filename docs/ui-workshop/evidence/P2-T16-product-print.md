# P2-T16 证据：打印产品纵向切片 — 隐藏 renderer 窗口 + Rust PrintToPdf（快照打印）

- 日期：2026-10-19 · 代码（产品仓库）：
  - `desktop/src-tauri/src/print.rs`：抽取 `render_window_pdf_to(app, window_label, target, content_width)`
    （既有主窗口导出行为不变；打印设置/页宽/背景/页眉页脚逻辑复用）
  - `desktop/src-tauri/src/print_snapshot.rs`：
    - `ensure_render_window`：**启动时**创建隐藏 renderer 窗口（`visible(false)/focused(false)/skip_taskbar`），
      **env 门控 `KE_WS_PRINT_RENDER=1`（默认关闭，零行为变化）**；不在命令里创建窗口（防死锁）；
    - `print_snapshot_pdf(html, target, content_width)`：校验绝对路径/不覆盖已有文件 →
      注入可信快照 HTML（`document.open/write/close`）→ 等布局 → 对 renderer 窗口 PrintToPdf → 返回路径；
  - `frontend/public/print-render.html`：静态空白 renderer 页（含 `@page{margin:0}`）；
  - `frontend/src/core/print/tauriPrintTransport.ts`：`PrintTransport` 产品实现（invoke
    `print_snapshot_pdf`；支持 AbortSignal，取消不调用命令）；
  - 测试：`tauriPrintTransport.test.ts` 2 例
- 证据类型：**U/B（产品 Rust 构建 + cargo 34 单测 + 前端单测/全量回归）**；
  **产品端到端 W 未做**（运行时创建隐藏窗口需隔离安装，避免干扰用户正在运行的 AstraNota）

## 验证结果

```text
$ cargo test --release           # 产品壳
test result: ok. 34 passed; 0 failed
$ cargo build --release
Finished `release` profile [optimized]
$ npx vitest run --maxWorkers=2  # 全量前端
Test Files  130 passed (130)
     Tests  1793 passed | 1 skipped (1794)
$ npx tsc -b --noEmit
exit 0
```

| 检查 | 结果 |
| --- | --- |
| renderer 窗口仅在 env 开启时创建（默认零行为变化） | 通过代码路径（setup 门控） |
| 快照打印命令：绝对路径/不覆盖/注入 HTML/PrintToPdf | 通过编译与代码审查；无运行时 W |
| 前端 transport：参数/取消 | 2 例单测通过 |
| 既有导出 PDF 行为 | `render_pdf_to` 委托 `render_window_pdf_to("main")`，行为不变 |

## 结论

- T16 的**产品打印管线骨架**落地：快照→隐藏 renderer→PrintToPdf，与 S4 原型（真实 PDF 6/6 W）及
  Core 打印 Job（12 例 U）形成三层；默认 env 关闭，不影响既有发布行为。
- 尚未完成（T16 收尾）：
  1. **Windows/WebView2 端到端 W**：以隔离安装/数据目录运行产品，验证 renderer 隐藏、快照打印、
     PDF 内容/页数、取消清理、不覆盖；需避免干扰用户运行中的 App（T26 验收时执行）；
  2. renderer 就绪改为**显式 ready 握手**（当前固定等待 400ms）；长文档分页/主题/源码模式；
  3. 与打印 UI（T23/对话框）接线、job 取消后 Rust 侧清理与对账；环境变量开关的正式配置化。
