# v1.1.x 迭代计划（v1.1.1 发布后续 · 合并版）

> 起草：2026-09-06（v1.1.1 正式发布后）；初始稿曾拆 4 个迭代（1.1.2~1.1.5），
> 经主理人反馈**合并为 2 个正式版本**（每次发布成本：全量回归 + sidecar 重建 +
> manifest 重生成 + NSIS 重打 + Release；拆太细不划算）。
> 依据：v1.1.1-pre.1 发布前全面审查「可延期清单」、`docs/backlog-1.1.x.md`（拍板基线四项）
> + 本轮发布遗留（R2 竞态残余、spec 漂移）。
> 约定：**数据完整性 > 契约正确性 > 健壮性/UX > 性能**；每条含可裁决的验收标准。

---

## 0. 排期总览

| 版本 | 主题 | 条目数 | 一句话 |
|---|---|---|---|
| **v1.1.2** | 数据完整性 + 设置契约 | 11 | 正确性集中修复：保存/索引/历史确定性落盘、双端契约对齐 |
| **v1.1.3** | 健壮性 + 体验 + 文档 | 7 | 用户可感知行为：外部修改判定、改名自愈、假警报清零、大文档体验 |

> 若想再压：可全部并入 v1.1.2 单版本（19 条均为 S/M，一次发布可承载），
> 但建议保留 v1.1.3 隔离「用户可见行为变更」，便于发布后定位与回退。

---

## v1.1.2：数据完整性与设置契约

> 目标：消灭「静默错误落盘/漏索引/跨端行为分裂」；全部为 S/M 级，后端 + 设置层为主。

### B1 — reconcile 签名判据漏更（等长+同 tick）＋flaky 测试【P1｜S】
- **现象/根因**：`indexer.py` 签名判据 (size + mtime_ns) 在「等长 + 同 tick」时漏更；存在 flaky 测试（先修 flaky）。
- **影响**：搜索结果过期、测试偶发失败。
- **修复方向**：签名加入内容 hash（拍板已定「hash 入签名」）；判据改为 (size + mtime_ns + sha256)。
- **验收标准**：等长同 tick 连续写 10 次测试稳定（连续 50 次运行零 flaky）。

### K3-I1 — indexer 增量更新不刷新扫描签名 → 永久全量重建【P1｜S】
- **现象/根因**：`_SIGNATURE_KEY` 仅 `rebuild()` 写入，`update_file` 不更新。
- **影响**：每次启动全量扫描，大库启动性能退化。
- **修复方向**：`update_file`/`update_move`/delete 同步刷新签名（与 B1 同一判据改造一并做）。
- **验收标准**：重启后 indexer 仅扫描变更文件；既有索引测试全绿。

### K3-I2 — rename/move 非原子、无 fsync【P2｜S-M】
- **现象/根因**：`fs.py:145-245` 重命名/移动无引用计数与 fsync；崩溃窗口内文件名与索引不一致。
- **修复方向**：「引用计数 + 原子 rename 先行」；正文保存原子写已落实（markdown_io.py:319）。
- **验收标准**：崩溃注入（rename 中 kill）后重启：文件与索引一致或自动收敛；无孤儿恢复点。

### F07 — ke-attach 的 title/caption 含 `}` 时附件引用提取失效【P2｜S】
- **现象/根因**：前端 `import-export.ts:36-49` 与后端 `markdown_io.py:28` 用非贪婪 `\{[\s\S]*?\}` 截断；编辑器内解析用 `matchBalancedJson` 无此问题，两条链路未复用。
- **影响**：导出文档包漏打包该附件；后端误判孤儿附件（清理时可能删在用附件）。
- **修复方向**：前后端统一括号平衡匹配；补「title 含 `}`」回归测试（前后端各 1）。
- **验收标准**：含 `}` 标题的附件导出 zip 完整；orphans 接口不再误报该附件。

