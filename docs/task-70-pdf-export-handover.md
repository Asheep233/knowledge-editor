# task-70（导出 PDF，与编辑器渲染完全一致）· 暂停状态交接

> 主理人 2026-10-12 要求**暂停**（未完成、未验收）。本文件只记录**当前落盘状态**与**恢复步骤**，不做任何实现决策。
> 恢复前请先读 `docs/render-stability.md`（I1/I2/I6 不变量）与 `docs/testing-discipline.md`（沙箱纪律）。

## 1. 需求（已拍板，勿再改口径）

- **导出当前文档为 PDF，PDF 内渲染与编辑器渲染完全一致**（"完全一致"含**颜色**）
- **主题跟随当前主题**（深色主题 → 深色 PDF，**不许**固定浅色）
- 范围：先做**当前文档**（批量二期）；页码/页眉页脚**默认关闭**；图片**内嵌**；**源码模式不参与导出**
- **安全门禁（主理人明确要求"别把我文件写坏了"）**：
  1. 导出前后**被导出文档 sha256 必须一致**（导出路径绝不调用保存/flush/`getMarkdown()`）
  2. 导出**不得在工作区产生/修改任何文件**（临时文件只用系统 temp）
  3. **输出路径保护**：指向工作区内部或与已有文件冲突 → **拒绝、不覆盖**
  4. 打印**不得改写编辑器 DOM**（只在 `@media print` 切样式；禁止 `innerHTML` 回写正文）
- **一致性门禁（可测）**：同一份 DOM 取编辑器截图 + PDF→PNG 位图比对 —— 几何偏差 ≤ ±1 CSS px 或 ±0.5%；
  **颜色平均 ΔE < 2** 且不得整块前景/背景反转；公式必须是**可选中矢量文本**；`$$` 不跨页；中文无乱码。

## 2. 当前落盘状态（暂停时，**均未提交**）

| 文件 | 状态 | sha256（暂停时） |
|---|---|---|
| `frontend/src/print.css` | **新建，完整**（129 行，最后一行 `}`） | `f5ef8c16cf84b10b8987c38bfe784ac831b8e3e695e3471bb2245f1f98ad487b` |
| `frontend/src/print-css.test.ts` | **新建，完整**（6 条 CSS 契约用例） | `255c212c586b47304f7c945cb98603d8e45a4777efa20ee8f910b40ba3cb1aac` |
| `frontend/src/main.tsx` | **已改**：`import './index.css'` → 追加 `import './print.css'` | `74af20df25dbfdcc383fe319c7129f8faaa889907e5818517af73d3e7b2f2bde` |

`print.css` 覆盖：`@media print` 包裹全部规则、`@page{margin:0}`、`html,body` 用 `var(--background)/var(--foreground)` 铺满整页、
`print-color-adjust`/`-webkit-print-color-adjust: exact`、隐藏外壳、`.ke-editor-prose` 宽度自适应（内边距充当可视页边距）、
公式/表格/图片/引用/代码块 `break-inside: avoid`、标题 `break-after: avoid`、代码块保留 `var(--muted)` 底色、字体 `inherit`、**零硬编码颜色**。

## 3. 未完成 / 未验证（**恢复时必须先补**）

1. **入口未接**：导出下拉实际在 **`frontend/src/components/layout/EditorArea.tsx:1156-1190`**（**不在** `EditorToolbar.tsx` —— 上一轮的写入边界写错了，恢复时须授权改 `EditorArea.tsx`，或把入口另置）。当前 **PDF 无任何 UI 触发点**，`window.print()` 也未接。
2. **未验证**：`npx tsc -b --noEmit` 与 `npx vitest run src/print-css.test.ts` **未运行**（被暂停打断）→ **不得声称通过**。
3. **选择器待真机核对**（按命名推断，未对真实 DOM 验证）：`.ke-status-bar` / `.ke-sidebar` / `.ke-toolbar` / `.ke-note` / `[data-ke-note]`。若类名不符，隐藏外壳与信息块分页会失效。

## 4. 恢复步骤（已侦察，无需重新发现）

1. 先跑 `tsc` + `print-css.test.ts`，绿了再往下（否则先修）。
2. 接入口（`EditorArea.tsx` 导出下拉；先用 `window.print()`），**不得**触碰保存链、**不得**调用 `getMarkdown()`/flush。
3. 一致性门禁脚本：**Windows Chrome**（`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`，WSL 侧 Playwright Chromium 缺 `libnspr4` 不可用）
   `--headless=new --print-to-pdf=out.pdf --no-pdf-header-footer` → **PyMuPDF（WSL 可用，1.28.2）**转 PNG → 与编辑器截图比对几何/ΔE/矢量文本/分页/中文；
   安全门禁用**沙箱目录快照 diff**（文档 sha256 不变、工作区零写入、输出路径拒绝覆盖）。
4. 最后才做 Rust 静默导出：`desktop/src-tauri/src/**` 新增 `#[tauri::command]` **子模块**（否则 E0255），
   调 WebView2 `ICoreWebView2_7::PrintToPdf`，**必须 `ShouldPrintBackgrounds = true`**（否则主题底色不输出），替换 `window.print()`。
5. 交付：先出 `1.2.12-dev.N` 给主理人验（对照图 + 门禁数字），通过后再进正式版（功能类按政策攒批）。

## 5. 纪律提醒

- 真机验证**只用文档副本 + 沙箱工作区**（`docs/testing-discipline.md`），**绝不打开主理人真实工作区**。
- 逐路径 `git add`；**不** do 整目录 `checkout/reset/clean`。
