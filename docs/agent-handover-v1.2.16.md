# 主 Agent 交接文档 v1.2.16

> 前任主 Agent 留给下一任的完整交接。写作时间：2026-10-17。
> 请先读 §1–§3（现状 + 红线 + 环境），再按 §8 的「下一步」决定做什么。

---

## 1. 当前状态（一句话）

**AstraNota v1.2.16 已发布（Latest）**，master 干净、发布流程可重复；本轮（1.2.9 → 1.2.16）的核心工作是 **PDF 导出**、**导出预览**、**斜体 d 转正体**，以及两次**数据/渲染缺陷的定案**。

| 项 | 值 |
|---|---|
| 版本 | **v1.2.16**（tag `v1.2.16`，Release 四附件, `draft=false`） |
| master | 见 `git log --oneline -1`（v1.2.16 发布提交之后应有若干 docs/test 提交） |
| 安装包（工作区根目录） | `F:\Work\KE Project\AstraNota_1.2.16_x64-setup.exe` |
| 门禁基线（发布时实跑） | `tsc 0` · vitest **101 files / 1549 passed + 1 skipped** · `cargo test` 通过 · pytest 基线 **782 passed + 6 skipped**（后端本轮未改逻辑） |

**发布记录**：1.2.9（空公式块写盘）· 1.2.10（第三份审查批次）· 1.2.11（逐字一行损坏根因 + `_` 转义）· 1.2.12（PDF 导出）· 1.2.13（预览清晰度 + 导出健壮性）· 1.2.14（预览公式渲染）· 1.2.15（预览分页/颜色根因）· **1.2.16（预览=真 PDF + 斜体 d + 根号修复）**

---

## 2. 红线（不可违反，先读再动手）

1. **B 层标识符不可变**：`ke_version`、`ke-note`/`ke-attach`/`ke-module`/`ke-video` 等标记格式**不得改**。
2. **D 层 `ke-*` + Markdown 单一真源**：磁盘上的 Markdown 是唯一真源，往返必须字节级稳定（见 `docs/render-stability.md` I1–I6）。
3. **9 处版本源**统一用 `node scripts/bump-version.mjs <ver>`；dev 构建用 `node scripts/dev-version.mjs`（`x.y.z-dev.N`，不打 tag/不发 Release）。
4. **主理人笔记库绝不写入**：所有真机测试用沙箱 `C:\ke-tmp\ke-sandbox` + 文档副本；测试前把 `app_config.json` 的 `recent_workspaces[0]` 指向沙箱，**测试后必须还原**（备份：`/tmp/app_config.backup.json`），并**杀干净** `knowledgeeditor` / `knowledgeeditor-backend` / `msedgewebview2` 进程。
5. **不改序列化口径 / `ke-*` 格式 / 保存链**（除非有明确任务且先回报）。
6. 一个文件同一时间只有一个写者；逐路径 `git add`；**禁止**整目录 `checkout/reset/clean`；commit 用**引号 heredoc**（反引号会被 shell 解释）。

---

## 3. 环境事实（踩过坑，照抄即可）

| 场景 | 做法 |
|---|---|
| Shell | WSL（`python3`）；工作目录 `/mnt/f/Work/KE Project` |
| **Windows Python** | `/mnt/c/Users/y8882/AppData/Local/Python/pythoncore-3.14-64/python.exe`（已装 `pymupdf`、`websocket`、`Pillow`） |
| **cargo** | 只能用 `F:\Work\Dev\cargo\bin\cargo.exe`，并设 `CARGO_HOME=F:\Work\Dev\cargo`、`RUSTUP_HOME=F:\Work\Dev\rustup`、`CARGO_TARGET_DIR=F:\Work\Dev\cargo-target`（PATH 里只写 `cargo` 不带 `.exe` 会失败） |
| gh | `/mnt/c/Program Files/GitHub CLI/gh.exe`（TLS 偶发超时，重试即可） |
| Windows Chrome | `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`；CDP 端口 **9333** |
| WSL Playwright Chromium | **坏**（缺 `libnspr4`）→ 一律用 Windows Chrome + CDP |
| **Windows 脚本路径** | 必须传 Windows 路径（`C:\...`），`/mnt/c/...` 会被当成仓库内相对路径 |
| PyInstaller | `cd backend && python.exe -m PyInstaller --noconfirm knowledgeeditor-backend.spec`，产物拷到 `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` |