### F14/F15 — 慢保存并发边角（跨文档串写 / A→B→A 回退）【P2｜M】
- **现象/根因**：flush 3s 超时窗口内 A 的第二棒保存经 `editorRef` 读到 B 的内容写入 A 路径；A 的 flush 在途时点回 A，GET 先于 PUT 返回导致编辑器停留旧内容。
- **修复方向**：saveFn 捕获「保存起点内容」而非执行时重读（或版本号校验）；openWithSeq 覆盖 flush 等待期。
- **验收标准**：构造慢保存（mock 3s+）：A→B→A 内容与磁盘一致；跨文档无串写（状态机级单测）。

### R2 竞态残余 — 在途保存可能覆盖外部版本【P1 残余｜S-M】
- **现象/根因**：saveQueue 只能取消「未决」保存；已在途的 PUT 无法撤销，极端时序下外部版本被在途 PUT 覆盖。
- **修复方向**：saveQueue 为在途保存持有 AbortController，`cancelPending`/新 `abortPending` 中止 HTTP（client.ts 透传 signal）。
- **验收标准**：人为延迟 PUT 响应下「重新加载外部版本」：磁盘保持外部内容，编辑器=磁盘。

### F13（= K3-T1）— applyTheme matchMedia 监听器泄漏【P2｜S】
- **现象/根因**：`settings.ts:183-188` 每次调用注册匿名监听器，回调内再调 applyTheme 再注册。
- **影响**：内存泄漏、系统切换后监听器指数翻倍。
- **修复方向**：单例注册（模块级一次注册/unlisten），theme 切换只改 data-theme。
- **验收标准**：切换主题 50 次后监听器注册数不增长；系统深色切换仅生效一次。

### F17 — Rust 设置净化不完整【P3｜S】
- **现象/根因**：`sanitize_hex` 仅验长度不验字符（`#zzzzzz` 可落盘）；u32 字段类型错误 → 整份设置静默归零。
- **修复方向**：hex 正则校验；serde 按字段类型 fail-fast + 合法字段保留。
- **验收标准**：构造 `#zzzzzz`/类型错误 JSON → 安全兜底或报错，不静默归零；cargo test 补 2 例。

### F08 — 嵌套对象 merge 语义前后端分歧【P2｜S】
- **现象/根因**：Rust `merge_value` 深合并（settings.rs:177-190），前端 `mergeSettings` 对三个嵌套字段整体替换（settings.ts:93-112）。
- **影响**：启用即双端分裂（三字段当前为空壳，属潜伏分叉）。
- **修复方向**：前端改深合并（与 Rust 对齐）；加双端契约测试（共享用例）。
- **验收标准**：更新 `{editor:{display:{x:1}}}` 后兄弟字段保留；双端合并结果一致。

### F09 — Web 路径 loadSettings 零净化【P2｜S】
- **现象/根因**：`settings.ts:121-127` 裸 `JSON.parse`；localStorage 旧版/手改缺 `startup` 键 → SettingsPanel 白屏；非法 theme 直达 applyTheme。
- **修复方向**：解析后 sanitize + 默认值补齐（与 Rust 端同构）；非法 theme 回退默认。
- **验收标准**：缺 `startup`/非法 theme → 渲染正常、主题回退默认（组件测试）。

### F16 — 主题注入串行阻塞于 resolveApiBase（首屏闪烁）【P3｜S】
- **现象/根因**：`main.tsx:86-98` applyTheme 等 resolveApiBase（最长 30s）；index.html 无内联预置脚本。
- **修复方向**：loadSettings/applyTheme 与 resolveApiBase 并行；或 index.html 内联预置脚本。
- **验收标准**：模拟 30s 超时 → 深色用户首帧即深色。

---

## v1.1.3：健壮性、体验与文档

> 目标：用户可感知行为修正 + 大文档体验 + 文档现状对齐；发布前照门禁走一遍。

### F10 — 2500ms 自写抑制窗吞真实外部修改【P2｜M】
- **现象/根因**：`fsEvent.ts:11-61` 前端冷却窗 2.5s 覆盖 ~83% 自动保存周期，窗内真实外部修改不弹窗。
- **修复方向**：冷却缩短/移除，只依赖后端 `mark_internal` 精确抑制。
- **验收标准**：保存后 1.5s 的外部修改仍弹窗；自身保存不触发弹窗（既有 fsEvent 测试绿）。

