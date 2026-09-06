# Knowledge Editor v1.1.1-pre.1 发布前全面审查报告

> 审查日期：2026-09-06 | 审查对象：v1.1.1-pre.1 完整产品状态（非增量）
> 审查方式：静态代码审查 + 真实运行验证（后端 API 全链路、vitest 动态复现）+ 历史报告交叉验证
> 注意：仓库为单一压缩 commit（888cbe1），无 git diff 可用；所有「最近引入 vs 基线已有」的判断基于代码证据与历史报告交叉推断。

---

## Executive Summary

```yaml
发布判定: 需修复后发布
一句话回答: 当前版本不可直接发布——改名链路存在静默数据丢失、「重新加载外部版本」功能产生与用户意图相反的结果、空信息块可腐蚀 Markdown 方言结构，三者为阻断项；其余区域质量良好。
release_blockers:
  - R1: 改名链路（页眉标题改名 / 文件树重命名移动）丢失未保存编辑——静默数据丢失
  - R2: 外部修改弹窗「重新加载外部版本」不重载编辑器，且未决保存回写覆盖外部版本
  - R3: 空 ke-note（无内容信息块）重开时吞噬后续内容，破坏 ke-note 包裹格式不变量
blocker_count: 3
p1_non_blocking: 4
p2_and_below: 15+
测试基线:
  frontend_vitest: "205 passed / 1 skipped（24 文件，含导出专项）"
  backend_pytest: "全绿（2 skipped，Linux py3.14 复跑）"
  typecheck: "tsc -b 0 错误"
  build: "dist-build 构建成功（产物路径合规）"
  runtime_api: "workspace/folder/doc/save/reopen/search/export/history 实测通过"
版本一致性: "7 处中 6 处一致 1.1.1-pre.1；frontend/package-lock.json 仍为 1.0.2（P2，非阻断）"
充分验证区域: [保存/并发状态机, Markdown方言往返(动态复现), 导出链路(代码+测试+API), settings契约, 主题/强调色, 版本一致性, 历史报告全部finding, 后端API运行时闭环]
未充分验证区域: [WebView2真实GUI下载, NSIS安装包, PyInstaller sidecar Windows构建, cargo test, CDP端到端]
```

**充分验证 vs 未充分验证**：代码层与后端运行时层验证充分；凡需 Windows GUI/WebView2/安装包的环节本次环境无法验证（见 UNVERIFIED 清单），这些环节依赖 v1.1.0 发布时的既有验证结论，且本轮相关代码未见劣化证据。

---

## Blocker 清单（按 Root Cause 组织）

### R1（P0/BLOCKING）：改名链路丢失未保存编辑——标题数据流硬约束被破坏

**Root Cause**：所有「文档路径变更」入口（页眉标题改名、文件树重命名/移动）都不先 flush 未决防抖保存；路径变更后 `EditorArea` 的重载 effect 用**陈旧的 `article.content` 快照**重置编辑器，未保存输入被静默抹掉。

