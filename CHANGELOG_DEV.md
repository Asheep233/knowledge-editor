# CHANGELOG_DEV.md

> 开发日志。每次 Bug 修复、功能完成、架构调整、数据格式变化、API 变化、测试结果、性能优化、重要风险发现后追加记录。
> 维护方式：按时间倒序（最新在上）或按版本顺序追加均可，保持每条记录字段完整。
> 最后更新：2026-09-22（v1.2.0 已发布；**以下修复已进 master，攒着一起发 1.2.1**）

## 未发布（1.2.1 待发）

| 提交 | 内容 | 验证 |
|---|---|---|
| `5155448` | **相邻行内公式 `$\iff$$A$` 刷新后渲染成红色错误文本**（用户实测：直接输入正常、重新解析 Markdown 后坏）。根因 = 行内公式 tokenizer 闭合侧 `(?!\$)`：两个公式紧挨时，前一个的闭合 `$` 后正好是后一个的开头 `$` → 负向前瞻失败 → 正则回溯把两式吞成一个（latex = `\iff$$A`）→ KaTeX 报错。修法：闭合 `$` 后允许「紧跟另一段行内公式开头」`\$(?=\$[^$]|[^$]|$)`，仍拒绝 `$$`；**文档数据无需改动** | 新增 `math-adjacent.test.ts`（相邻公式→两个节点且往返稳定 / 空格分隔不变 / 块级不变）；math+fidelity 7 套件 259 例；全量 vitest **60 files / 1153 passed + 1 skipped** |
| `8082084` | **编号标签后的文字错位 4px**：「（1）若…」与「（2）若…」的正文左边缘不齐（用户实测 + 红线圈出）。根因 = 正文字体栈首位 DM Sans 是**比例数字**（实测 `1`=4.68px、`2`=8.64px），而文档写的是全角括号 + 半角数字 → 两标签宽度差 3.96px。修法：`@font-face{font-family:'KE Digits';src:local('Segoe UI');unicode-range:U+0030-0039}` + 正文栈前置该字体 + `font-feature-settings:'tnum' 1`（`font-variant-numeric` 对 DM Sans 无效） | 重建后实测：`（1）`/`（2）` 均 **38.09px**（改前 34.68/38.64）；两行前缀宽度同为 **53.1px**、公式起点同为 **x=561** |

> 发布注意：v1.2.0 的 GitHub 资产**保持不变**（未覆盖）；上述修复随 1.2.1 一起发。

> 最后更新：2026-09-22（**v1.2.0 正式版已发布（Latest）**：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0）

## 2026-09-22（★★ v1.2.0 正式版）

状态：Published · **Latest**（四附件齐全，Latest 已从 v1.1.9 切到 v1.2.0）
Tag：`v1.2.0` · commit `85ecbfd`（bump）
Release：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0（2026-09-22T11:26:54Z）

**内容 = 三步走第 1/2 步 + 发布前全面审查全部修复 + 一轮界面修订**
- 新增：自定义快捷键（42 动作、既有键位零改动）· 文档标签栏 · 公式编辑光标 · **源码模式**（字符串直存）· Markdown 保真（任务列表/行内 HTML/实体/BOM/CRLF/导出 frontmatter）
- 修复：审查 B1-B5 + M1-M8 + U4（含 BOM/CRLF 字节损坏、菜单退出绕过 flush、rename 反斜杠穿越、跨工作区串写、plain 导出吞段…）· 对抗验证 R-1…R-4b（重载握手/兜底取消/PID 生命周期/重载双刷）· 真机事故（退出清理同步 PowerShell 致「窗口消失但进程不退」、Ctrl+Q 加速键不送达、capabilities 缺 window-close）
- 界面：标签栏移到最顶端 + 去双滚动条 · 源码模式同列对齐 + 去「神秘分割线」· 源码模式点击不再出外框 · `.tmp-*.md` 残留不再成文档

**发布前门禁与验收（全部实做）**
| 项 | 结果 |
|---|---|
| pytest / tsc / vitest / cargo | **735 passed + 6 skipped** / **0** / **59 files · 1150 passed + 1 skipped**（3 连跑全绿）/ **20 passed** |
| 独立对抗验证 | 后端 61 例 · 前端 122 例 · 回收站 120 例 |
| 真机验收 | 版本一致性 · 标签栏 · 设置导航 · 源码模式端到端 · **Ctrl+Q 连续输入中退出 3.9s 干净退出且内容全部落盘** |
| **U3 干净首装演练** | ✅ 清空 `%APPDATA%\KnowledgeEditor` → 首启进入工作区引导、无崩溃、无版本不一致；演练后已从备份还原用户数据 |
| **U2 导出四件产物字节校验** | ✅ **KE 导出 vs 磁盘源文档逐字节一致（sha 相同，diff=0；6/6 次导出一致）** · 普通导出零 `ke-` 残留 · zip 内嵌 md 与 KE 导出 diff=0 |

**资产**：安装包 50,806,063 B sha `a81d8fd1…` · 侧车 46,207,371 B sha `9422652e…` · manifest `09fd8319…` · versions `84979b46…`

> 最后更新：2026-09-22（**v1.2.0-pre.3 预发布 · 发布前全面审查修复版**：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0-pre.3）

## 2026-09-22（★ v1.2.0-pre.3 预发布 · 全量审查修复）

类型：Pre-release（三步走第 2 步收口：审查修复 + 界面修订）
状态：Published（Pre-release；四附件齐全；Latest 仍为 v1.1.9）
Tag：`v1.2.0-pre.3` · commit `54ff492`
Release：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0-pre.3（2026-09-22T03:18:48Z）

**修复**：发布前全面审查（NO-GO）的 **B1-B5 + M1-M8 + U4** ——
B1 BOM/CRLF 字节损坏（含 `read_text` 通用换行第二根因）、B2 菜单退出绕过 flush、B3 rename 反斜杠穿越、
B4 跨工作区串写、B5 plain 导出吞段、M1-M3 引用保护绕过族、M4 源码态导出陈旧、M5/M6 sidecar 孤儿与误杀、
M7 token 半成品移除、M8 目录删除建档+容错、U4 门禁 flaky（App 动态 import 缺 `.catch`）。
**对抗验证新增并修复**：R-1 Ctrl+R 绕过握手、R-2 兜底退出不可取消、R-3 SPAWNED_PID 生命周期、
R-4/R-4b 重载双刷与两处竞态。
**真机验收发现并自修**：退出清理里同步 PowerShell/WMI 阻塞主线程 → 「窗口消失但进程与侧车不退出」；
`capabilities` 缺 `core:window:allow-close`；WebView2 焦点下原生菜单加速键不送达（Ctrl+Q 无反应）→ 前端兜底。
**界面（用户实测）**：标签栏移到最顶端（并修双滚动条）、源码模式说明条/编辑区与正文同列（去「神秘线条」）、
源码模式点击不再出现 focus 外框、`.tmp-*.md` 残留不再成为文档/标签（枚举跳过 + 启动清理）。

**门禁**：pytest **735 passed + 6 skipped** · tsc 0 · vitest **59 files / 1150 passed + 1 skipped**（3 连跑 exit 0）· cargo 20
**独立验证**：后端 61 例、前端 122 例、回收站 120 例（报告 `docs/verification-review-backend.md`、`verification-review-frontend-rust.md`、`verification-trash.md`）
**资产**：安装包 50,807,474 B sha `4adb9b04…` · 侧车 46,208,684 B sha `35ff9658…` · manifest `663e7914…` · versions `4f9d345c…`

**正式版 `1.2.0` 前仍缺**：干净 Windows 首装演练（U3，清空 `%APPDATA%\KnowledgeEditor` 模拟首装）+ 导出四件产物字节校验在新版本上复跑。

## 2026-09-20（★ v1.2.0-pre.2 预发布）

类型：Pre-release（三步走第 2 步）
状态：Published（Pre-release；四附件齐全；Latest 仍为 v1.1.9）
Tag：`v1.2.0-pre.2` · commit `ad2e526`（bump）→ 内容见下（实现 `b34a5af`/`a3e40ff` 等）
Release：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0-pre.2（published 2026-09-20T03:17:28Z）

**内容**
1. **源码模式 MVP**（主理人拍板：切视图自动保存 / 视图态全局 / frontmatter 隐藏 / `<textarea>` / 未知语法可改但保存提示）
   - 工具栏视图切换按钮；源码视图 = `<textarea>` 直编 Markdown 原文
   - **字符串直存**：`frontmatterBlockOf + withFrontmatter(..., {stripCaretArtifacts:false}) + applyDocTraits` → 既有 saveArticle 链，**不经 ProseMirror**
   - 单视图排他、切前 flush + 确认（取消留正文）、初值 = 保存后内容、未知/损坏 `ke-*` 改动首次保存提示、切回正文重解析提示
   - 复用既有防抖/恢复点/历史/自写抑制/BOM 换行还原；U+200B 保留；只读态不可进入
   - 规范先行：`document-format.md` §6（9 条硬性契约 + §6.2.1 两条边界 + §6.2.2 重载语义）；契约见 `docs/design-1.2.0-source-mode.md`
2. **D-1 混排列表紧凑**（`- [x] a` + `- b` + `- [ ] c` → 不再插空行；引用块内/任务↔有序同样生效）
3. **D-2 嵌套未知标签**（`<em><span>x</span></em>` → `<span>*x*</span>`，集合保全；D-5 声明不作顺序镜像）
4. **EDGE-1 空 frontmatter**（`---\n---\n\n正文` 正确识别/剥离/写回）
5. **ADD-1 两条内容丢失**（`---\n---\n\n正文\n\n---\n\n更多` 吞正文；`---\n\n正文\n\n---\n` 整篇为空）
6. **ADD-2 有序任务项**（`1. [x] a` 不再被转义）；ADD-3 控制项（松散纯列表）零改动
7. **ADD-1 过度收紧回归**（首行空行型 / 顶层序列型合法 frontmatter 被误拒 → 双区块）—— 独立验证发现，Lead 修复
8. **源码模式初值修复**（编辑 → 直接切源码 → 下一次源码保存曾覆盖刚 flush 的编辑）—— 独立验证发现，Lead 修复

**门禁**：pytest **630 passed + 2 skipped** · tsc 0 · vitest **56 files / 1095 passed + 1 skipped** · cargo **20**
**独立对抗验证**：保真修复 **47 例**（`docs/verification-fidelity-fixes-120.md`，含 41 构造矩阵终测 `EXACT=0/TRAILING=24/CHANGED=17`）、
源码模式 **49 例**（`docs/verification-source-mode.md`，含对照实验与「先实测后取证」样本筛选）。
**打包冒烟 + GUI 验收**：版本横幅 `v1.2.0-pre.2` 与后端一致、无不一致提示；标签栏正常；
设置页左栏高亮四态（顶部/滚到各组/回顶/点击）全对；**源码模式端到端**：切源码 → textarea 含正文原文且 frontmatter 隐藏 →
追加两行 → 自动保存 → 磁盘与原文件**逐字节差异仅那两行**（frontmatter/正文/`ke-*` 注释/换行风格全保留）→ 切回正文恢复 ProseMirror。

**已知偏差 / 限制**：D-4 混合换行统一为主导风格（纯 LF/纯 CRLF 逐字节保留）；D-5 嵌套顺序不作镜像保证；
显式外部重载丢弃未保存的源码输入（有意取舍，与正文通道一致）。

## 2026-09-19（★ v1.2.0-pre.1 预发布）

类型：Pre-release（三步走第 1 步）
状态：Published（Pre-release；四附件齐全；Latest 仍为 v1.1.9）
Tag：`v1.2.0-pre.1` · commit `15269a0`（bump）→ 内容 `6703f5d`/`054a046` 等
Release：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.2.0-pre.1（published 2026-09-19T15:35:13Z）

**内容**
1. **自定义快捷键**（设置 → 快捷键，42 个动作）：录制/解绑/恢复默认、即改即生效；**既有键位零改动**（空映射零副作用，独立验证 15 组键位 battery + 生产接线双层）；保留键（原生菜单 `Ctrl+N/O/,/Q/R`、`F12`）拒绝绑定；`Ctrl+N` 冲突按主理人裁决保留并提示。含 **ADP-1 收口**：删除 DOM 过渡适配层，改为真实 handler 闭包注册；补 `doc.close` 定义
2. **Tab 栏**：打开入标签 / 重复打开只激活 / 关闭激活**左邻**（无左邻取右）/ 脏标记与 `saveState` 同源 / 中键关闭 / 横向滚动；切换复用既有 flush+确认链，非激活关闭**零文档请求**，无标签不注册 `doc.next/prev`；顺手清掉工具栏死「附件」按钮（G-2）与右栏 title 残留（G-3）
3. **公式光标/换行**：行内 → 公式后一位；块级 → 既有段落行首（无则新起一行）；只读态零事务；一次保存=1 事务；撤销一次回到编辑前
4. **F-1…F-5 保真修复**：任务列表 / 行内 HTML（含属性含 `>` 的引号感知）/ HTML 实体 / BOM 容忍+回写 / 按文档保留换行风格；**导出侧**（单文件 + .zip）保留源 frontmatter 键与 BOM/换行；`@tiptap/extension-list` 显式声明依赖
5. **DEL-1 数据安全修复**（既有缺陷）：确认框期间继续输入后选择「放弃」→ 此前仍会落盘；现 `discardPending`（cancel + abort）接两条放弃分支，独立验证给出「不修则必然二次写入」的对照证据

**门禁**：pytest **630 passed + 2 skipped** · tsc 0 · vitest **48 files / 894 passed + 1 skipped** · cargo **20** ·
独立对抗验证：② 38 例、F 组 80 例、① 42 例、Tab 30 例（报告 `docs/verification-math-fidelity.md`、`docs/verification-shortcuts-tabs.md`）。
**打包冒烟**：版本横幅 `v1.2.0-pre.1` + 后端 `v1.2.0-pre.1` 一致、无版本不一致提示；标签/附件/设置页快捷键组/附件默认收起均目视通过。

**发布后同日修正（GUI 验收发现 → 修复 → 覆盖上传，版本号不变）**
设置页左栏高亮，三条一起修（task-37/38，独立验证 16 例全绿）：
1. 容器重挂后监听仍持 detached 旧节点 → 高亮恒停「维护」→ 滚动时重新查询节点 + 参考线语义 + 触底例外
2. **内容不足一屏（不可滚动）时触底例外恒真** → 高亮恒末段（独立验证判 FAIL 的反例）→ 改 `scrollable` 守卫，不可滚动直接跳过滚动联动
3. 点击后平滑滚动中途短暂闪回相邻分组 → 700ms 有界抑制 + 到期强制复核
最终资产：安装包 50,791,578 B sha256 `c376d4e3…` / manifest `082f19dd…` / versions `34b3707c…`（侧车未变 `2e6185cd…`）；报告 `docs/verification-settings-nav.md`。
真机复验：顶部→常规、滚到 1200→快捷键、回顶回落、点击四组跟随；模拟超高窗口（内容不足一屏）初始「常规」且点击跟随。

**已知问题（正式版前处理）**：混合列表 tight→loose（D-1）；标准标签嵌套未知标签丢失（D-2）；空 frontmatter 区块不被识别（EDGE-1）。

## 2026-09-17（★ v1.1.9 正式版发布）

类型：Release
状态：Completed（已发布为 Latest；四附件齐全）
Tag：`v1.1.9` · commit `9bcdeb8`（bump）→ 内容提交 `ca9ff1f` 等
Release：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.1.9（published 2026-09-17T03:59:37Z）

**本版内容（发布后一周增量批次）**
1. 品牌：0908 新 logo 应用内素材 + 派生脚本；**对外图标恢复白底版**（透明深字标在深色任务栏不可见 → 整目录回退 v1.1.8 白底圆角图标集，逐字节一致；保留 `--plated-icon` 以便切「新标+白底」）
2. 附件：能力归位**左栏**「附件」区（右栏回归纯文档属性）；点击看「附属情况与附属记录」（全部引用文档逐条可跳转）；**默认收起**（表头 = 附件 N + 孤儿徽章 + 刷新）
3. 移动路径 4 项修复：F9b（目标文件夹误导 409）/ F9c（未走统一净化 → 尾空格双扩展名、纯点名丢扩展名、NUL 500）/ F11（最近更新不同步）/ F12（recovery 草稿孤儿）
4. 保存切档 2 项修复：F-S1-2（内容快照分支恒假 → 旧文档最后 <3s 编辑静默丢弃）/ F-S1-4（>200KB 过期 timeout 覆盖编辑器 + 恢复点 id/内容错配 → 跨文档内容污染）
5. 韧性：K3-I2 方案 A **启动自愈**（恢复草稿按唯一 stem 重挂、历史孤儿只统计不删除、失败不阻断启动）

**bump 后回归**：pytest **630 passed + 2 skipped**；tsc 0；vitest **38 files / 548 passed + 1 skipped**；前端产物内嵌版本串仅 `1.1.9`。

**构建链（照 handover §6）**
- `node scripts/bump-version.mjs 1.1.9` → 9 处版本源一致（lock 中 1.1.9 仅顶层 + `packages[""]` 两处，无第三方污染）
- `npm run build` → dist-build 内嵌 1.1.9
- Windows 侧 PyInstaller 重建侧车（46,202,789 B）→ 拷入 `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`
- `tauri build --bundles nsis`（beforeBuildCommand no-op 绕行 + trap 还原逐字节一致）→ `AstraNota_1.1.9_x64-setup.exe`（50,781,068 B）
- `tools/gen-manifest.py`（C:\ke-tmp 副本，F: 根）→ `versions.json` / `manifest.sha256`（**85 项**）

**冒烟（真实 exe，非安装包）**
- 版本横幅 `AstraNota v1.1.9` + 状态栏 `后端 v1.1.9` **一致**，无「版本不一致」横幅
- 关窗 `CloseMainWindow()` → **2.7s 退出、0 孤儿进程、9333 端口释放**
- 图标/横幅素材为新版（`astranota-*` 新 hash）；设置页显示 v1.1.9

**四附件（已上传，`gh release` 校验 size/state 全部 uploaded）**
| 附件 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.1.9_x64-setup.exe` | 50,781,068 B | `8b4cd210…` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` | 46,202,789 B | `5b047baf…` |
| `manifest.sha256` | 10,917 B | `2609fda6…` |
| `versions.json` | 19,344 B | `367dcc42…` |

**过程留痕**：`gh release create` 首次因上传 ~97MB 超时（命令被 SIGTERM）→ 实际产生了 **draft** 且只带上两个小附件；用 `gh release upload <tag> --clobber` 补传两个大附件后再 `gh release edit --draft=false --latest` 发布。**教训**：大附件发布应后台执行，或先 `--draft` 再 upload 再 edit（本次即按此收尾）。

## 2026-09-15（发布后 · 附件区默认收起 + K3-I2 方案 A 启动自愈）

类型：UX 调整 + 韧性加固
状态：Completed（源码 + 独立验证 PASS；未发版）；主理人已定版本 **v1.1.9**
任务：task-22/24（附件默认收起）· task-21/23（启动自愈）

**1. 左栏「附件」区改为默认收起**（主理人裁决，承接「别占太多空间」的原始诉求）
- `LeftSidebar.tsx`：`attachOpen` 初值 `true → false`；收起态只剩一行表头（chevron + 「附件 N」+ 有孤儿时琥珀徽章 + 刷新），行/详情/孤儿区块/底部说明一律不渲染
- 行为边界：默认收起**照发数据请求**（计数与徽章依赖数据）；展开态行为与之前完全一致
- 独立验证（verifier-attach，`LeftSidebar.verify.test.tsx` 25 → 33 例）：判据只改「默认态」一族，4 条被强化（刷新仍重新拉取 / 0 附件收起态不显示空态 / 收起态先断言零写 / refreshKey 计数随数据变化）+ 净新增 8 条（不省首次请求、计数徽章源自真实数据、徽章在折叠按钮内且点它即展开、`aria-expanded` 往返、收起后零残留、卸载重挂仍默认收起等）
- 门禁：tsc 0；全量 vitest **38 files / 548 passed + 1 skipped**（skip 恒 1）

**2. K3-I2 方案 A：启动自愈**（主理人裁决「开 A」；把「极端崩溃」降级为「重启即收敛」）
- 背景：正文保存有 `atomic_write`（temp+fsync+os.replace），而 `fs.py::move_path` 只有 `src.rename(dst)`（无 fsync、无回滚）→ 崩在 rename 与同步之间的窗口里，草稿会带**旧路径 hash** 而文档已在新路径（UI 里显示「找不到原文档」）
- 新增 `app/services/self_heal.py`：`heal_recovery_drafts`（hash 命中不动；**stem 唯一匹配** → 改名到规范名 + `store.move_recovery` 迁记录，**内容逐字节不变**；0 或多个候选 → **一律不动 + WARNING**）、`reconcile_recovery_records`（仅记录侧兜底）、`count_backup_orphans`（`Drafts/backup` 孤儿**只统计不删除**）
- `app/main.py`：启动调用 + **调用点 try/except**（自愈失败不阻断启动）+ `install_workspace_hook()` 包装工作区激活入口（启动 / `/api/workspace/open|create` / 测试直接调用全覆盖；幂等、无草稿不扫文档）
- 独立验证（verifier，19 例 + dev 14 例）：**崩溃窗口真复现**（不调自愈函数，直接造崩溃态 → 真实 lifespan）→ 草稿改名 `report-7a4bb084 → report-254a7df3`、`doc_path → Articles/归档/report.md`、id/saved_at/session_id 保留、草稿 sha256 逐字节不变；歧义 fail-safe；幂等（两次启动四重零变化）；**全工作区不变量**证明无任何用户内容被删/改写；E1b 由「观察项」升格为**硬契约**（入口整体抛异常时启动仍存活）
- 门禁：全量 pytest **630 passed + 2 skipped**（597 + 19 + 14）；openapi 快照 3 passed（无新端点）
- **设计取舍**：换名（stem 变化）的崩溃窗口**不可自愈**（fail-safe 不动，草稿仍在磁盘）；自愈随每次工作区激活跑（幂等 + early-return）；**未做** fsync 加固（方案 B）与引用计数（方案 C）

## 2026-09-15（发布后 · F-S1-4 修复：过期 timeout 覆盖编辑器 + 恢复点 id/内容错配）

类型：Fix（数据完整性）
状态：Completed（源码 + 独立验证 PASS；未发版）
任务：task-19（dev-attach-ui）· task-20（verifier）
来源：验证 F-S1-2 时由 verifier 独立构造证实（`[DS6]`/`[DS7]`），见上一条记录

**根因两处**
1. 大文档（>200KB）载入走 `window.setTimeout(..., 80)`，**未保存 timeout id、无代次守卫** → 切档过快时旧 timeout 仍执行 `setKeContent`，把上一篇内容灌进编辑器（`[DS6]` 实测：C 载入后 80ms 变 `B-BODY`）
2. `flushDraftRecovery`（`EditorArea.tsx:239-244`）用 `articleRef.current`（声明更早的 effect 已更新为新文档）+ 编辑器实时内容 → **id 与内容不同源**；破坏态下以 C 的名义登记含 B 正文的恢复点（`[DS7]`），崩溃后「恢复」即把 B 写回 C（**跨文档内容污染**）

