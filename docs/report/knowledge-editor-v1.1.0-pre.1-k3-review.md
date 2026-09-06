# K3 第二阶段高级审查报告：Knowledge Editor v1.1.0-pre.1 (ab4ca1d)

- **审查对：** v1.0.2a（`4732c5c`）→ v1.1.0-pre.1（`ab4ca1d`）
- **审查定位：** 第二阶段（K3）对抗式 / 架构级审查；只审查，不修改任何代码。
- **输入：** 第一轮审查报告 + 当前工作区代码态 + 实测输出。

---

## Executive Summary

```
发布判定:需修复后发布(低修复成本)
发布阻断项数量:2(①版本一致性 P2;②新建文件夹功能缺失 P1 — 用户实测不可用)
核心数据完整性 / 保存读取 / 导出 / Markdown 方言兼容:全部 PASS
```

> **勘误（K3 自我修正，用户实测驱动）：** 初版报告结论「不存在阻止发布的功能性问题」**不成立**。用户实测「新建文件夹功能不可用」，K3 复核确认这是一个第一轮与 K3 初版都漏报的 **false negative**——后端 mkdir 成功且测试全绿，但空文件夹在前端树中根本不渲染，功能等同于缺失。已补入 K3-U1【BLOCKING】。

**一句话结论：存在 2 个发布阻断项——① 版本源漂移（`desktop/package.json` 仍为 1.0.2，第一轮误报「全链一致」）；② 新建文件夹功能因「空文件夹不进树」而实际不可用（K3 初版漏报）。两者均为低/中工作量修复，修复后可发布正式 1.1.0。**

### 验证环境与实跑结果

- 本地仓库为浅克隆（仅含 ab4ca1d，4732c5c 不可用），无法直接重放 `git diff`；所有结论基于**当前代码态 + 实测输出**独立验证，Introduced/Regression 判定以第一轮报告的 diff 地图为参照（置信度已注明）。
- 前端 `npx vitest run`：**197 passed / 1 skipped（23 files）**。
- `npx tsc -b --noEmit`：exit 0。
- `npm run build`：成功，产物在 `dist-build/`（非 dist）。
- 后端 `python3 -m pytest`：**161 passed / 2 skipped / 0 failed**（B1 flaky 本次未复现）。
- `cargo test`：受 Linux 沙箱 glib 限制仍 UNVERIFIED（环境限制，非代码缺陷）。
- 导出专项 `plain-export.test.ts + export-actions.test.ts`：**14 passed**（与第一轮实测一致，非 prompt 所述 74 项）。

---

## 一、对第一轮 findings 的对抗式复核

第一轮无 P0/P1，实际需裁决的是 2×P2 + 1×P3 + 1×Baseline + 5 个观察项。逐条独立验证（不采信第一轮结论，重新读代码 / 跑测试 / 核构建产物）：

