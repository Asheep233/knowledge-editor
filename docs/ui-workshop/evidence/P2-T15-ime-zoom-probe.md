# P2-T15 证据：WebView2 CDP 驱动真实编辑面的 IME/焦点/缩放验收（8/8 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型，S2 持续编辑面窗口）**
- 方法：原型 app 以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<随机>` 启动，
  Windows Python 经 **CDP（Chrome DevTools Protocol）** 连接真实 WebView2 页面：
  - `Input.imeSetComposition` + `Input.insertText`：走浏览器 **IME 组词输入路径**
  - `Input.dispatchMouseEvent`：真实鼠标点击编辑面获得焦点
  - `window.__TAURI__.webviewWindow.getCurrentWebviewWindow().setZoom(1.25)`：真实缩放
    （原型已授予 `core:webview:allow-set-webview-zoom` capability）
  - `Runtime.evaluate` 读取真实 Tiptap Editor 的文本/撤销状态/dpr
- 代码：`prototypes/p0/s2_editor/harness.ts`（新增 `window.__s2` 探针 API）、
  `prototypes/p0/s1_runtime/run_t15_cdp_probe.py`、原型 `tauri.conf.json` capabilities
- 原始结果：`evidence/T15-ime-zoom-probe-results.json` · 证据类型：**W（Windows/WebView2 实机）**

## 实测结果：**8/8 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T15-1 CDP 页面存在（WebView2 remote debugging） | PASS |
| W-T15-2 持续编辑面 harness 就绪（`window.__s2`） | PASS |
| W-T15-3 真实 WebView2 环境（UA Edg/155） | PASS |
| W-T15-4 编辑面可聚焦（真实鼠标点击后 activeElement 为 contenteditable DIV） | PASS（document.hasFocus=true） |
| **W-T15-5 IME 组词输入进入编辑面**（`imeSetComposition` + commit） | PASS（正文含「中文组词」） |
| W-T15-6 IME 输入可撤销（history 正常） | PASS |
| **W-T15-7 缩放可用且 dpr 变化**（Tauri setZoom → dpr 2 → 2.5） | PASS |
| W-T15-8 缩放后编辑面仍可输入 | PASS |

## 限制 / 未验证（明确记录）

- IME 为 **CDP 浏览器级 composition 模拟**（真实走 WebView2 组合输入管线），不等于物理键盘 + 系统中文
  IME 的人工验收；真实 OS IME 需用户手工/自动化补测（T15/T26 待办）。
- 缩放为 WebView2 页面缩放（dpr 变化）；**多显示器不同 DPI 拖拽切换**未测（需要物理/显示器矩阵）。
- 焦点测试使用 CDP 鼠标点击（后台窗口经 focus emulation）；真实窗口失焦/遮挡场景未测。
- 探针钩子 `window.__s2` 仅存在于原型构建（非产品代码）。

## 结论

- T15 的关键路径（编辑面焦点、IME 组合输入与撤销、真实缩放后编辑）在 **Windows/WebView2 CDP 实测**通过，
  为「持续编辑面 + 真实 IME/缩放」提供了可复跑的实机证据链。
- T15 仍 in_progress：真实 OS 中文 IME、多 DPI 拖拽、失焦/遮挡、与真实产品 EditorSession 接线后的
  回归（T14 接线完成后再测）。
