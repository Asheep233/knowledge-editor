# v1.1.x Backlog（延后项 · 不阻断 v1.1.0）

> 来源：v1.1.0-pre.1 两阶段审查（第一轮 + K3 对抗式）延后项；K3 判定「功能安全」，
> 全部排入 1.1.x 迭代，不阻断本次正式发布。

| ID | 问题 | 根因 | 影响 | 优先级 | 备注 |
|---|---|---|---|---|---|
| K3-I1 | indexer 增量更新不刷新扫描签名，reconcile 退化为永久全量重建 | `_SIGNATURE_KEY` 仅 `rebuild()` 写入，`update_file` 不更新 | 启动性能退化（每次启动全量扫描） | P1 | 已拍板接受进 1.1.x；hash 入签名 |
| K3-I2 | rename/move 非原子、无 fsync，崩溃窗口内文件名与索引不一致 | 写路径一致性只在正文保存落实 | 极端崩溃下标题改名半完成 | P2 | ✅ **方案 A 已落地（2026-09-15）**：启动自愈（草稿按唯一 stem 重挂 + 历史孤儿只统计），详见下方「K3-I2 状态更新」 |
| K3-T1 | applyTheme 每次调用累积注册 matchMedia change 监听器 | 函数体内 addEventListener 无去重 | 内存泄漏累积、系统切换重复执行 | P2 | 改为单例注册 + unlisten |
| B1 | reconcile 签名判据（size+mtime_ns）在「等长+同 tick」时漏更索引 + flaky 测试 | `indexer.py:141-152` 判据粒度不足 | 搜索结果过期、测试偶发失败 | P1 | 可先修 flaky 测试再改判据；hash 入签名 |

## 拍板记录（K3 默认建议已确认）

- **O4 自定义强调色覆盖侧栏主色**：接受为预期（深色默认 #0065fd 路径不受影响），关闭。
- **B1 / K3-I1**：接受进 1.1.0（功能安全）；hash 入签名排 1.1.x。
- **F1 / F2**：随 1.1.0 一起修（已落地）。

## 验收备注

- v1.1.0 发布验收：七处版本源 = 1.1.0 且无旧版本串残留 ✓；RC-VERSION 关闭 ✓；
  F1/F2/K3-V3 修复落地且有测试（slug.test.ts 8 项）✓；六项硬约束 PASS ✓。


---


## v1.1.8 已落地（**v1.1.8 正式版已发布 · 2026-09-15**；原 pre.1 于 2026-09-08）

| 项 | 说明 | 验证 |
|---|---|---|
| **文件名保留原标题** | 新建/导入/改名/导出统一「仅替换非法字符」策略（不再 slug 化）| pytest 175 / vitest 248 / GUI 实测 |
| **S-1 草稿恢复点扩展到编辑防抖**（2026-09-14）| 登记节奏与保存防抖解耦：自首笔未登记编辑起至多 3s 必登记一次，**不因后续编辑重置**。根因比原描述严重——`saveQueue.enqueueSave` 是纯尾沿防抖且无 maxWait，连续输入时计时器被反复重置永不触发，丢失窗口**无界**（并非「一个 autosave 周期」）| pytest 314 / vitest 262+1skip / tsc 0；独立对抗验证 T1-T8 全过（`docs/verification-s1-s3.md`）|
| **S-3 附件保留原始文件名**（2026-09-14）| 上传保留原名（CJK/空格/大小写）。因 `file.filename` 用户可控，新增「净化层 + 路径层」双防线（复用 `sanitize_filename` + resolve 父目录校验 + `O_EXCL` 去重），并附带修 CJK 名 `Content-Disposition` latin-1 500（升级 RFC 6266）与 multipart `%22/%0D/%0A` 逆变换 | pytest 314 / 独立对抗验证 28 穿越 + 36 退化名 + 10 编码变体全过 |

## v1.1.8 候选（2026-09-08 全量测试产出）

