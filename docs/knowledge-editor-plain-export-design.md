# 导出为普通 .md（朴素 Markdown）设计

状态：v1.0.1 增量功能（实现于 `frontend/src/editor/plain-export.ts`）
目标：KE 方言文档 → **任何 Markdown 工具都能干净渲染**的单文件 .md。
产出不含 `ke_version` 和任何 `ke-*` 注释标记；附件仍按 relative 路径引用（与 KE 导出一致，单文件不打包附件）。

## 入口

- `EditorArea.tsx` 顶栏「导出 ▾」下拉第三项：**导出普通 Markdown (.md)**；
  原第一项改为「导出 Markdown（KE 格式）」（保留 ke_version/ke-* 的 KE 方言导出）。
- 内容源：`editor.getMarkdown()`（无 frontmatter）→ `plainMarkdown(md, metaFromArticle(article))`；
  标准 frontmatter 仅含 `title / tags / created / updated`（来自 article），**不含 ke_version**。
- 文件名：`{slugForDownload(title)}.md`；复用 `downloadBlob`。

## 降级规则（严格表）

| KE 结构 | 降级输出 |
|---|---|
| frontmatter 的 `ke_version`、`ke-module` 定义块 | 删除；剩余键仅 title/tags/created/updated（其它非 KE 键保留）；删空则移除整个 `---` 块 |
| `ke-note`（包裹/自闭合两种格式） | `> **{label\|title\|信息}**{（author）}` + 内容逐行 `> ` 前缀（空行输出 `>`）；多行内容每行加前缀 |
| `ke-module` | `> 模块：{name}`（v1 不做 inline 展开） |
| `ke-attach` image | `![{title\|caption\|文件名}]({src})`；存在 caption 且与 alt 不同时，追加一行图注 `{caption}` |
| `ke-attach` file / `ke-video` | `[{title\|文件名}]({src})` |
| `ke-footnote`（行内） | 行内引用 → `[^n]`；**独立成行的位置型标记 → 删除整行**（避免孤立 `[^n]`） |
| `ke-footnotes:start/end` 区域 | `[^n]: text` 定义行，按 n **升序**；多行文本续行缩进 **4 空格** |
| `<!-- ke-version ... -->` 文档级注释（独立行） | 删除 |
| 未知/损坏的 `ke-*`、`ke-NOTE`（大小写变体） | **原样保留** |
| 普通 HTML 注释/块、数学公式、标准 Markdown | 原样保留（逐字节） |

## 实现要点

- 纯函数、零网络、零副作用；
- JSON 属性解析用**括号平衡匹配**（兼容 `{`/`}` 嵌套与字符串内 `}`，如脚注文本含 `} -->`）；
- 处理顺序：① 脚注区域 → 定义行（文档级一次替换）② 行内 ke-footnote → `[^n]`
  ③ ke-note 包裹格式（头尾标记）→ 块引用 ④ 逐行处理单行 ke-note/module/attach/video ⑤ 删除 ke-version 注释行；
- `plainMarkdown(md, meta)` = `stripKeFrontmatter` → `downgradeKeNodes` → `withPlainFrontmatter`；
- 幂等：输出不含任何 `ke-*` 注释与 ke_version，再次运行结果不变。

## 保存路径（共享修复点）

三种导出的保存统一走 `frontend/src/editor/import-export.ts` 的 `saveOrDownload`：
支持 File System Access API 的环境（Tauri WebView2 / Chromium 系）优先 `showSaveFilePicker`（OS 原生另存为，
每次点击都有明确交互，不受 WebView2 静默下载/多下载拦截影响）；用户取消静默返回；否则回退 `downloadBlob` 静默下载。

## 测试

`frontend/src/editor/plain-export.test.ts`：无 ke-* 残留/标准内容逐字节保留；脚注引用与定义数量与编号一致；
frontmatter 键删留正确；未知/损坏标记原样保留；幂等；image/file/video 降级形态。

## 已知限制

- 附件为相对路径引用（单文件导出不内联附件二进制）；
- 合并（表格 colspan 等）本就不受支持——GFM 表格保留原样；
- `ke-module` 不做 inline 内容展开（v1 决策，避免递归复杂度）。
