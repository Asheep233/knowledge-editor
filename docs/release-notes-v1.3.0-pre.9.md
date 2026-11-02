# AstraNota v1.3.0-pre.9（预发布）

> **预发布版本**：正式版仍为 `v1.2.18`（Latest）。本版修复 pre.8 独立复测发现的 **PDF 预览与导出一致性 FAIL**：
> 冷 WebView profile 首次真预览与正式导出的页数/正文不一致（431 vs 434 页）。
> 编辑器三项（R1-1 / R1-table / R1-S）在 pre.8 复测中已 PASS，本版不改动其逻辑。

## 背景：pre.8 独立复测结果

报告：`F:\Work\KE Project\perf-retest-2026-11-02\REPORT.md`（证据/可复跑脚本同根）

| 项 | 结论 | 关键数字 |
|---|---|---|
| R1-1 PDF 量测离屏 | PASS | 默认 3s 首 dirty p95：1MiB 640.3→27.3ms、5MiB 3248.1→80.9ms；严格 8s：196.6→14.3 / 953.4→46.5ms（n5）；root data-theme 写入 8–12→**0** |
| R1-table 早拒绝 | PASS | 原生 1MiB 同字节纯 parse 两组改善 **27.46% / 42.81%** |
| R1-S 源码 no-op 复用 | PASS | 20MiB 原始 n5 + 保存后 n3 均 **parse=0**、PM 引用/JSON 不变；返回样本全部 ≤20s（最大 13.74s；保存后 13.87s） |
| R1-D PDF | 部分 PASS / 一致性 FAIL | 正式导出 20 份（19+1 恢复）页数/全文一致、0 回退/孤儿；但**冷 profile 首次预览 431 页 vs 导出 434 页**（MediaBox/内容宽/主题/DPR 相同，规范化全文不同，新 profile 可复现） |

## 相对 v1.3.0-pre.8 的变化：R1-D2 资源就绪守卫

- **根因（静态强候选 + 冷路径复现）**：正式导出路径有 `waitForPrintFonts()`，而**真预览路径应用打印样式后立即 invoke `preview_pdf`**；
  新 WebView profile 首次打印时 KaTeX 字族（Size1..4 等）尚未加载/解码 → 分页与最终导出一致性失守。图片懒加载且两路径均无图片就绪守卫（次要候选）。
- **修复**：新增 `frontend/src/editor/pdfPage.ts::waitForPrintReadiness()`（有界 8s、不抛）：
  1. `waitForPrintFonts`（6 个 KaTeX 字族 + `document.fonts.ready`）；
  2. 正文内未完成 `<img>` 等待（强制 `loading=eager`，load/error 结束；超时仅告警不阻塞）；
  两条路径（`ExportPdfDialog` 真预览生成 / `exportPdfWithOverrides` 正式导出）**共用同一守卫**后再向原生发打印请求。
- 不加大超时、不改既有 seq/disposed 复查与单飞队列；资源未就绪只 `console.warn` 不阻塞用户。
- 新增单测：图片收集/加载/超时/无资源快速通过 4 例（`editor/pdfPage.test.ts`）。

## 发布资产

（构建完成后补全）

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-pre.9`） |
| 前端全量测试 | **153/153 文件、2083 passed + 1 skipped**、EXIT=0 |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-pre.9` 与源码一致 ✔ |

## 复测验收（待 codex-agent 在 pre.9 独立复测，当前 UNVERIFIED）

- 5 个**新 WebView profile**：首个长文 preview↔export **页数与规范化全文一致**；
- 每 profile 连续 2 次正式导出一致；0 误回退 / 0 孤儿预览；
- 保存资源就绪证据（字体/图片状态、`waitForPrintReadiness` 结果）、IPC 与落盘证据。

## 已知限制（未变）

- 20MiB 默认排版首开仍约 2 分钟，属第 2 轮大文档保护范围（源码优先/Worker/可见区渲染）。
- 10k 首次激活仍受同步索引 + 30s 健康握手限制，未实施/未复测，不能据此放行该规模正式支持。
- 安装包未签名；PDF 打开期间切换应用主题不会实时反映到快照（打开时捕获），宽度随 resize 更新。

## 升级/回滚
- 预发布，可直接覆盖安装 pre.1–pre.8（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。