| ID | 第一轮判定 | K3 裁决 | 独立依据（一句话） |
|---|---|---|---|
| F1 (P2 `bg-primary-soft0`) | 确认 | **CONFIRMED** | `EditorToolbar.tsx:152` 源码命中；`index.css` 仅定义 `--color-primary-soft`，产物 CSS `grep primary-soft0` = 0 命中、`bg-primary-soft{` 存在 → 类名拼写错误确凿，表格尺寸选择高亮失效为真实功能缺陷 |
| F2 (P2 focus ring 非 --ring) | 确认 | **CONFIRMED（实际影响 P3 级）** | 产物 CSS `.ring-2{...var(--tw-ring-color,currentcolor)...}` 证实无 `ring-ring` 时回退 currentColor；`index.css:33` 注册 `--color-ring`，Tailwind v4 中 `ring-2` + 无 ring-color 类时确实不取 `--ring` → 规范偏差成立，仅影响键盘焦点环颜色一致性，不影响任何功能 |
| F3 (P3 WorkspacePicker 版本带 v) | 确认 | **CONFIRMED** | `WorkspacePicker.tsx:28` 本地常量 `'v1.1.0-pre.1'`（带 v）vs `version.ts:4` 无 v，且系**重复维护的版本常量**（K3-V1 根因的一部分） |
| B1 (Baseline reconcile 漏更) | 确认 | **CONFIRMED（机制层面证据强化）** | 本次全量 pytest 0 失败（flaky 未复现），但机制确凿：`indexer.py:141-152` reconcile 签名 = `{rel:(size,mtime_ns)}`，`# A\n\n内容1`→`内容2` 同字节长 + 同 mtime tick → 签名不变 → 漏更；**K3 新证据：`update_file()`（`indexer.py:163`）与 `update_move` 均不刷新 `_SIGNATURE_KEY`，任何经 API 的保存后启动 reconcile 必然全量重建**（功能安全、性能退化，见 K3-I1） |
| O1（阴影 opacity 0 vs 真实 shadow） | 观察项 | **REJECTED 为缺陷（P3 记录性建议）** | 防误报清单已拍板「阴影 opacity 0」；组件使用 shadow-xl/lg 属 UI 重构产物，代码层不一致仅影响注释准确性，不构成发布问题 |
| O2（slugify 无单测） | 观察项 | **CONFIRMED 为测试缺口（P3）** | `utils/slug.ts` 无 slug.test.ts；K3 实测前后端 slugify 存在**真实行为分歧**（见 K3-V3)，使该缺口从「建议补测」升级为「有未覆盖的行为差异」 |
| O3（rounded-full 边界） | 观察项 | **REJECTED** | 圆形图标按钮 / 状态点 / 开关系合理圆形元素，非胶囊滥用，不违反设计纪律 |
| O4（自定义强调色覆写 --sidebar-primary） | 观察项 | **CONFIRMED（接受为拍板项，P3 记录）** | `settings.ts:174-176` 自定义色时同写 `--primary/--sidebar-primary/--ring`，确实使侧栏主色失去「独立于主 CTA」的分层；但**仅当用户主动设自定义色时发生**，且深色默认 #0065fd 路径不受影响——属设计取舍，建议主理人确认是否预期 |
| O5（localStorage 与 Rust 并存） | 观察项 | **REJECTED** | schema camelCase 一致，双端 merge 语义对齐（settings.ts:86-114 vs settings.rs)，无独立问题 |
| 硬约束⑥「APP_VERSION 全链一致」 | PASS | **REJECTED（第一轮误报）** | 实测 `desktop/package.json:4` = `"1.0.2"`、`desktop/package-lock.json:3` = `"1.0.0"`，与 Cargo.toml / tauri.conf.json / Cargo.lock / frontend / backend `__version__`（均 1.1.0-pre.1）**不一致**——第一轮「全链一致」结论错误（见 K3-V1） |

**第一轮漏报的重要问题（false negatives）：** **K3-U1（新建文件夹空目录不进树、功能不可用——第一轮与 K3 初版双双漏报，用户实测发现）**、K3-V1（desktop/package.json 版本漂移，且被第一轮明确误报为一致）、K3-V3（前后端 slugify 在 Windows 保留名带扩展名场景行为分歧）、K3-I1（indexer 增量更新不刷新扫描签名，reconcile 退化为永久全量重建）、K3-I2（rename_doc / move_path 非原子、无 fsync，崩溃窗口内可丢文件）。详见下节。

---

## 二、架构级新发现（K3-only，按 Release Impact 排序）

### K3-U1 — 新建文件夹功能不可用：空文件夹不进文件树【BLOCKING】

- **ID:** K3-U1
- **Severity:** P1（核心功能实际不可用）
- **Category:** 跨模块数据流（Editor → Backend API → 文件树渲染）
- **Root Cause:** RC-EMPTY-DIR — 文件树数据源（`/api/tree`）只返回**文件**（`walk_files`），前端 `buildFileTree` 只从**文件路径推导**父文件夹，空文件夹不产生任何节点，故「创建成功的空文件夹」在 UI 中完全不渲染。
- **Disposition:** NEW（第一轮 + K3 初版双双漏报，用户实测发现）
- **K3 Confidence:** HIGH（代码路径 + 后端测试 + 用户实测三方印证）
- **Release Impact:** **BLOCKING**（核心文件管理功能实际不可用）
- **File/Line:**
  - 后端：`backend/app/routers/documents.py:127-149`（`walk()` 用 `markdown_io.walk_files` 只枚举文件）；`fs.py:119-127`（`POST /dir` mkdir 成功但不影响树内容）
  - 前端：`frontend/src/utils/tree.ts:10-36`（`buildFileTree` 仅从文件路径 `parts[i]` 推导 folder 节点，无独立目录条目）；`LeftSidebar.tsx:458`（`buildFileTree(tree?.articles ?? [])`）