| ID | 建议 | 价值 | 来源 | 状态 |
|---|---|---|---|---|
| S-1 | 草稿恢复点从「保存进行中」扩展到「编辑防抖」| 硬崩溃最多丢 3s 输入 | test-report-v1.1.8-pre §7 | ✅ 已落地（2026-09-14）|
| S-2 | 明确 GFM 脚注 `[^1]` 是否纳入支持（当前仅 ke 自有格式，外部文档粘贴会降级为纯文本）| 兼容性 | 同上 | ✅ 已落地（2026-09-14，方案 A/A2；见 `design-s2-gfm-footnote.md`）|
| S-3 | 附件上传保留原始文件名（当前时间戳重命名，用户难以对应）| 可发现性 | 同上 | ✅ 已落地（2026-09-14）|

## 主理人裁决：以下已知偏差**全部修复**（2026-09-19）

| ID | 项 | 处置 |
|---|---|---|
| D-1 | 混合任务/普通列表被拆成两个列表（tight→loose，项间多空行） | ✅ **已修（v1.2.0-pre.2）**：混排保持紧凑（引用块内、任务↔有序同样生效）；实现 = `KeBlockJoin`。验证 14/14 |
| D-2 | 标准标签**嵌套**未知标签（`<em><span>x</span></em>` → `*x*`）内层未知标签丢失 | ✅ **已修（v1.2.0-pre.2）**：`<em><span>x</span></em>` → `<span>*x*</span>`（集合保全）；实现 = `claimStandardWrapper`。嵌套**顺序**差异见 §2.6 **D-5** |
| D-3 | 裸 `&` → `&amp;`、`[X]` → `[x]`、`<br>`/`<a>` 走标准转换 | **保持现状**（语义等价的字节变化，已在 §2.6 表内声明；不属于「损坏」） |
| EDGE-1 / K8 | 空 frontmatter 区块 `---\n---\n\n正文` 不被 `stripFrontmatter` 识别（整块被当正文载入） | ✅ **已修（v1.2.0-pre.2）**：新增共享行扫描 `scanFrontmatter`（另覆盖首行空行/顶层序列型合法 frontmatter）· 16/16 |

## v1.2.0 保真与源码模式收口状态（2026-09-20 更新）

| ID | 项 | 状态 |
|---|---|---|
| **D-1** | 混排列表 tight→loose | ✅ 已修（`KeBlockJoin`）· 独立验证 14/14 |
| **D-2** | 嵌套未知标签内层丢失 | ✅ 已修（`claimStandardWrapper`）· 契约口径通过（集合保全） |
| **D-3** | 裸 `&`→`&amp;`、`[X]`→`[x]`、`<br>`/`<a>` 标准转换 | **保持现状**（语义等价字节变化，§2.6 表已声明） |
| **D-4** | 混合 EOL（LF+CRLF 混用）被统一为主导风格 | **已声明限制**（`DocTraits` 是文档级模型；纯 LF/纯 CRLF 逐字节保留）· §6.2.1 |
| **D-5** | D-2 修复后的嵌套**顺序**与原文镜像不同（`<span>*x*</span>`） | **已声明偏差**（契约只要求集合保全 + 幂等；追求镜像会在混合形态产出 `*a**<span>x</span>**b*`）· §2.6 |
| **EDGE-1 / K8** | 空 frontmatter 区块不被识别 | ✅ 已修（`scanFrontmatter`）· 16/16 |
| **ADD-1** | frontmatter 定界符扫描吞正文（中间正文被吞 / 整篇为空）——**内容丢失** | ✅ 已修 · 独立验证复验通过 |
| **ADD-2** | 有序列表任务项 `1. [x] a` 被转义为 `1. \[x\] a` | ✅ 已修（`ListExtension.renderMarkdown`） |
| **ADD-3** | `- a\n\n- b`（本就松散的纯普通列表）被压紧 | **既有行为，保持不动**（控制用例，验证方确认未被改坏） |
| **ADD-4** | ADD-1 收紧过头：首行空行型 / 顶层序列型**合法** frontmatter 被误拒（写回双区块） | ✅ 已修（跳过前导空行 + 接受 `-` 序列项）· 独立验证复验通过 |
| **DEP-1** | `@tiptap/extension-list` 未显式声明 | ✅ 已补（`package.json` + lock `^3.29.2`） |
| **SRC-1** | 源码模式「切到源码时初值落后于刚 flush 的编辑」→ 下一次源码保存覆盖该编辑（**内容丢失**） | ✅ 已修（WYSIWYG 保存路径补写 `lastSavedRawRef`）· 独立验证 B1/B1b 复验通过 |
| **U+200B** | `withFrontmatter` 无条件剥除零宽空格 → 源码通道删用户字节 | ✅ 已修（`{ stripCaretArtifacts }` 默认 true；源码通道传 false）· §6.2.1 |
| **ADP-1** | 快捷键动作曾走 DOM 过渡适配层 | ✅ 已收口（真实 handler 注册 + 完整性守卫） |
| **DEL-1** | 「放弃修改」后仍可能二次落盘（确认框期间继续输入） | ✅ 已修（共享 `discardPending` 接两条放弃分支）· 对照实验证明修复必要 |
| **EXP-1** | KE 导出丢源 frontmatter 键（单文件 + 文档包） | ✅ 已修（`frontmatterBlockOf` 拼回 + 只更新 `ke_version`）· 独立验证 K1–K12 通过 |