**修复**
- `state/docSwitch.ts` 新增 `createDeferredLoader({ delayMs?, timers? })`（`schedule`/`cancel`/`generation`）：schedule 自增代次并清未决定时器，**回调到点再比对代次**（clearTimeout 失效也能拦）；立即载入 / 关档 / 卸载均 `cancel()`
- 新增导出 `resolveRecoveryTarget({ editorDocId, articleDocId, editorMarkdown }) => { docId, md } | null`：**配对以 `editorDocId` 为准**（`articleDocId` 仅诊断），未载入/无内容 → null = 放弃登记；`flushDraftRecovery` 改走该函数，旧「articleRef id + 编辑器内容」组合消失
- 顺序（拍照 → flushPending → cancelDraftTimer）与 S-1 登记口径未变；正常编辑路径登记次数不减少

**独立验证（verifier，34 例；含 J 组 7 例 `createDeferredLoader` 语义 + I 组缝级矩阵）**
- **gate 前后对照**：false → 21 passed/6 skipped（全量 527+7skip）；true（终态）→ **34 passed/0 skipped**，全量 **540 passed + 1 skipped**（gate 已确认留在 true，不会 false 入库）
- **修复前基线对照**（/tmp 轨 7 例）：DS6 `80ms 后 md = B-BODY` → 冻结版 `80ms 后 md = # C-disk`（覆盖消失）；DS7 错配登记消失；DS1–DS5（切档快照/无串写/零 PUT）无回归
- **缝级接口**：J1（**注入 timers 让 clearTimeout 故意失效** → 仅最新一代执行）、J2 cancel 后回调到点不执行、J3 连续 schedule 只最新生效、J5 卸载清理、J6 cancel 后可重 schedule、J7 新旧两次载入只保留最后一次；I1 18 组矩阵防空转、I2 判别性、I3 错配窗口仍同源登记（反锁「不得静默不登记」）
- 范围：`App.tsx`/`draftDebounce.ts`/`saveQueue.ts` 未改；dev 临时自检 harness 无残留

**门禁（Lead 复核）**：tsc 0；全量 **38 files / 540 passed + 1 skipped**（skip 仍 1）

## 2026-09-15（发布后 · F-S1-2 修复 + 验证发现的 F-S1-4）

类型：Fix（+ 新发现的既有缺陷）
状态：F-S1-2 Completed（源码 + 独立验证 PASS，未发版）；F-S1-4 由 task-19/20 修复与验证中
任务：task-17（dev-attach-ui）· task-18（verifier）

**F-S1-2 根因**（Lead 复核，含行号）：`EditorArea.tsx:110-112` 的 `articleRef` 同步 effect 声明更早 →
切档 effect `:368` 的 `articleRef.current?.id === prevId` **恒为假** → `contentSnapshotRef` 从未写入 →
`:376 flushPending(旧文档)` 的 saveFn（`:258-267`）取不到快照直接 `return` → 旧文档最后 <3s 编辑
**既不落盘也不登记恢复点**（生产路径被 `App.requestOpenArticle` 的 `flushWithTimeout` 挡住，属潜伏缺口）。

**修复**（3 文件）：
- 新增可测缝 `frontend/src/state/docSwitch.ts`：`onDocumentSwitch()`（顺序固定 **拍快照 → flushPending → cancelDraftTimer**）
  与 `resolveSaveContent()`（`docId === currentDocId` 才可用实时内容，否则只用该 docId 快照，**无快照 → null = 放弃保存**，承载 F14「绝不把当前编辑器内容写进旧文档路径」红线）；快照表 LRU 上限 16
- `EditorArea.tsx`：新增 `editorDocIdRef`（编辑器此刻载着谁），更新点覆盖常规切档、>200KB 的 80ms 延迟分支（在 `setKeContent` 之后）、reloadToken 外部重载、F15 保存后对齐；守卫改为「编辑器此刻是否仍载着 prevId」
- `state/docSwitch.test.ts`（新，21 例）

**独立验证（verifier，18 例 + 树外组件轨 7 例）**：冻结 sha 跑前/跑后逐字一致；判别性证明（旧判据 → null、新语义 → A 内容，两边不可区分即 FAIL）；
接线四点逐点行号与顺序证据（常规 `411→413`、延迟分支 `418→420` 均在 setTimeout 内、reloadToken 同 effect、F15 `302→305`）；
**「放弃保存」新分支的生产可达性**：正常路径不可达（切档必先拍快照再 flush，drain 同步消费；LRU 驱逐需单次 PUT 往返内切档 ≥17 次）→ 不判 FAIL
**门禁**：tsc 0；全量 **38 files / 512 passed + 1 skipped**（473+21+18，skip 仍 1）；`App.tsx` / `draftDebounce.ts` 未改

**⚠ 验证顺带发现的既有缺陷 → 登记为 F-S1-4（已开修）**：
- ① 大文档（>200KB）80ms 延迟载入的**过期 timeout 仍会 `setKeContent` 覆盖编辑器**（切档过快时）——`[DS6]` 实测：C 载入后 80ms 变 `B-BODY`
- ② `flushDraftRecovery`（`EditorArea.tsx:239-244`）用 `articleRef.current` + 编辑器实时内容，**缺 `editorDocIdRef` 守卫**（与 save 路径不同源）→ 破坏态下 `[DS7]` **以 C 的名义登记了含 B 正文的恢复点**
- 后果：崩溃后「恢复」会把 B 的内容写回 C 的路径（**跨文档内容污染**，数据完整性）；save 路径无串写（dev 声明成立）
- 处置：task-19（①代次令牌/清理过期 timeout ②`flushDraftRecovery` 补同源守卫，缝内可测）+ task-20（独立验证）

## 2026-09-15（发布后 · 主理人对三项遗留的裁决）

类型：Decision（+ F-S1-2 修复开工）
状态：F10 / W-S3-2 已落文档；F-S1-2 由 task-17/18 实施与独立验证中

**F10（移动模块文档 → `ke-module.source` 悬空）→ 方案 C「只登记」**
Lead 沿数据流复核的证据链：
1. 规范 §3.2（`docs/markdown-extension-spec.md`）明示 v1.1.0 拍板「**插入后复制内容**，不做动态引用/嵌套解析」，`source` 字段说明为「Phase 5 记录，**不参与动态同步**」；
2. 插入实现 `EditorToolbar.insertModule`：`getModule(path)` 取正文 → `stripModuleTitle` → 拼 `<!-- ke-module: {"source": path} -->` → 插入 → **内容当场复制**；
3. `ModuleNodeView` 仅渲染 `display:none` 的隐藏占位（`data-ke-module-source`），不渲染卡片、不请求后端；
4. **后端零消费者**（`backend/app` grep 无任何读取 `ke-module.source` 的代码；`referencing_docs` 只认 `Attachments/`）。
→ 结论：移动（200）**无运行时影响**（引用方正文照旧、无报错、无索引坏引用）；遗留三笔滞后账：①悬空元数据随复制/导出传播 ②将来做动态模块同步/引用体检时集中暴露 ③用户可能误以为引用会跟着更新。
→ 处置：规范 §3.2 补注「悬空属预期」，backlog F10 行标注「设计已知、待动态同步需求」；**不拦截、不提示**（拦截 A 会挡住正常改名/移动而当前收益为 0）。
→ 对照保留：**附件**的 409 保护不变（`ke-attach.src` 是动态使用，必须保护）。

**W-S3-2（`../../evil.pdf` → `.. evil.pdf` 前导点残留）→ 暂不修，仅记录**
无安全影响（穿越已被挡、文件仍在 `Attachments/<分类>/` 内），修它要动**共享** `sanitize_filename`（文档命名 + 附件命名共用），收益低 → 保留为观察项（W-S3-1/2/3 一并记录备查）。

**F-S1-2（切档内容快照分支恒假）→ 一起修**
根因（Lead 复核含行号）：`EditorArea.tsx:110-112` 的 articleRef 同步 effect **声明更早**，切档 effect `:368` 的 `articleRef.current?.id === prevId` 恒假 → `contentSnapshotRef` 从未写入 → `:376 flushPending(旧文档)` 的 saveFn（`:258-267`）取不到快照直接 `return` → 旧文档最后 <3s 编辑**既不落盘也不登记恢复点**（生产路径被 `App.requestOpenArticle` 的 `flushWithTimeout` 挡住，属潜伏缺口）。
处置：task-17（抽 `state/docSwitch.ts` 可测缝 + 修守卫语义为「编辑器此刻是否仍载着 prevId」+ 顺序不变量）+ task-18（独立对抗验证，含**判别性证明**：旧恒假判据必须产生「保存被放弃」而新实现产生「用 A 的内容保存」，两者不可区分即判 FAIL）。

## 2026-09-15（发布后 · 移动路径 4 项修复：F9b / F9c / F11 / F12）

类型：Fix（含新引入的语义收敛，见 WARN）
状态：Completed（源码已提交并推送 master；未发版）
来源：`docs/design-file-management-feasibility.md` 的实测登记（F9b/F9c/F11/F12）→ 修复与验证留痕 `docs/verification-move-fixes.md`

**触发**：主理人问「那几个 Fxx 现在能修吗」→ 后端 4 项（F9b/F9c/F11/F12）当日修完；F10 待裁决；F-S1-2 单独排期。

**F9c（最重，含两个可用性缺陷）** —— `move_path` 目标末段完全不走统一净化：
- 尾空格 `Articles/文档.md ` → 旧实现 `suffix = Path("文档.md ").suffix` 得 `".md "`（含空格）≠ `".md"` → 重复补后缀 → 落盘 `文档.md.md ` → **名字不再以 .md 结尾，文档从树/索引消失**
- 纯点名 `....md` / `.md` / `..md` / `.. .md` → 落盘 `md` / `md` / `md` / `.md.md`（**隐藏文件**），同类后果
- NUL 字符 → `_guard_rel → Path.resolve()` 抛 `ValueError: embedded null character`（真实 uvicorn 下 **500**）
- 修复：扩展名 oracle 改为「先 `strip().rstrip('. ')` 再取最后一个点后有内容的部分」，主名过 `sanitize_filename`、扩展名单独拼回并**收敛到源文件类型**（文档恒 `.md/.markdown`，附件随源扩展名）；净化后重新校验顶层与业务目录；NUL 在 `_guard_rel` 之前 400，`safe_rel_path` 异常兜底 400（fs 全端点受益）；非 NUL 控制字符仍走净化（`控制\x01字符\x07.md` → `控制 字符.md`）

**F9b** —— dst 是已存在**目录**时只报「目标已存在」，用户读不懂；且检查顺序若在 F9c 之后，`Articles/子目录` 会被补成 `子目录.md` 而绕过提示。
→ 明确「目标是已存在的文件夹：…，请在目标路径里带上文件名」，并把该检查固定在顶层/同区校验之后、F9c 收口之前。

**F11** —— `_sync_after_move` 只做 indexer + history，移动后「最近更新」仍留旧路径（点开 404）。
→ `app_config.rename_recent_document()`（原位替换 rel_path，保 title/顺序/去重/上限 20，未命中不写盘）+ 目录移动按前缀逐条平移。

**F12（数据安全）** —— 草稿名 = `{stem}-{hash8(完整相对路径)}.draft.md`，`_migrate_history` 只迁 `Drafts/backup`，移动后 recovery 草稿成孤儿 → **未保存内容失联**。
→ 草稿文件改名（**内容逐字节不变**）+ `store.move_recovery()` 迁移 DB 记录（保留 id/saved_at/session_id，不新增表/不改 schema）+ 目录移动遍历迁移；目标草稿名已占用时**不覆盖**（保留原文件与原记录）；无草稿 no-op。三类同步失败均只记日志、不阻断 200（沿用 `_sync_after_move` 契约）。

**独立验证（verifier，非开发者自测）**：`backend/tests/test_move_fixes_verify.py` **93 例**（含「失败请求前后快照必须相等」「inode 不变证原子 rename」「草稿逐字节不变 + SQLite 行级核验」「移动失败时最近列表逐字节不变」「DB 丢失时目录扫描兜底」「目录移动内草稿也迁移」）。
- 冻结前该套件对**未冻结实现**先报 **7 红**（尾空格双扩展名 / 纯点名丢扩展名 / `.. .md` 隐藏 / NUL 未捕获）→ 全部修复后 93/93 绿
- 修复前基线已在 `3f97f1a` 上留证（非法字符 dst → 200 落原名、recents 仍旧路径、recovery 仍旧 doc_path）

**门禁**：`pytest` **597 passed + 2 skipped**（基线 462+2 + 开发者 42 + 独立验证 93，只增不减）；`test_openapi_snapshot.py` 3 passed（无新端点）；前端未涉及；`markdown_io.py` 未改。

**⚠ 本轮新引入语义（如实保留，非缺陷）**：
- **W1** API 调用者显式写 `报告.PDF` / `新名.txt` → 静默收敛为 `.md`。UI **不可达**（`LeftSidebar.handleMove` 用 `` `${target}/${node.name}` ``，只换目录、保留源名），响应 `to` 即权威路径。
- **W2** 附件 `photo.jpeg` → `photo.jpg` 会收敛回 `.jpeg`（同目录同主名 → 409）→ **用 move 改附件扩展名不再可行**（修复前允许；无数据丢失、UI 不可达）。

## 2026-09-15（发布后 · 附件归位左栏 + 对外图标白底复原）

类型：Refactor / Fix
状态：Completed（源码已提交并推送 master；本机已重建 exe 并 GUI 目视验收；**未重新发布安装包**）
提交：`1355c07`（附件归位左栏 + 右栏净身）· `e8af9d4`（对外图标回退白底版）· `44ae327`（plated 圆角对齐旧版）

**1. 主理人纠偏：附件归位左栏**
原话：「『附件』应该在左侧查看啊（那里本来就有一列附件的 UI），不应该在文档属性里，文档属性就是文档属性。」
上一轮把附件列表/附属记录/孤儿处理做进了 RightPanel（task-9/11）→ 本轮**整体迁到左栏「附件」区**并让右栏净身：
- 左栏：可折叠小节（表头 = chevron +「附件 N」+ 折叠按钮内琥珀徽章「孤儿附件 N」+ 刷新；**默认展开**）、
  行 = 图标 + 去前缀名称 + 大小 + 已引用/未引用徽章、行点击就地展开「附属情况与附属记录」（**全部** `referenced_by`
  逐条可跳转；未引用显「未被任何文档引用」+ 路径/大小/修改时间）、保留原「打开文件」`<a href={attachmentUrl}>`、
  孤儿区块（说明 + 手动删除）随展开态；数据源改为 `listAttachments()` + `listOrphans()`（**渲染不再依赖 `tree.attachments`**），
  `refreshKey` 驱动刷新
- 右栏：附件小节/state/副作用/import 全删（`grep -c 附件 RightPanel.tsx` = 0），文档属性 / 大纲 / 历史快照保留，
  右栏不再发任何附件请求

**2. 对外图标回退白底版**（详见上一条记录 ⚠→✅ 段）：`desktop/src-tauri/icons/**` 整目录 checkout 回 v1.1.8
（52/52 逐字节一致，`128x128@2x.png` = `ec01435f…`）；脚本增补 `--plated-icon`（「新标 + 白底」选项，
圆角按可测内缩口径对齐旧版：半径参数 0.198×1024 → 首行内缩 189px vs 旧源 188px）。

**门禁（全绿，主理人复跑 + verifier 独立复算）**
- `npx tsc -b --noEmit` exit 0
- 全量 vitest **36 files / 473 passed + 1 skipped**（基线 449 → +24，无净丢失：原右栏 12 条附件用例逐条映射到左栏新用例）
- 后端 pytest **462 passed + 2 skipped**
- 独立验证 `docs/verification-relocate.md`：左栏迁移 25 例 + 右栏净身 13 例（含源码级净身断言
  「`RightPanel.tsx` 去注释后不含 `listAttachments/listOrphans/deleteAttachment/uploadAttachment`」与反向等价性反证
  「tree 有附件名 + API 空 → 不得渲染」）+ 图标 52/52 逐字节 + 脚本两模式字节级可复现