- **Evidence:**
  - 支持证据 — ① 后端 `POST /api/fs/dir` 返回 201、目录确实落盘（`test_file_tree.py:31-44` 等 7/7 通过）；② 但 `/api/tree` 的 `articles` 仅为 `.md` 文件路径数组，`buildFileTree` 对「无文件的目录」不生成任何 `TreeNode`；③ 「新建文件夹」入口（`LeftSidebar.tsx:412` hover 按钮 / `:743` 右键菜单）只在**已存在的文件夹**上提供，新建成功后 `notify→refreshAll→getTree` 刷新，但新空文件夹无文件 → 不渲染 → 用户看到「点了没反应」= 不可用。
  - 反证 — 若在新建文件夹里再新建文档，文档出现则父文件夹「被迫」渲染（间接证明目录已建）；说明后端与创建链路本身无缺陷，缺陷在**树渲染数据源不含空目录**。
- **Baseline comparison:** Introduced / Expanded（`buildFileTree` 为既有工具，但本轮 UI 重构把它接入新 LeftSidebar 且「新建文件夹」成为显眼入口，使该缺陷从「无入口无人触发」变为「显眼入口触发后无反馈」）
- **Impact:** 用户无法通过 UI 创建并看到空文件夹；唯一 workaround 是「先建文件夹再立即在其中建文档」，不符合直觉。文件管理核心能力受损。
- **Fix direction:** 两条路任选（建议①）：① 后端 `/api/tree` 增加目录列表（`walk_dirs`），前端 `buildFileTree` 接受文件+目录两个数组合并建树（空目录作为显式 folder 节点）；② 前端在「新建文件夹」成功后乐观插入一个空 folder 节点（治标，刷新后仍消失，不推荐）。工作量：**中**（涉前后端契约 + 树构建逻辑 + 测试）。

### K3-V1 — 版本源三处漂移且第一轮误报「全链一致」【BLOCKING】

- **ID:** K3-V1
- **Severity:** P2（无运行时功能影响）
- **Category:** 版本一致性 / 发布流程
- **Root Cause:** RC-VERSION — 版本号缺少单一事实源，多文件人工同步（backend `__version__` 注释自称「唯一版本来源」实际并非构建/打包源）
- **Disposition:** NEW（推翻第一轮硬约束⑥ PASS）
- **K3 Confidence:** HIGH
- **Release Impact:** **BLOCKING**（正式发布将重打 NSIS 并做运行时版本校验；版本源漂移恰是本发布动作的目标对象）
- **File/Line:** `desktop/package.json:4` = `1.0.2`；`desktop/package-lock.json:3` = `1.0.0`；`WorkspacePicker.tsx:28` 重复定义 `APP_VERSION = 'v1.1.0-pre.1'`（带 v，且与 version.ts 漂移）
- **Evidence:**
  - 支持证据 — 上述三处与 `Cargo.toml:3` / `tauri.conf.json:4` / `Cargo.lock:1935` / `frontend/package.json:4` / `version.ts:4` / backend `__version__`（均 1.1.0-pre.1）不一致；运行时校验链（`sidecar.rs:204` 仅校验 `version` 字段存在 + `App.tsx:123` `h.version !== APP_VERSION`）只覆盖 front↔back，**不覆盖 desktop/package.json**（该文件不进 NSIS 版本元数据，NSIS 版本取自 tauri.conf.json，故运行时无即时症状）。
  - 反证 — 无任何测试/CI 断言该文件版本。
- **Baseline comparison:** Expanded（desktop/package.json 漂移可能基线已有；本轮版本升级未同步，WorkspacePicker 常量为本轮新增）
- **Impact:** 发布流程的「全链一致」宣称不实；若 CI/打包脚本未来读取 desktop/package.json（如 npm run tauri build 链）将注入错误版本元数据；WorkspacePicker 重复常量保证未来再次漂移。
- **Fix direction:** 同步 desktop/package.json + lock 至 1.1.0；WorkspacePicker 改为 `import { APP_VERSION } from '../../version'` 并在展示层统一 `v${APP_VERSION}` 前缀。工作量：**小**。

### K3-I2 — rename_doc / move_path 非原子无 fsync（崩溃窗口丢文件）【NON-BLOCKING】

