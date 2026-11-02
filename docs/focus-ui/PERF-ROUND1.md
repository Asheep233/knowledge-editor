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
---

## 独立复测结论（pre.8 · codex-agent，2026-11-02）

报告：`F:\Work\KE Project\perf-retest-2026-11-02\REPORT.md`（证据/可复跑脚本同根）

| 项 | 结论 | 关键数字（Windows 原生/解包 pre.8） |
|---|---|---|
| R1-1 PDF 量测离屏 | **PASS** | 默认 3s 首 dirty p95：1MiB 640.3→27.3ms、5MiB 3248.1→80.9ms；严格 8s 确认：196.6→14.3ms / 953.4→46.5ms（各 n5）；root data-theme 写入 pre.7 各 8–12 次 → pre.8 **0 次** |
| R1-table 早拒绝 | **PASS** | 原生 1MiB 同字节纯 parse 两组改善 **27.46% / 42.81%**（≥20% 目标达成） |
| R1-S 源码 no-op 复用 | **PASS** | 20MiB 原始 n5 + 保存后 n3 均 **parse=0**、PM 引用/JSON 不变；20MiB 返回样本全部 ≤20s（最大 13.74s；保存后最大 13.87s）；真编辑反例仍重解析/正确保存 |
| R1-D PDF 真实完成链 | **部分 PASS / 一致性 FAIL** | 正式导出重复稳定（20 份 = 19+1 恢复，页数/全文一致，0 回退/孤儿）；但**冷 profile 首次真预览 431 页 vs 正式导出 434 页**（MediaBox/内容宽/主题/DPR 相同，规范化全文不同），新 profile 复现 → **PDF 整体 FAIL**，阻塞正式版 PDF 一致性放行 |

### R1-D2（pre.9 追加修复）：预览与导出共享资源就绪守卫

- **根因（Codex 静态强候选 + 冷路径复现）**：正式导出路径有 `waitForPrintFonts()`，而**真预览路径应用打印样式后立即 invoke `preview_pdf`**；新 WebView profile 首次打印时 KaTeX 字族（Size1..4 等）尚未加载/解码 → 分页与最终导出不一致。图片 NodeView 懒加载且两路径均无图片就绪守卫（次要候选）。
- **修复**：新增 `editor/pdfPage.ts::waitForPrintReadiness()`（有界 8s，不抛）：
  ① `waitForPrintFonts`（6 个 KaTeX 字族 + `document.fonts.ready`）；
  ② 正文内未完成 `<img>` 等待（强制 `loading=eager`，load/error 结束，超时返回 ok=false 仅告警）；
  两条路径（`ExportPdfDialog` 预览生成 / `exportPdfWithOverrides` 正式导出）**共用同一守卫**后再向原生发打印请求。
- **测试**：`pdfPage.test.ts` 新增图片收集/加载/超时/快速通过 4 例；fake-timer 的预览链路测试 mock 守卫，避免测试环境字体 ready 不推进造成阻塞。
- **验收（待 codex 复测 pre.9）**：5 个新 WebView profile 中**首个长文 preview↔export 页数与规范化全文一致**；每 profile 连续 2 次正式导出一致；0 误回退/孤儿；保留资源就绪/IPC/落盘证据。

> 20MiB 默认排版首开仍约 2 分钟（Editor 数据项之外），属第 2 轮保护范围；10k 首次激活仍未实施/未复测，不能据此放行该规模正式支持。
---

## 验收状态（2026-11-02 收工）

- 用户决定**本轮暂不安排 pre.9 的 PDF 一致性独立复测**（`v1.3.0-pre.9` 已于 2026-11-02 发布为预发布）。
  → **R1-D2（预览/导出资源就绪守卫）保持 UNVERIFIED**：代码与单测已就绪，但「5 个新 WebView profile 首个长文 preview↔export 页数/规范化全文一致、每 profile 连续 2 次导出一致、0 误回退/孤儿」尚未在 Windows 真机独立复测。
  → **正式版前必须补此验收**（阻塞 PDF 一致性放行）；复测口径与目标见上文 R1-D2 与 Codex `perf-retest` 报告 §5。
- `F:\Work\KE Project\perf-retest-2026-11-02` 已清理会再生成的 `appdata`(1.13G) / `workspace`(0.54G) / `binary-pre8`(0.15G) 共 **1.82G**；保留 `REPORT.md`、`evidence/`、`scripts/`、`corpus-original/`（≈0.1G）供下次复测与审计。
- 磁盘清理本轮完成：KE 即时项 +6.15G、cargo-target +19.52G、perf-retest 重产物 +1.82G，合计 **+27.49G**；KE Project 剩余仅风险审核证据、仓库与复测报告。