**验证报告**：`docs/verification-fidelity-fixes-120.md`（47 例）· `docs/verification-source-mode.md`（49 例）· `docs/verification-math-fidelity.md` · `docs/verification-shortcuts-tabs.md` · `docs/verification-settings-nav.md`

## 移动路径 4 项已修（2026-09-15，F9b/F9c/F11/F12）

来源：`docs/design-file-management-feasibility.md` 的实测登记；验证留痕 `docs/verification-move-fixes.md`。

| ID | 修复 | 证据 |
|---|---|---|
| **F9c** | 移动目标末段走 v1.1.8 统一净化（复用 `markdown_io.sanitize_filename`，扩展名单独拼回），**扩展名收敛到源文件类型**（文档恒 `.md/.markdown`，附件随源）；净化后**重新**校验顶层/业务目录；NUL 在 `_guard_rel` 之前拦成 400（原先 `Path.resolve()` 抛 ValueError → 500） | 尾空格 `Articles/文档.md ` 旧 `文档.md.md ` → 新 `文档.md`；`....md/.md/..md/.. .md` 旧 `md`/`.md.md`（隐藏）→ 新 `untitled.md`/`md.md`；NUL 旧 `ValueError` → 新 `400 非法路径：含 NUL 字符` |
| **F9b** | dst 是**已存在目录**时给可操作提示（「请在目标路径里带上文件名」），与「已存在文件 → 409」区分；检查顺序固定在**顶层/同区校验之后、F9c 收口之前**（否则 `Articles/子目录` 会被补成 `子目录.md` 而绕过提示） | `dst='Articles/子目录'` → 409 文件夹提示，且硬断言 `Articles/子目录.md` **不存在**；`dst='Articles/.'` 仍 400（F8 语义） |
| **F11** | `app_config.rename_recent_document()`（原位替换，保 title/顺序/去重/上限 20）+ `_sync_after_move` 调用；目录移动按前缀逐条平移 | 移动后 `/api/workspace/recent-documents` 同步新路径；移动失败（4xx）时列表逐字节不变 |
| **F12** | 草稿文件改名 + `store.move_recovery()` 迁移 DB 记录（保留 id/saved_at/session_id，不新增表/不改 schema）；目录移动遍历迁移；目标草稿名已占用时**不覆盖**；无草稿 no-op | 新路径可恢复、旧路径不残留、草稿**逐字节不变**（SQLite 行级 + 文件字节双核验） |

**门禁**：`pytest` **597 passed + 2 skipped**（既有基线 462+2 + 开发者 42 + 独立验证 93，只增不减）；openapi 快照 3 passed（无新端点）；
`markdown_io.py` 未改；F8 归一化 400 与 P2-15 引用保护 409 均未回归。

**两条如实保留的 WARN（本轮新引入语义，非缺陷）**：
- **W1**：API 调用者显式写 `报告.PDF` / `新名.txt` 会**静默收敛**为 `报告.md` / `新名.md`。前端 `LeftSidebar.handleMove` 用 `` `${target}/${node.name}` `` 构造 dst（只换目录、保留源名）→ **UI 路径不可达**；响应 `to` 即权威实际路径。
- **W2**：附件 `photo.jpeg` → 目标 `photo.jpg` 会收敛回 `photo.jpeg`（同目录同主名 → 409），即**用 move 改附件扩展名不再可行**（修复前允许）。无数据丢失、UI 不可达。