- **ID:** K3-I2
- **Severity:** P2
- **Category:** 数据安全 / 跨模块一致性
- **Root Cause:** RC-FSYNC — 写路径一致性只在正文保存（atomic_write + fsync + os.replace）落实，文件操作（rename/move）走裸 `Path.rename`
- **Disposition:** NEW
- **K3 Confidence:** HIGH（代码路径确凿；崩溃窗口概率低故 NON-BLOCKING）
- **Release Impact:** NON-BLOCKING（有明确 workaround：重启后 reconcile 全量重建可恢复索引一致；且重命名不丢内容——旧内容仍在原文件）
- **File/Line:** `backend/app/routers/fs.py:245` `full.rename(target)`；`fs.py:290` `src.rename(dst)`
- **Evidence:**
  - 支持 — 正文写盘统一走 `markdown_io.atomic_write`（tempfile+fsync+os.replace），rename/move 既无 fsync（目录项）也无事务，且 `update_move` 在 rename 之后（indexer 调用若失败，磁盘已变、索引残留旧路径）。
  - 反证 — 同盘 rename 在 NTFS 上元数据操作崩溃窗口极小；delete_article 有强制快照，rename 无但旧内容不丢。
- **Baseline comparison:** Baseline（本轮未触碰 fs.py；K3 架构视角新识别）
- **Impact:** 极端崩溃下文件名与索引/树不一致；标题改名链路（handleTitleBlur → updateArticleMeta → renameDoc）第二步失败时已写 frontmatter，状态半完成（前端 catch 仅 alert）。
- **Fix direction:** rename/move 后 fsync 父目录；`update_move` 失败时回滚或记录补偿。工作量：**中**。可排 1.1.x 修复，不阻断 1.1.0。

### K3-I1 — indexer 增量更新不刷新扫描签名（reconcile 永久退化 + B1 根因强化）【NON-BLOCKING】

- **ID:** K3-I1
- **Severity:** P2（性能）/ 与 B1 合并机制
- **Category:** 后端索引一致性
- **Root Cause:** RC-SIGNATURE — `_SIGNATURE_KEY` 仅 rebuild() 写入，update_file / update_move 不维护
- **Disposition:** NEW（与 B1 同根因域，合并计数）
- **K3 Confidence:** HIGH
- **Release Impact:** NON-BLOCKING（功能安全：不一致→全量重建，结果正确；仅启动性能退化 + B1 边界过期索引）
- **File/Line:** `backend/app/services/indexer.py:138`（rebuild 写签名）vs `indexer.py:163-198`（update_file 不写）
- **Evidence:**
  - 支持 — reconcile:150 `sig == _signature(snap)` 在任何 API 保存后必然不等（磁盘已变、签名未更）→ `return self.rebuild()`；即 P3-3「增量校验跳过全量重建」优化在实际使用中**永不命中**；B1 测试 `test_p33` 偶发失败正是同签名机制下「size 相等 + 同 mtime tick」的漏更实例（本次 pytest 161 passed 未复现，符合 flaky 描述）。
  - 反证 — 全量重建对小 workspace 代价低，用户无感知。
- **Baseline comparison:** Baseline
- **Impact:** 启动 reconcile 退化为每次全量重建；B1 边界下搜索命中过期内容。
- **Fix direction:** update_file / update_move 同步维护签名，或将内容 hash 纳入签名判据（B1 修复同向）。工作量：**中**。

### K3-V3 — 前后端 slugify 在 Windows 保留名带扩展名场景行为分歧【NON-BLOCKING】

- **ID:** K3-V3
- **Severity:** P2
- **Category:** 数据契约（文件名同步链路）
- **Root Cause:** RC-SLUG-DIVERGE — 前端 `slug.ts` 保留名检测 `^(con|...)$` 不匹配带扩展名，后端 `_WIN_RESERVED` 按 `s.split(".",1)[0]` 匹配
- **Disposition:** NEW（O2 升级为真实分歧）
- **K3 Confidence:** HIGH（双端实测输出对照）
- **Release Impact:** NON-BLOCKING（有 workaround：后端 rename_doc 409 → 前端保留 meta title，标题仍更新，仅文件名不同步）
- **File/Line:** `frontend/src/utils/slug.ts:13` vs `backend/app/services/markdown_io.py:55-56`
- **Evidence:**
  - 实测 — 前端 `slugify("con.txt")="con.txt"`、`slugify("nul.md")="nul.md"`；后端 `slugify("con.txt")="_con.txt"`、`slugify("nul.md")="_nul.md"`。
  - 场景：标题含保留名+点（如 "con.txt"）→ handleTitleBlur 以前端 slug 调 renameDoc，目标名与后端规则不一致，若冲突/拒绝则重命名失败但 meta 已更新（`EditorArea.tsx:93-104` catch alert）。
  - 其余 10 个用例（含 `a...b`、`..`、`hello world .md`、100 字符截断、CJK）双端**完全一致**。