**GUI 目视验收（主理人，`D:\KE-Project-shots\`）**：左栏默认展开（`附件 10` + 琥珀「孤儿附件 6」）、
点行出「附属情况与附属记录」、收起后仅剩一行表头且徽章可见、孤儿区块 6 条删除按钮齐全；
右栏只剩「文档属性 + 大纲」；任务栏图标为白底圆角版清晰可见。

## 2026-09-15（发布后 · 品牌 logo 替换 + 附件区改造｜历史过程，落点已被上一条取代）

类型：Feature / Fix
状态：Completed（源码已提交并推送 master；本机已重建 exe 目视验收；**未重新发布安装包**）
提交：`077285d`（logo 替换，含派生脚本）→ `50e44df`（横版尺寸修正）→ `3047082`（附件区）

**1. 品牌 logo 替换（新素材来自 `<repo>/../AN Logo`）**
- 新增 `scripts/make-brand-assets.py`：从原始素材（3334² 画布、内容仅占 18~23%）**裁到 alpha 内容边界**再派生，
  避免 CSS 拉伸变形（侧栏 `size-8` + `size-full`、横幅 `h-12 w-auto`）。
- 产物：`frontend/src/assets/astranota/` 四件（icon 256×256 内容占比 74.6%；横版 800×200 占比 99.0%）+
  `Logo/unified/astra-icon-1024.png`（供 `tauri icon`）。
- **发现并修复**：横版分支原用 `resize_width(im, 800)` → 实际 800×**202**，而文件名常量写死 `-800x200.png`，
  靠一句「近似标签」注释兜着 → 改为 `fit_into(im, 800, 200)`（等比放入、不拉伸），文件名 = 真实尺寸；
  顺带修脚本自身「旧尺寸」列在覆盖写之后才读、永远显示新尺寸的报告 bug。
- `desktop/src-tauri/icons/**` 由 `tauri icon` 重新生成（15 PNG + icns + ico + mobile 33 个）；
  `lib.rs` 的 `include_bytes!("../icons/128x128@2x.png")` 目标已更新（`ec01435f…`→`b1aba9b3…`）。
- **可复现性**：派生脚本在 /tmp 副本上重跑，5/5 产物与仓库**字节级一致**（verifier 独立复算）。

**2. 附件区改造（`frontend/src/components/layout/RightPanel.tsx`）**
- 列表**默认收起**，收起 = 只剩一行表头（`附件 N` + 刷新）；点击表头展开。
- 孤儿信号不丢：折叠按钮内置琥珀徽章「孤儿附件 N」（收起态 100% 可见）；孤儿处理区块（说明 + 删除按钮）
  **随列表一并收起**（主理人 2026-09-15 裁决：诉求是「别占太多空间」，信号由徽章承载）。
- 点击附件行 → **就地展开「附属情况与附属记录」**：列出**全部** `referenced_by`（逐条可跳转），
  未引用时显示「未被任何文档引用」+ 全路径 / 大小 / 修改时间；点同行收起、点异行切换。
  修掉旧行为「只跳 `referenced_by[0]`、未引用附件点了没反应」。
- 只读不变量：零写请求（27 个写函数替身零调用 + 裸 fetch 绊线）、不 import `frontend/src/editor/**`。

**门禁（全绿，主理人亲自复跑）**：tsc 0 · vitest **35 files / 449 passed + 1 skipped** ·
pytest **462 passed + 2 skipped**（collect 464）· `tauri build --no-bundle` 成功（beforeBuildCommand 绕行后逐字节还原）。
独立验证产物 `docs/verification-attach-logo.md`（verifier 26 条对抗用例，含真后端/上游语义级核对与未验证项声明）。

**⚠ → ✅ 对外图标已按主理人指令回退为白底版（同日处置）**
发现：`tauri icon` 图标集是用**新版透明素材** `astra-icon-1024.png` 生成的 → 透明深字标
（不透明像素仅 13%、不透明区平均 RGB (3,6,12)），在**深色任务栏**下几乎不可见；
而 v1.1.8 的图标集是**白底圆角方形**（bbox 100%、96.1% 不透明、平均 RGB (229,230,234)）。
主理人指令：「应用的对外 icon 要用旧版有白底的」。
处置：`git checkout 57d1e6a -- desktop/src-tauri/icons`（50 文件全部为 M、无新增/删除 → 整目录复原即逐字节一致，
`128x128@2x.png` sha 回到 `ec01435f…`）；脚本增补 `--plated-icon`，可派生「新标 + 白底圆角」源
`Logo/unified/astra-icon-plated-1024.png`（几何对齐旧白底版：圆角半径 0.208×边长、标记宽占 0.85、居中，
不透明像素 96.3%），若将来要换新标白底可直接 `tauri icon` 该文件。
重建 exe 后任务栏实测：白底圆角图标清晰可见（`D:\KE-Project-shots\taskbar-zoom.png`）。
应用内素材**不受影响**（仍是新版透明标）。

## 2026-09-15（★ v1.1.8 正式版发布）

类型：Release
状态：Completed（已发布）
Tag：`v1.1.8` · commit `1bd3983` · https://github.com/Asheep233/knowledge-editor/releases/tag/v1.1.8

**发布前门禁（全绿）**：pytest 462+2skip · vitest 33 files/411+1skip · tsc 0 · cargo 13 ·
前端产物内嵌版本串仅 `1.1.8` · 侧车 `/api/health` = 1.1.8 · 运行时无「版本不一致」横幅。

**发布流程要点（照 §6，含两处本机特有的坑）**：
- 侧车重建必须在 Windows 侧（PyInstaller 仅 Windows 可用；WSL 只能构建 Linux 二进制）
- `gh.exe` 是 Windows 程序 → 附件与 `--notes-file` 必须传 **Windows 路径**（`/mnt/f/...` 它会解析失败）
- NSIS 构建期间 `beforeBuildCommand` 临时改 no-op（坑 5），**构建后已逐字节恢复并比对确认**

**附件**：`AstraNota_1.1.8_x64-setup.exe`（48.5MB）/ 侧车 exe / `manifest.sha256`（84 项）/ `versions.json`

**发布后同日修正（主理人问「为什么安装器语言变成英文了」）**：
根因 **不是本次发布引入** —— 提交 `dccb8f9`（添加 NSIS 品牌迁移钩子时）**整块替换**了
`bundle.windows.nsis`，把 `languages: ["SimpChinese","English"]` 与 `installMode` 一起丢失
→ **自 v1.1.5 起所有安装包只剩英文**（v1.1.4 是最后一个中文包）。

实测证据：修复前 `release/nsis/x64/installer.nsi:464` 仅 `MUI_LANGUAGE "English"`；
修复后 `:464-465` 含 `SimpChinese` + `English` 且生成 `SimpChinese.nsh`；
安装包 sha256 `95b989ac…` → `37d009da…`。
`installMode` 经查生成脚本实际值为 `currentUser`（= Tauri 默认）→ 丢失无行为影响，故只恢复 `languages`。

处置（主理人选定「覆盖 v1.1.8」）：修复提交 `4b9ffc1` → tag `v1.1.8` 强移至该提交 →
`gh release upload --clobber` 替换安装包 → 三方一致（`remote master = remote tag = 4b9ffc1`）。

另记两个本机发布坑（均已在 §6/§8 之外单独踩到）：
- `gh.exe` 是 Windows 程序 → 附件与 `--notes-file` 必须传 **Windows 路径**（`/mnt/f/…` 会解析失败）
- NSIS 重建的 `beforeBuildCommand` no-op 绕行已封装为 `C:\ke-tmp\rebuild-nsis.sh`，
  用 `trap` 保证**无论成败都还原**并逐字节比对

## 2026-09-15（回收站 MVP 交付 + 原生确认框静默失效根治）

类型：Feature（回收站，主理人立项）+ 安全性既有缺陷修复
状态：Completed
分支：master · 修订 `af7542e` → `c05de58` → `ff7e9b8` → `e6b902a` → `9d4d207`

### 一、回收站 MVP（主理人 2026-09-15 显式立项，推翻原「拍板延后」）

**落点＝workspace 根级 `Trash/`**。选它的关键理由（实测对照）：该目录**不在**任何扫描器的
枚举范围内（indexer / fs_watch / references / `/api/documents/tree` 只认
Articles/Modules/Attachments）→ 回收站内容**天然不进索引/搜索/树/watcher，零扫描器改动**。
反例：放 `Articles/.trash/` 会进 tree + 搜索 + 附件列表 + watcher，需 9+ 处排除。

**清单从目录结构派生**（entry 名 `YYYYMMDD-HHMMSS-<4~16hex>` 内含删除时间，条目下保留原 rel
完整路径）→ 不引入 DB 表/sidecar，不把 SQLite 当虚拟文件系统（Markdown 单源红线）。

- 删除文档改道：`documents.py::delete_article` → 原子 move 入 Trash（**P1-11 删除前快照保持不变**，
  双份保留是有意的）；文件夹与附件仍硬删（MVP 仅文档）
- 新增 4 端点：`GET /api/trash`、`POST /api/trash/restore`、`DELETE /api/trash/{id}`、`DELETE /api/trash`
- 前端：启用侧栏「回收站」导航（原为 disabled 占位）+ `TrashPanel`（列表/恢复/彻底删除/清空）
- 契约 §7 文案：文档删除改**单次确认 +「可在回收站恢复」**；文件夹删除保留「无法恢复」双重确认

**独立对抗验证发现 6 处真缺陷（含 1 处数据丢失、2 处符号链接逃逸），全部修复**：
id 碰撞致覆盖（独占创建 + 计数扩展 id 兜底）、`purge` 遇符号链接 entry 500、
`restore` 对符号链接 entry 放行可搬运外部文件、手工 entry 可恢复到非文档位置（改用
`is_doc_rel` 白名单）、去重上限耗尽 500（应 409）、路径参数名与契约不一致。
契约同步新增硬约束 C7（符号链接拒绝）/C8（恢复过文档白名单）/C9（id 碰撞不丢数据）。

**孤儿附件数据安全**：文档进回收站后若从引用索引消失，其附件会被判「孤儿」并可删除，
用户「清理孤儿」即毁掉可恢复文档的引用链 → `references.py` 扫描范围**增加 `Trash/`**；
并**删除 `attachments.py` 自带的重复 `_doc_refs_index` 实现**（收敛到共享服务——
不收敛则本加固会在此漏掉）。

### 二、★ 原生 `window.confirm` 在 Tauri 下恒真 → 全仓 17 处确认静默失效（安全性）

主理人 GUI 验收时察觉「删除没弹窗」。CDP 实测查明：

```js
window.confirm = async function(i){ return await invoke("plugin:dialog|confirm", {...}) }
```

Tauri v2 **把 `window.confirm` 替换成 async 函数** → 恒返回 **Promise（truthy）** →
`if (!window.confirm(…)) return` **判定永为假** → **确认全部被静默绕过**。
叠加 `capabilities/default.json` 的 `dialog:default` **实测只授予
allow-message / allow-save / allow-open（不含 allow-confirm）** → 返回 rejected Promise，
**仍是 truthy** → **修 ACL 也无效**。

**影响**：17 处确认全部失效，含**丢弃未保存修改**（切换文档/重载外部版本/切换工作区/
关闭工作区/新建/导入覆盖）、改名丢弃、恢复历史版本、删除孤儿附件、重建索引 ——
即**涉及数据丢失的操作一直没有二次确认**，且界面无报错、靠肉眼验收发现不了。

**修复**：`PromptDialog` 扩展为 prompt + **confirm** 双形态（`askConfirm` 返回
`Promise<boolean>`，危险操作初始焦点落「取消」防误触回车）；17 处全部改 `await askConfirm(…)`。
**未动 `window.alert`**（其 `plugin:dialog|message` 已授权、确实可用）。
新增回归守卫 `no-native-dialog.test.ts`（源码再用原生对话框或把 Promise 当布尔 → 测试直接失败）。

**注意与 P0-2 的区别**：切换文档时「先 flush 未决保存再切换」是 **P0-2 的既有设计**（防丢输入），
不是本次改动；`askConfirm` 只在 **flush 超时**时才出现。

### 验证

pytest **450 passed + 2 skipped**（基线 314+2）· tsc **0** ·
vitest **33 files / 411 passed + 1 skipped**（基线 28/378+1）· cargo **13** · `npm run build` ✓ ·
独立对抗套件 **120 用例 0 红**。

> 独立性声明：对抗用例由独立 agent `verifier-trash` 按契约推导（不 import 实现模块），
> 但该作者因 token 耗尽中断，**执行与判定由 Lead（实现者本人）完成** →
> `docs/verification-trash.md` §0 已如实标注「不构成完整独立验证」。

## 2026-09-14（v1.1.8 候选 S-2 落地 · GFM 脚注 `[^1]` 等价解析）

类型：Feature（backlog 候选 S-2）+ 4 项既有缺陷附带修复
状态：Completed
分支：master · 修订 `2f2eede` → `75273e5`

**验证：tsc 0 错 · vitest 28 files / 377 passed + 1 skipped（基线 263）· pytest 314 passed + 2 skipped ·
cargo 13 passed。独立对抗验证：`docs/verification-s2.md` + `frontend/src/editor/gfm-footnote-verify.test.ts`（84 用例）。**

### 问题（实测，比 backlog 描述严重）

backlog 写「外部文档粘贴会降级为纯文本」；实测是**破坏性转换**（marked 17.0.6 未实现 GFM 脚注，
而 `[^1]: x` 是 CommonMark 的「链接引用定义」）：

| 输入 | 保存往返输出 | 后果 |
|---|---|---|
| 引用 + `[^1]: 内容` | `正文[^1](第一脚注)。` | 引用变**假链接**，结构损坏 |
| `[^1]: 孤立定义`（无引用）| `正文无关。` | 定义行**整行消失**（内容丢失）|
| 多段落脚注（4 空格续行）| `…\n```\n续行\n```"` | 续行变**代码块**，结构错乱 |

且产品自家「导出普通 Markdown」产出的正是该语法 → **导出→再打开即损坏**（闭环缺口）。

### 实现：解析入口全文规范化（**不新增 marked tokenizer**）

- 新增 `frontend/src/editor/gfm-footnote.ts`，在 `setKeContent` 内、`setContent` 之前把 GFM 脚注
  等价转为既有 `ke-footnote` / `ke-footnotes` 标记（**不新增节点类型**，复用全部渲染器与导出降级）
- 选此形态的原因：脚注编号按 GFM 语义是「定义**首次被引用**顺序」，引用通常出现在定义之前，
  tokenizer 局部作用域拿不到全文；且**不新增 tokenizer 即无注册顺序抢占风险**。
  生产环境 markdown 解析入口**仅此一处**（`handlePaste` 只处理文件粘贴，初始 content 恒空）
- **消歧＝定义感知**（原方案建议无条件识别，其实施期修订：全文规范化后全文上下文免费获得，
  定义感知与 GFM 一致且对无脚注文档**零行为变化**）
- **掩码方向性**：宁可漏转（退化为字面文本，无损），不可误转。覆盖围栏 / 缩进代码 / **跨行
  code span** / 行内与块级公式 / HTML 注释与块 / 行内 HTML / **链接与图片目标** / **引用式链接定义 URL**
- **中和**：未收编的「定义样」行（重复定义、容器内 `> [^1]: x`、标题内 `## [^1]: x`）转义为字面文本
- 已有 ke-footnotes 区域时**并入**，不新建第二个区域

### 附带修复（独立验证驱动；前三项为既有缺陷）

1. **行首引用退化为块级 fallback**（C26/C27）：行首 `<!-- … -->` 在 marked 里是块级 HTML，
   原实现返回仅含注释的 fallback 块 → 引用退化纯文本；中途尝试「让位」更糟（注释被静默丢弃）。
   最终在块级直接产出 `ke_footnote` token 重建 footnote 节点
2. **`keFallbackTokenizer.start` 恒 -1**：「1 个字符 + 行内脚注」处原返回 0 → marked 把段落从第 1 个
   字符截断（`一[^x] 二[^x] 三[^x]。` refs 由 3 变 2）
3. **`plain-export` 脚注续行不再 `trim()`**：原实现压平缩进，脚注内代码块（GFM 8 空格）导出→回读后不再是代码块
4. **图片 alt 段掩码**（C28）：alt 是纯字符串，GFM 不在其中解析引用

另：一度引入的 `-->` → `\u003e` 转义**已回滚** —— P2-17 早已用**括号平衡 JSON** 解决该问题，
该转义无必要且破坏既有回归守卫（fidelity-regression 当场抓出）。

### 规范（红线：先行）

`document-format.md` 新增 §2.3.1（识别规则 / 边界表 / 编号 / 中和 / 掩码方向性）+ §4 兼容策略；
`markdown-extension-spec.md` §2.2 + §4 方言提示；新增方案书 `docs/design-s2-gfm-footnote.md`。

### 方言转换（预期行为，已在规范写明）

GFM 脚注文档打开并保存后输出为 ke 方言；此时在 GitHub/Typora 上脚注标记会被当 HTML 注释忽略
（与其它 `ke-*` 节点一致）。需保持外部可读时用「导出普通 Markdown」——`plain-export` 会还原为 GFM。

### 已知边界（主理人 2026-09-15 拍板：写入规范，本轮不修）

GUI 验收观察到脚注条目内的 `**粗体**` 显示为字面星号。核验确认**非 S-2 回归**：
`footnotes` 节点的 `items[].text` 是**纯字符串**（`FootnotesExtension.ts:27` `text: string`；
`FootnotesNodeView.tsx:72` 直接作为文本节点渲染，不走 Markdown 解析）；ke 原生脚注
（`insertFootnote(text)`）行为一致，修复前后不变。同理「GFM 8 空格 = 脚注内代码块」
在本模型下只能是普通段落。

**决策：写入 `document-format.md` §2.3.2**，显式声明「不解析行内格式」是当前契约的一部分，
避免被当作缺陷反复上报。消除该边界需把条目正文升级为块级内容——属 D 层格式变更（红线），
须独立批次 + 旧文档迁移，本轮不做。

## 2026-09-14（v1.1.8 候选 S-1 + S-3 落地 · 首次 Agent Team 并行）

类型：Feature（两项 backlog 候选）
状态：Completed
分支：master · 修订 `fc98a98` → `d8c0e61` → `1bb00a6` → `efdf5cc`

**验证：tsc 0 错 · vitest 262 passed + 1 skipped（基线 248 + 新增 15）· pytest 314 passed + 2 skipped
（基线 177 + 本任务 37 + 独立验证 102）。独立对抗验证报告：`docs/verification-s1-s3.md`。**

### S-1 草稿恢复点扩展到编辑防抖（`fc98a98` + `d8c0e61` + `efdf5cc`）

**根因比 backlog 描述严重**：恢复点原本只在**保存开始时**登记；而 `saveQueue.enqueueSave`
是**纯尾沿防抖且无 maxWait**（每次编辑 `clearTimeout` 重置）→ 用户**连续输入**时计时器被反复
重置、永不触发，**既不自动保存也不登记恢复点**。故硬崩溃丢失窗口**不是「一个 autosave 周期」而是无界**
（连续写作十分钟可整段蒸发）。

- 新增 `frontend/src/state/draftDebounce.ts`：与保存防抖**解耦**的「有界年龄」调度——
  自首笔未登记编辑起至多 3000ms 必登记一次，**且不因后续编辑重置**（重置即退化为原缺陷）；
  序列化只在登记时机执行一次，不在击键路径（守住 Phase 6.4 优化）。
- 并发正确性三处防护：`markSaved` 仅在「保存覆盖最新编辑 **且** 文档仍为当前」时清除；
  切档 `cancel()` 防串档；中止路径 `cancel()` 需门控**中止时刻**仍为当前文档。
- **性能权衡（verifier 独立量化，不美化）**：击键路径**无**新增序列化；新增代价为连续输入时
  每 3s 一次同步序列化——191KB 稳态中位 39.8ms / 冷 105.5ms，256KB 中位 54.9ms / 冷 86.2ms；
  某次击键落入阻塞窗口概率 ≈1.0–1.8%（冷 2.9–3.5%）。判定 PASS，但该成本是 S-1 新增的。

### S-3 附件上传保留原始文件名（`1bb00a6`）

- 原 `{ms}-{hex6}{ext}` 使路径穿越**结构上不可能**；保留 `file.filename`（用户可控）会引入该面，
  故采用双防线：净化层（复用 `sanitize_filename`，仅净化主名；扩展名走白名单单独拼回）
  + 路径层（单组件名断言 + `resolve()` 父目录严格校验，**先校验后落盘**）。
- 不覆盖：NFC+casefold 识别**大小写不敏感碰撞**（Windows 语义）→ 确定性 `name-1.ext`；
  `open("xb")`（O_EXCL）兜底 TOCTOU。
- 必要附带修复（保留原名引入的新失败面）：CJK 名进 `Content-Disposition` 的 latin-1
  `UnicodeEncodeError`（500 级）→ 升级 RFC 6266/5987；multipart `%22/%0D/%0A` 逆变换。
- 返回体 `name` 语义由「回显 raw」改为「实际落盘 basename」——已核实前端 `attachmentNode`
  只用 `res.category`/`res.path`，标题取自 `File.name`，无调用方依赖。

### 验证与协作方式（首次启用 Agent Team）

- Lead 亲自实现 S-1（关键路径）；`dev-attach` 独立实现 S-3（仅 `attachments.py` + 新测试文件）；
  `verifier` 独立对抗验证两者（写独立测试 + 报告，不改源码）。
- 对抗验证产出 2 个真实缺陷并均在交付前修复：**F-S1-1** 中止路径漏清未保存标记 → 孤儿草稿
  （与磁盘同内容的假恢复点，下次启动误弹）；**F-S1-3** 中止分支 `cancel()` 语义过宽。
  其中 F-S1-3 的修复**第一次尝试无效**（套用起始快照 `isCurrent` 仍过期），改为**中止时刻重读**
  `articleRef.current?.id === docId` 才转绿——该细节已写入代码注释与验证报告。
- 独立发现未修：**F-S1-2**（F14 快照分支自 `53803ca` 起恒假，潜伏；生产被 App 前置
  `flushWithTimeout` 挡住）→ 记入 backlog「独立遗留项」，建议另立任务。

## 2026-09-14（接管核对 · 环境收尾，无产品代码改动）

类型：Maintenance
状态：Completed
范围：F 盘迁移（`D:\KE Project` → `F:\Work\KE Project`）后的接管核对 + 环境修复

**验证：tsc 0 / vitest 247+1skip（248）/ pytest 175+2skip / cargo 13 / npm run build ✓；
9 处版本源一致 = 1.1.8-pre.1；release GUI 构建 3m37s。**

**修复的环境问题**：
- `master` 领先远端 1 个提交（`08e5188` 环境修复）未推送 → 已推送，GitHub 恢复为唯一权威；
- GUI 冒烟启动脚本 `C:\ke-tmp\launch-release-cdp.ps1` 指向**不存在的路径**
  （`<repo>\desktop\src-tauri\target\release\`）→ 根因：cargo target 由 `CARGO_TARGET_DIR`
  重定向到仓库外 `F:\Work\Dev\cargo-target` → 已改指正确路径，并补 `cargo build --release`；
- `desktop/node_modules` 为空（迁移时漏装）→ `@tauri-apps/cli` 缺失、NSIS 打包链路不可执行
  → 已在 **Windows 侧** `npm ci` 补装（`tauri-cli 2.11.4`）；
- `C:\ke-tmp\README.md` 索引过时（CDP 9222 / `D:\` 旧路径 / 「81 项」manifest）→ 重写
  （实际 **84 项**），并新增通用 CDP 探针 `cdp-eval.py`（统一 9333，替代约 200 个硬编码 9222 的历史脚本）。

**GUI 冒烟（只读断言，全过）**：CDP 9333 目标 = AstraNota（非 Edge）；启动到可交互 **1.64s**
（基线 1.7s）；版本横幅一致（无「版本不一致」）；文档打开 + 编辑器挂载 + 10 KaTeX 节点、
0 console error；**关窗退出 2s / 侧车残留 0 / 8000 端口释放 —— v1.1.7 S1 缺陷（侧车孤儿）修复复验通过**
（含「已打开文档时关窗」场景）。

**重要风险发现（写数据安全）**：`KE_WORKSPACE` **不能隔离 GUI**。该变量只作用于侧车启动参数
（`/api/health` 如实回报测试工作区），但**前端会从持久化设置恢复「上次工作区」并调切换 API 覆盖它**
→ 界面实际打开主理人真实工作区 `...\Documents\KE Workspace`。二者不一致，极易让 Agent 误判已在隔离环境。
本次核对全程只读，已确认真实工作区**无用户内容写入**（仅 `.knowledgeeditor/index.db-shm` 正常索引触及）。
Agent 规则已写入交接文档坑 16。

**备注**：另一处误导——`window.close()` 会绕过 Tauri 生命周期直接杀 WebView，造成「壳进程+侧车残留、
端口不释放」的假象；关窗测试须用**全新实例 + 单次 `CloseMainWindow()`**（坑 17）。

## 2026-09-07（v1.1.4-pre.1 发布 · 新建文件夹/新建文档修复）

### 发布：v1.1.4-pre.1（修复预发布，先于品牌版）

- 修复「新建文件夹/新建文档」在 WebView2 下不可用（window.prompt 输入不返回 → 自绘输入弹窗，替换 9 处）；
- 修复空文件夹在文件树不可见（/api/tree 返回目录条目）；
- 发布记录见 GitHub Releases tag v1.1.4-pre.1。


### 品牌收官补丁（同日并入 v1.1.4）
- 树展示扁平化：文章/模块区不再显示冗余顶层节点，新建文件夹与区内容并列；
- 同名目录创建显式报错（409「文件夹已存在」）；
- 输入弹窗每次打开重置（默认值预填 + 自动全选，消除上次内容残留）；
- **任务栏图标根治**：窗口图标显式 256×256 源（Tauri 默认仅 32×32 → 任务栏 24px 低质缩放糊）；
  方法：setup 中 set_icon（证据链见 Logo/icon-work-archive-20260907/LESSONS.md）；
- 品牌素材换版：方标 v3（合并用户新版白底 Logo + 22% 圆角）、横版深色版改透明抠图（适配深色模式）；
- 横版横幅位置：设置页**右内容区顶端**（非整页顶部）。
## 2026-09-08（v1.1.8-pre.1 预发布 · 文件名保留原标题）

类型：Pre-release
状态：Completed（预发布已发布；正式版待 v1.1.8 累积更多项）

验证：vitest 248 / pytest 175 / cargo 13 / tsc 0；GUI 实测（新建 `My Big Note 2026` → 磁盘同名落地；
改名 `Renamed Doc 标题` → 同名落地）

**已完成（待 v1.1.8 发布）**：
- **文件名保留原标题**：新建/导入/改名联动/导出下载统一改为「仅替换文件系统非法字符」，
  不再 slug 化（大写、空格、中文原样保留）。前后端契约对齐（`sanitize_filename` /
  `filenameFromTitle`），pytest 175 / vitest 248 全绿，GUI 实测通过。
  说明：已有文档在下次编辑标题时渐进对齐，无强制批量迁移。

**候选（来源：v1.1.8 前置全量测试报告 §7）**：
- S-1 草稿恢复点扩展到编辑防抖（硬崩溃最多丢 3s）
- S-2 GFM 脚注 `[^1]` 是否纳入支持
- S-3 附件保留原始文件名
- K3-I2 rename/move 原子性（P2）

## 2026-09-08（v1.1.7 正式发布 · 公式编辑体验 + 信息块块级）

类型：Release
状态：Completed

**公式编辑体验（M2）**：
- 全屏公式编辑器（知乎式模态，外圈透明不误触、Esc=保存/空删除）；
- 常用公式模板面板（方程组/多行对齐/矩阵/行列式/分段/分式/根式/求和/积分，Tab 槽位跳转）；
- 公式自动补全（VS Code 式：\fr → 悬浮建议 → Tab 选择；全量 LaTeX 命令目录 459+ 条；设置开关）；
- 公式模态/节点架构修复（编辑器根持有 + 节点 id 定位——根治 React #300 白屏）；
- 空公式 Enter=Esc=删除；非受控输入（光标稳定）。

**信息块（A 方案）**：
- 内容升级为块级（列表/多段落整体进信息块，粘贴不再崩格式）；
- 空信息块 Enter = 移出至下方新段；块内单行（托尾 0 高度 + 段落保证）。

**启动（M1）**：埋点（__bootTimings）+ 品牌页分段进度（40/80/100% 真实事件驱动）；
启动无串行瓶颈（5 采样中位 1.7s，WebView2 冷启为主体）。

验证：vitest 244 / pytest 174 / cargo 13 / tsc 0；GUI 全矩阵实测。

**发布后补丁批次（用户实测 7 项 + 发布流程 1 项，17:21 包）**：
- 图片完全不可用（CSP `img-src`/`media-src` 缺回环地址；`handlePaste` 缺失）→ 放行 + 新增粘贴处理；
- 真实文件拖拽无效（Tauri `dragDropEnabled` 默认拦截 OS 拖放）→ 显式关闭；
- `Ctrl+N/M`/工具栏插入不再吞掉选中文本；`Ctrl+Z` 撤销后不再弹回公式窗；
- 空信息块外部修改后不再变 0 行（空内容解析全路径补段落）；
- 补全前缀替换修复（`\fr\frac` 残留）+ 提示条；设置新增「切换工作区…」；
- 外部修改提示延迟（轮询 1.5s→0.7s、空闲嗅探 5s→2.5s）；
- 退出后侧车孤儿占端口 → 有界同步清理；安装包内嵌旧前端（版本不一致）→ 重打覆盖。
## 2026-09-08（v1.1.6 正式发布 · 体验优化 + 恶性修复）

### 发布：v1.1.6（AstraNota 1.1.6 · 体验优化与恶性修复）

类型：Release
状态：Completed

**恶性修复**：
- 关窗后进程假死（双击无窗口）——退出链立即 app.exit + 单实例唤醒 show()（v1.1.6-pre.1）；
- 数字标题文档（1.md/111.md）打不开——frontmatter `title: 1` YAML 整形化 → ArticleOut 校验 500；
  修复三层（写入引号化 yaml_scalar + parse 兜底 + 模板改造）；
- 新建文档不索引不显示——旧会话 sidecar 索引饥饿（重建即愈；新包自带）。

**体验优化**：
- 信息块：占位符与光标同行（0 高度浮动叠放）/ 输入聚焦即隐藏（PM 选区判定）/
  新建后一行（托尾空段 0 高度 + 空态 br 处理）/ 徽章预设色板 8 色 + 跟随强调色 + 自定义色号；
- 公式：Ctrl+N / Ctrl+M 快捷键；块级 Enter=保存、Ctrl+Enter=换行、空块 Esc/Enter=删除；
  插入后光标自动入框；块级 Σ 正方形外框居中等宽（行内区分）；
- 深色 KaTeX 配色；列表标记浅灰；Obsidian 式列表输入与空项续列；
- 启动品牌页（Logo + 正在打开工作区）；引用块/信息块透明度可调；
- 新建文档不生成一级标题（dual-title 对齐）。

验证：vitest 235 / pytest 174 / cargo 13 / tsc 0；GUI 全链路实测（14+ 场景）。
## 2026-09-07（v1.1.6-pre.1 发布 · 关窗假死修复）

### 发布：v1.1.6-pre.1（修复预发布）

- **修复关窗后进程假死**（关闭 exe 窗口后无法立即重开）：
  - 退出链重排——后端清理独立线程 best-effort，**立即 app.exit(0)**（原实现 5s 轮询完成后才退出，任一环挂起即隐藏残留进程）；
  - 单实例回调加 `w.show()`——隐藏残留实例二次启动被唤醒显示（原只 focus 对隐藏窗口无效）。
- 实测：WM_CLOSE → <6s 完全退出；二次启动 → 唯一实例 + 主窗可见。

## 2026-09-07（v1.1.5 正式发布 · 细节优化）

### 发布：v1.1.5（AstraNota 1.1.5 · 细节优化）

类型：Release
状态：Completed

变更：
- ① 深色模式 KaTeX 公式配色（浅色字可读）；
- ② 新建文档/模块正文不再生成 `# 标题`（dual-title 对齐，标题由页眉承载）；
- ③ 信息块徽标颜色：预设色板 8 色 + 跟随强调色 + 任意色号输入（亮度自动前景色；规范 §3.1 扩展）；
- ④ 信息块/引用块背景透明度可调（0-100 滑杆，0% = 引用块仅剩左侧紫线）；
- ⑤ 列表标记浅灰（Obsidian 式弱化）；
- ⑥ 有序列表 Obsidian 式输入（`1. `/`1) ` 自动列表；空项回车=续列，二回车退出）；
- ⑦ NSIS 迁移钩子路径精确杀进程（v1.1.4 迁移失败修复的固化）；
- 标题输入框：非受控化 + 拖选越界回收（框内外松开均保持高亮）；
- 迁移钩子：卸载旧版前按 InstallLocation 精确结束进程。

验证：vitest 235 / pytest 173 / cargo 13 / tsc 0；GUI 全链路实测（四项 + 修复闭环）。

## 2026-09-07（v1.1.4 正式发布 · 品牌改版）

### 发布：v1.1.4（更名 AstraNota + 全新品牌标识）

类型：Release（品牌）
状态：Completed

变更（仅 A 层显示名与品牌，B/C/D 层标识与数据格式不动）：
- **项目更名 AstraNota**：窗口标题、产品名（productName → 安装包/快捷方式/注册表 DisplayName 同步为 AstraNota）、关于对话框、侧栏品牌块、启动器页、设置面板徽标、README。
- **新 Logo（AstraNota 轨道-A 形标 + AstraNota · YOUR KNOWLEDGE UNIVERSE 横版）**：
  - 应用图标 19 件全套重新生成（`npx tauri icon`，深色方形标 1024 → **22% 圆角透明蒙版**）；
  - 侧栏品牌块：KE 方块 → 圆角图标（浅/深主题双版本 CSS 切换）；
  - 设置页面顶端：横版品牌横幅（浅/深双版本，`[data-theme]` 切换）。
- 用户 Logo 资产统一尺寸：方标 1024²、横版 1600×400（背景延展不失真）→ 前端展示用 256²/800×200 双主题版本（来源 `/mnt/d/KE Project/Logo/unified/`，已同步至前端 `assets/astranota/`）。
- **未动**（按拍板）：应用标识 `com.knowledgeeditor.desktop`、数据目录 `%APPDATA%\KnowledgeEditor`、侧车/包名/进程名、`.knowledgeeditor`、`ke-*` 文件格式与内部键——老用户升级零迁移。

验证：
- 前端 vitest **230 passed** / 1 skipped；tsc 0 错误；构建 dist-build 成功。
- 后端 pytest **170 passed** / 2 skipped；cargo test settings **13 passed**。
- sidecar 独立拉起 `/api/health` = **1.1.4**；manifest/versions 重生成（85 项，NSIS 不入 manifest）。
- GUI（CDP）品牌验证：侧栏 AstraNota 图标/名称、窗口标题、设置页横版横幅（深/浅主题切换正确）、徽标 AstraNota v1.1.4。
- NSIS：**AstraNota_1.1.4_x64-setup.exe**（51.0MB，sha256 B7622AC9…F36D）本机构建成功。

## 2026-09-06（v1.1.3 正式发布）

### 发布：v1.1.3（迭代修复：健壮性、体验与文档）

类型：Release
状态：Completed

变更（按 `docs/iteration-plan-1.1.x.md` v1.1.3 条目全部落地）：
- **F10**：外部修改自写抑制窗 2500ms → **600ms**（原窗口覆盖 83% 自动保存周期，窗内真实外部修改被吞；抑制改由后端 mark_internal 精确标记兜底）。
- **F18**：标题改名 409 后回填磁盘标题（UI==磁盘，明确提示文件名冲突）；前端 slugify 剥离前导点（`.note` 不再产出隐藏文件，与后端 strip("-.") 对齐）。
- **F19**：404 假警报门控 isCurrent（后台文档 404 不再对无关文档弹窗/双弹窗）；强调色色板拖动 300ms 去抖落盘（消除写放大）；patchAndSave 失败显式报错（不再静默）。
- **F21**：编辑序号按文档隔离（per-doc seq）——切走后 A 的在途保存判定 latest 正确、恢复点及时清除，不再误报「未恢复编辑」。
- **F04**：新建文档 / 切换工作区推进打开序号——迟到在途 GET 不再覆盖新建视图、旧工作区内容不再渗入新工作区。
- **F22**：大文档（>200KB）首次解析前渲染一帧「正在解析大文档…」占位（原无声卡死观感；解析仍同步，重开走会话缓存）。
- **F20**：`docs/markdown-extension-spec.md` §3.1/§3.2 改写为现状（ke-note 包裹格式+空内容闭合标记、ke-module「插入后复制内容」+ display:none 无边界拍板，删除旧动态模块/inline-card 设计）。

验证：
- 前端 vitest **230 passed** / 1 skipped（+2）；tsc -b 0 错误；构建 dist-build 成功。
- 后端 pytest **170 passed** / 2 skipped；cargo test settings **13 passed**（无 Rust 改动回退）。
- sidecar 独立拉起 `/api/health` = **1.1.3**；manifest/versions 重生成 81 项（NSIS 不入 manifest）。
- **实机安装验收（A 部分 7 步，2026-09-06，成品包 KnowledgeEditor_1.1.3_x64-setup.exe）全通过**：
  安装元数据（DisplayVersion=1.1.3/快捷方式/卸载项）→ 卸载清理=目录+注册表清空、数据目录保留 →
  首启+侧车 health=1.1.3+崩溃自动拉起 → 编辑→自动保存→WM_CLOSE 8s 内退出→重开字节一致 →
  三种导出（三模式探针：suggestedName/二次导出/无失败告警；**真实字节落盘=缺口，待主理人空闲时手动补一次**）→
  R1 改名不丢编辑+R2 外部版本胜出不覆盖 → 历史快照 13 份+预览/主题深浅切换/搜索点击打开/多实例互斥/原生菜单 4 顶级。
- 验收数据目录（%APPDATA%\KnowledgeEditor）已备份→恢复；安装包已卸载；工作区测试文档已清理。

## 2026-09-06（v1.1.2 正式发布）

### 发布：v1.1.2（迭代修复：数据完整性与设置契约）

类型：Release
状态：Completed

变更（按 `docs/iteration-plan-1.1.x.md` v1.1.2 条目全部落地）：
- **B1/K3-I1**：索引扫描签名判据加入文档内容 hash（等长同 tick 修改可识别）；`update_file`/`update_move`/`delete_file` 增量同步签名（原仅 rebuild 写入 → 每次启动退化全量重建）；delete_dir 改经索引器删除。
- **K3-I2**：rename/move 的索引与历史同步改为 graceful（失败不阻断 200，签名过期由下次 reconcile 自愈）；原子写/fsync 由既有 atomic_write 承担。
- **F07**：ke-attach/video 附件引用提取改括号平衡匹配（前后端同源；title/caption 含 `}` 不再漏打包附件）。
- **F14/F15**：saveFn 用「切换瞬间内容快照」替代执行时经 editorRef 重读（防跨文档串写）；A→B→A 回退时保存完成后对齐编辑器。
- **R2 残余**：saveQueue 新增 `abortPending`（中止在途 PUT）+ `saveArticle` 透传 AbortSignal；「重新加载外部版本」改为中止而非仅取消，杜绝在途写回覆盖外部版本。
- **F13**：applyTheme 系统主题监听器模块级单例（原每次调用注册匿名监听器，指数级累积泄漏）。
- **F17**：Rust `sanitize_hex` 增加字符校验（`#zzzzzz` 不再落盘）；`load_from`/`update_settings` 改字段级宽松解析（单字段类型错误不再整份设置静默归零）。
- **F08**：前端 `mergeSettings` 嵌套对象改深合并（display/displayPreference/maintenance，与 Rust merge_value 对齐）。
- **F09**：`loadSettings` 增加 `normalizeSettings` 兜底（缺键补默认/非法 theme 回退/非法 accent 清除，Web 降级路径主防线）。
- **F16**：主题应用与 `resolveApiBase` 并行 + index.html 内联预置脚本（deep 色用户不再浅色首屏闪烁）。

验证：
- 前端 vitest **228 passed** / 1 skipped（+8）；tsc -b 0 错误；构建 dist-build 成功。
- 后端 pytest **170 passed** / 2 skipped（+4）；cargo test settings **13 passed**（+2）；无 Rust 行为回退。
- sidecar 独立拉起 `/api/health` = **1.1.2**；manifest/versions 重生成 81 项（NSIS 不入 manifest）。
- NSIS 本机构建成功：`KnowledgeEditor_1.1.2_x64-setup.exe`（50.7MB）；实机安装验收待补（见 `docs/release-acceptance-checklist.md`，计划 v1.1.3 发布前执行）。
- 版本九处源同步 1.1.2（backend/frontend package+lock/desktop package+lock/Cargo.toml+Cargo.lock/tauri.conf/version.ts）。

## 2026-09-06（v1.1.1 正式发布）

### 发布：v1.1.1（发布前全面审查修复闭环后转正）

类型：Release
状态：Completed

变更（相对 v1.1.1-pre.1）：
- 发布前全面审查（2026-09-06）三阻断项 + 数据完整性项全部修复：R1 改名丢编辑 / R2 外部版本重载失效 / R3 空 ke-note 吞噬后续 / F01 历史快照孤立 / F02 跨工作区串写 / F03 大小写变体丢失 / F05 fs/dir 校验绕过 / F06 块级 footnote 丢失 / F11 子目录 rename 误报 / F12 package-lock 版本（详见上一节修复记录）。
- 版本九处源统一 **1.1.1**（backend __version__ / frontend package+lock / desktop package+lock / Cargo.toml+Cargo.lock / tauri.conf.json / version.ts）。

验证：
- 前端 vitest **220 passed** / 1 skipped；tsc -b 0 错误；构建产物 frontend/dist-build。
- 后端 pytest **166 passed** / 2 skipped；cargo test settings **11 passed**。
- sidecar 独立拉起 `/api/health` = **1.1.1**（运行时校验通过）；manifest/versions 重新生成（81 项；NSIS 不入 manifest）。
- GUI（WebView2 + CDP）R1/R2 触发路径回归 PASS（本轮修复前已录证据）。
- 发布：GitHub Release **v1.1.1**（正式，Latest）附件四件套：sidecar exe / KnowledgeEditor_1.1.1_x64-setup.exe（NSIS）/ manifest.sha256 / versions.json。

## 2026-09-06（v1.1.1-pre.1 发布前全面审查修复）

### 修复：三阻断项（R1 改名丢编辑 / R2 外部版本重载失效 / R3 空信息块吞噬后续）

类型：Bug 修复（数据完整性 + 格式不变量）
状态：Completed（待正式 v1.1.1 发布；未推送）

背景：v1.1.1-pre.1 发布前全面审查（2026-09-06）判定「需修复后发布」，阻断项 3 条 + 优先数据完整性项 4 条。本轮全部落地。

**R1（P0）改名链路丢失未保存编辑**：
- `EditorArea.handleTitleBlur` 改名（路径变更）前先 `flushWithTimeout(docId)`（3s 超时 + confirm 兜底），避免防抖窗口内输入被陈旧快照静默抹掉；
- `LeftSidebar` 新增 `onBeforeFsMutation` 钩子：文件树重命名/移动/删除当前文档（或其所在目录）前先 flush（变更后旧路径已不存在，flush 会 404）；
- 配套修复 **F11**：`oldSlug` 取文件名基线（原先 `replace(/^Articles\//)` 对子目录文档永不相等 → 每次改标题都 rename 撞自身 409）。
- GUI 实测：防抖窗口内输入草稿 → 页眉改名 → 编辑器内容保留、文件名已改名、旧路径 404、无「保存失败」假警报。

**R2（P1）「重新加载外部版本」不重载且本地回写覆盖外部**：
- `saveQueue` 新增 `cancelPending(docId)`（取消防抖计时器 + 最新待保存函数；在途链无法撤销，调用方随后 flushPending 等待）；
- `App.handleReloadExternal`：cancelPending → await flushPending（在途序化）→ openArticle(rel) → `reloadToken` 递增强制编辑器重载（原 `[article?.id]` effect 对同 id 不触发）；
- `EditorArea` 文档加载 effect 依赖改为 `[article?.id, reloadToken]`（id 变 → flush 上一文档；token 变 → 仅重载）。
- GUI 实测：外部覆盖文件 → 弹窗 → 点「重新加载外部版本」→ 编辑器=外部版本，4s 后磁盘仍=外部版本（未决保存被取消，未覆盖）。

**R3（P1）空 ke-note 重开吞噬后续内容（包裹格式不变量）**：
- `NoteExtension.renderMarkdown`：空内容也输出 `<!-- /ke-note -->`（不再与旧自闭合格式混淆）；
- `tokenizers.keNoteTokenizer`：结束标记搜索限界——按行扫描，遇到下一个块级 ke-* 标记即判定自闭合（旧实现在文档剩余全文 indexOf，会把下一个信息块头标记与内容吞进空信息块）；
- 回归测试：空信息块+非空信息块解析/往返/旧格式兼容 3 例。

**F03（P1）大小写变体 ke- 注释静默丢失**：兜底正则放开大小写（`[a-zA-Z]`），`isPlainHtmlComment` 的 ke- 前缀判定 `/i`；ke-NOTE 等大小写变体落入 GenericFallback 原样保留（document-format §4「大小写不符→原样保留」）。

**F06（P2）块级 footnote 系静默丢失**：块级兜底不再排除 footnote 系；独占一行的 ke-footnote 引用 / 未闭合 ke-footnotes 区域 / 孤儿 footnote-item 原样保留。段首脚注（注释后同行有正文）只保留注释原文、正文照常成段，绝不整行吞掉（有回归测试锁定 5 例）。

**F01（P1）改名后历史快照孤立**：`HistoryStore.move_path` 迁移 `Drafts/backup/{doc_rel}`（单文档 + 目录级递归；目标存在时合并 + 修剪）；`fs.py` rename_doc/rename_dir/move_path 挂接 `_migrate_history`（失败只记日志不阻断）。

**F02（P1）切换/关闭工作区不 flush 未决保存**：`switchWorkspace`/`handleCloseWorkspace` 先 `flushWithTimeout(当前 id)`（flushed=false 才 confirm），内容先落到旧 workspace root，杜绝跨工作区同相对路径串写。

**F05（P2）fs/dir 顶层目录约束可绕过**：`create_dir` 改为规范化后校验——`_guard_rel` → `_require_business_top`（`Articles/../evil` 原来可在 workspace 根建目录，现在 400）。

**F12**：`frontend/package-lock.json` 根版本 1.0.2 → 1.1.1-pre.1（七处版本源 + lock 全部一致）。

影响范围：前端 App/EditorArea/LeftSidebar/saveQueue/tokenizers/NoteExtension + 后端 fs.py/history_store.py；三种导出（plain-export/export-actions）零改动（红线保持）。

验证：
- 前端 vitest **220 passed** / 1 skipped（24 文件；+15 新用例：saveQueue cancelPending/flushWithTimeout 5、R3 3、F03 2、F06 5）；tsc -b 0 错误；`npm run build` dist-build 成功。
- 后端 pytest **166 passed** / 2 skipped（+5：F05 2、F01 rename/move/folder 3）。
- GUI（WebView2 + CDP 9222）实测：R1/R2 触发路径全链路 PASS（含无 404 假警报、无未决保存覆盖外部版本）；F05/F01 经运行中 sidecar API 冒烟 PASS。
- 未复验（延续审查 UNVERIFIED 清单）：NSIS 安装包、cargo test（本轮无 Rust 改动）、干净环境安装验收。

## 2026-08-11（发布：AI Agent 协作声明）

### 基础设施：新增 AI Agent 协作声明并同步 README

类型：Feature（基础设施）
状态：Completed

现象：GitHub 仓库面向访客，需声明项目开发过程包含 AI Agent 协作，保证透明度。

原因：用户要求上传协作声明并顺带更新 README。

修改：
- 新增 `docs/agent-collaboration.md`：协作方式（用户指示 + Agent 辅助 + 实测合入）、协作范围表、透明度与数据主权（Markdown 唯一事实源不变）、时间范围（初始开发 2026-08-08 ~ 08-11，Alpha 迭代延续）
- `README.md`：标题区加入声明引用行；文档索引登记 `docs/agent-collaboration.md`
- `PROJECT_STATE.md`：文档索引登记

影响范围：对外文档；代码与数据无变化。

验证：git 提交推送后 GitHub 页面可见；声明链接可访问（docs/ 下相对路径）。

## 2026-08-11（发布：GitHub Releases 分发）

### 基础设施：创建 GitHub Releases 并上传各版本安装包

类型：Feature（基础设施）
状态：Completed

现象：GitHub 仓库仅有 v0.7.3 / v1.0.0 标签，无 Release 分发页面，安装包仅存于本地构建目录。

原因：用户要求「在 release 里加上每个版本的安装包」，建立版本分发渠道。

修改：
- 创建 Release v0.7.3：上传 `KnowledgeEditor_0.7.3_x64-setup.exe`（20,020,814 B，M6 修复版，用户真实环境实测通过）
- 创建 Release v1.0.0：上传 `KnowledgeEditor_1.0.0_x64-setup.exe`（20,472,183 B）
- 工具：gh CLI 2.97.0（已登录 Asheep233），安装位置 `C:\Program Files\GitHub CLI\gh.exe`（当前终端 PATH 不含，需显式调用；git 需注入 `C:\Program Files\Git\cmd`）

影响范围：版本分发渠道；代码与数据无变化。

验证：`gh release view` 确认两 Release 资产 `state=uploaded`，大小与本地一致；Release 页 https://github.com/Asheep233/knowledge-editor/releases

## 2026-08-11（Phase 7 M7，v1.0.0）

### 里程碑完成：M7 回归发布 v1.0.0（发布前版本号统一修正，进入 Alpha 测试）

类型：Feature（里程碑）
状态：Completed

现象：用户指示「接下来 v1.0.0 及以后的版本算入 Alpha 测试」，要求进入 M7 并在最终发布前完成版本号修正：UI 左上角阶段徽标 Phase 6 → Alpha；右上角后端版本 v0.7.3 → v1.0.0。

原因：Phase 7 桌面化全部里程碑（M0-M6）已完成，发布 v1.0.0 前需统一版本标识：UI 阶段徽标由内部 Phase 编号改为公开测试阶段名（Alpha），全链路版本号（后端 / 前端 / 桌面工程 / 安装包）对齐为 1.0.0，作为 Alpha 测试期的发布基线。

修改：
- `frontend/src/App.tsx`：左上角阶段徽标 `Phase 6` → `Alpha`；右上角「后端 v${health?.version}」由后端 health 数据源驱动，无需前端改动（后端版本即显示版本）
- `backend/app/__init__.py`：`__version__` 0.7.3 → 1.0.0（全链路版本唯一数据源），注释追加 v1.0.0 / Alpha 说明
- `frontend/src/version.ts`、`frontend/package.json`、`frontend/package-lock.json`（2 处）：0.7.3 → 1.0.0
- `desktop/package.json`、`desktop/package-lock.json`（2 处）：0.7.3 → 1.0.0
- `desktop/src-tauri/Cargo.toml`、`Cargo.lock`（仅本 crate `knowledgeeditor`；第三方 cfb 依赖 0.7.3 保持不动）、`desktop/src-tauri/tauri.conf.json`：0.7.3 → 1.0.0
- `DEVELOPMENT_ENVIRONMENT.md`：产物名 `KnowledgeEditor_0.7.3_x64-setup.exe` → `KnowledgeEditor_1.0.0_x64-setup.exe`（附注版本随 Cargo.toml/tauri.conf.json 同步）
- 历史记录保留 0.7.3：CHANGELOG_DEV / docs / README 中的 0.7.3 属历史记录，不改
- 后端重新打包：PyInstaller 6.22.0 `--onefile` + 11 个 uvicorn hidden-import，产物 12,637,983 B（旧 12,637,746 B），替换 `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（SHA256 0CF4DCBA… 与 dist 一致）

影响范围：全链路版本标识（UI 徽标、后端 health version、前端 / 桌面工程版本、安装包文件名与注册表 DisplayVersion）；数据格式与 API 无变化。

验证（本机，2026-08-11）：
- 后端：`backend\.venv\Scripts\python.exe -c "from app import __version__"` → 1.0.0；重新打包产物启动 health 200 且 `"version":"1.0.0"`
- 前端：`npm run build` 13.52s 成功；vitest 70/70 通过
- 桌面构建：`npm run tauri -- build`，编译日志 `Compiling knowledgeeditor v1.0.0`，产出 `desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_1.0.0_x64-setup.exe`
- UI 效果（左上角 Alpha 徽标 + 右上角「后端 v1.0.0」）待用户实测确认

版本约定：v1.0.0 及以后版本算入 Alpha 测试期；UI 阶段徽标对外统一为 Alpha，不再显示内部 Phase 编号。

## 2026-08-11（Phase 7 M6，v0.7.3）

### Bug 修复：退出时连续弹出并消失空白终端窗口

类型：Bug Fix
状态：Completed

现象：用户在本机真实环境手动测试安装包（KnowledgeEditor_0.7.3_x64-setup.exe），应用正常启动，但点 X 退出时会连续迅速弹出并消失几个空白 PowerShell 窗口（实际为 Windows 11 上的 Windows Terminal，内部为空，一闪而过）。

原因：`sidecar.rs` 的 `is_alive()` 每 250ms 轮询进程存活状态时调用 `tasklist`（控制台程序），但漏加 `CREATE_NO_WINDOW` 创建标志。GUI 主程序进程中启动控制台程序且不带该标志时，Windows 会为新进程分配新控制台，Windows 11 上表现为弹出 Windows Terminal 窗口。退出优雅等待期约 5s / 250ms ≈ 20 次轮询，实际进程提前退出约 7 次轮询，与用户看到"连续几个"完全吻合。全仓库 `Command::new` 共 3 处（taskkill / tasklist / explorer），仅 `tasklist` 这一处漏标志。

修改：
- `desktop/src-tauri/src/sidecar.rs`：`is_alive()` 的 `Command::new("tasklist")` 增加 `.creation_flags(CREATE_NO_WINDOW)`
- 重新构建：`npm run tauri -- build` 产出修复版 `KnowledgeEditor_0.7.3_x64-setup.exe`（主程序时间戳 00:41:12）

影响范围：仅退出清理路径的进程存活轮询；不影响 taskkill 强杀与 explorer 打开目录（两处本就带标志或是 GUI 程序）。

验证（本机，修复版主程序 + backend 正常启动环境）：
- 启动修复版 → 1s 内 backend health ok、runtime.json 生成（backend pid / port 8000 / version 0.7.3）
- 窗口监控（50ms 枚举可见顶层窗口）覆盖退出全程：WM_CLOSE 后无任何 WindowsTerminal / Terminal 新窗口（修复前同场景捕获 7 个 WindowsTerminal + 7 个 tasklist 一一对应）
- 退出：WM_CLOSE 后 6s 内主进程与侧车全部退出，无进程残留，runtime.json 已清理
- 附注：修复版安装目录（D:\KnowledgeEditor）在本终端沙箱环境中 backend 无法启动（PyInstaller onefile 报 "Could not create temporary directory!"，属 vmcache 对工作区外路径的限制，backend 文件哈希与工作区运行版完全一致、复制到工作区后运行正常）；用户真实环境无此限制（用户反馈的弹窗即证明退出链路完整走通）。修复效果以用户下次真实环境手动测试为准。
- 用户实测（2026-08-11，真实环境安装版）：应用正常启动、后端正常，点 X 退出不再弹任何终端窗口，全部验证通过。修复闭环。

### 里程碑完成：M6 构建安装包（NSIS）与干净环境 7 步验收

类型：Feature（里程碑）
状态：Completed

现象：Phase 7 需交付可安装的桌面分发物；此前仅有 `cargo build --release` 裸二进制，无安装/卸载路径，也无数据目录与安装目录的分离验证。

原因：`phase7-plan.md` 第 11 章验收标准要求「干净环境 7 步验收全过」（安装 → 首启引导 → 打开工作区 → 编辑保存 → 关闭 → 再启动 → 数据恢复），且 7.6 设计约束要求卸载不得清除用户数据。

修改：
- `desktop/src-tauri/tauri.conf.json`：`bundle.targets=["nsis"]`；`windows.nsis.installMode="currentUser"` + `languages=["SimpChinese","English"]`。版本信息由 Cargo.toml 与顶层 `version` 提供（首版误加 productName/productVersion 等触发 schema 校验失败，按本地 `desktop\node_modules\@tauri-apps\cli\config.schema.json` 修正后通过）
- 构建产物：`desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_0.7.3_x64-setup.exe`（19.1MB，NSIS-3 Unicode，LZMA:23；内含主程序 18.3MB / 侧车 12.6MB / uninstall.exe）

影响范围：分发与安装体验。安装目录 `%LOCALAPPDATA%\KnowledgeEditor` 与数据目录 `%APPDATA%\KnowledgeEditor` 彻底分离，卸载不影响用户数据。

验证（本机完整安装验收，2026-08-11，验收前已备份 `%APPDATA%\KnowledgeEditor` 并清空模拟干净环境）：
- 1 安装：`/S` 静默安装成功；安装位置文件、开始菜单快捷方式、注册表 Uninstall 条目（DisplayVersion 0.7.3）均确认
- 2 首启引导：CDP 验证「欢迎使用！…使用已有工作区 / 创建新工作区」引导页正常
- 3 打开工作区：`KE_WORKSPACE` 注入后主界面完整渲染（文件树 / 后端 v0.7.3 / 搜索 / 重建索引 / 最近 / 标签 / 附件 / 大纲 / 属性面板）
- 4 编辑保存：CDP 在 contenteditable 编辑器末尾插入 `[M6-验收-安装版编辑保存-<ISO时间>]` 标记并点击「保存」，磁盘文件 87B → 151B 持久化（frontmatter `ke_version: 1` 保留，标记转义为 `\[…\]` 属 Markdown 语法处理，内容完整）
- 5 关闭：WM_CLOSE（等价用户点 X）后主进程 8s 内退出，侧车无残留，`runtime.json` 已清理
- 6 再次启动：应用正常拉起，CDP 可连
- 7 数据恢复：最近列表恢复（新文档-2026-8-8-2）、文档内容含 M6 标记（字数 14→30）、属性面板路径/创建/修改时间正常
- 卸载验证：安装目录、开始菜单快捷方式、注册表 Uninstall 条目全部清除；无进程残留；`%APPDATA%\KnowledgeEditor` 数据目录（runtime / workspace / app_config.json / settings.json）完整保留
- 数据目录已从验收前备份（`ke-data-backup`）恢复原始状态

环境注意（踩坑记录）：
- tauri 2.11.5 的 `bundle.windows` 下不支持 productName / productVersion / fileVersion 等字段，版本信息必须由 Cargo.toml 与顶层 version 提供
- 自动化冒烟中 JS `window.close()` 只销毁 WebView 页面、不触发 tao 的 CloseRequested，窗口残留且后续 WM_CLOSE 清理链路不完整；正常关闭路径须走系统 WM_CLOSE（等价用户点 X），验证通过
- 本环境终端 PATH 不含 `taskkill`，进程清理需用 `Stop-Process` 或完整路径

## 2026-08-10（Phase 7 M5 收尾，v0.7.3）

### 基础设施：项目纳入 git 版本管理并推送 GitHub 私有仓库

类型：Feature（基础设施）
状态：Completed

现象：项目此前无版本管理，源码无 git 兜底；回收站排查后确认需要建立远程备份。

原因：源码一旦误删无法恢复；开发环境文档（DEVELOPMENT_ENVIRONMENT.md）要求项目可迁移、可恢复。

修改：
- 完善 `.gitignore`：新增 `node_modules.ghostbak/`、`dist-build/`、`.esbuild/`、`repro.html`；`desktop/target/` 修正为 `**/target/`（实际路径是 `desktop/src-tauri/target/`，原规则未命中导致 10.5GB 构建产物被暂存）；workspace 运行时数据（Articles/Drafts/Modules 内容、vite-cache、index.db 等）改为仅保留目录结构与 `.gitkeep`
- `git init` + 首次提交：`f86dcf2 chore: 初始化仓库，纳入版本管理 v0.7.3`（219 个文件，master 分支）
- 创建远程私有仓库并推送：`https://github.com/Asheep233/knowledge-editor`（private，账号 Asheep233）
- 全局配置：git 身份（Asheep233 / noreply 邮箱）、`http.proxy/https.proxy=127.0.0.1:7890`（Clash）、本仓库禁用 `maintenance.auto`