**仍未做**：**F10**（移动模块文档不校验 `ke-module source` → 悬空引用）——方案已定「仅检测」，但「检测到之后拦截(409) 还是放行+警告」待主理人裁决。

## 本轮（2026-09-14）发现的独立遗留项

| ID | 项 | 事实 | 影响 | 建议 |
|---|---|---|---|---|
| **F-S1-2** | `EditorArea` 的 F14 内容快照分支恒假（自 `53803ca` 起）| 切档 effect 中 `articleRef.current?.id === prevId` 因 ref 同步 effect 声明更早而恒为 false → `contentSnapshotRef` 从未赋值 → `flushPending(A)` 的 saveFn 因 `snap === undefined` 直接 return | 潜伏：绕过 App 前置 flush 直接切档时，A 最后 <3s 的编辑**既不落盘也不登记**。生产路径被 `App.requestOpenArticle` 的 `flushWithTimeout` 挡住（T5b 实测正常）| ✅ **已修**（task-17/18，2026-09-15）：抽 `state/docSwitch.ts` 可测缝 + 守卫改为「编辑器此刻是否仍载着 prevId」+ 快照严格早于 flush；独立验证 PASS（dev 21 例 + verifier 18 例 + 树外组件轨 7 例；全量 512 passed + 1 skipped）|
| **F-S1-4** | **①** 大文档（>200KB）80ms 延迟载入的过期 timeout 仍会 `setKeContent` 覆盖编辑器（切档过快时）；**②** `flushDraftRecovery`（`EditorArea.tsx:239-244`）用 `articleRef.current` + 编辑器实时内容，**缺 `editorDocIdRef` 守卫**（与 save 路径不同源） | 验证 F-S1-2 时由 verifier 独立构造证实：`[DS6]` C 载入后 80ms 变 `B-BODY`；`[DS7]` 破坏态下**以 C 的名义登记了含 B 正文的恢复点**（C 的 PUT = 0，save 路径无串写） | **数据完整性**：崩溃后若「恢复」，会把 B 的内容写回 C 的路径（跨文档内容污染） | ✅ **已修**（task-19/20，2026-09-15）：① 抽出 `createDeferredLoader`（`cancel()` + **代次比对**双守卫，clearTimeout 失效也拦得住）；② `flushDraftRecovery` 改走导出的 `resolveRecoveryTarget`（id 与内容同源于 `editorDocIdRef`，`articleDocId` 仅诊断）。独立验证 PASS：gate 翻正后 `verify.test.ts` 34 例全跑、全量 **540 passed + 1 skipped**；修复前 7 例基线对照显示 DS6/DS7 已消失、DS1–DS5 无回归 |
| **F-S1-3** | 中止分支 `cancel()` 语义过宽 | `draftRegRef` 为单例、与文档无关；中止非当前文档的保存会误清当前文档的未决登记 | 当前不可达（`abortPending` 唯一入口受全屏遮罩约束）| ✅ 本轮已修（`efdf5cc`，verifier T8 复测转绿）|
| W-S3-1/2/3 | 符号链接同名碰撞走 400（fail-closed）；`.. evil.pdf` 前导点残留；`trailing.pdf.` 400 | 行为观察，非安全缺陷 | 无 | **主理人 2026-09-15 裁决：W-S3-2 暂不修**（要动共享 `sanitize_filename`，收益低）；三条全部保留为观察项，仅记录备查 |
| **F10** | 移动模块文档不校验 `ke-module source` → 引用方 `source` 悬空 | 规范 §3.2：v1 为「插入后复制内容」语义，`source` 仅记录、**不参与任何运行时解析**；后端 grep 零消费者；`ModuleNodeView` 为 `display:none` 隐藏占位 | 移动后**无运行时影响**（引用方正文照旧、无报错、无索引坏引用）；遗留三笔滞后账：①悬空元数据随复制/导出传播 ②将来做动态模块同步/引用体检时集中暴露 ③用户可能误以为引用会跟着更新 | ✅ **主理人 2026-09-15 裁决：方案 C「只登记」** —— 规范 `markdown-extension-spec.md` §3.2 已注记「悬空属预期」；不拦截、不提示；待动态模块同步需求落地时一并处理（可用必填 `id` 做兜底匹配）|