### 打包/发版脚本（都在 `C:\ke-tmp\`）
- `smoke-pre1.ps1`：启动应用（用于 CDP 真机验证）
- `rebuild-nsis.sh`：Windows 侧 cargo build + NSIS 打包
- `gen-manifest.py`：生成 sidecar 校验清单
- 一堆探针脚本：`export-hw.py`、`realpdf-verify.py`、`upright-d-test.py`、`opaque-check.py`、`radical-check.py`、`statusbar.py` 等（按需改写）

### ⚠️ dev 构建纪律（本轮踩过的坑）
> **凡是用 `dev-version.mjs` 改过版本的构建，必须重建侧车（PyInstaller）**，否则前端 `x.y.z-dev.N` 与侧车 `x.y.z` 不一致 → 底栏报「版本不一致」。
> 正确顺序：`dev-version` → 前端 build → **PyInstaller 侧车 + 拷到 `binaries/`** → `rebuild-nsis.sh` → `gen-manifest.py` → 验证底栏无告警。

---

## 4. 本轮做了什么（含根因，别重查）

### 4.1 PDF 导出（v1.2.12 起，task-70）
- 技术路线：**用宿主自身引擎打印**（WebView2 `ICoreWebView2_7::PrintToPdf`），不另起渲染器 → 才能"与编辑器完全一致"
- `desktop/src-tauri/src/print.rs`：`export_pdf(app, filename, content_width)`，写 `%USERPROFILE%\Documents\AstraNota Exports\<名>.pdf`（重名 ` (2)`，**绝不覆盖**）；`ShouldPrintBackgrounds=true`、页眉页脚关、边距 0、页宽 = `(contentWidth + 2×52.9167)/96` in、页高 11.69in；**轮询等待落盘（≤3s）+ 非空校验**
- `frontend/src/print.css`：`@media print` + 预览块；`@ke-print-shared:start/end` 等标记供测试比对
- 安全门禁：`scripts/pdf-gate.py`（文档 sha256 不变 / 工作区未被写 / 输出路径保护 / DOM 摘要）；一致性门禁：`scripts/pdf-consistency.py`
- 导出选项（`ExportPdfDialog.tsx`）：主题 / 纸张底色 / 文字色 / 强调色（HEX 校验，`ke.exportPdf.options` 记忆）

### 4.2 导出预览：从「DOM 模拟」到「真 PDF」（v1.2.16，task-73/75/76）
- 演进：DOM 单页 → **DOM 按高度切片分页**（v1.2.15）→ **预览 = 真 PDF**（v1.2.16）✅
- 为什么必须改成真 PDF：DOM 切片**本质上无法**与 Chromium 分页一致（内边距只作用于第一页、`break-inside: avoid` 把整块推到下页、页眉只在第一页…）
- 实现：`print.rs` 的 **`preview_pdf(content_width)`** 写 `%TEMP%\AstraNota-preview\preview-<pid>-<ns>.pdf`、**`discard_preview_pdf(path)`**（目录白名单）；`tauri.conf.json` 开 `assetProtocol{enable:true, scope:["$TEMP/AstraNota-preview/**"]}` + `Cargo.toml` 的 `protocol-asset` feature；前端 `convertFileSrc` + `<iframe>` 显示（**已真机验证 WebView2 内置阅读器可用**）
- 行为：打开即生成、选项/文档变化**防抖 400ms** 重生成、**关闭即删 temp**、失败**回退 DOM 预览**；**零 `getMarkdown()`、零 PUT、不写工作区**
- 测试：`ExportPdfDialog.test.tsx` / `ExportPdfDialog.realpdf.test.tsx`