影响范围：全仓库；后续开发流程增加「提交 → 推送」步骤；.gitignore 生效后 workspace 运行时数据不再入库（本地不受影响）。

验证：`git log` 显示提交存在；`git status` 干净；`gh api repos/Asheep233/knowledge-editor` 返回 private=True、default_branch=master、pushed_at 为当日；远程文件数与本地 219 个一致（workspace 仅 3 个 .gitkeep）。

环境注意（踩坑记录）：
- 首次 `git commit` 触发 `git maintenance run --auto`，repack 进程 CPU 占用异常（>700 秒）导致命令输出挂起；commit 实际已成功，禁用自动维护后正常
- 本环境终端 PATH 不含 git/gh，gh 调用 git 需先 `$env:PATH = 'C:\Program Files\Git\cmd;' + $env:PATH`
- GitHub 直连不稳定，gh 命令前需设 `HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:7890`（会话级）

## 2026-08-10（Phase 7 M5 收尾，v0.7.3）

### Bug 修复：注释对话框（FootnoteDialog）白字白底，输入文字与光标不可见

类型：Bug Fix
状态：Completed

现象：点击工具栏「📝注释」打开内容输入弹窗后，textarea 内无输入光标；用输入法输入后输入框仍显示纯白无任何变化；全选文字出现蓝底选中态（证明文字实际存在），取消全选后再次不可见。两种注释样式（脚注区域 / 纯 Markdown）均受影响。