## 状态更新（2026-09-08）

| ID | 状态 |
|---|---|
| B1 | ✅ 已修（签名判据加入内容 hash，v1.1.2 批次）|
| K3-I1 | ✅ 已修（update_file/move/delete 增量同步签名）|
| K3-T1 | ✅ 已修（F13：applyTheme 监听器模块级单例）|
| K3-I2 | ✅ 已修（2026-09-15，方案 A 启动自愈；task-21/23）|

## 测试稳定性观察（2026-09-17）

| 观察 | 证据 | 处置 |
|---|---|---|
| 全量 vitest 出现**一次性** 1 failed / 547 passed | 2026-09-17 11:38 的 `npx vitest run`（当时与后端 pytest 并发执行）。**失败用例名未捕获**（当时的命令管道只留尾部 4 行）→ 无法定位 | **未能复现**：随后 5 次全量运行（含 1 次 6 路 CPU 负载下单独跑 perf-bench）全部 `548 passed + 1 skipped`。登记为观察项；**若再次出现，先捕获完整日志与用例名**再判是否修复。不排除与并发负载相关的时序敏感用例（如 perf-bench 的 1.5s 门槛） |

## K3-I2 状态更新（2026-09-15，方案 A）

**原始描述**：rename/move 非原子、无 fsync，崩溃窗口内文件名与索引不一致（`docs/reports/knowledge-editor-v1.1.0-pre.1-审查总汇报.md:51`）。现状核对：正文保存有 `atomic_write`（temp + fsync + `os.replace`），而 `fs.py::move_path` 仍只有 `src.rename(dst)`（无 fsync、无回滚）→ 描述**今天仍成立**。

**主理人 2026-09-15 裁决：开 A（最小自愈）**，把「极端崩溃」降级为「重启即收敛」。落地内容：
- 新增 `app/services/self_heal.py`：
  - `heal_recovery_drafts()` —— 扫 `Drafts/recovery/*.draft.md`，hash8 命中现存文档 → 不动；未命中且 **stem 唯一匹配** → 改名到规范名 + `store.move_recovery()` 迁移记录（**草稿内容逐字节不变**）；**0 或多个候选 → 一律不动 + WARNING**（fail-safe，绝不猜）
  - `reconcile_recovery_records()` —— 兜底：草稿文件已改名但记录未迁（崩在文件改名与记录迁移之间）→ 只迁记录，文件零变动
  - `count_backup_orphans()` —— `Drafts/backup` 孤儿**只统计不删除**（非破坏性）
- `app/main.py`：启动 lifespan 调用（**调用点 try/except 纵深防御**，自愈失败不阻断启动）+ `install_workspace_hook()` 包装工作区激活入口，使启动 / `/api/workspace/open|create` / 测试直接调用都覆盖；幂等 + 无草稿时不扫文档。

**独立验证（verifier，19 例 + dev 14 例）**：崩溃窗口**真复现**（不调自愈函数，直接造「新路径文档 + 旧 hash 草稿 + SQLite 记录指旧路径」→ 走真实 lifespan）；歧义 fail-safe；幂等（两次启动 sha+mtime_ns+DB+GET 四重零变化）；**全工作区不变量**（启动前后增删恰好 = 新/旧草稿，其余文件逐字节不变 → 未发现任何用户内容被删/改写）；E1b 升格为硬契约（入口整体抛异常时启动仍存活）。全量 pytest **630 passed + 2 skipped**（597 + 19 + 14），openapi 快照 3 passed。

**设计取舍（如实记录）**：
1. **换名（stem 变化）的崩溃窗口不可自愈** —— 唯一 stem 匹配的前提不成立 → fail-safe 不动（草稿保留在磁盘，内容不丢，可手工找回）。这是「绝不猜」的直接代价。
2. 自愈随**每次工作区激活**跑（非严格「进程一次」），以覆盖启动与运行期切库；靠幂等 + early-return 控制开销。
3. **未做**：rename/move 的 fsync 加固（方案 B，Windows/NTFS 收益有限）与引用计数索引（方案 C，性能向、非正确性必需）。