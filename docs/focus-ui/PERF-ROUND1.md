# 性能优化第 1 轮（Codex 审查处置）

> 来源：`F:\Work\KE Project\perf-review-2026-11-01\{REPORT,PLAN}.md`（codex-agent 独立审查）
> Lead 抽检记录：`F:\Work\KE Project\perf-review-2026-11-01\lead-spotcheck\SPOTCHECK.md`
> 实施日期：2026-11-02；目标版本：v1.3.0-pre.8（预发布）

## 实施项

| 编号 | 改动 | 文件 | 回归守卫 |
|---|---|---|---|
| R1-1 | PDF 专用主题/宽度量测移出日常 render：`<ExportPdfDialog>` 只在 `pdfDialogOpen && snapshot` 时挂载；快照在打开时采集一次，打开期间仅在窗口 resize 时更新宽度 | `frontend/src/components/layout/EditorArea.tsx` | `EditorArea.pdf-export.test.tsx`：PDF 关闭时多次 re-render **0 次 root data-theme 写入** |
| R1-table | 表格 tokenizer 早期拒绝：先只读头两行判断「表头+分隔行」候选，不匹配立即返回（不再 `split` 剩余全文）；确认候选后才切行 | `frontend/src/editor/tokenizers.ts` | `tokenizers.table-guard.test.ts`（合法/非法/长尾/无换行/缩进代码 语义不变）；全部表格保真套件 |
| R1-S | 源码 no-op 往返复用驻留 PM：进入源码记录 checkpoint（docId / 载入代次 / reloadToken / PM doc 引用 / 进入时源文）；退出时全一致则跳过 `setKeContent` 重解析，并用 0 步 history 事务保持「返回清 undo/redo」策略 | `EditorArea.tsx`、`editor/sourceReuse.ts`、`editor/index.ts`（导出 `clearUndoRedoHistory`） | `sourceReuse.test.ts`（6 类失效反例）；`EditorArea.pdf-export.test.tsx`：no-op 往返 `setKeContent` 不增加 / 源码有改动仍重解析 |
| R1-D | PDF 等待真实 COM 完成：`with_webview` 闭包通过 mpsc 回传 `(Result, WebView2 成功标志)`，async 命令 `spawn_blocking` 等待（180s 安全超时）后再校验文件；新增全局打印串行锁；前端预览生成队列化（单飞 + 过期 seq 跳过），避免并发 `PrintToPdf` | `desktop/src-tauri/src/print.rs`、`frontend/src/components/editor/ExportPdfDialog.tsx` | Rust `cargo check`；既有 PDF 对话框/导出测试；真机晚回调验收见下（UNVERIFIED） |

## 本地证据（dev preview，非 Windows 产品验收）

`evidence/perf-round1/measurements.json`：

| 指标 | 修复前（pre.7） | 修复后 | 结论 |
|---|---:|---:|---|
| PDF 关闭时单次击键 root `data-theme` 写入 | 16 | **0** | 机制达成 |
| 单次击键 `getComputedStyle`（root/prose） | 27（8/10） | 11（0/2） | 显著下降 |
| 1MiB 纯 MarkdownManager.parse 中位（dev，n=3） | 294ms | 228ms | **−22.4%**（dev 参考） |
| 1MiB 源码 no-op 返回：exit wall / reparse | — | 755ms / **0 次** | 功能达成（单测强制） |

> 说明：上述为 Linux dev preview + headless Chromium，**不是** Windows/WebView2 产品验收；R1-1 的 1/5MiB 首次 dirty p95、R1-table 的原生 parse 收益、R1-S 的 20MiB 原生数字、R1-D 的固定快照连续导出，均由 codex-agent 在 pre.8 上用同语料同探针独立复测（UNVERIFIED → 待复测）。

## 行为变化与已知限制

- PDF 对话框的「跟随当前主题」令牌在**打开时**快照；打开期间用户切换应用主题不会实时更新（宽度变化仍会随 resize 更新）。建议导出前确定主题；如需实时跟随，列入 R2。
- 源码 no-op 返回时不再触发「未知语法可能被规范化」确认（因为**不发生重新解析/规范化**）；源码有改动/不可复用时仍走原提示与重解析链路。
- 源码返回仍清空 undo/redo（与旧行为一致，用 0 步 history 事务实现）。

## 未包含（第 2 轮 / 候选）

tree 单次遍历、原生句柄退出、Markdown 解析 Worker 化、异步索引启动、lazy 加载/内存预算、10k 首次激活保护、20MiB 超预算源码优先入口。