原因：双层叠加导致：
- 用户在设置中选择了深色主题（`%APPDATA%\KnowledgeEditor\settings.json` → `ui.theme="dark"`），前端 `applyTheme('dark')` 给 `<html>` 注入 `color-scheme: dark`（`frontend/src/settings.ts` 第 126 行）。
- Chromium 在 `color-scheme: dark` 下对**未显式着色**的元素注入 UA 白字默认值（经 CDP 计算样式确认：HTML→BODY→overlay→dialog→textarea 整条链 `color: rgb(255,255,255)`）。
- 注释对话框容器为 Tailwind `bg-white`（白底，`EditorToolbar.tsx` 第 239 行），textarea 的 className 未声明文字/光标颜色类（第 268 行）→ 白字白底，文字与光标均不可见；全选时 `::selection` 蓝底反色使文字短暂可见（与用户描述完全吻合）。
- 其他输入框不受影响的原因：均有显式 `text-gray-*` 类（工具栏、上标编辑等）；`MathNodeView` 的 textarea 有 CSS 显式 `color: #1e293b`（`index.css` 第 338 行）。

修改：
- `frontend/src/components/editor/EditorToolbar.tsx`（FootnoteDialog textarea，第 268 行）：className 追加 `text-gray-900 caret-blue-600 placeholder:text-gray-400`（文字深灰 + 蓝色光标 + placeholder 浅灰），在任意 `color-scheme` 下均可见。
- `frontend/src/index.css`（body 规则，第 21 行）：追加 `color: #1f2937;` 作为全局兜底，避免 dark 主题下其他未显式着色元素（未来新增的输入框/对话框）再次出现白字白底。

影响范围：注释对话框输入可见性；全局 body 文字色兜底（浅色 UI 现状下视觉无变化，因各组件已有显式类）；Math/标题输入等已有显式颜色的组件不受影响；深色主题完整适配（深色 CSS 变量方案）不在本次范围，仍为已知项。

验证：
- 根因复现：CDP 计算样式确认修复前 textarea `color/caretColor/textFillColor` 均为 `rgb(255,255,255)`，且 HTML→BODY 全链白字；`index.css` 的 body 无显式 color。
- 修复后（重新构建前端 + cargo 重编译嵌入新资源）：body 计算颜色 `rgb(31,41,55)`；textarea 计算样式 `color=gray-900`、`caretColor=blue-600`、`placeholder=gray-400`；`Input.insertText` 输入「测试注释可见性」成功且可见。
- 回归：vitest 70/70 全部通过；`tsc -b` + `npm run build` 通过。
- 环境注意：应用以生产资源模式运行（tauri.localhost），前端改动必须 `npm run build` 重新生成 dist-build 并 `cargo build` 重新编译嵌入，页面才能加载新资源（仅重跑 vite dev 无法验证）。

## 2026-08-10（Phase 7 M5，v0.7.3）

### M5 桌面集成：应用图标 + 窗口配置 + 原生菜单栏（四组 + 最近动态子菜单 + DevTools + 关于）

类型：Feature
状态：Completed

现象：Phase 7 规划 7.5 要求桌面版完整集成：bundle 图标、窗口配置（标题/尺寸/居中/最小尺寸）、原生菜单栏（文件/编辑/视图/帮助四组），debug 模式 DevTools 可用；菜单项需驱动前端既有动作（新建文档/打开工作区/打开最近工作区）。

原因：无（功能新增）。M4 完成后推进 M5，补齐桌面 shell 的视觉与交互集成。

修改：
- `desktop/src-tauri/src/menu.rs`（新增，完全实现）：常量 `MID_NEW="ke-menu:new-document"` / `MID_OPEN_WS="ke-menu:open-workspace"` / `MID_EXIT="ke-menu:exit"` / `MID_RELOAD="ke-menu:reload"` / `#[cfg(debug_assertions)] MID_DEVTOOLS="ke-menu:devtools"` / `MID_ABOUT="ke-menu:about"` / `RECENT_PREFIX="recent:"` / `RECENT_MAX=8`。`pub fn build(app)` 组装四组 Submenu（文件=新建文档 Ctrl+N/打开 Workspace Ctrl+O/最近子菜单/退出 Ctrl+Q；编辑=撤销/重做/剪切/复制/粘贴/全选预置项；视图=重新加载 Ctrl+R + debug 追加「开发者工具 F12」；帮助=关于）并 `app.set_menu`。`pub fn handle_event(app, event)` 用 `event.id().0.as_str()` 匹配分发：新建文档/打开工作区 emit 同名事件到前端；recent 前缀 emit `ke-menu:open-recent` + JSON path；reload/DevTools 直接操作窗口（DevTools 分支 `#[cfg(debug_assertions)]`）；`MID_EXIT → request_exit`。`pub fn request_exit`：hide 主窗口 + 后台线程 `cleanup_on_exit` + `app.exit(0)`（与窗口关闭一致）。`build_recent_submenu` / `read_recent_paths`：读 `data_dir()/app_config.json` 的 `recent_workspaces` 数组生成菜单项（上限 8），空列表加置灰项「（暂无最近记录）」。`show_about`：读 SidecarState runtime 版本/工作区（fallback package_info）经 `dialog().message()` 展示。
- `desktop/src-tauri/src/lib.rs`（修改）：`mod menu`；`.setup` 尾部 `menu::build(app.handle())`；CloseRequested 分支改为 `api.prevent_close() + menu::request_exit(...)`；新增 `.on_menu_event`。
- `desktop/src-tauri/tauri.conf.json`（修改）：窗口 title=KnowledgeEditor、width 1440、height 900、minWidth 1000、minHeight 640、center true、resizable true；`tauri icon` 重新生成 bundle icon 全套（19 个文件，含 icon.ico/icon.png/32x32.png/128x128@2x.png 等）。
- `frontend/src/App.tsx`（修改）：新增菜单事件监听 useEffect——桌面环境（`isDesktop()`）动态 `import('@tauri-apps/api/event')` 后 `listen` 三个事件：`ke-menu:new-document`→`handleNewArticle()`、`ke-menu:open-workspace`→`handleOpenWorkspaceMenu()`、`ke-menu:open-recent`（payload.path）→`switchWorkspace(path,'open')`；dispose 语义（unlisteners + disposed 标记）防泄漏，Web 环境零依赖不挂载。
- 图标生成：`gen-app-icon.ps1`（GDI+ 绘制 blue-600 圆角方块 + 白色粗体 KE，输出 1024×1024 PNG）→ `npx tauri icon` 生成全套；脚本必须纯 ASCII（含中文注释在 GBK 编码下导致 GraphicsPath 构造失败）。

影响范围：桌面版窗口外观（标题/尺寸/居中/图标）与原生菜单交互；菜单项复用既有前端动作不新增业务逻辑；Web 版不受影响；release 构建视图菜单无「开发者工具」（debug_assertions 门控）。

验证（完整链路）：
- `cargo test --release` 8/8；镜像工作区同步后 vitest 70/70、`tsc -b` 通过、`npm run build` 通过（11.92s，dist-build 73 文件同步回真实路径）。
- dev 冒烟（vite dev 5173 + cargo run，CDP 9223）：
  1. 窗口：MainWindowTitle=KnowledgeEditor；Win32 GetWindowRect 1453×936 物理像素（192 DPI=200% 缩放下对应 1440×900 逻辑）；居中偏差 (0, 4)px；CDP 内容区 `innerWidth/innerHeight = [1440, 881]`（900 减去标题栏/菜单栏），页面 complete、React 挂载、无 JS 错误。
  2. 菜单结构（Win32 GetMenu/GetMenuItemCount/GetMenuString 枚举）：顶级 4 组「文件/编辑/视图/帮助」；文件 6 项（新建文档 Ctrl+N / 打开 Workspace Ctrl+O / 分隔 / 最近 / 分隔 / 退出 Ctrl+Q）；编辑 7 项（撤销/重做/分隔/剪切/复制/粘贴/全选）；视图 3 项（重新加载 Ctrl+R / 分隔 / 开发者工具 F12——debug 存在）；帮助 1 项（关于 KnowledgeEditor）。
  3. DevTools：向主窗口 SendMessage WM_COMMAND(1019) → 枚举到新窗口「DevTools - tauri.localhost/」，DevTools 可用。
  4. 菜单→前端链路：WM_COMMAND(1003) 触发「新建文档」→ CDP 捕获 `Page.javascriptDialogOpening`（type=prompt、message=「文档标题」、defaultPrompt=「新文档 2026/8/10」）→ `Page.handleJavaScriptDialog` 接受标题「M5菜单冒烟测试」→ 文章树出现 `m5菜单冒烟测试.md`、编辑器显示「未保存…」——菜单→Rust emit→前端 listen→复用既有动作全链路通过。（注意：`Get-Process.MainWindowHandle` 在 DevTools 打开后会返回 Tauri 辅助窗口「Tao Thread Event Target」而非主窗口，WM_COMMAND 需按 class='Tauri Window' 显式定位主窗口句柄。）
  5. 退出：WM_COMMAND(1007)「退出」→ 应用干净退出、WebView2 子进程全部回收、5173/9223 端口释放；测试文章与备份清理。

### 环境记录：镜像同步脚本（robocopy 不可用改用 node fs）+ M5 冒烟脚本集合

类型：Environment（环境变更）
状态：Completed

现象：M4 镜像工作区策略沿用，但 PowerShell 沙箱中 `robocopy` 命令不可用（此前 M4 亦遇到），目录同步无现成工具。

原因：本机虚拟化层 + PowerShell 5 环境限制。

修改：
- `sync-frontend-src.mjs` / `sync-dist.mjs`（新增）：node fs `rmSync+cpSync` 双向同步脚本（镜像 src ↔ 真实 src；镜像 dist-build ↔ 真实 dist-build）。
- M5 冒烟脚本集合（`m5-smoke-*.ps1/js`，临时目录）：窗口/菜单枚举（Win32 GetMenu）、DevTools 触发（WM_COMMAND 1019）、菜单事件链路（CDP Page.javascriptDialogOpening + handleJavaScriptDialog）、退出触发（WM_COMMAND 1007）、全部后清理。

影响范围：本机构建/验证流程；M5 冒烟脚本为一次性验证产物，不纳入项目仓库。

验证：镜像同步后 vitest/typecheck/build 全通过（见上），dist-build 73 文件同步成功。

## 2026-08-10（Phase 7 M4，v0.7.3）

### M4 Workspace 桌面适配：app_config 重定向 + 首启引导 + 原生目录选择 + 最近工作区 exists 标记

类型：Feature
状态：Completed

现象：Phase 7 规划 7.4 要求桌面版工作区选择桌面化：原生目录选择器（tauri-plugin-dialog）替代 Web 文本输入、首启两选项引导（空 workspace 且无最近记录时）、最近工作区记录持久化并标记失效路径、软件级配置 app_config.json 从旧 Web 位置（`~/.knowledgeeditor`）重定向到应用数据目录（`%APPDATA%\KnowledgeEditor`）并自动迁移。

原因：无（功能新增）。M3 完成后推进 M4，解决桌面版工作区选择体验与软件级配置落盘位置（Web 与桌面分离）。

修改：
- `desktop/src-tauri/src/sidecar.rs`：sidecar env 注入 `KE_WORKSPACE`（读外部环境变量，缺省默认工作区）、`KE_APP_CONFIG`（`data_dir()/app_config.json`，强制覆盖）、`KE_CORS_ORIGINS`（tauri.localhost + debug 追加 dev port）。
- `backend/app/config.py`：`APP_CONFIG_PATH` 读 `KE_APP_CONFIG`；新增 `APP_CONFIG_LEGACY_PATH`（`KE_APP_CONFIG_LEGACY`，默认同旧 Web 位置）。
- `backend/app/services/app_config.py`：`_migrate_legacy` 首次启动（新位置不存在且与旧位置不同）将旧 Web 版 app_config.json 并入新位置，保留最近工作区/文档列表；复制失败回退默认不阻塞。
- `backend/app/routers/workspace.py`：`POST /api/workspace/open` 与 `/create` 成功后 `add_recent_workspace`；`GET /api/workspace/recent` 返回 `[{path, exists}]`（exists 为目录实时 `is_dir`）；`DELETE /api/workspace/recent?path=` 移除记录。
- `frontend/src/desktop.ts`（新增）：`isDesktop()` 双条件（`hostname==='tauri.localhost'` 或 `'__TAURI_INTERNALS__' in window`）；`pickDirectory(title)` 桌面动态 `import('@tauri-apps/plugin-dialog').open({directory:true})`，失败/非桌面返回 null。
- `frontend/src/App.tsx`：`firstRun` 判定（workspace 已打开且 `stats.document===0` 且最近记录为空）；`handleUseDefaultWorkspace`（重开默认 workspace 写入最近记录使下次不再引导）；顶栏「打开/新建工作区…」桌面用原生选择器、Web 回退 `window.prompt`。
- `frontend/src/components/layout/WorkspacePicker.tsx`：guide 两选项（primary 使用已有工作区/原生选择器、secondary 创建新工作区/沿用默认）；recent 列表（exists 项可点击打开，失效项置灰 + 「路径已失效」徽标 + × 移除）。
- `frontend/src/api/client.ts`：`getRecentWorkspaces` 返回 exists 字段。

影响范围：桌面版工作区选择流程与软件级配置存储位置；首次启动自动迁移旧 Web 配置（只复制不动源文件）；Web 版行为不变（仍用 `~/.knowledgeeditor` + prompt 输入）。

验证（完整链路）：
- 后端 pytest 全过（含 `test_app_config_migration`）；前端 vitest 70/70；`tsc -b` 通过；`npm run build` 通过（63 文件，dist-build）。
- `cargo test` settings 8/8；`cargo build --release` 成功（3m49s，16.9MB）；二进制内嵌 `index-C4HBtfzV.js`（EMBEDDED-OK）。
- release 冒烟（CDP 9223，`KE_WORKSPACE`=空目录 + `KE_APP_CONFIG_LEGACY`=不存在路径）：
  1. 首启引导出现：`ws-picker-guide-primary`「使用已有工作区」+ `ws-picker-guide-secondary`「创建新工作区」，副标题「欢迎使用！选择一个已有工作区，或创建新的工作区开始创作」。
  2. 点击 secondary → 主界面打开，`%APPDATA%\KnowledgeEditor\app_config.json` 生成且 recent 记录写入 empty-ws。
  3. API：`GET /workspace/recent` exists:true；`POST /workspace/open` 真实工作区（7 文档 1 模块）成功且 recent 顺序更新；目录重命名后 `GET /recent` 该路径 exists:false（失效标记）；`DELETE /workspace/recent` 移除记录 HTTP 200。
  4. 二次启动（有最近记录 + 空 workspace）→ 不再引导，主界面直接打开；设置面板（M3 回归）正常。
  5. WM_CLOSE 退出清理（两轮）：ke/backend 进程 0、8000/9223 端口释放、runtime 目录清空、app_config.json 保留最近记录。

### 环境变更：镜像工作区策略 + Rust 工具链误判修正（M0 已装，M4 重复安装后弃用）

类型：Environment（环境变更）
状态：Completed

现象：`D:\Agent` 虚拟化层存在幽灵文件（node_modules 等 906 个文件可见不可读、删除/枚举不可靠），前端依赖安装与验证不可行；M4 会话还发现 cargo 不在 PATH、`~/.cargo/bin/cargo.exe` 是 rustup-init 本体（12.8MB）、`~/.rustup` 无 toolchains，据此判断「Rust 未安装」并重新安装。

