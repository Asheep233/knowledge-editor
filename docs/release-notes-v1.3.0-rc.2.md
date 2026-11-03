# AstraNota v1.3.0-rc.2（Release Candidate 2）

> **发布候选版**：正式版仍为 `v1.2.18`（Latest）。RC.2 在 RC.1 基础上只修 **PDF 页边距**（用户反馈「导出 PDF 顶端/底端顶天顶地」）。

## 相对 v1.3.0-rc.1 的变化（仅此一项）

- **PDF 每页上下各留 16mm 空白**：`print.css` 的 `@page` 从 `margin: 0` 改为 `margin: 16mm 0`，正文不再贴纸边；长文档的页与页之间也不再顶天顶地。
- **页边距颜色跟随纸面**：`@page { background: var(--card) }` 让上下 16mm 区域与纸张同色（真实 Edge/WebView2 156 实测像素确认，**深色主题不会出现白边**）。
- **预览/导出同源**：真 PDF 预览与正式导出走同一套 CSS/Rust 参数，自动一致；DOM 回退预览按「内容高 = 页高 − 32mm」计算页数与分页位移，与真 PDF 页数口径对齐。
- 页数会相应略增（内容区高度 296.93 → 264.93mm，约 +10.8%；1MiB 长文约 434 → 480 页量级，实际以真机为准）。
- 保持：页眉标题与正文间距 8mm；左右 14mm 横向边距不变；打印总宽/内容宽公式不变。

## 发布资产

（构建完成后补全）

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0 |
| 前端全量测试 | （待填） |
| 视觉验收 | （待填） |
| 侧车版本一致性 | （待填） |
| 页边距像素验证 | Edge 156（与 WebView2 156 同引擎）headless 打印实测：`@page margin 16mm 0` 生效，页边距区域被 `var(--card)` 填满（浅色 #fff / 深色 #0e0e10 均无白条） |

## 已知限制（未变，RC 不覆盖）

安装包未签名｜125%/150% 缩放与多屏未验｜附件/模块端到端未验｜10k 首次激活不支持｜20MiB 默认排版首开约 2 分钟｜富媒体图片保真/慢资源超时未验｜系统打印 fallback UNVERIFIED。

## 升级/回滚
- 可直接覆盖安装 rc.1 及更早预发布（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。

## 验收参考
- PDF 一致性独立复测（pre.9）PASS：`F:\Work\KE Project\perf-retest-pre9-2026-11-03\REPORT.md`
- 本轮页边距实现：`frontend/src/print.css`、`frontend/src/editor/pdfPage.ts`（`PDF_PAGE_MARGIN_MM = 16`）、`frontend/src/components/editor/ExportPdfDialog.tsx`