### F18 — rename 409 后标题分叉永不重试；前导点 slug 分歧【P3｜S-M】
- **现象/根因**：`EditorArea:90-105` 409 后无重试 + `next === article.title` 提前返回；前端 slugify 不剥前导点。
- **修复方向**：409 后回填磁盘标题 + 重试一次；前端 slugify 对齐后端。
- **验收标准**：构造同名 409 → 标题回填无分叉；`.note` 不再产出隐藏文件。

### F19 — 404 假警报 / 色板写放大 / 静默失败【P3｜S-M】
- **现象/根因**：`EditorArea:159` 404 alert 不以 isCurrent 为条件；SettingsPanel 色板拖动连续落盘；patchAndSave 失败静默。
- **修复方向**：404 alert 门控 isCurrent；色板拖动去抖；失败可见提示。
- **验收标准**：后台文档 404 不弹窗；色板拖动落盘有界；失败有反馈。

### F21 — editSeqRef 跨文档共享 → 恢复点误报【P3｜S】
- **现象/根因**：编辑序号跨文档共享，切到 B 后 A 保存判定 latest=false → 恢复点保留 → 下次启动误报。
- **修复方向**：编辑序号按文档隔离或判定携带 docId。
- **验收标准**：A 保存成功（期间切 B）后启动无 A 的恢复提示。

### F04 — openSeq 未覆盖新建与工作区切换【P2｜M】
- **现象/根因**：新建文档与切换工作区不推进打开序号，迟到 GET 可覆盖新视图/旧工作区渗入。
- **修复方向**：新建/切工作区统一推进 openSeq（openWithSeq 路由）。
- **验收标准**：慢 GET 在途时新建/切工作区 → 最终视图正确（请求序号单测扩展）。

### F22 — 256KB 大文档首次解析 12-17s【P3｜M】
- **现象/根因**：@tiptap/markdown v3.29.x markdown→PM JSON 超线性（上游瓶颈）；会话缓存已把重开降到 1.8s。
- **修复方向**：首开解析进度/提示 + 评估降级路径（等价 HTML 0.46s）+ 上游升级跟踪；不做全量回归重写。
- **验收标准**：保留 perf 门槛测试不劣化；大文档首开有可见进度，无「卡死」观感。

### F20 — 文档漂移（markdown-extension-spec 旧设计）【P3｜S】
- **现象/根因**：`markdown-extension-spec.md:124-125` 仍是旧动态模块设计。
- **修复方向**：以当前代码为准改写（模块 display:none 无边界、包裹格式、脚注独立节点）。
- **验收标准**：spec 与 Note/Module/Footnotes 扩展现状逐条一致。

### 拍板延后项复核（不做，仅维护状态）
- 回收站（占位 disabled）、多标签 TabBar、音频上传白名单、字号设置空壳 —— 拍板延后；
  不消耗迭代资源，除非主理人明确立项。

---

## 附：每版本发布门禁（照 v1.1.1 剧本）

1. 全量回归：vitest / tsc -b / build(dist-build) / pytest / cargo test（先杀 GUI）
2. 版本同步：九处源（backend __version__ / frontend package+lock / desktop package+lock / Cargo.toml+Cargo.lock / tauri.conf.json / version.ts）
3. sidecar 重建 + 独立拉起 `/api/health` = 版本
4. manifest/versions 重生成（≥81 项；NSIS 不入 manifest）
5. NSIS：`docs/tauri-build-env-notes.md` 流程（WSL 预构建 → no-op beforeBuild → cmd tauri build → 恢复配置）
6. git tag + push（token URL）+ `gh release create`（四附件）
7. 文档三件套 + `docs/release-acceptance-checklist.md` 走一遍（**v1.1.3 发布前应补 NSIS 实机验收 A 部分**）