原因：`D:\Agent` 虚拟化层对删除/枚举的写入不可靠（PowerShell 列目录可见、node 进程读取 ENOENT、rmSync 假删除）；**Rust 误判根因**：M0 已将工具链安装至 `%LOCALAPPDATA%\cargo` + `%LOCALAPPDATA%\rustup`（用户级 CARGO_HOME/RUSTUP_HOME 已持久化，cargo/rustc 1.97.1 完整可用，`%LOCALAPPDATA%\cargo\config.toml` 已配 rsproxy 镜像），但 M4 会话只检查了 `~/.cargo`（M0 首次尝试默认位置被安全软件拦截留下的残留）与 `~/.rustup`，未检查 `%LOCALAPPDATA%` 位置，误判未安装。

修改：
- 镜像工作区策略（有效，保留）：前端源码复制到 `C:\Users\y8882\.trae-cn\work\6a773c1419e6c03a410e3eb1\ke-frontend` 干净路径安装依赖、跑 vitest/tsc/build；产物 dist-build 经 sync-dist.js 同步回真实路径供 release 构建内嵌。
- Rust 工具链（M4 误判产物，已弃用）：M4 曾用 rsproxy 镜像重复安装一套至临时路径 `...\rustup-home`/`cargo-home`（约 1.5GB）；后经核实 M0 安装完好，**统一回用 `%LOCALAPPDATA%` 工具链**（用户级环境变量已持久化，新终端直接可用），临时路径那套弃用勿再使用。M4 的 cargo test 8/8 与 release 构建均用临时路径工具链完成，产物有效（同版本 1.97.1，不影响结果）。

影响范围：本机构建/验证流程；文档记录（约束 9、DEVELOPMENT_ENVIRONMENT.md）已同步修正；临时路径冗余工具链待清理（虚拟层删除不可靠，暂留）。

验证：`%LOCALAPPDATA%` 工具链 `cargo test --release` 8/8 通过（settings 模块），与 M4 临时路径工具链结果一致；cargo/rustc 1.97.1 双套版本一致。

## 2026-08-10（Phase 7 M3，v0.7.3）

### M3 设置系统：settings.json schema v1 + Rust 读写命令 + 四组设置面板 + autosave 驱动 + 维护项

类型：Feature
状态：Completed

现象：Phase 7 规划第 7 章 7.3 要求桌面版提供应用层设置（启动 / 编辑器 / 界面 / 维护四组），`settings.json` schema v1 落盘 `%APPDATA%\KnowledgeEditor\settings.json`；自动保存间隔由设置驱动；三个维护项（查看日志 / 打开数据目录 / 重建索引，重建索引复用后端 `POST /api/index/rebuild`，不新增后端接口）。设置属于应用层，不写入 Markdown、不修改 Workspace 文件结构、不与文章数据混存；Web 版降级 localStorage。

原因：无（功能新增）。M2 完成后按规划推进 M3，将应用偏好与应用数据分离存储。

修改：
- `desktop/src-tauri/src/settings.rs`（新增）：`SCHEMA_VERSION = 1`；结构体 `StartupSettings`（restoreLastState / autoOpenRecentWorkspace，默认 true/true）、`EditorSettings`（autosaveIntervalMs=3000 / historyRetentionCount=30 / display）、`UiSettings`（theme=system / displayPreference）、`AppSettings`（schemaVersion + 四组 + maintenance 扩展字段），serde `default + rename_all = camelCase`，未知键忽略；`load_from/save_to` 支持路径注入（供测试），`settings_file()` 定位 `data_dir()/settings.json`；深合并 `merge_value`（patch 仅覆盖存在的键）；sanitize theme（仅 system/light/dark，非法回退 system）；原子保存（tmp + rename）；命令 `get_settings` / `update_settings` / `open_log_dir` / `open_data_dir`（explorer spawn）；8 个单测（defaults / merge 部分补丁 / 未知键 / sanitize theme / roundtrip / 损坏回退 / 缺失回退 / UTF-8 BOM 兼容）。
- `desktop/src-tauri/src/sidecar.rs`：`data_dir()` 改为 `pub(crate)` 供 settings.rs 复用。
- `desktop/src-tauri/src/lib.rs`：`mod settings` + 4 个命令注册。
- `frontend/src/settings.ts`（新增）：类型 + `DEFAULT_SETTINGS` + `isTauri()`（`'__TAURI_INTERNALS__' in window`）+ `sanitizeTheme` + `mergeSettings` 纯函数 + `loadSettings/saveSettings`（Tauri invoke ↔ localStorage `ke.settings.v1` 降级）+ `getCachedSettings` + `getAutosaveIntervalMs` + `applyTheme`（data-theme + colorScheme）。
- `frontend/src/settings.test.ts`（新增）：7 个用例（sanitizeTheme 3 + mergeSettings 6 断言组）。
- `frontend/src/components/settings/SettingsPanel.tsx`（新增）：右侧抽屉，四组设置 + 维护项；输入框 onBlur 校验（autosave 500–600000 / retention 1–999）；主题三按钮即时生效；维护按钮带 `data-action`（open-log / open-data / rebuild-index）、关闭按钮 `data-action="close-settings"`（供自动化精确定位）。
- `frontend/src/App.tsx`：顶栏「⚙ 设置」入口 + 启动 `loadSettings().then(s => applyTheme(s.ui.theme))` + `<SettingsPanel>`。
- `frontend/src/components/layout/EditorArea.tsx`：两处硬编码 `setTimeout(..., 3000)` 改为 `getAutosaveIntervalMs()`（每次 debounce 触发时读缓存即时生效）。

影响范围：桌面应用层设置存储与读写命令；前端设置面板与主题/自动保存行为；Web 版（localStorage 降级）不受影响；后端 API 与 Markdown 数据格式无改动（重建索引仅复用既有端点）。

验证：`cargo test` settings 8/8；vitest 70/70；`tsc -b` 通过；`npm run build` 通过（1.95 MB）；dev 冒烟（CDP 9222 端到端）：预置 settings.json（dark/8000/30）正确读取并应用（data-theme=dark、autosave-input=8000、retention-input=30）、主题切换即时生效、设置面板内重建索引成功（「重建完成：文档 1 / 模块 0 / 附件 0」）、open_log_dir 真实创建 `%APPDATA%\KnowledgeEditor\logs`、关闭按钮正常；WM_CLOSE 退出清理：ke 进程 0 / 8000 释放 / Vite 5173 退出 / runtime.json 删除 / settings.json 保留（dark/8000/30 未破坏）。

### 修复 settings.json 读取遇 UTF-8 BOM 静默回退默认

类型：Bug Fix
状态：Completed

现象：CDP 首轮冒烟发现预置 settings.json（theme=dark / autosaveIntervalMs=8000）读取后回退默认（data-theme=system、autosave 3000），落盘值丢失。

原因：预置文件由 PowerShell 5 `Set-Content -Encoding UTF8` 写入，带 UTF-8 BOM；serde_json 遇 BOM 解析失败 → `load_from` 静默回退默认值。

修改：`desktop/src-tauri/src/settings.rs` 的 `load_from` 解析前 `trim_start_matches('\u{feff}')` 剥离 BOM；新增 `utf8_bom_is_tolerated` 单测（写 BOM 字节 + JSON，断言 dark/8000 被正确读取）。

影响范围：Windows 上任何带 BOM 的 settings.json（记事本 / PowerShell 保存场景）均可正确读取；无 BOM 文件不受影响。

验证：单测 8/8 通过；用 node 重写无 BOM 预置文件后 CDP 复验 dark/8000/30 全部生效。

### M3.1 修复 release 构建缺失 custom-protocol feature（二进制未嵌入前端资源）

类型：Bug Fix
状态：Completed

现象：release 冒烟发现 `target\release\knowledgeeditor.exe` 不包含任何 `index-*.js` 前端资源字符串（`strings` 搜不到），实际启动加载的是 devUrl 而非打包资源。

原因：`desktop/src-tauri/Cargo.toml` 中 `tauri = { version = "2", features = [] }` 未启用 `custom-protocol` feature；Tauri v2 下该 feature 缺失时 release 构建不嵌入 frontendDist 资源、回退 devUrl 加载。

修改：`desktop/src-tauri/Cargo.toml`：`features = ["custom-protocol"]`。

影响范围：release 二进制资源嵌入与启动加载路径；dev（tauri dev）不受影响。

验证：重新构建后二进制含 `index-Cftz0YnZ.js` 哈希字符串；release 启动页面为内嵌资源（hostname=tauri.localhost）。

### M3.1 修复 dist 虚拟层幽灵文件复发：vite outDir 改 dist-build 彻底绕行

类型：Bug Fix
状态：Completed

现象：M2 曾以「真实层 rename dist 恢复 + 直接 cargo build --release」绕开 dist 幽灵文件；M3.1 重新构建时幽灵文件复发（`index-CDHoAOT-.js` 在 PowerShell 视图可见、node/rustc 宏读取失败），`cargo build --release` 再次失败；且发现 rename dist → dist.bak 后 rename 回 dist 仍带幽灵文件，虚拟化层删除/重命名均不可靠。

原因：`frontend/dist` 在虚拟化层存在可见不可删的陈旧产物（index.html 引用旧哈希，实际文件缺失），tauri-build 扫描 dist 列入资产清单后宏读取失败；rustc 子进程与 node/PowerShell 文件系统视图不一致。

修改：
- `frontend/vite.config.ts`：`build.outDir` 改为 `dist-build`（全新路径，无幽灵污染）；dev 不受影响。
- `desktop/src-tauri/tauri.conf.json`：`build.frontendDist` 改为 `../../frontend/dist-build`。
- 构建路径统一为 `npm run tauri -- build`（同一 npm 进程树，cargo/rustc 继承注入的 RUSTUP_HOME/CARGO_HOME/PATH），不再直接 `cargo build --release`。

影响范围：本地 release 构建全流程；`frontend/dist`（含幽灵文件）废弃不再参与构建；CI 干净环境与 dist-build 方案兼容。

验证：`npm run tauri -- build --no-bundle` 成功产出 `target\release\knowledgeeditor.exe` 与 `target\release\bundle\nsis\KnowledgeEditor_0.7.3_x64-setup.exe`；release 启动加载内嵌 dist-build 资源。

### M3.1 修复 release 首启 IPC 竞态：API 基址注入失败误判「后端未连接」

类型：Bug Fix
状态：Completed

现象：release（custom-protocol 内嵌资源）首启时 `window.__KE_API_BASE__` 未注入，页面显示「后端服务未连接」；`Page.reload` 后注入成功（console 输出「[ke] 运行时注入 API 基址: http://127.0.0.1:8000」）。

原因：内嵌资源加载极快，React bundle 执行可能早于 WebView2 IPC 通道就绪，首次 `invoke('get_runtime_info')` 失败；且首启时 `'__TAURI_INTERNALS__' in window` 尚未为真，旧逻辑直接返回 null 不再重试。另经 CDP 实测确认 Tauri v2 不修改 WebView2 UA（UA 为 `Edg/151.0.0.0`，不含 "Tauri"），UA 检测思路无效；release 页面 hostname 恒为 `tauri.localhost`。

修改：`frontend/src/main.tsx` 的 `resolveApiBase()`：
- 环境判定改为双条件：`location.hostname === 'tauri.localhost'`（release 桌面恒真）或 `'__TAURI_INTERNALS__' in window`（dev 注入后真）；非 Tauri 环境（Web/测试）立即返回 null，不做无谓等待。
- `invoke('get_runtime_info')` 纳入重试循环：10 次 × 400ms，成功即写入 `window.__KE_API_BASE__`。

影响范围：桌面 release/dev 双模式首启 API 基址注入；Web/测试（vitest）路径立即回退不受影响。

验证：重建后 release 首启注入成功（`apiBase=http://127.0.0.1:8000`、后端 v0.7.3、工作区侧栏加载、⚙ 设置出现、theme=dark）；vitest 70/70、`tsc -b` 0 错误回归通过。

### M3.1 release 冒烟补验：设置面板端到端 + 退出清理（修正断言选择器）

类型：Test
状态：Completed

现象：release 面板 CDP 断言中 `data-field=autosaveIntervalMs` / `data-field=historyRetentionCount` 输入框与 `data-field=rebuild-result` 未命中，疑似面板缺陷。

原因：断言设计错误——`SettingsPanel.tsx` 的 `NumberRow` 输入框无 data-field 属性（仅 `type="number"`，按 label 文本区分）；重建结果为无属性条件渲染 `<p>`（`{indexResult && ...}`）。DOM dump 证实输入框 `val=8000/30` 与 settings.json 一致，面板功能正常。

修改：无代码改动；修正 CDP 脚本选择器——按 label 文本（「自动保存间隔（毫秒）」「历史版本保留数量」）向上遍历定位输入框、按「重建完成/重建失败」文本前缀定位结果。

影响范围：仅自动化验证脚本；产品代码不变。

验证：release（CDP 9223）面板端到端全通过：open-settings=clicked、inputs `{"autosave":"8000","retention":"30"}`、编辑 autosave→7500 blur 后即时保存生效（settings.json 同步）、还原 8000 成功、rebuild-result=「重建完成：文档 1 / 模块 0 / 附件 0」（confirm 自动接受）、close-settings 后面板关闭；WM_CLOSE 退出清理：knowledgeeditor 进程 0、8000 释放、`%APPDATA%\KnowledgeEditor\runtime\` 目录已清空（release 运行时临时数据落盘 runtime\ 目录，退出清空目录内容，settings.json 保留 dark/8000/30）。

## 2026-08-10（Phase 7 M2，v0.7.3）

### M2 前端适配：API 基址注入 + attachmentUrl 合并（P9）+ 测试脚本/CI/OpenAPI 快照（P10）

类型：Feature
状态：Completed

现象：桌面版 WebView 页面 origin（tauri.localhost / dev 前端页）与后端 127.0.0.1:8000 跨源，前端 API 需按实际侧车端口拼接基址；`ke.ts` 与 `client.ts` 存在两份 `attachmentUrl` 实现且 URI 编码行为有差异；`package.json` 无 test 脚本、CI 无前端测试与 OpenAPI 端点快照断言（规划第 6 章 + 6E P9/P10）。

原因：无（功能新增）。M1 已提供 `get_runtime_info` command，需前端挂载前注入基址并统一拼接；P9/P10 为 6E 遗留项，按规划在 M2 收敛。

修改：
- `frontend/src/main.tsx`（重写）：挂载前检测 `'__TAURI_INTERNALS__' in window`，`invoke('get_runtime_info')` 取得 `api_base` 写入 `window.__KE_API_BASE__`（末尾去斜杠），失败回退相对路径（Vite 代理）；Web/测试环境无注入 → 空串 → 既有 vitest 不受影响。
- `frontend/src/api/client.ts`：新增导出 `apiBase()`（`window.__KE_API_BASE__ ?? ''`）；`request<T>` 改为 `fetch(apiBase() + path, ...)`；4 处直接 fetch（uploadAttachment / exportPackage / importMarkdown / importPackage）统一拼接基址；P9 合并 `attachmentUrl`：`apiBase() + '/api/attachments/' + rel.split('/').map(encodeURIComponent).join('/')`（以 client 实现为准，URI 编码保留）。
- `frontend/src/vite-env.d.ts`：新增 `interface Window { __KE_API_BASE__?: string }`。
- `frontend/src/editor/ke.ts`：删除 `attachmentUrl` 函数体，替换为指向 `api/client.ts` 的说明注释；`AttachmentNodeView.tsx` / `VideoNodeView.tsx` 的 import 改自 `'../../../api/client'`。
- `frontend/package.json`：dependencies 新增 `@tauri-apps/api@^2.11.1`；scripts 新增 `"test": "vitest run"`。
- `.github/workflows/ci.yml`：frontend job 在 build 前增加 Unit tests（vitest run）步骤。
- `backend/tests/test_openapi_snapshot.py`（新增）：`GET /api/openapi.json` 的 paths 有序键集合全等断言（实测 36 路径，缺/多显式输出差异）+ 方法总数断言（实测 47；docstring 注明规划「42」为 Phase 6E 冻结检查业务口径，差异为辅助端点）。
- `desktop/src-tauri/src/sidecar.rs`：CORS 追加 dev origin（见下条 Bug Fix）。

影响范围：前端 API 访问全链路（Web/桌面双模式）；附件 URL 生成；CI 前端测试与后端快照；42 端点 API 业务口径无改动。

验证：vitest 62/62；`tsc -b` 通过；`npm run build` 通过（1.94 MB）；后端快照 2 passed；桌面 dev 冒烟：注入基址链路（health ok → runtime.json 写入 → 窗口 UI 完整加载）→ CORS 修复后 7 项核心 API 抽测全通过（含真实写入 `Articles/m2.md`）→ WM_CLOSE 退出清理无残留；release 冒烟：`cargo build --release` → sidecar 拉起 → health/OPTIONS/GET（Origin: `http://tauri.localhost`）全 200 → 前端产物含 `__KE_API_BASE__`/`get_runtime_info` → WM_CLOSE 全清理。

### 修复桌面 dev 模式 CORS 预检 400（跨源 OPTIONS 失败）

类型：Bug Fix
状态：Completed

现象：M2 注入绝对基址后 dev 模式前端产生跨源请求（页面 origin 127.0.0.1:5173 → 后端 127.0.0.1:8000），OPTIONS 预检返回 400，真实 API 调用失败。

原因：M1 在 sidecar.rs 以 `KE_DEV_FRONTEND_PORT` 环境变量追加 dev origin，但该变量从未被设置，dev 构建缺失 127.0.0.1:5173；且 `KE_CORS_ORIGINS` 环境变量会覆盖 config.py 默认值。

修改：`sidecar.rs` CORS 列表固定包含 `http(s)://tauri.localhost`；`cfg!(debug_assertions)` 分支无条件追加 `http://127.0.0.1:{port}` 与 `http://localhost:{port}`（端口取 `KE_DEV_FRONTEND_PORT`，缺省 5173，与 tauri.conf.json devUrl 一致）。

影响范围：桌面 dev 模式前端 API 调用；release 不受影响。

验证：dev 冒烟 OPTIONS/GET 全 200（ACAO 回显正确），随后 7 项核心 API 抽测全通过。

### 修复桌面退出关闭回归（CloseRequested 处理器内同步清理阻塞）

类型：Bug Fix
状态：Completed

现象：关闭窗口后 sidecar 已清理、8000 已释放、runtime.json 已删除，但主窗口仍残留、进程不退出。

原因：`cleanup_on_exit` 内 taskkill 等待 + 最多 5s 轮询在 CloseRequested 事件处理器中同步执行，长时间阻塞主线程，破坏 tao 的窗口销毁流程（此前用 `CloseMainWindow()` 无法复现是因为 Get-Process 缓存了虚拟化层无效句柄，见下条）。

修改：`lib.rs` CloseRequested 处理器改为 `api.prevent_close()` + `window.hide()` + `std::thread::spawn(move || { sidecar::cleanup_on_exit(&app); app.exit(0); })`，清理在独立线程完成后强制退出；调试用 `eprintln!` 诊断日志已移除，保留注释说明。

影响范围：桌面退出路径；退出后无残留进程与记录文件。

验证：dev 与 release 双模式 WM_CLOSE 冒烟（投递真实窗口句柄）：进程退出、8000 释放、runtime.json 删除、Vite（dev）退出，全通过。

### 本地 release 构建 dist 虚拟层幽灵文件（环境性）

类型：Bug Fix
状态：Completed

现象：`npm run tauri -- build --no-bundle` 失败，报缺 `frontend/dist` 的 `index-CDHoAOT-.js`；PowerShell 视图显示 dist 中存在该文件，但 node（真实层）`fs.readdirSync` 与 Read 工具均报不存在（虚拟化层「幽灵文件」）。

原因：dist 存在新旧混合产物（index.html 引用旧的 CDHoAOT 而真实层该文件已被 rename），删除被沙箱拦截、目录 rename 在真实层可用。

修改：无代码改动；本机构建绕开——用 node（真实层）将 `dist-old` rename 回 `dist`（真实产物 64 个文件、index.html 引用 `index-FNRpDFjq.js` + `index-CLYym4aG.css` 一致），直接 `cargo build --release` 成功（release 产物 `target\release\knowledgeeditor.exe` + `knowledgeeditor-backend.exe`）。

影响范围：仅本机本地 release 构建流程；CI（干净环境）无此问题，README/CI 中的 `npm run tauri -- build` 不受影响。

验证：release 冒烟全通过（见本阶段 Feature 条目）。

## 2026-08-10（Phase 7 M1，v0.7.3）

### 后端侧车：PyInstaller 打包 + Rust Sidecar Manager（拉起/health/动态端口/崩溃自动拉起/退出清理）

类型：Feature
状态：Completed

现象：Phase 7 桌面化需要 Tauri 壳内置后端服务，由 Rust 侧统一拉起、握手、清理（规划第 5 章 7.2）。

原因：无（功能新增）。桌面版无独立前端进程，需将既有 FastAPI 后端打包为侧车由桌面壳托管。

修改：
- `backend/run.py`（新增）：PyInstaller 打包入口。`_ensure_env_defaults()` 先于 `from app import config` 执行（`KE_WORKSPACE` 缺省 `%APPDATA%\KnowledgeEditor\workspace`）；`main()` 对象式导入 `from app.main import app` 供 PyInstaller 静态分析全依赖树，再 `uvicorn.run(app, host=config.HOST, port=config.PORT, reload=False)`。
- PyInstaller 6.22.0（venv 内）`--onefile --name knowledgeeditor-backend --paths backend` + 11 个 `--hidden-import uvicorn.*`（uvicorn 动态导入收编）；产物 12,637,746 B，重命名为 `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` 放入 `desktop/src-tauri/binaries/`。
- `desktop/src-tauri/src/sidecar.rs`（新增，约 440 行）：Sidecar Manager。四段式流程（cleanup_stale → find_free_port 动态端口（默认 8000，最多 3 次）→ spawn_sidecar + wait_health（30s/1s 轮询，`status=ok`）→ write_runtime（schema 与 start.ps1 一致，frontend 置 null，落盘 `%APPDATA%\KnowledgeEditor\runtime\runtime.json`））；`watch_sidecar` 监听线程透传 stderr/stdout（`[sidecar]` 前缀）、emit `ke:sidecar-exited`/`ke:runtime-ready`/`ke:runtime-error`、崩溃自动拉起 ≤3 次；环境注入 `KE_HOST/KE_PORT/KE_WORKSPACE/KE_CORS_ORIGINS`（追加 `http(s)://tauri.localhost` 与 dev 端口）；`get_runtime_info` command 供 M2 基址注入。
- `desktop/src-tauri/src/lib.rs`：`mod sidecar` + `tauri_plugin_shell::init()` + `.manage(SidecarState)` + setup 启动 + `CloseRequested` 退出清理 + `get_runtime_info` 注册。
- `Cargo.toml`：新增 `tauri-plugin-shell = "2"`、`ureq = "2"`；`tauri.conf.json`：`bundle.externalBin: ["binaries/knowledgeeditor-backend"]`；`capabilities/default.json`：`shell:allow-spawn`、`shell:allow-execute`。

影响范围：桌面启动/退出全链路；Web 版（start.ps1）不受影响；42 端点 API 无改动。

验证：`tauri dev` 集成冒烟——窗口 → 侧车拉起 → health 握手 → runtime.json 写入（backend.pid/port/started_at/version + frontend:null）→ 前端真实 API 调用成功（workspace/current、tags、tree、fs/events 等）；WM_CLOSE 退出后主进程/sidecar 整树/端口/runtime.json 全部清理无残留；强杀 sidecar 模拟崩溃，1s 后自动拉起（第 1/3 次）且 health 恢复、runtime.json pid 更新。

