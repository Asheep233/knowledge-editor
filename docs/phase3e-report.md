# Phase 3E 报告：文档导入导出与迁移闭环

日期：2026-08-09

## 一、实现内容

### 1. 文档导出（3E.1）

**入口**：编辑器文档标签栏新增「导出 ▾」下拉菜单（仅打开文档时可用），含两个选项。

**Markdown 单文件导出**（纯前端）：
- 内容来自现有 Markdown Serializer（`editor.getMarkdown()`），即 Document Model → Markdown 的同一链路；
- 序列化结果经 `withFrontmatter(md, KE_VERSION)` 带上版本头后触发浏览器下载 `{slug}.md`；
- 完整保留标准 Markdown 与所有 ke-* 扩展节点；不触碰 workspace 中的原文件。

**文档包导出 .zip**（前后端协作）：
- 前端序列化 Markdown → `extractAttachmentRefs(md)` 提取附件引用（ke-attach / ke-video 的 `src` + 标准图片 `![alt](path)`，按出现顺序去重）→ `POST /api/export/package`；
- 后端校验 refs（防目录穿越、仅打包 `Attachments/` 下真实存在的文件）后打包：
  ```
  {slug}_export/
  ├── {slug}.md
  └── Attachments/
      ├── images/
      ├── videos/
      └── files/
  ```
- 附件按 workspace 相对路径归档（`Attachments/images/x.png` → 包内同名），因此 **md 内引用路径无需改写**，在导出目录中相对 md 位置即可解析；文档包可脱离 workspace 独立存在；
- 响应使用 RFC 5987 `filename*`（兼容中文文件名），前端解析 `Content-Disposition` 作为下载名。
- 网络 URL 与本地绝对路径不参与打包，md 中保持原样（Phase 4 附件管理范围）。

### 2. 文档导入（3E.2）

**入口**：顶栏「导入」按钮，文件选择器接受 `.md / .markdown / .zip`。导入前检查编辑器是否有未保存修改（`dirty / saving / error`），有则提示「当前内容未保存，导入将覆盖，是否继续？」，确认后才执行。

**普通 Markdown 导入**（`POST /api/import/markdown`）：
- 读取上传副本，原样写入 `Articles/{slug}.md`（不破坏原文件）；slug 冲突自动去重（`{slug}-2.md`）；
- 建立索引；ke-* 扩展与未知标记（GenericFallbackNode）无需处理，正文原样保留；
- 网络图片链接、本地绝对路径保持原样，不下载不改写。

**文档包导入**（`POST /api/import/package`）：
- 解压到临时目录（含 zip-slip 防护：拒绝绝对路径 / `..` / 越界，单文件上限 512MB）；
- 定位 Markdown 文档（跳过 `Attachments/` 目录，避免把附件目录里的 .md 当文档）；
- 附件复制到 workspace `Attachments/{分类}/`，保留包内子目录结构（如 `Attachments/images/sub/x.png`）；分类按扩展名（images / videos / files）；
- **冲突处理**：
  1. 目标不存在 → 原文件名复制；
  2. 已存在且内容一致（sha256）→ 复用已有文件；
  3. 已存在但内容不同 → 生成唯一文件名（`{stem}-{随机}.{ext}`），并同步改写 md 中对应引用路径；
- 引用改写按「先 `./old` 后 `old`、长路径优先」规则执行，保证所有附件引用指向新位置；
- 文章保存到 `Articles/`（slug 冲突去重）并建立索引；导入返回附件明细（from / to / reused）供前端展示。

### 3. 一致性测试（3E.3）

后端 pytest 覆盖完整闭环：创建含全部节点（标题/粗体斜体/列表/表格/公式/信息块/Footnote/Module/图片/视频/附件/未知标记）的文档 → 导出包 → 删除原文档 → 导入包 → 打开验证内容一致 → 附件引用可解析 → 二次导出与首次导出的包逐文件一致（零漂移）。前端 vitest 覆盖引用提取 / 下载名 / Content-Disposition 解析。