- **Baseline comparison:** Introduced（slug.ts 为本轮新增）
- **Impact:** 极窄场景下标题→文件名同步静默失败（文件名保持旧 slug，frontmatter title 已新）；非数据损坏。
- **Fix direction:** 前端保留名检测对齐后端 `split(".",1)[0]`；补 `slug.test.ts` 双端契约用例（含 O2）。工作量：**小**。

### K3-T1 — applyTheme 每次调用累积注册 matchMedia change 监听器【NON-BLOCKING】

- **ID:** K3-T1
- **Severity:** P3
- **Category:** 主题令牌架构（健壮性）
- **Root Cause:** RC-LISTENER — `settings.ts:183-188` 在函数体内 `media.addEventListener('change', ...)`，无去重 / 无 AbortController
- **Disposition:** NEW
- **K3 Confidence:** HIGH
- **Release Impact:** NON-BLOCKING
- **File/Line:** `frontend/src/settings.ts:183-188`
- **Evidence:**
  - 支持 — applyTheme 调用点 ≥3（`main.tsx:95` bootstrap、`App.tsx:141`、`SettingsPanel.tsx:97` 每次保存设置），每次调用注册一个新监听器；监听器回调闭包引用 getCachedSettings，长期会话中泄漏累积、系统主题切换时 N 次重入 applyTheme（每次再注册 N 个）。
  - 反证 — 回调幂等（重算 data-theme），功能结果正确，仅内存 / 重复执行浪费。
- **Baseline comparison:** Introduced（主题三态 + 强调色为本轮）
- **Fix direction:** 模块级持有单 listener（注册一次）或用 AbortController 去重。工作量：**小**。

### K3-V2 — WorkspacePicker 重复维护版本常量

已并入 K3-V1 根因 RC-VERSION，不重复计数。

---

## 三、数据契约与兼容性专项

| 专项 | 判定 | 依据 |
|---|---|---|
| **Markdown 方言（ke-note / ke-attach / ke-module / ke-video / ke-footnote(s)）序列化-反序列化闭环** | **PASS** | markdown-roundtrip 19 + fidelity-regression 46 + phase3 15 + phase5-module 14 全绿（197 / 23 files）；`ke.ts` KE_FIELD_ORDER 五类字段序稳定、parseKeComment / toKeComment 互逆、keJson 保留自定义键（P3-5）；module version 字段（`ModuleExtension.ts:16,34,59,98`）解析-序列化闭环（Number↔attr），后端 `modules.py:40` `meta.get("version") or meta.get("ke_version") or 1` 兼容回退；frontmatter withFrontmatter 合并语义保留全部键（`ke.ts:38-54`）。前后向兼容未破坏 |
| **API 契约** | **PASS** | test_openapi_snapshot.py 通过（161 passed 内含）；ArticleOut 保存后返回完整元信息（`documents.py:281-291`，v0.7.2 修复保持）；rename / move / meta / health 路由契约本轮无破坏性变更 |
| **Settings 契约** | **PASS** | settings.ts mergeSettings（空串清除 / undefined 保留语义）与 settings.rs 对齐；schemaVersion=1 双端一致；settingsGates 死开关已接线；sanitize_accent_color 有 Rust 单测（沙箱无法跑，前端 settings.test.ts 通过） |
| **版本一致性** | **FAIL** | 见 K3-V1：`desktop/package.json=1.0.2`、`desktop/package-lock.json=1.0.0` 漂移；WorkspacePicker 重复常量带 v 前缀。运行时校验链（sidecar / App.tsx）本身正确，但「全链一致」不成立 |

---

## 四、正式发布阻断项清单（按 Root Cause 组织）