### 4.3 根号上横线过长 —— **是我们的 bug，已修**（重要教训）
- 现象：导出 PDF 里 `\sqrt{...}` 的上横线跑出纸外（主理人截图）
- **真因**：`print.css` 的后代通配 `.ke-editor-prose *` 与 `#root *` 里的 `overflow: visible !important` **覆盖掉了 KaTeX `.hide-tail` 的内部裁剪** → 那段 400em 的 SVG 路径被整条画进 PDF
- 修复：两条通配改为 `*:not(.katex):not(.katex *)`（commit `7b118a2`）
- **实测**（主理人真实文档 `Homework-Ch6`，288dpi）：**245.88pt → 25.50pt**（被开方内容 ~33pt）
- **走过的弯路（勿重犯）**：我先用 `page.get_drawings()` 的**原始路径长度**当"可见宽度"，误判成「Chromium PDF 不裁剪 SVG」，还据此做了两版 DOM 补丁（v1 隐藏 svg → **丢 √ 字形**；v2 收窄 viewBox → 横线 34.25→51.00pt **更差**），**均已回滚**（`a0a086a`）
- **测量纪律（已写进 `docs/render-stability.md` 附录 A）**：**禁止**把 `get_drawings()` 路径长度当可见宽度；判定 PDF 视觉必须 **像素级栅格（≥200–288dpi，量最长连续墨迹）** 或 **clip 感知（`get_drawings(extended=True)` 检查 `level`）**
- 外部独立复核（`F:\Work\KE Project\KaTeX-PDF-独立复核完整交付.zip` + 报告）**推翻了我的错误结论** —— 其价值在于"敢推翻"；教训：**结论要能被独立证伪**

### 4.4 斜体 d 一键转正体（v1.2.16，task-74）
- 口径：只改**微分场景**（`d`+字母）→ `\mathrm{d}`（幂等）；**仅当前文章**；**另存同目录新文件** `<原名>-正体d.md`（重名 ` (2)`），**原件绝不改动**；**必须差异预览 + 勾选**
- 实现：`frontend/src/editor/upright-d.ts`（**词法级**纯函数：`convertLatexUprightD` / `analyzeUprightD`（只遍历 `math`/`mathBlock` 的 latex）/ `applyUprightD` / `uprightDPlan` + `applyUprightDToMarkdown` / `uprightDFileName`）；`UprightDDialog.tsx`（差异预览+勾选）；入口在 `EditorToolbar.tsx`（可选 prop）+ `EditorArea.tsx` 接线（**取已保存正文快照，不调 `getMarkdown()`**）
- **跳过**：命令名（`\dots`/`\dfrac`/`\delta`…）、`\begin{}`/`\end{}` 环境名、`\text{}`/`\mathrm{}` 等花括号内容、已有正体写法、变量 `d_i`/`d^2`、孤立 `d`
- 已知边界（规格内）：`d(mv)`/`d(x)` 这类"微分括号"**不改**（进"跳过"区）
- 语料实测：调查见工作区 `调查报告-斜体d一键转正体.md`；`Week 3 Day 2` 报告口径的"15 处候选"经词法扫描 = **0 hits**（全是 `\dots`、脚注 JSON 哈希串误报）
- **踩坑**：对话框面板用了**不存在的 Tailwind token `bg-surface`** → 漏设背景 → 面板透明（commit `1d29e9c` 修，并加**源码级守护**：组件源码不得再出现 `bg-surface`）

### 4.5 更早的根因（1.2.9–1.2.11，仍有参考价值）
- **逐字一行 + 写盘损坏**：上游 marked 用 block tokenizer 的 `start()` 当段落截断提示；我们的 table tokenizer `start()` 对任意 `|` 行返回 0 → 每字符一段 → 回写即损坏。修法：`start: () => -1`（`frontend/src/editor/tokenizers.ts`）
- **`_` 被全量转义**：上游 `escapeMarkdownSyntax`；用 `MarkdownManager.prototype` patch（`frontend/src/editor/markdown-escape.ts`）
- **空公式块写盘**：`$$\n\n$$` 往返归一化
- 渲染稳定不变量 I1–I6 与测试纪律：`docs/render-stability.md`、`docs/testing-discipline.md`、`docs/document-format.md`（§1.1 **正文 H1 与文档标题是两个独立的东西**，禁止同步/去重/派生）

---

## 5. 关键文件地图