### 修复桌面退出清理阻塞（taskkill 挂起导致窗口关闭卡死）

类型：Bug Fix
状态：Completed

现象：桌面窗口发送关闭后：主进程不退出、窗口半关闭、前端仍在轮询、sidecar 进程与 runtime.json 残留。

原因：`cleanup_on_exit` 第一步同步调用 `taskkill /PID <pid>`（无 /F）。PyInstaller onefile bootloader 不响应 CTRL_CLOSE_EVENT，taskkill 无限等待进程退出，阻塞窗口事件线程，后续清理步骤（5s 等待、整树强杀、删 runtime.json）全部无法执行。

修改：`sidecar.rs` 优雅终止 `taskkill /PID` 移入独立线程（防挂起阻塞）；改为轮询等待最多 5s（`is_alive` 每 250ms 检查，进程退出即提前结束），超时仍存活则 `kill_tree`（`taskkill /T /F`）；提取 `is_alive()` 消除 cleanup_stale / cleanup_on_exit 两处重复。

影响范围：桌面退出路径；退出后无残留进程与记录文件。

验证：WM_CLOSE 后主进程退出、sidecar 整树清理、runtime.json 删除、8000 端口释放；崩溃自动拉起场景（pid 已更新）下退出清理同样通过。

## 2026-08-09 / 2026-08-10（Phase 6U 周期，v0.6.0 后 → v0.7.3）

### 表格功能优化（气泡菜单）

类型：Feature
状态：Completed

现象：光标进入表格时缺少行列级编辑入口，只能依赖工具栏插入固定 3×3 表格，无法按需增删行列、合并拆分单元格。

原因：表格节点仅支持创建，缺少交互式编辑 UI。

修改：新增 `frontend/src/components/editor/TableBubbleMenu.tsx`：光标进入表格（或拖选单元格）时在表格上方浮动显示操作条，支持上/下插行、左/右插列、删行、删列、合并单元格、拆分单元格、删除整个表格；操作按钮带可用态判断（`can().mergeCells()` 等），点击按钮 `onMouseDown preventDefault` 防止编辑器失焦导致菜单隐藏。该组件是唯一从 `@tiptap/react/menus` 子路径导入 `BubbleMenu` 的文件。

影响范围：表格相关编辑交互；引入新依赖路径，触发 Vite 重新预构建（见下条白屏记录）。

验证：真实 Chrome 操作验证菜单定位与各操作按钮生效。

### 修复开发页白屏（esbuild 被拦截，环境性）

类型：Bug Fix
状态：Completed

现象：表格优化推送后，开发页打开白屏，页面无模块可渲染。

原因：表格优化引入 `@tiptap/react/menus`（BubbleMenu）依赖路径，推送后触发 Vite 对新增依赖重新预构建；本机安全软件按文件名拦截 `esbuild.exe` 写入（Access is denied），预构建无法产出 `node_modules/.vite` 缓存，页面无模块可加载。

修改：
- 新增 `frontend/scripts/ke-vite.mjs`：启动 Vite 前把 `@esbuild/win32-x64/esbuild.exe` 复制为改名副本（`.esbuild/esbuild-renamed.exe`，按体积与 mtime 判断是否需刷新副本），在任何 esbuild 模块被加载前设置 `ESBUILD_BINARY_PATH` 指向副本，再以子进程启动真实 Vite CLI（dev/build/preview 参数原样透传）。
- 修改 `frontend/vite.config.ts`：`cacheDir` 从 node_modules 下移出到 `../workspace/.knowledgeeditor/vite-cache`（沙箱保护 node_modules 目录、拦截目录 rename，导致预构建 `deps_temp -> deps` 原子替换失败；workspace 下 rename 不受限）。

影响范围：前端开发/构建/预览的启动链路；新增副本目录与缓存目录。

验证：dev server 可正常产出依赖预构建缓存，`repro.html` 与主应用页面均能加载渲染（app-smoke / diag 脚本验证无致命错误）。

### v0.6.1：拖拽添加附件

类型：Feature
状态：Completed

现象：需求「增加拖动添加附件」。

原因：无（功能新增）。

修改：
- `frontend/src/editor/index.ts`：`editorProps.handleDrop` 拦截 ProseMirror 对拖入图片的默认 base64 内联行为，改为逐个上传后插入 `attach`/`video` 节点（`uploadAttachment` 上传 → `attachmentNode` 按返回类别构建节点 → `tr.insert(pos)`），拖放位置按 `posAtCoords` 计算；上传失败 `window.alert` 提示且不中断后续文件。
- `frontend/src/components/layout/EditorArea.tsx`：拖拽悬停遮罩。
- 配套：孤儿附件（未被任何 Markdown 引用）仅支持手动删除、绝不自动删除；被引用附件后端返回 409 拒绝删除。

影响范围：附件/视频插入路径、拖拽交互。

验证：真实 Chrome 拖拽文件到编辑区，attach/video 节点按拖放位置插入；孤儿附件手动删除正常。

### v0.6.2 / v0.6.3：注释样式（脚注两种样式）

类型：Feature
状态：Completed

现象：需求「增加注释样式」，脚注展示形式单一。

原因：无（功能新增）。

修改：`frontend/src/components/editor/EditorToolbar.tsx` 的 `FootnoteDialog` 支持两种脚注样式，选择记忆在 `localStorage['ke.footnoteStyle']`：
- 脚注区域（block）：正文插入上标 [n]，文末自动生成灰底「脚注」信息块（独立 footnotes 节点），条目可就地编辑、与上标有连接。
- 纯 Markdown（plain）：正文同样插入上标 [n]；文末追加 `# 参考` 与 `[n] 内容` 为普通段落，无连接、可自由编辑（v0.6.3 补齐正文上标，不创建 footnotes 节点）。

影响范围：脚注插入命令、Markdown 导出结构、底部脚注区渲染。

验证：真实 Chrome 切换两种样式插入脚注，正文上标与文末内容正确生成；重启后样式选择记忆生效。

### v0.6.4：修复插入脚注上标后自动换行 + 上标编号可修改

类型：Bug Fix
状态：Completed

现象：插入脚注上标后正文自动换行；上标编号无法直接修改。

原因：StarterKit `trailingNode` 在 footnotes 节点后补空段落；插入后光标未显式复位到上标之后。

修改：`trailingNode` 配置 `notAfter: ['paragraph', 'footnotes']`，footnotes 节点后不再补空段落；插入上标后光标显式复位到上标之后同一行；上标编号可点击直接修改（仅影响正文显示，不影响底部参考栏）。

影响范围：脚注插入链路、行尾结构。

验证：真实 Chrome 行中/行尾插入上标无换行；点击上标可修改编号。

### v0.6.5：修复脚注光标 DOM 错位（Backspace 误删上标）

类型：Bug Fix
状态：Completed

现象：上标后按 Backspace 误删上标；行末/段末插入后光标视觉跳到下一行行首。

原因：`insertFootnote`/`insertPlainFootnote` 用 chain 模式 `insertContent` 不立即 dispatch，selection 仍是插入前位置；上标 `line-height: 0` 造成行尾视觉错位；浏览器把 caret 渲染到软换行后的下一行行首。

修改：
- 插入改为单 transaction（`tr.replaceWith` 插入上标后 `after = from + nodeSize` 将光标置于上标之后），杜绝 selection 滞后。
- 上标样式 `line-height` 由 0 改为 1 消除行尾视觉错位。
- 行末/段末插入后补零宽空格 U+200B 锚点（`isCaretAtLineEnd` 判断，`$pos.end()` 而非 `Node.end()`），避免 caret 落到下一行行首。

影响范围：脚注上标插入位置与光标行为（行中、行尾、段末三种场景）。

验证：真实 Chrome caret 像素级截图对比（修复前 caret 在下一行行首，修复后落在 sup 右侧同一行）；Backspace 不再误删上标。

### v0.7.0：信息块改为可编辑内容节点（方案 A）

类型：Refactor
状态：Completed

现象：「信息块内无法使用注释功能（它会删掉整个信息块）」。

原因：信息块为 atom 节点，PM 将插入位置视为替换选区，注释插入即整块替换。

修改：
- `NoteExtension.ts`：`group: 'block'`、`content: 'inline*'`、`defining: true`、`selectable: true`、`draggable: true`；`renderHTML` 返回 `['div', mergeAttributes(...), 0]`；`insertNote` 命令将内容参数包成文本子节点。
- `tokenizers.ts`：新增 `keNoteTokenizer`（'ke_note'，block 级），`matchBalancedJson` 解析头部 attrs，查找 `<!-- /ke-note -->` 结束标记——找到则解析为包裹格式 `{ content: inner }`，找不到则为旧自闭合格式 `{ selfClosed: true }`。
- Markdown 存储改为包裹格式：`<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`。
- 旧格式自动迁移：`parseHTML` 双规则（优先级 200 的旧格式规则仅当 `data-content`/`data-text` 属性存在时命中），`getContent` 用 `Fragment.fromJSON` 迁移为文本子节点；`parseMarkdown` 对旧格式同样从 attrs 迁移。
- `NoteNodeView.tsx`：改用 `NodeViewContent as="div"` 挂载 PM contentDOM。

影响范围：信息块的 Markdown 存储格式（v0.7.0 起冻结为包裹格式）、schema、往返解析；旧格式读取兼容保留。

验证：`markdown-roundtrip.test.ts` 新增「块内插入脚注」场景；`phase3-roundtrip.test.ts` 旧格式断言更新；62 前端测试全绿；真实 Chrome 块内插入脚注成功且不删块。

### v0.7.1：修复信息块内无法输入文本 + 徽章优化

类型：Bug Fix
状态：Completed

现象：「信息块现在无法输入文本」。

原因：NodeViewWrapper 设 `contentEditable={false}`，prosemirror-view 不会自动覆盖 contentDOM 的可编辑性，contentDOM 继承禁编辑。实验证明手动给 contentDOM 设 `contentEditable='true'` 后输入成功。

修改：
- wrapper 不再设置禁编辑；颜色按钮、徽章/标题输入框、删除按钮各自单独加 `contentEditable={false}`（tiptap 官方模式）。
- 徽章颜色与信息块背景同步同一色系：`COLOR_MAP` 结构从字符串改为 `Record<string, { block: string; badge: string }>`（blue/yellow/green/red/purple 五色）。
- 徽章默认空文本：placeholder 清空，不再显示「信息」占位字。

影响范围：信息块编辑交互、徽章配色。

验证：真实 Chrome 块内直接输入成功；五色系联动；新建块徽章无占位字。

### v0.7.2：修复占位文字错渲染到颜色按钮

类型：Bug Fix
状态：Completed

现象：「每个选择颜色的按钮下面都挂着一长串竖着的"输入信息块内容…"」。

原因：CSS `[contenteditable]:empty::before` 属性选择器匹配属性存在即命中（不看值），空的颜色按钮（`contenteditable="false"` 且无子节点）满足 `:empty`；`white-space: pre-wrap` 使文字在 16px 窄按钮中竖排。真实 contentDOM 无显式 contenteditable 属性且 PM 空容器内置 `<br class="ProseMirror-trailingBreak">`，永远不会 `:empty`，旧 CSS 规则实际从未在内容区生效过。

修改：
- `index.css`：改为 `.ke-note [contenteditable]:not([contenteditable="false"])`，控件不再渲染占位文字。
- `NoteNodeView.tsx`：检测 `node.content.size === 0`，为空时给内容区追加 `ke-note-content--empty` class，CSS 用 `.ke-note-content.ke-note-content--empty::before` 显示占位符，输入文字后 class 自动移除（JS 驱动，避开 trailingBreak 使 `:empty` 失效的问题）。

影响范围：信息块占位符展示、按钮/输入框样式。

验证：真实 Chrome 探针枚举确认按钮干净、内容区显示占位符、输入后消失；62 前端测试全绿；tsc 通过。

### v0.7.3：修复保存后属性面板元信息变「—」

类型：Bug Fix
状态：Completed

现象：「保存后，右边栏中属性的创建时间等内容，会变成 -，而不是更新」。

原因：编辑器保存走 `saveArticle` → `PUT /api/articles/{id}` → 后端 `update_article` 响应仅含标题/正文/标签 → 前端 `handleSaved` 用响应整体替换 article 状态 → `fmtTime`/`fmtSize` 对缺失字段显示「—」。

修改：`backend/app/routers/documents.py` 的 `update_article` 与 `GET /articles/{id}`、`PUT /articles/{id}/meta` 保持一致，返回完整元信息（`_file_stats` 取 `created_at`/`updated_at`/`size`，正文重新计算 `word_count`）。

影响范围：保存接口响应结构、属性面板显示。

验证：`backend/tests/test_api.py` 新增回归断言（保存响应必须携带非空元信息）；102 后端测试全绿；node 脚本 API 验证 + 真实 Chrome 端到端：保存后修改时间更新、创建时间不变。

### v0.7.3：stop.ps1 兜底停止增强

类型：Bug Fix
状态：Completed

现象：「目前前端正在正常运行，但我用 .\scripts\stop.ps1 无法停止它」。

原因：stop.ps1 只按 `runtime.json` 的 PID 记录停止（该文件由 start.ps1 写入）；dev 方式启动的进程无记录，脚本直接走「未找到记录文件」分支退出。

修改：`scripts/stop.ps1` 保留「不按进程名模糊匹配、不误杀无关服务」原则，增加「端口 + 项目命令行特征」双重匹配兜底：backend 端口 8000 匹配 `uvicorn app.main:app`，frontend 端口 5173 匹配 `node_modules\vite\bin\vite.js`；特征命中的进程用 `taskkill /PID /T /F` 停止整个进程树，`taskkill` 不可用时回退 `Stop-Process`；特征不命中的占用进程只提示、不自动关闭。

影响范围：进程停止脚本（start/stop 一键启停链路）。

验证：真实场景验证（无 runtime.json、服务运行中）：stop.ps1 按端口+特征识别并停止 5173/8000 进程树。

### 26 项浏览器端回归测试（checklist）

类型：Test
状态：Completed

现象：要求对 v0.7.3 做浏览器端全量回归。

原因：无（测试任务）。

修改：真实 Chrome + playwright-core 驱动，分三组执行：
- repro 页面（编辑器功能）17 项：页面加载、正文输入、Markdown 往返、信息块（插入/块内输入/块内注释/徽章标题自定义/色系联动/占位符/删除）、脚注上标（行中/行尾插入、编号修改、Backspace 安全、脚注区生成）、包裹格式导出、旧格式迁移。
- 完整 App 8 项：启动与版本（health=0.7.3）、打开文档属性有值、保存后修改时间更新且创建时间不变、标题/标签写回 frontmatter、自动保存防抖、历史版本面板、全文搜索命中、附件面板加载。
- 停止脚本 1 项：stop.ps1 无 runtime.json 时按端口+特征停止 5173/8000。

影响范围：无代码变更。测试过程中出现 4 项初始失败，均为测试脚本自身问题（ProseMirror 位置 0 基误算、脚注区 Markdown 标记格式写错、误判文件树显示标题、模态遮罩关闭方式），修正脚本后全部通过，未发现产品级 bug。测试数据仅写入专用测试文档 `phase2-e2e.md`。

验证：25 项功能 + 1 项停止测试全部通过；环境已通过重启恢复。

### npm run build 构建验证

类型：Test
状态：Completed

现象：要求确认 `npm run build` 正常。

原因：无（构建验证任务）。

修改：无代码变更。停止 dev server 后执行 `npm run build`：`tsc -b` 零错误，vite 构建 `✓ built in 6.46s`，exit code 0，产物（`dist/index.html`、`index-*.js` 1.94 MB、`index-*.css` 73.7 KB）生成正常。仅有既有 chunk > 500 kB 体积提示，不影响构建与运行。验证后重启 dev server。

影响范围：无。

验证：构建产物存在且体积合理；`npm run build` exit code 0。

### 固化 Phase 7 准备分析文档（phase7-prep / phase7-prep-freeze-check）

类型：Feature（文档）
状态：Completed

现象：要求把「进入 Phase 7 前需要什么准备」的分析与「是否需要在 Phase 7 前做冻结和稳定性检查」的判断分别固化为文档。

原因：无（文档任务）。此前分析仅存在于对话上下文，需要脱离会话、供 Phase 7 开工前后查阅。

修改：
- 新增 `docs/phase7-prep.md`：Phase 7 桌面化准备分析。结论 + 四类准备：1) 环境与工具链（Rust 工具链缺失、`desktop/` 不存在、Python 运行时嵌入为最大工程点）；2) 代码与配置（前端相对 `/api` 依赖 Vite 代理需引入运行时 API base、CORS 白名单缺 `http://tauri.localhost`、`KE_PORT` 端口动态化、`attachmentUrl` 去重 6E P9、v1.0.0 版本策略）；3) 工程质量（补 test 脚本并接入 CI、日志体系、快照清理、包体积 1.94 MB）；4) 数据迁移（workspace 根迁到用户数据目录，软件级配置 `~/.knowledgeeditor/app_config.json` 已独立无需迁移，沿用 6E.2 方案）。附建议执行顺序。
- 新增 `docs/phase7-prep-freeze-check.md`：Phase 7 前冻结与稳定性检查。背景（6E 冻结基线 v0.6.0 之后 6U 叠加 8 个版本，契约以文档维护无代码校验）+ 8 项冻结契约对账（含信息块格式已修改为包裹格式、`update_article` 响应扩展为超集）+ 6E P1-P10 状态对账（P2-P5 已修复、P9/P10 留给 Phase 7、P1/P7/P8 待核对）+ 5 项稳定性检查（测试基线重跑、环境性修复稳定性、数据兼容路径文件级验证、启动/停止链路、契约校验兜底建议）+ 通过标准与结论。

影响范围：无代码变更；影响 `PROJECT_STATE.md`（下一步计划与文档索引已更新，指向两份新文档）。

验证：两份文档均已创建并经内容复查，与 `phase6e-report.md`（冻结清单 / 8.2 注意事项）、`phase6u-report.md`、`config.py`（KE_* 环境变量、`~/.knowledgeeditor/app_config.json`）、`client.ts`（相对路径 /api）、`ci.yml`（前端仅 build）交叉核对一致。

### Phase 7 前冻结与稳定性检查执行（phase7-prep-freeze-check 落地）

类型：Test
状态：Completed

现象：要求按 `docs/phase7-prep-freeze-check.md` 的通过标准实际执行冻结检查，作为 Phase 7 开工前的最后一道闸门。

原因：无（测试任务）。6E 冻结清单以文档记录维护、无代码校验，需在桌面化开工前对账。

修改：无代码变更。执行内容与结果：
- 代码核对：P1（`EditorArea.tsx` 自动/手动保存均调用 `registerRecoveryPoint`）、P7（`App.tsx` 徽章已为 "Phase 6"）、P8（`LeftSidebar.tsx` 已调用 `clearRecentDocuments`）三项待核对项均确认已修复；版本三同步 v0.7.3 一致；API 端点与 6E 清单逐项比对，46 项一致 + attachments 新增 1 个 `DELETE /api/attachments/{rel_path}`（v0.6.1 引入，属增量扩展）。
- 测试基线：`pytest -q` 102/102（1 条 Starlette 弃用警告）；`vitest run` 62/62；`npm run build` tsc 零错误、9.82s、exit code 0。
- 浏览器抽测（真实 Chrome + playwright-core）7/7：A1 旧自闭合格式打开渲染正常（0 页面错误）、A2 保存落盘为包裹格式且内容无丢失（真实文件级迁移验证）、B1 包裹格式 markdown 往返一致、C1 block 脚注、C2 plain 脚注、D1 保存后属性更新（created 不变 / updated 更新 / 元信息非「—」）、E1 拖拽文件插入附件节点。
- 启动/停止链路：`stop.ps1` 兜底路径（无 runtime.json 的遗留 backend 8000 + vite 5173 按端口+命令行特征停止）与正常路径（`start.ps1` 一键启动 → 页面可操作 → `stop.ps1` 按记录停止）均实测通过，停止后端口无残留。
- 环境性修复稳定性：dev server 冷启动预构建正常（`/`、`/repro.html` 均 200 无白屏）；`npm run build` 走 `ESBUILD_BINARY_PATH` 改名副本成功。

影响范围：无代码变更；`docs/phase7-prep-freeze-check.md` 回填执行结果与结论；`PROJECT_STATE.md` 更新（阶段状态、已知问题补充 4 项：P9 attachmentUrl、文件树 div 无 title、外部文件需重建索引、esbuild 副本的 CI 差异）。

验证：通过标准 4 条全部满足（契约对账有结论 / P1-P10 有明确去向 / 全量测试通过 / 版本三同步一致）。结论：冻结检查通过，Phase 7 可开工。测试产物（`Articles/freeze-check-legacy.md`、5 个拖拽上传附件）已清理，服务已停止。

### 出具冻结检查报告（phase7-freeze-check-report）

类型：Feature（文档）
状态：Completed

现象：要求参考 `docs/phase7-prep-freeze-check.md` 的检查标准，把冻结检查执行为正式报告。

原因：无（文档任务）。检查结果此前以「标准文档回填」形式存在，需按项目报告体系（`phase6e-report.md` / `phase6u-report.md` 风格）出具独立报告，供 Phase 7 决策与查阅。

修改：新增 `docs/phase7-freeze-check-report.md`，结构与 `phase6u-report.md` 对齐：头部元信息（阶段/日期/冻结基线 v0.6.0/复核基线 v0.7.3/范围）+ 10 个编号章节（检查概述与结论、检查标准与方法、冻结契约对账 8 项、6E P1-P10 对账、测试基线重跑、浏览器核心路径抽测 7 项、启动/停止与环境性修复、确认的既有行为、通过标准判定、结论与建议）+ 执行记录附注。数据与 `docs/phase7-prep-freeze-check.md` 回填结果一致（102 pytest / 62 vitest / build 9.82s / 浏览器 7/7 / 停止链路双路径）。

影响范围：无代码变更；`PROJECT_STATE.md` 文档索引新增该报告条目。

验证：报告数据与冻结检查执行记录逐项核对一致；与 `phase6u-report.md` 报告风格一致。

## 2026-08-10（Phase 7 规划周期）

### 出具 Phase 7 实施规划（phase7-plan）

类型：Feature（文档）
状态：Completed

现象：要求基于 Phase 7 提示词（Tauri 集成 / Sidecar 管理 / 设置系统 / Workspace 适配 / 桌面集成 / 数据迁移 / 构建安装包 / 发布前回归）作整体规划，参考 `docs/phase0-architecture.html` 体例，输出 .md 文件，且明确「先不要开工」。

原因：Phase 7 是工程性质最大的一次阶段跳跃，需在开工前把需求展开为可执行蓝图，统一技术选型、复用点、异常处理与里程碑验收。

修改：新增 `docs/phase7-plan.md`，体例对齐 `phase0-architecture.html`（封面元信息 + 目录 + 编号章节 + 决策点 + 附录）：15 个编号章节（阶段定位与边界、技术选型、总体架构含 mermaid 运行时图与生命周期状态机、7.1-7.8 各节方案、前端运行时适配、风险分析 R1-R10、里程碑 M0-M7）+ 决策点 D1-D7 + 附录 A 版本策略 / 附录 B 目录结构。复用点显式锚定现有资产：`/api/health` 握手、runtime.json 记录 schema、`start.ps1` 四段式流程、`stop.ps1` 端口+特征兜底；禁止项清单对应用户要求（不重实现 Phase 1-6 功能、不改 Markdown 格式与后端 API）。技术事实以 Tauri 2 官方侧车文档（`bundle.externalBin` + target triple 后缀 + `tauri-plugin-shell` 权限）与 NSIS/WiX 打包踩坑记录为依据。

