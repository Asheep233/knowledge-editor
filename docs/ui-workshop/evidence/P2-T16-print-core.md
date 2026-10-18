# P2-T16 证据：打印产品化 Core — 指定 revision 快照的 Job 队列/状态机/取消/超时（12 例）

- 日期：2026-10-19 · 代码（产品仓库内 Core 打印层，无 DOM/React 依赖）：
  - `frontend/src/core/print/printJob.ts`：`PrintJobManager` + `PrintSnapshot`/`PrintRenderer`/`PrintTransport`
  - `frontend/src/core/print/printJob.test.ts`：12 例
- 关联既有 W 证据：`evidence/P0-S4-prototype.md`（Windows/WebView2 真实 PrintToPdf：PDF 90,002B /
  未保存内容 / 公式 / 源笔记 hash 不变，6/6 PASS）
- 证据类型：**U（Core 单测）+ 既有 W（S4 真实 PDF 探针）**

## 测试结果

```text
$ npx vitest run src/core/print
Tests  12 passed (12)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 成功 | queued→rendering→printing→done；输出 pages/pdfPath |
| 状态序列 | 中间状态完整、可观测（供 UI 进度） |
| 串行 | maxConcurrent=1 时第二 Job 等第一完成（打印资源串行） |
| 取消 queued | renderer **不被调用**，Promise 以 E_CANCELED 结束 |
| 取消 rendering | signal abort，状态 canceled，不产生输出 |
| 渲染失败 | failed + 错误保留（不 panic） |
| 打印失败 | failed |
| **快照绑定** | renderer 收到入队时的快照副本（revision=7、内容不被后续编辑污染） |
| 输出路径校验 | 非法路径 → 拒绝入队（不创建 Job；产品注入工作区之外/不覆盖规则） |
| 超时 | E_TIMEOUT failed，signal abort |
| 非法快照 | revision 非整数 → 直接拒绝 |
| DOM/React 守卫 | 打印层源码无 `document.`/`window.`/react |

## 结论

- T16 的 Core 语义成立：**打印只消费指定 revision 的可信快照**（不读当前编辑 DOM、不隐式保存）、
  Job 状态机/串行/取消/超时/路径校验完整；与 S4 的 Windows/WebView2 真实 PDF 探针互补。
- T16 尚未完成（产品化剩余）：
  1. 产品隐藏 renderer 窗口 + Rust `PrintToPdf` 接线（现有产品 print.rs 打印主窗口，需改为独立 renderer
     快照窗口，含字体/KaTeX/图片就绪等待与清理）；
  2. 长文档分页/页边距/纸张选项、深色主题、源码模式打印；取消后的 Rust 侧清理与 job 对账；
  3. 打印 UI（进度/取消/错误提示）与 Windows/WebView2 端到端 W 证据（T21/T26）。