**症状 A——页眉标题改名丢编辑（核心流程）**：
1. 用户输入正文（3s 自动保存防抖窗口内，`saveState=dirty`）；
2. 点击页眉标题改名回车 → [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L86-L106) `handleTitleBlur` → `updateArticleMeta` + `renameDoc` 成功 → `onRenamed`；
3. [App.tsx](file:///workspace/frontend/src/App.tsx#L659-L663) `setArticle({...prev, id: to})` —— `content` 仍是上次保存时的旧快照；
4. [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L190-L201) `[article?.id]` effect：`flushPending(旧id)` 对已不存在的旧路径 PUT → 404 被 saveFn 静默吞掉；随后 `setKeContent(editor, stripFrontmatter(article.content).content)` 把编辑器**重置为改名前旧内容**，且 `emitUpdate:false` 不产生 dirty 标记——用户刚输入的内容从编辑器消失、无任何提示。
5. 次生：丢失前 saveFn 已对旧路径 `registerRecoveryPoint`（[EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L150)），旧路径孤儿草稿在下次启动诱导「恢复」，后端 `restore_recovery` 允许重建已删文档（[drafts.py](file:///workspace/backend/app/routers/drafts.py#L238)）→ 新旧两个内容分裂的文件。

**症状 B——文件树重命名/移动当前打开文档丢编辑**：
[App.tsx](file:///workspace/frontend/src/App.tsx#L496-L498) `handleFsMutation → requestOpenArticle(m.to)`：`flushPending(旧id)` 对已改名旧路径 404（错误被吞、正常 resolve）→ 不弹放弃确认 → 加载磁盘旧内容覆盖编辑器。同样伴随 404 假警报（`isCurrent` 仍为 true 时触发 [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L159) 的 alert）。

**证据**：上述代码路径逐行追踪闭合；`article.content` 仅在 `handleSaved`（[App.tsx](file:///workspace/frontend/src/App.tsx#L343-L346)）保存成功后刷新，防抖窗口内编辑不在其中。
**修复方向**：改名/移动前 `await flushPending(当前id)`（与 `requestOpenArticle` 同款 3s 超时兜底）；`onRenamed` 更新 article 时携带当前编辑器最新序列化内容，或改名成功后不触发内容重载（id 变化时区分「重命名」与「切换文档」）。工作量：小（1 天级）。
**Baseline**：大概率为基线已有问题（v1.1.0-pre.1 审查报告未覆盖此路径），但直接违反「可编辑标题数据流不可破坏」硬约束，按现状定级。

---

### R2（P1/BLOCKING）：「重新加载外部版本」不重载且本地内容回写覆盖外部版本

**Root Cause**：与 R1 同族——`EditorArea` 仅在 `article?.id` **变化**时重载内容；重载同一 id 的文档不会产生任何编辑器更新，且未决自动保存不取消。

**触发路径**：当前文档被外部修改 → 弹窗 → 用户点「重新加载外部版本」→ [App.tsx](file:///workspace/frontend/src/App.tsx#L359-L368) `handleReloadExternal → openArticle(rel)`，rel 与当前 id **相同** → `setArticle` 新对象但 id 不变 → 重载 effect 不触发 → **编辑器仍显示本地旧内容**；队列中未决自动保存在数秒内把本地旧内容写回磁盘，**外部版本被静默覆盖**；`:367` `setSaveState('saved')` 进一步把状态伪装成已保存。用户明确选择了外部版本，实际结果是本地版本获胜——与操作意图完全相反，且毁掉的是外部（可能是另一工具/另一人）的成果。

**证据**：代码路径闭合追踪；effect 依赖 `[article?.id]`（[EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L201)）。
**修复方向**：`handleReloadExternal` 先取消该文档未决保存（saveQueue 需支持 cancel），再强制重载（如给 article 加 reload 序号作为 effect 依赖，或新增 `reloadArticle` 路径直接 `setKeContent`）。工作量：小。
**Baseline**：基线已有（外部修改检测为 Phase 6 引入，v1.1.0-pre.1 报告未测此分支）。

---

### R3（P1/BLOCKING）：空 ke-note 重开时吞噬后续内容，破坏包裹格式不变量

**Root Cause（两半）**：
1. [NoteExtension.ts](file:///workspace/frontend/src/editor/extensions/NoteExtension.ts#L188) `renderMarkdown`：空内容信息块只输出头标记 `<!-- ke-note: {...} -->`，**不输出 `<!-- /ke-note -->`**——产出与旧自闭合格式不可区分；
2. [tokenizers.ts](file:///workspace/frontend/src/editor/tokenizers.ts#L116-L128) `keNoteTokenizer`：`contentSrc.indexOf('<!-- /ke-note -->')` 在**文档剩余全文**中找结束标记。空笔记之后若存在任何包裹笔记的结束标记，中间所有内容（含下一个笔记的头标记）被吞为本笔记的块内文本，下一个笔记节点被整体消灭。

**动态复现（vitest 实测，临时测试已删除）**：输入
```markdown
<!-- ke-note: {"kind":"note","id":"n1","title":"空"} -->

<!-- ke-note: {"kind":"note","id":"n2","title":"非空"} -->
内容X
<!-- /ke-note -->
```
解析-序列化后 n1 获得本不属于它的 `<!-- /ke-note -->` 结尾，n2 的头标记降级为 n1 卡片内的**字面注释原文文本**（未经节点规范化，无 `color` 补全即为铁证），n2 作为信息块节点消失。再次保存后该损坏结构固化。

**触发场景**：用户在非空信息块之前留一个空信息块（插入后未填内容，或删空内容）——完全由当前版本自身产出，无需旧数据。违反 document-format.md §4 兼容承诺与「ke-note 包裹格式已冻结」约束（PROJECT_STATE 冻结项 2）。
**修复方向**：`renderMarkdown` 对空内容也输出 `<!-- /ke-note -->`（新格式自描述）；tokenizer 判定自闭合时限制搜索范围（如下一个块级 ke- 标记之前）。修一处即可止血，两处都修为完备。工作量：小。
**Baseline**：v0.7.0 包裹格式引入时即存在的潜伏缺陷，此前测试只覆盖单笔记场景。

---

## Findings（非阻断，按严重度排序）

| ID | Severity | Category | Release Impact | 问题 | File/Line | Confidence |
|---|---|---|---|---|---|---|
| F01 | P1 | 数据完整性 | NON-BLOCKING | **改名后历史快照全部孤立**：快照存于 `Drafts/backup/{旧路径}`，`rename_doc` 不迁移备份目录；标题改名（核心流程）后「历史快照→恢复」对该文档立即变空。运行时实测：改名前 2 份快照在旧路径可查、新路径 `versions:[]` | [fs.py](file:///workspace/backend/app/routers/fs.py#L227-L248) / [history_store.py](file:///workspace/backend/app/services/history_store.py#L42-L45) | High |
| F02 | P1 | 并发/数据 | NON-BLOCKING | **切换/关闭工作区不 flush 未决保存**：用户确认「放弃修改」后，未决防抖保存与 prevId flush 在后端 root 已切换后执行，把 ws1 内容写入 ws2 同相对路径文件（`untitled.md` 类常见名极易撞车），或产生 404 假警报 + 孤儿恢复草稿 | [App.tsx](file:///workspace/frontend/src/App.tsx#L375-L398) / [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L146)（`isCurrent` 只门控状态不门控写入） | High |
| F03 | P1 | Markdown 兼容 | NON-BLOCKING | **大小写变体（ke-NOTE 等）编辑保存后被静默删除**：`KE_INLINE/BLOCK_CATCH_PATTERN` 要求小写（[tokenizers.ts](file:///workspace/frontend/src/editor/tokenizers.ts#L328-L332)），`isPlainHtmlComment` 又把 ke- 前缀排除出普通注释 → 落入 marked html token 被 DOMParser 丢弃。动态复现确认：`<!-- ke-NOTE: {...} -->` 往返后消失。直接违反 [document-format.md](file:///workspace/docs/document-format.md) §4「大小写不符→原样保留」。注：plain-export 字符串级路径能保留，正常编辑保存反而丢失 | tokenizers.ts:328,332,375-377 | High（动态复现） |
| F04 | P1 | 并发 | NON-BLOCKING | **openSeq 只覆盖 openArticle**：新建文档（[App.tsx](file:///workspace/frontend/src/App.tsx#L443-L462)）与切换工作区不推进序号，迟到的在途 GET 响应可覆盖新建文档视图/旧工作区内容渗入新工作区 | App.tsx:443-462, 390-398 | Medium-High |
| F05 | P2 | 后端校验 | NON-BLOCKING | **`POST /api/fs/dir` 顶层目录约束可绕过**：第 123 行在**原始字符串**上校验 `Articles/` 前缀，`_guard_rel` 在规范化后只校验不越出 workspace 根；运行时实测 `{"path":"Articles/../evil"}` 返回 201 并在 workspace 根创建 `evil/`。不能越出 workspace 根（`../../../../` 已被拦），但「必须位于三大顶层目录下」的约束实际失效。恰处于本版本宣称修复的「新建文件夹」端点 | [fs.py](file:///workspace/backend/app/routers/fs.py#L119-L127) | High（运行时实测） |
| F06 | P2 | Markdown 兼容 | NON-BLOCKING | **独占一行的 ke-footnote 引用、未闭合 ke-footnotes 区域、孤儿 footnote-item 静默丢失**：footnote 仅注册 inline tokenizer，块级 fallback 负向前瞻排除 footnote 系 → 独立成行的引用整条消失（动态复现确认）。违反「单条损坏保留区域」意图 | [tokenizers.ts](file:///workspace/frontend/src/editor/tokenizers.ts#L159-L176) | High（动态复现） |
| F07 | P2 | 导出/附件 | NON-BLOCKING | **ke-attach 的 title/caption 含 `}` 时附件引用提取失效**：`\{[\s\S]*?\}` 非贪婪截断（前端 [import-export.ts](file:///workspace/frontend/src/editor/import-export.ts#L36-L49) 与后端 [markdown_io.py](file:///workspace/backend/app/services/markdown_io.py#L28) 同源）→ JSON 解析失败 → 导出文档包漏打包该附件、后端误判孤儿附件（用户清理时可能删在用附件）。编辑器内解析用 `matchBalancedJson` 无此问题，两条链路未复用 | import-export.ts:36-49 / markdown_io.py:28 | High |
| F08 | P2 | 设置契约 | NON-BLOCKING | **嵌套对象 merge 语义前后端分歧**：Rust `merge_value` 深合并（[settings.rs](file:///workspace/desktop/src-tauri/src/settings.rs#L177-L190)），前端 `mergeSettings` 对 `editor.display`/`ui.displayPreference`/`maintenance` 整体替换（[settings.ts](file:///workspace/frontend/src/settings.ts#L93-L112)），注释自称一致不成立。三字段目前为空壳无消费点，属潜伏分叉，启用即双端行为分裂 | settings.ts:93,99,112 vs settings.rs:177-190 | High |
| F09 | P2 | 设置契约 | NON-BLOCKING | **Web 路径 loadSettings 零净化**：裸 `JSON.parse` 直接当 AppSettings（[settings.ts](file:///workspace/frontend/src/settings.ts#L121-L127)），localStorage 旧版/手改 JSON 缺 `startup` 键时 SettingsPanel 渲染抛 TypeError 白屏；非法 theme 直达 applyTheme。Rust 端有 `#[serde(default)]`+sanitize，双端鲁棒性不对称（仅 Web 降级路径受影响） | settings.ts:121-127 | High |
| F10 | P2 | 外部修改 | NON-BLOCKING | **2500ms 自写抑制窗吞真实外部修改**：自动保存周期 3s 下约 83% 时间处于抑制窗（[fsEvent.ts](file:///workspace/frontend/src/state/fsEvent.ts#L11-L61)），窗内真实外部修改不弹窗，下一次自动保存静默覆盖。后端 mark_internal 精确抑制已存在，前端冷却兜底窗口过大 | fsEvent.ts:11,53-61 | Medium-High |
| F11 | P2 | 标题链路 | NON-BLOCKING | **子目录文档 oldSlug 计算错误**：`article.id.replace(/^Articles\//,'').replace(/\.md$/,'')` 对 `Articles/Sub/note.md` 得 `Sub/note`，与 slugify 输出永不相等 → 子目录文档每次改标题都走 rename；slug 未变时 rename 撞自身 409，误报「标题保存失败：409」（meta title 实际已成功）。根目录文档无此问题 | [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L95) | High |
| F12 | P2 | 版本一致性 | NON-BLOCKING | **frontend/package-lock.json 根版本仍为 1.0.2**，与 package.json 的 1.1.1-pre.1 漂移（手改 package.json 未经 npm install 同步）。不影响构建产物版本（tauri.conf.json 驱动），但提交信息宣称「七处版本源统一」不成立 | [package-lock.json](file:///workspace/frontend/package-lock.json#L3) | High |
| F13 | P2 | 主题 | NON-BLOCKING | **applyTheme 的 matchMedia 监听器无限累积且系统切换后指数翻倍**（每次调用注册新匿名监听器，回调内再调 applyTheme 再注册）。功能幂等不出错渲染，属真实泄漏。即 K3-T1 已知 backlog 项，仍存在 | [settings.ts](file:///workspace/frontend/src/settings.ts#L183-L188) | High |
| F14 | P2 | 并发 | NON-BLOCKING | **flush 3s 超时窗口内跨文档串写**：慢保存（>3s）时 flush 超时 → 用户确认切换 → B 载入编辑器 → A 的第二棒保存执行时经 `editorRef` 读到 B 的内容写入 A 路径 | [App.tsx](file:///workspace/frontend/src/App.tsx#L288-L302) / [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L142-L147) | Medium |
| F15 | P2 | 并发 | NON-BLOCKING | **重开与在途保存竞争（A→B→A 回退）**：A 的 flush 在途时点回 A，GET 若先于 PUT 落盘返回旧内容载入，保存响应随后到达但 id 相同 effect 不触发，编辑器停留在旧内容，下次保存覆盖 visit1 末尾编辑 | App.tsx:343-346 / EditorArea.tsx:190-201 | Medium |
| F16 | P3 | 主题 | NON-BLOCKING | **主题注入串行阻塞于 resolveApiBase**（最长 30s），index.html 无内联预置脚本，深色持久化用户慢冷启动时经历浅色首屏闪烁。loadSettings/applyTheme 与 resolveApiBase 无依赖可并行 | [main.tsx](file:///workspace/frontend/src/main.tsx#L86-L98) | High |
| F17 | P3 | 后端 | NON-BLOCKING | Rust `sanitize_hex` 只校验长度不校验字符（`#zzzzzz` 可落盘）；u32 字段单字段类型错误导致整份设置静默归零（`#[serde(default)]` 不兜类型错） | [settings.rs](file:///workspace/desktop/src-tauri/src/settings.rs#L47-L224) | High |
| F18 | P3 | 标题链路 | NON-BLOCKING | rename 409 后 UI 与磁盘标题分叉且永不重试（`next === article.title` 提前返回）；前端 slugify 不剥前导点（后端两侧剥），可产出 `.note.md` 隐藏文件，前后端契约不完全一致 | EditorArea.tsx:90-105 / [slug.ts](file:///workspace/frontend/src/utils/slug.ts#L18) vs markdown_io.py:50 | High |
| F19 | P3 | UX | NON-BLOCKING | 404 假警报不以 isCurrent 为条件（后台文档 404 对当前无关文档弹窗+双弹窗）；色板拖动期间连续落盘（写放大）；patchAndSave 失败静默无反馈 | EditorArea.tsx:159 / SettingsPanel.tsx:478-487,95-99 | High |
| F20 | P3 | 文档 | NON-BLOCKING | 文档漂移：markdown-extension-spec.md:124-125 仍是旧动态模块设计；PROJECT_STATE.md 仍标 v1.1.0；CHANGELOG_DEV.md 无 v1.1.1-pre.1（新建文件夹修复）条目 | spec/PROJECT_STATE/CHANGELOG | High |
| F21 | P3 | 恢复 | NON-BLOCKING | editSeqRef 跨文档共享：切到 B 输入后 A 的在途保存判定 latest=false，A 完全保存成功后恢复点仍保留，下次启动对 A 误报「未恢复的编辑内容」 | [EditorArea.tsx](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L69-L155) | Medium |
| F22 | P3 | 性能 | NON-BLOCKING | 256KB 大文档首次 Markdown 解析实测 12-17s（md 路径 22.9s vs 等价 html 路径 0.46s），会话缓存重开 1.8s。测试门槛（校准后）通过，但大文档首开体验差 | perf-bench 实测输出 | High |

### 已知 backlog 项复核（仍存在，与历史决策一致，不计入新 finding）
- K3-I1 增量索引更新不刷新扫描签名 → 下次启动退化为全量重建（[indexer.py](file:///workspace/backend/app/services/indexer.py#L138-L171)）
- K3-I2 rename/move 非原子、无 fsync（[fs.py](file:///workspace/backend/app/routers/fs.py#L145-L245)；正文保存的原子写在 markdown_io.py:319-333）
- K3-T1 即 F13；B1 reconcile 签名判据（size+mtime_ns）漏更场景
- 回收站占位 disabled、多标签未实现、音频上传白名单、字号设置空壳——均为已拍板暂缓项

### 历史报告交叉验证结论（无 false negative）
v1.1.0-pre.1 审查总汇报 8 条、UI 冲突分析 20 条、v1.0.2 导出报告全部「已修复」条目逐条到当前代码复核：**全部真修复**（RC-VERSION 版本链、F1 类名、F2 focus 环、K3-V3 slugify、块菜单、lightbox、StatusBar、面包屑、Inspector、图标集、Ctrl+K、启动注入、plain-export 全部降级规则与 8 用例）。未发现「宣称已修实际仍在」的条目。

---

## 硬约束红线复核

| 红线 | 结论 | 证据 |
| --- | --- | --- |
| 三种导出零改动（plain-export.ts / export-actions.ts） | **合规**：单一压缩 commit 即当前状态，两文件完整在位；WebView2 修复（showSaveFilePicker 优先 + AbortError 静默 + 回退）在 [import-export.ts](file:///workspace/frontend/src/editor/import-export.ts#L96-L111) 在位，导出专项 14 测试通过；三种导出 UI→handler→payload→保存全链路真实接线（EditorArea.tsx:369-396 → export-actions.ts → saveOrDownload / 后端 import_export.py）；文档包 zip 运行时实测产出正确（md + 附件，含路径穿越防护） | export-actions.test.ts 6 用例 + plain-export.test.ts 8 用例 + 运行时 zip 验证 |
| ke-module display:none 无边界、无管理入口、不改 pointer-events | **合规**：[ModuleNodeView.tsx](file:///workspace/frontend/src/components/editor/nodeviews/ModuleNodeView.tsx#L11-L21) 仅渲染 `display:none` + `aria-hidden` 占位，无任何控件 | 直接读码 |
| 可编辑标题数据流（handleTitleBlur + slug.ts）不可破坏 | **被 R1 破坏**（见 Blocker）；slug.ts 本身与后端契约一致（K3-V3 已修复，保留名 `split('.',1)[0]` 双端一致 + 测试） | 见 R1 |
| 构建产物 frontend/dist-build 而非 dist | **合规**：vite.config.ts outDir='dist-build'，tauri.conf.json frontendDist 同步，本次实测构建产物落在 dist-build | 构建实测 |
| sidecar /api/health 版本 == 前端 APP_VERSION | **合规**：后端源码实测 `/api/health` 返回 1.1.1-pre.1 == version.ts APP_VERSION；CI 含 sidecar exe 运行时版本校验（ci.yml:139-158）。打包后 exe 本体未在本环境复验（见 UNVERIFIED） | 运行时实测 |

---

## 可延期项清单（建议 1.1.x 迭代处理，不阻塞本次发布）

- F04 / F14 / F15（并发序号与慢保存边角，触发条件苛刻）
- F10（外部修改抑制窗，需外部编辑器并发场景）
- F11 / F18（子目录 rename 409 误报、409 后标题分叉、前导点 slug 分歧）
- F13 / F16 / F17 / F19 / F21 / F22（主题泄漏与闪烁、设置净化、UX 小项、恢复点误报、大文档解析性能）
- F20（文档同步）
- K3-I1 / K3-I2 / B1（基线 backlog，历史已拍板排期）

注意 F01（历史快照孤立）、F02（跨工作区写入）、F03（ke-NOTE 丢失）、F05（fs/dir 校验绕过）虽判 NON-BLOCKING，但均涉及数据完整性，建议紧随阻断项之后优先修，不宜拖过 1.1.x。

---

## UNVERIFIED / 未充分验证区域

1. **WebView2 真实 GUI 三种导出下载**（含二次下载）：本环境（Linux 沙箱）无 Windows/WebView2。代码链路与单测已验证，但 v1.0.2 曾在此出静默失败，发布前应在 Windows 真机以 CDP/手工对三种导出各做一次「真实落盘 + 字节比较 + 二次导出」。
2. **NSIS 安装包构建与安装/卸载**：`cargo test` 与 `tauri build` 需 Windows+MSVC，本环境未执行；CI desktop job 为 continue-on-error，不构成质量门禁。
3. **PyInstaller sidecar Windows 产物**：源码级 pytest 全绿、`/api/health` 版本实测一致，但打包后 exe（含 hidden-import 完整性、崩溃自动拉起、退出清理）未复验。
4. **CDP 端到端 GUI 流程**（新建/编辑/保存/重开字节比较、搜索点击高亮、历史恢复弹窗、主题三态切换视觉、强调色生效）：代码层闭环已验证，GUI 层未在本环境运行。
5. **R1/R2 的 GUI 级复现**：阻断项结论来自完整代码路径追踪（证据闭合），未在运行中的 GUI 内实际操作复现；修复后建议在 Windows 真机按触发路径回归。
6. **多实例互斥 / 原生菜单 / 关窗握手**：仅代码复核，未真机验证。
7. **workspace 存量真实文档**（按约束未用于验证双标题；新建文档已验证）。

---

## 最终建议（发布前行动顺序）

1. **修 R1**：改名/移动入口统一先 flush 未决保存（复用 requestOpenArticle 的 3s 超时模式）；onRenamed 不触发陈旧内容重载。同步修 F01（rename_doc 迁移 `Drafts/backup` 目录）与 F11（oldSlug 计算）——三者同处改名链路，一次回归覆盖。
2. **修 R2**：handleReloadExternal 取消未决保存 + 强制重载编辑器（不依赖 id 变化）。
3. **修 R3**：空 note 序列化补 `<!-- /ke-note -->`；tokenizer 自闭合判定限界。补「空笔记+非空笔记混合」回归测试（现有测试只覆盖单笔记）。
4. **修 F03**：放开 fallback 正则大小写，让一切未消费的 ke 系注释落入 GenericFallback 保留（同 PR 可覆盖 F06）。
5. 为 R1/R2/F02 各补一个状态机级单测（saveQueue/fsEvent 层可测，无需 GUI）。
6. 重新跑 vitest + pytest + tsc + build；同步 frontend/package-lock.json 版本（`npm install --package-lock-only`）。
7. **Windows 真机门禁**：三种导出真实落盘字节比较（含二次导出）、R1/R2 触发路径回归、NSIS 安装→首启→编辑保存→关闭→重开闭环、sidecar 版本校验。
8. 以上 1-7 全部通过后发布；F04 起按可延期清单排入 1.1.x。

---

*审查方法说明：本报告所有 P0/P1 结论均有代码行级证据、运行时实测输出或动态测试复现支撑；无法在当前环境验证的项已全部列入 UNVERIFIED，未混入正式问题清单。审查过程未修改任何产品代码/配置（临时验证测试文件用后已删除，运行时产生的工作区/进程已清理）。*
