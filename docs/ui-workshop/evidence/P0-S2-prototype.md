# P0-S2 原型证据：换 shell 不重建持续编辑面（Windows/WebView2 实机）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155.0.0.0（Tauri v2 原型 app）**
- 代码：
  - harness：`docs/ui-workshop/prototypes/p0/s2_editor/harness.ts`（Tiptap/ProseMirror 最小编辑器）
  - 构建：`build_s2_harness.sh`（esbuild 打包为单文件 IIFE，产物 s2.js 不入库）
  - 宿主：`prototypes/p0/s1_runtime/tauri_sandbox/`（Rust setup 打开 `s2-shell` 窗口加载 s2.html）
  - 驱动：`prototypes/p0/s1_runtime/run_s2_probe.py`（Windows Python；结果经 Tauri `report_results` 落盘）
- 原始结果：`evidence/P0-S2-probe-results.json`（**10/10 断言通过**）
- 证据类型：**W（WebView2 实机运行）** + U（harness 逻辑）；测试数据全部在临时目录/内存

## 实验内容

harness 在真实 WebView2 页面内：
1. 创建**一个** Tiptap `Editor`（StarterKit），挂载在 shell A 的 editor-host；记录 `editor.view` 身份与初始文档；
2. 执行两次编辑（插入 AAA/BBB），写入 shell A 的「源码通道」textarea 草稿；
3. **只移动 `view.dom`** 到 shell B 的 editor-host（不 new Editor、不 setContent）；
4. 断言：`editor.view` 与 DOM 身份不变、正文内容不变、旧 shell 的 editor-host 已空（移动而非复制）、
   undo/redo 在新 shell 下继续可用、焦点/输入可用、synthetic composition 事件不丢内容、源码草稿保持；
5. 再移动回 shell A，二次断言身份/内容/草稿。

## 实测结果（原文摘要）

```json
{
  "phase": "s2-done",
  "editorCreated": true,
  "initialDoc": "初始内容 initial",
  "docAfterEdits": " AAA BBB初始内容 initial",
  "viewIdentitySameAfterSwap": true,
  "docAfterSwap": " AAA BBB初始内容 initial",
  "shellAAfterSwapEditorHostChildren": 0,
  "sourceDraftPreserved": true,
  "docAfterUndoInShellB": "初始内容 initial",
  "undoWorkedAfterSwap": true,
  "redoWorkedAfterSwap": true,
  "focusInputWorked": true,
  "compositionSyntheticHandled": true,
  "viewIdentitySameAfterSecondSwap": true,
  "docAfterSwapBack": " AAA BBBFOCUS中初始内容 initial",
  "sourceDraftPreservedAfterSecondSwap": true,
  "userAgent": "… Chrome/155.0.0.0 … Edg/155.0.0.0"
}
```

`events.log` 记录：`s2-shell opened by rust setup` → `host-js: s2-harness-reported`。

## 结论（供 T07 ADR / T14–T15）

- **「换 shell 只移动宿主 view.dom」在真实 WebView2 中可行**：EditorView 身份、正文、history（undo/redo）、
  焦点与组合输入路径均保持；不需要重新解析 Markdown 或重建编辑器。
- **源码草稿**可以跨 shell 保持（本原型按 shell 复制 textarea 值；产品化需 T14 的常驻 source DOM 注册表）。
- 该结论支持架构中的「持续 OfficialEditorSession + 周边 UI 换壳」路线，但**不是** T03 完整验收。

## 限制 / 未验证（明确不冒充通过）

- 使用最小 Tiptap StarterKit，**不含产品 React NodeViews/MathLive/自定义 NodeView**；NodeView 身份与
  公式交互留给 T14/T03 完整实现验证。
- 两个 shell 都是 vanilla DOM 容器（非两个真实框架），框架差异本身对身份结论无影响；
  完整「两个不同框架 shell」验证在 T24。
- 组合输入为 **synthetic CompositionEvent**，不是真实中文 IME 组词；真实 IME/DPI/缩放/遮挡留待 T15 Windows 验收。
- 未验证 guest 包 shell 与宿主编辑面跨 WebviewWindow 的场景（本原型在**同一 webview 内**移动 DOM，
  这是「常驻编辑面 + 周边 UI」的首发模型；跨 webview 编辑面不在本路线）。