| 文件 | 作用 |
|---|---|
| `frontend/src/print.css` | 打印样式（`@media print` + 预览块 + 共享标记）；`:not(.katex)` 排除是根号修复 |
| `frontend/src/editor/pdfPage.ts` | 纸张尺寸同源计算（与 `print.rs` 逐条对应）+ `waitForPrintFonts()` |
| `frontend/src/components/editor/ExportPdfDialog.tsx` | 导出对话框：选项 + 真 PDF 预览 + 颜色覆盖注入 |
| `frontend/src/components/layout/EditorArea.tsx` | 导出入口 `handleExportPdf` / `runPdfExport`；斜体 d 入口接线；`measureEditorContentWidth()` |
| `frontend/src/editor/upright-d.ts` + `components/editor/UprightDDialog.tsx` | 斜体 d 转换器 + 差异预览对话框 |
| `desktop/src-tauri/src/print.rs` | WebView2 `PrintToPdf`；`export_pdf` / `preview_pdf` / `discard_preview_pdf` |
| `desktop/src-tauri/tauri.conf.json` | `assetProtocol` scope（temp 预览目录） |
| `scripts/pdf-gate.py` / `scripts/pdf-consistency.py` | PDF 安全门禁 / 一致性门禁 |
| `docs/render-stability.md` | 渲染稳定性不变量 + **附录 A：根号定案 + 测量纪律** |
| `docs/testing-discipline.md` | 沙箱/副本测试纪律 |
| `docs/document-format.md` | 文档格式规范（标题 vs H1 等） |

---

## 6. 验证手法（可复用的真机探针套路）

1. 备份并改写 `app_config.json` → `recent_workspaces[0] = C:\ke-tmp\ke-sandbox` → 还原（必须）
2. `smoke-pre1.ps1` 启动 → `sleep 12` → CDP（9333）连接
3. `Runtime.evaluate` 驱动 UI（点侧栏文章、点按钮）→ `Page.captureScreenshot` 存图
4. Windows Python + PyMuPDF 做 PDF 断言（**像素级**或 clip 感知）
5. 结束时杀进程 + 还原 config

**已用探针**：`C:\ke-tmp\{radical-check,realpdf-verify,upright-d-test,opaque-check,statusbar,variant-test,export-hw}.py`

---

## 7. 团队与任务板

- 队友（均 inactive，可 send_message 唤醒）：`dev-attach`、`dev-attach-ui`、`dev-math-ui`、`dev-trash-fe`、`verifier`、`verifier-s2`、`verifier-trash`、`verifier-attach`（**名额 8 已满，不能新增**）
- 本轮 task-74 / 75 / 76 已完成并入库；**任务板仍有若干历史遗留 `in_progress`**（task-31/45/47/62/70），其内容多数已被后续提交覆盖，接手时请先核对再决定 close 或重开，**不要盲目 claim**。

---

## 8. 下一步（建议优先级）

1. **补 `docs/release-policy.md` 一条**（本轮已答应的）：dev 构建必须重建侧车 + 验证底栏无版本告警（见 §3 纪律）
2. **真 PDF 预览的打磨**（低风险）：查看器工具栏收敛（`#toolbar=0&navpanes=0` 是否生效）、长文档生成耗时与缓存策略
3. **斜体 d 二期**（需主理人拍板）：是否处理 `d(mv)`/`d(x)` 微分括号；是否做**整个文件夹批量**
4. **任务板清理**：核对历史 `in_progress` 并归档
5. 若主理人反馈新 bug：**先复现（真机 + 证据），再定位根因，再修**；修完用**像素级/字节级**证据验收；**不许**"无法复现"结案

---

## 9. 本轮最贵的三条教训（请继承）

1. **测量方法错了，结论就全错**：PDF 几何必须 clip 感知或像素级；`get_drawings()` 原始路径 ≠ 可见墨迹（这条让整轮根号排查走偏，还带偏了队友和两版补丁）
2. **"库/英擎的锅"要先自证**：宁可先怀疑自己的样式（本轮真因就是我们的通配规则），也要用**最小复现**验证外部归因；外部独立复核的价值是**推翻**
3. **dev 包也是产品**：版本串、侧车、安装包、底栏告警都要验；"能跑"不等于"能发"

---

## 10. 主理人原话（口径，必须遵守）

- 「**要完全一致**」（PDF 渲染 vs 编辑器）
- 「**别把我文件写坏了**」→ 导出/预览/转换全程只读文档 + 沙箱验证 + 原件 sha256 不变
- 「**正文 H1 与文档标题是两个独立的东西**」（不做同步/去重）
- 「**预览 = 真 PDF**」（DOM 模拟不接受）
- 斜体 d：「只做**微分场景**、`\mathrm{d}`、**当前文章**、**另存同目录新文件**、**要差异预览+勾选**」
- 报告/审查要**证据**，不接受「无法复现」
