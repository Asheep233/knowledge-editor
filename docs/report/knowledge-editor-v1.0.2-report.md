# KnowledgeEditor v1.0.2 版本报告

> 版本基线：v1.0.1（发布完成）→ **v1.0.2**（新增「导出为普通 .md」）
> 本地提交：`949fadf`（WIP 检查点）→ `6fdad7b`（功能完成）→ `8f4fae0`（版本号 1.0.2 + CHANGELOG）
> 本地标签：**`v1.0.2`**（annotated，**未推送 GitHub**，仓库仍在前一发布线上）

---

## 一、本版本是什么

v1.0.2 = v1.0.1 全部修复与验证成果 + **一项新功能**：

> **「导出为普通 .md（朴素 Markdown）」**——把 KE 方言文档降级为任何 Markdown 工具都能干净渲染的单文件 .md，
> 不含 `ke_version` 与任何 `ke-*` 注释标记。

## 二、功能与降级规则（实现于 `frontend/src/editor/plain-export.ts`）

| KE 结构 | 降级输出 |
|---|---|
| frontmatter `ke_version`、`ke-module` 定义块 | 删除；保留 title/tags/created/updated（其它非 KE 键保留）；删空移除整个 `---` 块 |
| `ke-note`（包裹/自闭合） | `> **{label\|title\|信息}**{（author）}` + 内容逐行 `> ` 前缀（空行 `>`） |
| `ke-module` | `> 模块：{name}`（v1 不做 inline 展开） |
| `ke-attach` image | `![{title\|caption\|文件名}]({src})` + caption 存在且异于 alt 时追加图注行 |
| `ke-attach` file / `ke-video` | `[{title\|文件名}]({src})` |
| `ke-footnote`（行内） | `[^n]`；**独立成行**的位置型标记 → 删除整行（避免孤立 `[^n]`） |
| `ke-footnotes:start/end` 区域 | `[^n]: text` 按 n 升序；多行文本续行缩进 4 空格 |
| `<!-- ke-version ... -->`（独立行） | 删除 |
| 未知/损坏 `ke-*`、`ke-NOTE` 变体 | **原样保留** |
| 普通 HTML 注释/块、数学公式、标准 Markdown | 逐字节保留 |

入口：`EditorArea` 顶栏「导出 ▾」下拉第三项「导出普通 Markdown (.md)」；原第一项改名「导出 Markdown（KE 格式）」。
内容源：`editor.getMarkdown()`（无 frontmatter）→ `plainMarkdown(md, metaFromArticle(article))` → `downloadBlob`，文件名 `{slugForDownload(title)}.md`。

## 三、实现要点

- 纯函数、零网络、零副作用（与 import-export.ts 风格一致）；JSON 解析用**括号平衡匹配**（脚注文本含 `} -->` 不解析失败）；
- 处理顺序：① 脚注区域→定义行（文档级一次替换）② 行内 ke-footnote / 独立行删除 ③ ke-note 包裹 ④ 逐行单行注释 ⑤ ke-version 行删除；
- `plainMarkdown` 幂等：`withPlainFrontmatter` 为合并式（已有 frontmatter 时更新标准键、删除 KE 键，其余键逐字节保留），重复导出结果不变。

## 四、测试与验证

| 项 | 结果 |
|---|---|
| `npx vitest run` | ✅ **186 passed / 1 skipped（22 文件）**，其中 `plain-export.test.ts` 8 用例全过 |
| 六项断言 | ✅ 无 ke_version/良构 KE 注释且标准内容逐字节保留；脚注引用与定义数量、编号一致（升序+4 空格续行）；frontmatter 键删留正确（含删空移除块）；未知/损坏/ke-NOTE 原样保留；幂等；image/file/video 降级形态正确 |
| GFM 渲染验证 | ✅ marked(GFM) 渲染导出正文：块引用/表格/图片结构正确，无 ke_version/脚注区域残留（未知标记按规则保留） |
| `npx tsc -b --noEmit` | ✅ 0 错误 |
| `npm run build` | ✅ 成功 |
| 手动样例 | ✅ [`evidence-plain-export-sample.md`](/mnt/d/KE%20Project/evidence-plain-export-sample.md)（公式/表格/脚注/图片/信息块/模块/文件/视频全要素样例，降级后干净可读） |

## 五、文件清单（vs v1.0.1）

| 文件 | 变更 |
|---|---|
| `frontend/src/editor/plain-export.ts` | 新增 |
| `frontend/src/editor/plain-export.test.ts` | 新增（8 用例） |
| `frontend/src/components/layout/EditorArea.tsx` | 导出菜单第三项 + 首项改名 |
| `docs/knowledge-editor-plain-export-design.md` | 新增（设计文档） |
| `CHANGELOG_DEV.md` | v1.0.2 条目 |
| 版本常量 ×6 | `backend/app/__init__.py`、`frontend/src/version.ts`、前后端 `package.json`、`tauri.conf.json`、`Cargo.toml`/`Cargo.lock`：**1.0.1 → 1.0.2** |

## 六、边界与偏差说明（设计实现差异）

1. **独立成行脚注标记**：设计表未明示，实现为删除整行（避免孤立 `[^n]` 引用），已写入设计文档；
2. **image 图注行**：alt=title||caption||文件名；仅当存在 caption 且与 alt 不同时追加独立图注行（避免重复文字）；
3. **frontmatter 保留集**：除 title/tags/created/updated 外保留其它非 KE 键（防用户自定义键丢失）；
4. **「无任何 ke- 子串」与「未知/损坏原样保留」冲突**：断言收敛为「无 ke_version、无良构 KE 注释、无脚注区域结构」；
5. **附件相对路径引用**：单文件导出不内联附件二进制；ke-module 不 inline 展开（v1 决策）。

## 七、提交 / 标签 / 推送状态

```
949fadf  feat(plain-export): 导出为普通 .md（WIP 检查点）
6fdad7b  feat(plain-export): 导出为普通 .md（朴素 Markdown）完成
8f4fae0  chore: v1.0.2（导出为普通 Markdown 功能基线）  ← 当前 master HEAD
tag:     v1.0.2 (annotated, local)
push:    ✗ 未执行 —— 本轮仅本地记录，未推送 GitHub / 未触发 CI
```

## 八、后续建议（不阻塞）

- 如需发布：`git push origin master && git push origin v1.0.2` 后由 CI 验证；并按 v1.0.1 流程补 Release（本次改动纯前端，无构建产物变化）。
- 可评估：导出时可选项「内联图片 base64」或「打包附件 zip」；ke-module inline 展开。