影响范围：无代码变更；`PROJECT_STATE.md` 文档索引新增该规划条目；`docs/phase7-plan.md` 成为 Phase 7 实施时的总纲（与 `phase7-prep.md` 准备基线、`phase7-freeze-check-report.md` 闸门记录配套）。

验证：规划数据与冻结检查结果一致（42 端点基线、102/62 测试、esbuild 改名副本约束、1.94 MB 前端产物、30 份备份策略、`/api/index/rebuild` 存在）；章节覆盖用户提示词全部条目（7.1-7.8、版本要求、最终输出 8 项、开发记录要求）。

## 2026-08-10（Phase 7 M0 周期）

### 完成 M0：环境就绪 + Tauri 桌面壳脚手架

类型：Feature
状态：Completed

现象：Phase 7 需要 Rust 工具链与 VS Build Tools 作为 Tauri 编译前提，并创建 `desktop/` 工程；本机 rustup 安装被安全软件按路径拦截（`~\.cargo\bin` 硬链接创建失败，os error 1）。

原因：安全软件策略按目录路径拦截 NTFS 硬链接创建：`~\.cargo`、`~\.rustup`、D: 卷均拒绝，`%TEMP%` 与 `%LOCALAPPDATA%` 允许（A/B 测试确认）。rustup 内部依赖硬链接生成代理（rustc/cargo 等 14 个 exe），默认 home 目录下无法完成。

修改：
- 工具链：VS Build Tools 17.14.37（MSVC 14.44.35207 + Windows SDK 10.0.26100.0，含 `link.exe`/`rc.exe`）经提权静默安装；rustup 重定位 `CARGO_HOME=%LOCALAPPDATA%\cargo`、`RUSTUP_HOME=%LOCALAPPDATA%\rustup`（用户级环境变量已持久化），装得 Rust 1.97.1 stable（minimal profile）。
- 镜像：新增 `%LOCALAPPDATA%\cargo\config.toml` 使用 rsproxy.cn 稀疏索引（首次编译 Tauri 依赖数百 crate，直连 crates.io 过慢）；用户级配置不随仓库分发。
- 脚手架：新增 `desktop/` Tauri v2 工程（`src-tauri/Cargo.toml`、`tauri.conf.json`、`src/main.rs`、`src/lib.rs`、`capabilities/default.json`、占位图标全套、`package.json` 含 `@tauri-apps/cli`）。`tauri.conf.json` 关键项：`productName=KnowledgeEditor`、`frontendDist=../../frontend/dist`、`devUrl=http://127.0.0.1:5173`、`beforeDevCommand=npm --prefix ../frontend run dev`（相对 desktop/ 解析）、`bundle.targets=nsis`。
- 其他：`.gitignore` 追加 `desktop/target/`；`PROJECT_STATE.md` 增加架构约束 9（Rust 工具链重定位）。

影响范围：开发机 Rust 工具链位置（新终端经用户级 PATH 自动生效）；`desktop/` 为新工程目录；前端 `frontend/dist` 与 dev server 复用不变。

验证：`rustc 1.97.1` 编译 hello world 经 MSVC 链接成功输出（MSVC 链路 OK）；`cargo build` 通过生成 `knowledgeeditor.exe`（debug 12.6 MB）；`npx tauri dev` 冒烟通过——vite dev server 5173 返回 200，桌面窗口创建且标题为 "Knowledge Editor"，WebView2 渲染进程正常，停止后无残留。

### 确认 Phase 7 决策点并冻结实施规划（phase7-plan）

类型：Feature（决策）
状态：Completed

现象：要求「6 个决策点全部按默认进行」，更新规划文档后开工 M0。

原因：决策点确认是设计冻结的标志，之后实施不再变更；同时补入安装器目录选择与卸载数据保护两处此前核实的事实细节。

修改：`docs/phase7-plan.md` 更新 5 处：头部加「决策点 D1-D7 已全部确认，进入 M0」状态行；第 2 章安装包选型行与第 11 章 tauri build 步骤明确 `installMode: currentUser`（免提权、安装时可自选目录）；第 10 章安装程序约束补充 Tauri NSIS 卸载器「删除应用数据」复选框细节（默认不勾选，文案显式声明 workspace 保留，必要时 NSIS hook 剔除）；第 15 章决策点表改为冻结态（D1 Phase 0 已确认，D2-D7 六项按默认确认）。

影响范围：无代码变更；决策冻结后 Phase 7 按 `docs/phase7-plan.md` 执行，M0 开工。

验证：文档更新与已核实事实一致（Tauri NSIS 模板含 `MUI_PAGE_DIRECTORY`；`installMode` 三模式语义；卸载器 app data 复选框）。

## 2026-08-26（v1.0.1 修复批次：P0×4 / P1×17 / P2×20 / P3×21 / P4×13 全量执行）

### 依据：9 份独立审计报告整合清单（knowledge-editor-fix-checklist.md）

类型：Bugfix（阻断级：保存丢数据 / 整库删除 / 跨文档串内容）
状态：Completed（本地修复完成，未推送 GitHub）

#### P0 阻断级（4/4）
- P0-1 保存清空 frontmatter：后端 `update_article` 改无损合并（`merge_frontmatter` 原始行合并，含嵌套 YAML/注释）；前端 `withFrontmatter` 改合并语义仅更新 ke_version。回归：`test_p01_*` + fidelity P0-1
- P0-2 防抖窗口输入静默丢失：前端 per-doc 单飞保存队列（state/saveQueue）+ 统一 `requestOpenArticle` 入口（dirty 先 flush/confirm）+ beforeunload + Tauri 关窗握手（Rust emit `ke:close-requested` → 前端 flush → close()）
- P0-3 DELETE /api/fs/dir 整库删除：`safe_rel_path` 显式拒绝根路径等价输入（"."/""/"/"/"Articles/.."）；delete_dir/rename_dir/move 增加业务目录父级断言
- P0-4 切换文档 Ctrl+Z 跨文档串内容：`setKeContent` 清空 undo/redo 历史（prosemirror-history 状态重写）

#### P1 高优先（17/17）
打开即保存（emitUpdate:false）、HTML 注释/块保真（HtmlPassthroughExtension）、已知 kind 坏 JSON 兜底、表格 \| 转义/行内富文本/合并单元格禁用、module source 字段合并（含 kind）、保存单飞队列（乱序合并）、请求序号（openWithSeq/shouldAcceptSave）、外部修改 stale closure（articleIdRef）、SQLite RLock + 批量事务、API 路径白名单（doc/attachment/history/draft 负向矩阵）、删除前强制快照 + restore 重建已删文档、单实例插件 + 命令行校验杀进程、30s 运行时握手（ke:runtime-ready）、关窗 flush + recovery 目录扫描优先、SVG/HTML attachment 强转 + shell 权限移除 + 最小 CSP、CI 三重失效修复（master/跨平台 esbuild/Windows job/可复现构建+hash manifest）、symlink/Junction 递归越界（walk_files/walk_dirs 全链路替换）

#### P2 中等（20/20）
frontmatter 非完整 YAML（BOM/CRLF/嵌套对象无损）、非 UTF-8 422、快照同毫秒单调、快照失败不阻塞、上传/导入配额与 zip 实际字节计、重建单事务、设置死开关接线（restoreLastState/autoOpenRecentWorkspace）、错误状态区分（classifyLoadState）、WorkspacePicker 走 apiBase、release 日志落盘（logs/backend.log）、atomic_write fsync、settings/app_config 随机 tmp+锁、watcher 增量 reindex、草稿名含哈希防冲突、fs move/delete 附件引用保护、TrustedHost + KE_API_TOKEN、脚注 } --> 平衡匹配、保护目录大小写不敏感、崩溃重启重探测端口+整树杀+health 身份校验、上传后 mark_internal

#### P3 低优（21 项中 19 项落地）
Windows 保留名/尾点超长 slugify、增量索引校验（reconcile 签名）、搜索通配符转义+FTS 短语回退、外部删除当前文档、恢复检测重试+入口、workspace_create 文件路径 400、symlink 索引、restore 响应补元信息、frontmatter title 接线、导入引用改写仅命中字面量（代码块/URL 掩码）、buildFileTree memo、U+200B 保存剥除、测试 include .tsx、conftest 函数级隔离、OpenAPI schema 快照、拖拽插入竞态（shouldInsertDroppedFiles）、最近菜单动态化、运行时握手。
未落地（已注明）：P3-2 解析性能门槛（超线性解析）、P3-4 watcher 改 ReadDirectoryChangesW（保持轮询，性能项单独排期）。

#### P4 整理项（13 项中 11 项落地）
stable id（keStableId）、repro-main 移除、错误信息去绝对路径、requirements 版本锁定、签名脚本（KE_SIGN_CERT_THUMBPRINT 可选）、start.bat UTF-8、modules 含 .markdown、规范文档关系声明（P4-10）、~下标~ 说明、module source kind、大纲 Tab 实现。
未落地（已注明）：P4-2 深色主题仅 color-scheme 兜底（UI 主题工作量，单独排期）、P4-7 前端主包代码分割（mathlive/katex 拆 chunk，构建优化单独排期）。

#### 验证结果
- backend：157 passed / 2 skipped（symlink 需管理员权限，Windows 跳过）——含 41 个新增回归用例
- frontend：155 passed（20 文件）——含 85 个新增用例（fidelity 25 + state 58 + 其它）
- 桌面 Rust 改动未编译验证（本机无 cargo）：lib.rs/menu.rs/sidecar.rs/settings.rs 均经代码评审自查；PowerShell 三脚本语法校验通过；ke-vite.mjs 在 Linux 实跑通过

影响范围：前后端 + 桌面壳 + CI + 文档；数据格式（Markdown）无破坏性变化。

## 2026-08-27（v1.0.1 验证与收尾：编译验证 / 桌面冒烟 / P1-16 溯源消除 / 遗留项落地）

### 验证与发布收尾（阶段一）

类型：Verification（编译/冒烟/复跑）
状态：Completed（本地完成，未推送 GitHub）

- 阶段一.1 Rust 编译验证：Windows rustc 1.97.1(MSVC) 实机 `cargo check`/`cargo build` 全绿
  （发现并修复 settings.rs unique_tmp_path format! 参数不匹配 + menu.rs unused import；
  Cargo.lock 自动补入 tauri-plugin-single-instance 2.4.3）。日志见 cargo-check/build/build2.log。
- 阶段一.2 桌面冒烟（真实 GUI 会话，截屏 evidence-ke-window-v101.png）：
  ① 编辑→保存→重开→字节比较 PASS（生产 PyInstaller 侧车 v1.0.1，真实 workspace）；
  ② 双实例：第二实例 exit 0 即退，仅 1 个窗口；③ 慢启动握手：GUI 实机注入 api_base 成功 + 单元测试覆盖 5-15s；
  ④ stale PID：无关进程身份校验不命中→不杀；真实 backend 命中（PowerShell 实测）。
- 阶段一.3 P1-16 矛盾消除（方案 a）：预编译 exe 移出版本库（git rm --cached + *.exe/versions.json/manifest.sha256 gitignore），
  侧车 = 构建期产物（PyInstaller spec 为唯一来源）；新增 binaries/README.md 构建契约；
  版本一致性校验改为「运行时拉起 exe 查 /api/health 比对 __version__」（字节扫描对 PyInstaller 压缩 PYZ 失效，已弃用）。
- 阶段一.4 T0 端到端字节比较：pytest test_t0_e2e_save_reopen_byte_exact + vitest fidelity T0
  （title/tags/自定义键 + HTML 注释/块逐字节保留、幂等）。
- 阶段一.5 Linux 跨平台复跑：backend 160 passed/2 skipped（Windows 语义用例正确 skip）、
  frontend 178 passed/1 skipped、tsc 0、npm run build 成功；
  顺带修复 Linux 下 delete_dir 符号链接残留 bug（新增 walk_links/unlink_link，链接本体移除绝不触碰目标）。

### 遗留项（阶段二，全落地）

类型：Performance / FEATURE
状态：Completed

- P3-2 解析性能：定位=上游 @tiptap/markdown 二次复杂度（marked 21ms 线性/等价 HTML 280ms 线性/256KB 解析 4.4s、512KB 43s）；
  缓解=setKeContent 会话级解析缓存（256KB 重开 733-900ms）+ perf-bench.test.ts 门槛（首解析 ≤6s、缓存重开 <1.5s、KE_PERF_512=1 观测 512KB）。
- P3-4 watcher：空闲指数退避（1s→5s 封顶，next_backoff 纯函数 + 测试），空闲期全树 stat 频率降 80%。
- P4-7 代码分割：manualChunks（math/editor/react/vendor），主包 1.96MB→122KB（gzip 35KB）。
- P4-2 深色主题：[data-theme=dark] 完整 CSS 覆盖层（~50 工具类映射 + 编辑器/滚动条/hover 适配），applyTheme 解析 system→resolved 并监听系统切换。

验证：Windows/Linux 双平台 pytest 160/160 + vitest 178/178 + tsc 0 + npm build 成功；build.ps1 全链路（pytest→tsc/ke-vite→版本校验→manifest）在 Windows 实跑。
剩余说明：CI 未在本机触发（无 push）；Windows 侧侧车构建需本机平台 node_modules（@esbuild 平台二进制随安装平台），CI 各 runner 各自 npm ci 无此约束。

## 2026-09-02（v1.0.2：导出为普通 .md）

### 功能：导出为普通 Markdown（朴素降级，KE 方言 → 标准 Markdown）

类型：Feature
状态：Completed（本地提交 v1.0.2，未推送 GitHub）

- 新增 `frontend/src/editor/plain-export.ts`：`stripKeFrontmatter` / `downgradeKeNodes` / `plainMarkdown`
  - frontmatter：删 ke_version / ke-module 定义块，保留 title/tags/created/updated（删空移除整个 --- 块）
  - ke-note → `> **{label|title|信息}**{（author）}` + 内容逐行 `>` 前缀；ke-module → `> 模块：{name}`
  - ke-attach image → `![alt](src)` + 图注行；file / ke-video → `[title](src)` 链接
  - ke-footnote 行内 → `[^n]`（独立成行的位置型标记删除整行）；ke-footnotes 区域 → `[^n]: text` 按 n 升序、续行缩进 4 空格
  - `<!-- ke-version ... -->` 独立行删除；未知/损坏 ke-*、ke-NOTE 变体原样保留；HTML/公式/标准 Markdown 逐字节保留
  - 幂等（合并式 frontmatter）
- EditorArea「导出 ▾」新增第三项「导出普通 Markdown (.md)」；原第一项改名「导出 Markdown（KE 格式）」
- 测试：`plain-export.test.ts` 8 用例（六项断言 + GFM 渲染无残留验证）
- 文档：`docs/knowledge-editor-plain-export-design.md`
- 验证：vitest 186 passed / 1 skipped（22 文件）、tsc 0 错误、npm run build 成功；
  样式证据 `evidence-plain-export-sample.md`（公式/表格/脚注/图片/信息块样例降级后 GFM 渲染干净）
- 已知限制：附件相对路径引用（单文件不内联二进制）；ke-module 不做 inline 展开（v1 决策）

## 2026-09-04（v1.0.2a：导出菜单"点击无反应"热修复）

### Bugfix：导出保存改原生另存为（共享路径）

类型：Bugfix
状态：Completed（本地提交，未推送）

- 版本标记：v1.0.2a（发布/标签后缀；技术版本常量保持 1.0.2 —— `a` 为非 semver 后缀，Cargo/tauri/npm 不接受，且 CI 运行时版本校验与「三同步常量」要求全栈一致）。
- 根因：Tauri WebView2 下 `a[download]+blob` 为**静默下载**（无另存为弹窗/无完成提示），且同一会话第二次起的程序化下载被 WebView2 多下载策略静默丢弃（实测第 1 次落盘成功、第 2/3 次 downloadBlob 被调用但无文件落地）→ 用户体感"点击无反应"。
- 修复：新增 `import-export.saveOrDownload`（File System Access API `showSaveFilePicker` 原生另存为优先；AbortError 静默返回；否则回退 downloadBlob）；新增 `editor/export-actions.ts` 统一三种导出载荷（keExportPayload / plainExportPayload / packageExportAndSave）；EditorArea 三 handler 全部接入。
- 回归：`export-actions.test.ts` 6 用例（三模式各走正确保存路径与参数；picker 优先/取消/回退）。
- 验证：vitest 192 passed / 1 skipped（23 文件）、tsc 0、npm build ✓；WebView2 实机三模式真实点击均触发 showSaveFilePicker 且文件名正确。

## 2026-09-05（v1.1.0：UI/UX 重构正式发布）

### 里程碑完成：UI/UX 重构（设计令牌层 → 参考稿对齐 → 审查修复 → 正式发布）

类型：Feature（里程碑）
状态：Completed（v1.1.0-pre.1 审查 → 修复阻断 → 正式发布，本地与 GitHub Release 均完成）

现象：v1.0.2a 之后 UI 与设计参考稿差异大，经历多轮重构与审查后定版。

原因：用户要求按 `knowledge-editor-ui` 设计稿（editor/launcher/settings + handoff + colors_and_type.css）对齐前端 UI；随后两轮前端 agent 审查（视觉 + K3 对抗式）逐项修复；K3 判定"唯一阻断 = 版本源漂移"，修复后发布正式 v1.1.0。

修改（覆盖 9 个提交：5ee3102 → 778b791）：
- **批次 1A-1D**：语义令牌层（浅/深两套 + Tailwind `@theme inline` 桥接）+ 渲染前主题注入；三栏壳 AppShell/StatusBar；左栏（品牌块/搜索胶囊 Ctrl+K/QuickNav/模块区/数据主权页脚）；单行 40px 工具栏（正文▾/B/I/U/列表/引用/代码/链接/图片/公式×2/模块▾/代码块/注释/信息块/表格/撤销重做，左右滑不收起）；右栏三卡（属性/大纲/附件+孤儿引用徽章/历史快照）；NodeView 视觉（图片灯箱+图注、公式透明+双击、信息块圆角卡+徽章色板、模块 display:none 无边界、视频保留）；设置页整页（左分组 220px 锚点跳转 + 卡片式）；启动器卡片式（BrandHero+两操作卡+最近 3 条）。
- **工具**：`icons.tsx` 线性 SVG 集（~60 枚）；`slug.ts` 文件名 slug（对齐后端契约）。
- **主题**：Phase 2 自定义强调色（浅/深两套 + `accentColor` settings schema + `applyTheme` 覆写 `--primary`/`--sidebar-primary`/`--ring` + 派生 token `color-mix` 全链路跟随）；深色默认 #3b82f6（主理人拍板，非设计稿 #fc2c50；用户可在设置改）。
- **字体**：DM Sans（`@fontsource/dm-sans` 本地打包 400/500/700，主理人拍板引入）。
- **后端/壳**：`GET /api/modules` 增 `version`（批准变更）；新文档模板去掉自动 `# {title}`（标题由可编辑页眉承载，blur/回车同步 frontmatter title + 文件名 slug 重命名）；原生菜单补齐新建工作区/关闭/恢复检查/设置入口；`indexer._title_of` 防御数字 title（YAML `title: 111` 曾致 workspace open 500）；`slug` 保留名对齐（con.txt→_con.txt）。
- **审查修复（K3）**：RC-VERSION 版本源三处漂移（desktop/package.json、lock、WorkspacePicker 重复常量→import APP_VERSION）；F1 表格网格高亮类拼写 `bg-primary-soft0`→`bg-primary-soft`；F2 全局 `:focus-visible` 环 --ring（正文/搜索框蓝框随后修复：contenteditable 排除 + React state 驱动胶囊聚焦态）；版本源七处统一 1.1.0（Cargo/tauri/frontend/desktop/backend/version.ts/Cargo.lock，grep 零残留）。
- **v1.1.x backlog**：K3-I1/I2/T1/B1 延后项写 `docs/backlog-1.1.x.md`；构建环境备忘 `docs/tauri-build-env-notes.md`（WSL 挂载盘 symlink 坑 + NSIS 绕行方案）。

影响范围：前端全部 UI 层、后端 3 文件、桌面壳 menu.rs/settings.rs、新建文档模板；导出管线（plain-export/export-actions）零改动。

验证：
- 前端 vitest **205 passed** / 1 skipped（+8 slug 契约测试）；tsc 0；构建产物 `frontend/dist-build`。
- 后端 pytest 全绿；Rust 11 passed；导出专项 14 passed 且 diff=0。
- sidecar 运行时校验：独立拉起 `/api/health` = **1.1.0**（前后端版本告警消除）。
- GUI 实测：浅/深/自定义强调色三态；公式双按钮/保存按钮/未保存橙点/标签索引/无文档库/焦点环 #4285f4/F1 网格高亮 6 格；正文与搜索框无蓝框。
- 发布：GitHub Release **v1.1.0**（Pre 票 v1.1.0-pre.1 先行）附件四件套：sidecar exe、“KnowledgeEditor_1.1.0_x64-setup.exe”（NSIS 50.7MB，本机构建）、manifest.sha256、versions.json（81 项）；CI 三个 push 工作流 success。
- 版本一致性：远端 master = 本地 HEAD；v1.1.0 tag 与其构建产物一致（后续 ccd6814/778b791 为构建依赖与文档，不进 tag 语义正确）。

## 2026-09-05（v1.1.1-pre.1：新建文件夹入口修复预发布）

### 修复：左侧「文章」大栏目新增顶层「新建文件夹」按钮

类型：Bug 修复（UI）
状态：Completed（预发布，正式 v1.1.1 待安装包）

现象：左侧文件管理栏「文章」大栏目下原只有「新建文档」按钮；「新建文件夹」功能仅存在于文件夹行 hover 时的小图标，点击区域小、入口难发现，实际不可用。

原因：新建文件夹入口依赖 `group-hover:flex` 显示——功能本身（`create_dir` → `Articles/文件夹名` 后端 201）正常，但 UI 可达性差。

修改：
- 「文章」Section 动作区新增显式「新建文件夹」按钮（与「新建文档」并列，顶层 `Articles/` 下创建）——`handleNewFolder('Articles')`
- 文件夹行 hover 快捷按钮保留（子文件夹内快速创建文档/文件夹）
- SettingsPanel 标题徽标 `KnowledgeEditor v1.1.0 · Alpha` 硬编码 → 改 `import { APP_VERSION }`（消除展示层版本硬编码，防再漂移）
- 七处版本源统一 `1.1.1-pre.1`（Cargo/tauri/frontend/desktop/backend/version.ts/Cargo.lock）

影响范围：前端左栏 + 设置徽标；后端/导出/模块链路零改动。

验证：
- GUI 实测：点击「新建文件夹」→ prompt 拦截 → `Articles/测试夹-0905` 目录创建成功（后端链路 OK）
- 前端 vitest 205 passed / tsc 0；后端 pytest 全绿；导出专项 14 passed（三种导出 zero diff）
- sidecar 运行时校验 `/api/health` = 1.1.1-pre.1；manifest/versions 重新生成（81 项）
- Pre-release：GitHub **v1.1.1-pre.1**（三附件：sidecar/manifest/versions；NSIS 随正式 1.1.1 产出）
