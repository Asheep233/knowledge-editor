# P0-S4 原型证据：独立只读快照 renderer + WebView2 真实 PDF（Windows 实机）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155.0.0.0（Tauri v2 原型 app）**
- 代码：
  - Rust：`prototypes/p0/s1_runtime/tauri_sandbox/src/print_proto.rs`（从产品 `print.rs` 简化移植：
    对**指定窗口**执行 WebView2 `PrintToPdf`，ShouldPrintBackgrounds、页眉页脚关、页边距 0、
    页宽=内容宽+打印内边距、异步完成回调、拒绝覆盖已有文件、轮询等待落盘）
  - renderer harness：`prototypes/p0/s4_print/harness.ts`（esbuild + KaTeX CSS 内联；
    用**内存 session 快照**生成只读 HTML：标题/未保存标记/行内+根号公式/表格）
  - 驱动：`prototypes/p0/s1_runtime/run_s4_probe.py`（Windows Python + PyMuPDF 校验真实 PDF）
- 原始结果：`evidence/P0-S4-probe-results.json`（**6/6 断言通过**）
- 证据类型：**W（Windows/WebView2 真实 PrintToPdf）**；测试数据全部在 `C:\ke-tmp` 临时目录

## 实测结果

| 检查 | 结果 |
| --- | --- |
| S4-1 Rust setup 打开独立 print-render 窗口 | **PASS**（events.log: `print-render opened by rust setup`） |
| S4-2 harness 完成；KaTeX 渲染 2 处公式 | **PASS**（phase=s4-done, katexCount=2） |
| S4-3 快照含未保存内容标记（来自内存 session） | **PASS** |
| S4-4 **真实 PDF** 生成且含未保存内容 | **PASS**：PDF **90,002 B / 1 页**；PyMuPDF 文本含 `UNSAVED-SNAPSHOT-MARK`，且含公式文本 `E = mc2`、根号分式（KaTeX 排版结果进入 PDF） |
| S4-5 打印**不隐式保存** | **PASS**：临时源笔记 `note.md` sha256 前后不变（`31167937…`） |
| S4-6 输出在系统临时目录（工作区之外） | **PASS**：`C:\ke-tmp\uiws-s4-probe\probe-s4\snapshot.pdf` |

原始 JSON：`P0-S4-probe-results.json`。

## 结论（供 T07 ADR / T16）

- **独立打印面在 Windows/WebView2 上可行**：指定窗口渲染只读快照（含未保存内容/公式/表格）→ `PrintToPdf`
  产出真实 PDF；打印过程不读取磁盘正文、不触发保存（临时笔记 hash 不变）。
- 与产品现有 PDF 链的差异/关系：产品 `print.rs` 打印主窗口；本原型验证「**独立 renderer 窗口**」打印，
  为 T16「可信打印面」的窗口/路由形态提供证据。
- 打印窗口当前显示可见；产品化需隐藏窗口/离屏策略与资源就绪等待（字体/图片/KaTeX ready）、
  job 指定 workspace/session/revision、Rust 路由与清理（T16 完成）。

## 限制 / 未验证

- 快照为原型内构造的内存对象（模拟 session 快照），未接真实 EditorSession revision（T14/T16）。
- 仅单页内容；未测长文档分页、图片/附件映射、页边距/纸张选项、深色主题、源码模式。
- 未验证窗口隐藏/离屏打印、打印期间 UI 占用、失败重试与 job 清理。