## 二、修改文件列表

| 文件 | 变更 |
| --- | --- |
| `backend/app/routers/import_export.py` | 新增：导出包 / 导入 Markdown / 导入包三个端点 + 冲突处理工具 |
| `backend/app/main.py` | 注册 `import_export` 路由 |
| `backend/tests/test_import_export.py` | 新增：6 项后端测试（结构 / 闭环 / 冲突 / 子目录 / 非法输入 / 原样保留） |
| `frontend/src/editor/import-export.ts` | 新增：`extractAttachmentRefs` / `slugForDownload` / `downloadBlob` / `filenameFromDisposition` |
| `frontend/src/editor/import-export.test.ts` | 新增：9 项前端单元测试 |
| `frontend/src/api/client.ts` | 新增 `exportPackage` / `importMarkdown` / `importPackage` |
| `frontend/src/components/layout/EditorArea.tsx` | 新增「导出 ▾」下拉菜单 + `onSaveStateChange` 上报 |
| `frontend/src/App.tsx` | 新增「导入」按钮、未保存确认、导入后刷新树并打开文档 |
| `frontend/src/components/layout/LeftSidebar.tsx` | 新增 `refreshKey`，导入完成后重拉文件树 |

## 三、数据格式变化

**无**。未修改任何 Phase 3 冻结约定：

- ke-* 扩展语法（`<!-- ke-xxx: {json} -->`）与节点字段不变；
- `ke_version` frontmatter 机制不变（导出带版本头，导入原样保留）；
- workspace 目录约定（`Attachments/{images|videos|files}`）不变；
- 附件 `src` 仍为 workspace 相对路径；导出包内路径与 workspace 路径一致，导入无冲突时引用无需改写。

## 四、测试结果

| 验证项 | 结果 |
| --- | --- |
| 后端 pytest 全套（17 项，含新增 6 项导入导出） | 17/17 通过 |
| 前端 vitest 全套（38 项，含新增 9 项导入导出工具） | 38/38 通过 |
| `npx tsc -b` 类型检查 | 通过 |
| `npm run build` 生产构建 | 成功（7.23s） |

端到端闭环测试断言要点：导入后正文与导出前一致（重新包装 frontmatter 后逐字节相等）、3 个附件全部复用且引用可解析、二次导出包与首次逐文件字节一致（零漂移）。

## 五、当前风险

1. **引用提取覆盖面**：`extractAttachmentRefs` 只处理 ke-attach / ke-video / 标准图片。ke-module 的 `params` 或手写非 `Attachments/` 开头的相对路径不参与打包，这类引用在导入后可能无法解析（按需求，网络与绝对路径属 Phase 4 范围，本阶段保持原样是设计决策）。
2. **虚构引用无防护**：若 md 中引用包内不存在的附件（如手写 `Attachments/images/ghost.png`），导出时后端跳过缺失文件，导入后该引用无法解析（编辑器显示破图，不报错不丢数据）。
3. **冲突文件的孤儿化**：附件内容不同时生成唯一名，旧文件保留在 workspace（可能成为无引用孤儿文件）；清理归属 Phase 4 文件管理。
4. **zip 总大小无上限**：已做 zip-slip 防护与单文件 512MB 上限，但未限制压缩包总体积，超大 zip 会临时占用磁盘空间（导入后自动清理临时目录）。
5. **文章 slug 自动去重**：标题同名导入时生成 `{slug}-2.md` 等，不会覆盖原文档，但用户可能混淆同名文档；文件树目前不区分。
6. **导入期间保存竞态**：导入覆盖前若编辑器正在自动保存（saving 状态视为未保存需确认），确认后导入的新文档与旧保存请求互不干扰（保存写旧文档 id），但极端时序下旧内容可能短暂写回旧文档。