| Root Cause | File/Line | 问题 | 修复方向 | 工作量 |
|---|---|---|---|---|
| **RC-EMPTY-DIR**（K3-U1） | `documents.py:127-149`、`utils/tree.ts:10-36`、`LeftSidebar.tsx:458` | 新建空文件夹不进文件树 → 「新建文件夹」功能实际不可用（用户实测） | 后端 `/api/tree` 返回目录列表（`walk_dirs`），前端 `buildFileTree` 合并文件+目录建树，空目录作显式 folder 节点；补前后端测试 | **中** |
| **RC-VERSION**（K3-V1 / K3-V2 / F3 合并） | `desktop/package.json:4`、`desktop/package-lock.json:3`、`WorkspacePicker.tsx:28` | 版本源三处漂移：desktop 两文件未随 1.1.0-pre.1 升级；WorkspacePicker 重复常量带 v 前缀且与 version.ts 解耦 | ① desktop/package.json + lock 同步 1.1.0；② WorkspacePicker `import { APP_VERSION }` 唯一来源，展示层统一 `v${APP_VERSION}`；③ 正式发布时以同一常量重打 NSIS 并复核 Cargo.toml / tauri.conf.json / lock | **小** |

**共 2 项阻断（RC-EMPTY-DIR 为 K3 初版漏报、用户实测补回）。** F1 / F2 / K3-V3 / K3-I1 / K3-I2 / K3-T1 均为 NON-BLOCKING（功能不损、有 workaround 或概率极低），建议进入 1.1.x 修复队列而非阻断 1.1.0。

---

## 五、待主理人决策项

1. **O4（自定义强调色覆写 --sidebar-primary）**：用户设自定义色后侧栏主色跟随主 CTA、失去独立分层——是否预期？（默认深色 #0065fd 路径不受影响；若拍板「预期」则关闭，否则 applyTheme 需跳过 --sidebar-primary）
2. **B1 / K3-I1 修复优先级**：reconcile 签名机制（size+mtime_ns）是否接受「功能安全但启动必全量重建」进入 1.1.0，K3 建议接受（性能影响小）并将 hash 入签名排 1.1.x。
3. **F1 / F2 是否随 1.1.0 一起修**：F1（表尺寸选择高亮失效）是真实可见的功能退化，修复为一行类名；虽 NON-BLOCKING，建议顺手修复（成本极低、用户可感知）。

---

## 六、最终建议

**可进正式 1.1.0，但发布前必须完成 2 个阻断项修复。** 建议行动顺序：

1. **修 RC-EMPTY-DIR（K3-U1，新建文件夹可用性）** → 核心功能，用户实测不可用，涉前后端契约，工作量中；
2. **修 RC-VERSION**（同步 desktop 版本 + WorkspacePicker 去重）→ 第一轮「全链一致 PASS」误报的纠正，工作量小；
3. **顺手修 F1**（`bg-primary-soft0`→`bg-primary-soft`，一行）与 K3-V3（slug.ts 保留名对齐后端 + 补 slug.test.ts），成本极低、消除两个真实用户可感知缺陷；
4. 重打 NSIS，复核 Cargo.toml / tauri.conf.json / Cargo.lock / frontend version / backend `__version__` 五链均为 1.1.0（去 pre 后缀），并在 Windows 真机补验 U1（cargo test）、U2（CDP 视觉复核 F1/F2 修复）与 **K3-U1 的 GUI 端到端验证（新建空文件夹 → 树中立即可见）**；
5. K3-I1 / K3-I2 / K3-T1 / B1 排 1.1.x；O4 待主理人拍板。

**在 ab4ca1d 当前状态下，新建文件夹功能不可用（K3-U1）与版本源漂移（K3-V1）是 2 个必须修复的发布阻断项；修复后即可发布正式 1.1.0。数据完整性 / 兼容性 / 保存读取类无阻断问题。**

---

## 七、K3 自我复核记录（方法论诚实）

本条为发布后对 K3 自身的复盘，非发布阻断项。

- **漏报教训：** K3 初版与第一轮都犯了同一类错误——把「后端 API + 单元测试全绿」误当作「端到端功能可用」。新建文件夹后端 mkdir 成功、`test_file_tree.py` 7/7 通过，但**测试断言停留在「目录落盘 + 含文件的树」，从未断言「空目录出现在树里」**；前端 `buildFileTree` 从文件路径推导目录这一间接数据源，使「空目录不可见」成为测试盲区。
- **触发：** 用户一句「新建文件夹不可用，你没跑出来吗」——K3 的审查清单（导出/方言/保存/版本/主题）覆盖了大量架构面，却漏掉了这个最朴素的用户路径。
- **改进：** 架构级审查应补一条「**核心 CRUD 用户路径端到端走查**」清单（新建/重命名/删除/移动 文档与文件夹各跑一遍真实数据流，而非只看 API 测试），避免「测试全绿但功能不可用」的系统性盲区。
