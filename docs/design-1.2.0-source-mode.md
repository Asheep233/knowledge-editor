# v1.2.0-pre.2 源码模式 · 实施契约

> 规范先行已完成：`document-format.md` §6「编辑通道与视图」（9 条硬性契约）+ `markdown-extension-spec.md` P2 澄清。
> 可行性依据：`docs/analysis-1.1.10/source-mode.md`（41 构造往返矩阵；结论「源码保存必须字符串直存」）。
> 主理人拍板：**切视图自动保存**、**视图态全局**、**frontmatter 隐藏**、**`<textarea>`**、**未知语法可改但保存必须提示**。

## 1. 目标（验收人可读版）

用户可在**正文（所见即所得）**与**源码（原始 Markdown）**之间切换，源码视图里直接编辑 Markdown 原文并保存；
保存**逐字节保留**用户所写内容（不经过 ProseMirror 规范化），且不影响既有保存/恢复/历史/外部修改检测语义。

## 2. 架构与落点

| 关注点 | 落点 | 要点 |
|---|---|---|
| 视图态 | 新模块 `frontend/src/state/viewMode.ts`（纯函数 + 存储读写） | **全局**单值（`'wysiwyg' \| 'source'`），键如 `ke.viewMode`；不写入文档、不按文档记忆 |
| 切换入口 | `EditorToolbar.tsx` 加一个切换按钮（与既有图标行同风格，`aria-pressed`） | 有文档打开时才可切换；只读/版本预览态禁用 |
| 源码视图 | 新组件 `frontend/src/components/editor/SourceModeView.tsx` | 受控 `<textarea>`（等宽字体）+ 顶部说明条（"直接编辑 Markdown 原文；frontmatter 已隐藏"）+ 保存状态显示 |
| 保存路径 | `EditorArea.tsx`（宿主） | **字符串直存**：`frontmatterBlockOf(raw) + editedBody` → `withFrontmatter(..., KE_VERSION)` → `applyDocTraits(..., captureDocTraits(raw))` → 既有 `saveArticle` 链（saveQueue / 恢复点 / 自检） |
| 排他 | `EditorArea.tsx` | 源码态下正文编辑器 `editable=false` 或卸载；正文态下 textarea 不渲染。**同一时刻只有一个可写通道** |
| 提示 | `SourceModeView` + `App` 的既有确认框（`askConfirm`） | ① 进入源码：提示"frontmatter 已隐藏，正文为原文"（轻提示，可一次/常驻说明条）② **保存时若检测到未知/损坏 ke-* 被改动 → 必须显式提示**（规范 §6.2-4）③ 切回正文：提示"正文将重新解析，未知语法可能被规范化" |

## 3. 关键行为（必须实现）

1. **切到源码前先保存**：`flushWithTimeout(docId)`（与切文档同款）；失败 → `askConfirm('未保存修改可能丢失，仍要切换？')`；取消则留在正文。
2. **源码初值**：以「保存后的内容」为准（保存成功用服务端回包 / 等价编辑器序列化 + frontmatter 区块），保证源码看到的是当前状态而非旧盘面。
3. **编辑即保存**：沿用既有防抖保存节奏（`editor.autosaveIntervalMs`），**内容来自 textarea 字符串**；同时登记 S-1 恢复点（恢复点内容 = 源码字符串 + frontmatter，草稿仍是内部数据、按既有 LF/无 BOM 口径）。
4. **frontmatter 隐藏**：textarea 内容**不含** frontmatter；保存时以原块为准（逐字节 + 仅更新 `ke_version`），因此源码模式删除不了 frontmatter 键 ✓（与 §6.2-3 一致）。
5. **未知语法提示**：保存前对比「初始源码字符串」与「当前源码字符串」中**未知/损坏 ke-* 标记**集合（可用正则或复用既有提取器）；若被改动/删除 → 首次保存弹一次明确提示（可"本次不再提示"）。
6. **切回正文**：保存 → 重新 `setKeContent`（既有链路）→ 提示未知语法可能被规范化（首次/可记忆）。
7. **外部修改检测不受影响**：源码保存同样要 `mark_internal`（否则会被自己的写入触发"外部修改"提示）。
8. **只读态**：`article` 为版本预览或 `editable=false` 时不可进入源码模式（按钮禁用 + 说明）。
9. **性能**：≥256KB 文档用 `<textarea>`，不做实时高亮/解析；切换不得阻塞主线程超过既有正文切换的耗时量级。

10. **⚠️ `<textarea>` 的换行陷阱（独立验证方提出，必须显式处理）**：DOM 会把 `textarea.value` 中的换行**规范化为 LF**。
    因此「载荷逐字节 = 用户所写」对 CRLF 文档**必须**依赖 `applyDocTraits(md, captureDocTraits(raw))` 还原换行风格 ——
    若直接把 `textarea.value` 交给保存，就会把 CRLF 文档静默改成 LF（等于在源码通道里重新引入 F-5）。
    测试请把两件事**分开断言**：① 非换行字节不变；② 换行按 traits 还原（LF 文档不得变 CRLF，CRLF 文档必须回到 CRLF）。

## 4. 不做（明确排除）

- 不做分屏双向同步（分析结论：每次同步都要 serialize/parse，256KB 下 39–138ms / 7–14s，且必经 PM ⇒ 保真必输）
- 不引入 CodeMirror / Monaco 等编辑器框架
- 不在源码模式里编辑 frontmatter
- 不改 `ke-*` 格式、不改 B 层标识、不新增后端端点

## 5. 测试与验证要求

- 纯函数/模块用例：视图态读写、未知标记 diff 检测、字符串直存组装（frontmatter + traits）
- 组件用例：切换按钮态、textarea 初值、编辑→防抖保存（mock `saveArticle` 断言**载荷 = 用户原文**，逐字节）、切回正文触发重新解析、只读态禁用
- **保真闭环**：源码模式保存的载荷**不得**出现 ProseMirror 规范化痕迹（用 41 构造里最敏感的样本：`- [x]`、`<span style=…>`、`&copy;`、CRLF、BOM、未知 `ke-*`）
- 独立对抗验证（另一 teammate）：见 task-42
- 回归底线：`tsc 0`；全量 vitest 只增不减（当前基线 50 files / 920 passed + 1 skipped）

## 6. 与在飞任务的关系

- task-39（D-1/D-2/EDGE-1）**正在改 `frontend/src/editor/**`** → 源码模式**只读 import** 该目录（`ke.ts` 的 `frontmatterBlockOf`/`withFrontmatter`/`applyDocTraits`/`captureDocTraits`），**不得改 `editor/**` 下的文件**，避免同批冲突
- 写入边界：`state/viewMode.ts`、`components/editor/SourceModeView.tsx`、`EditorArea.tsx`、`EditorToolbar.tsx`、`App.tsx`（如需）+ 各自测试
