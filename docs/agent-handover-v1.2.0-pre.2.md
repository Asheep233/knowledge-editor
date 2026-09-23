# AstraNota（旧名 KnowledgeEditor）主协调 Agent 交接文档 · v1.2.0-pre.2

> 生成：2026-09-20（Lead） | 上游交接：`docs/agent-handover-v1.1.8.md`
> 用途：给**下一任主协调 agent** 的状态基线、规矩与坑。读这一份即可接手。

---

## 0. 一句话现状

**v1.2.1 补丁版已发布（Latest）**（`1.2.0-pre.1`、`1.2.0-pre.2`，Latest 仍是 `v1.1.9`）；
**下一步是第 3 步「大规模全量审查」（明确不由 Lead 执行）**，通过后才有 `1.2.0` 正式版。

| 项 | 值 |
|---|---|
| 仓库 | `F:\Work\KE Project\knowledge-editor`（WSL: `/mnt/f/Work/KE Project/knowledge-editor`）· 分支 `master` |
| 远端 | https://github.com/Asheep233/knowledge-editor |
| 当前版本 | `1.2.1`（**补丁版已发布，Latest**）（发布前全面审查 B1-B5/M1-M8/U4 修复 + 对抗验证 R-1…R-4b + 真机发现的退出挂死与 Ctrl+Q 加速键问题；`node scripts/bump-version.mjs <ver>` 维护） |
| 最近发布 | `v1.2.0-pre.2`（Pre-release，2026-09-20T03:17:28Z，四附件）· `v1.2.0-pre.1`（Pre-release）· `v1.1.9`（Latest 正式版） |
| 应用安装位置（主理人机器） | `D:\AstraNota`（覆盖安装即可，数据目录 `%APPDATA%\KnowledgeEditor` 与工作区 `C:\Users\y8882\Documents\KE workspace` 不受影响） |
| 门禁基线（**任何改动不得低于**） | pytest **630 passed + 2 skipped** · tsc **0** · vitest **56 files / 1095 passed + 1 skipped**（+ 待实现的 verifier todo）· cargo **20** |

## 1. v1.2.0 已交付内容

**pre.1**：① 自定义快捷键（42 动作、既有键位零改动、真实 handler 注册）② 公式编辑光标（行内→公式后 / 块级→既有段落行首 / 只读态零事务）③ Tab 栏（左优先关闭、脏标记、非激活关闭零文档请求）④ F-1…F-5 保真修复（任务列表 / 行内 HTML / 实体 / BOM / 换行）+ 导出保真。

**pre.2**：**源码模式 MVP**（工具栏切换 + `<textarea>` 直编 Markdown 原文 + **字符串直存**保存 + frontmatter 隐藏 + 切视图自动保存 + 未知语法改动提示 + 单视图排他）
+ **D-1** 混排列表紧凑、**D-2** 嵌套未知标签、**EDGE-1** 空 frontmatter、**ADD-1** 两条内容丢失、**ADD-2** 有序任务项、**ADD-4** 合法 frontmatter 误拒回归、**SRC-1** 源码初值落后、**U+200B** 静默删除。

## 2. 下一步（第 3 步）

1. **大规模全量审查**（主理人明确：**不由 Lead 做**）——建议覆盖：全量代码审查、依赖与安全、数据格式兼容（旧文档读取）、跨平台/长文档性能、GUI 目视矩阵、发布流程可重复性。
2. 审查发现的问题按既有规矩处置（每报必修 + 独立验证）。
3. 通过后：`bump-version.mjs 1.2.0` → 打包（预发布流程去掉 `--prerelease`，正式版加 `--latest`）→ 更新 `docs/release-acceptance-checklist.md`。
4. **正式版前仍缺**：干净 Windows 首装演练（清空 `%APPDATA%\KnowledgeEditor`）、导出四件产物字节校验在新版本上的复跑。

## 3. 关键文档地图

| 文档 | 用途 |
|---|---|
| `docs/document-format.md` | **D 层规范**：§2.6 保真契约（含 D-3/D-4/D-5 声明）、**§6 编辑通道与视图**（源码模式 9 条硬性契约 + §6.2.1 边界 + §6.2.2 重载语义） |
| `docs/design-1.2.0-plan.md` | 1.2.0 三步走 + 11 条裁决 + pre.1/pre.2 执行状态 |
| `docs/design-1.2.0-source-mode.md` | 源码模式实施契约（含 textarea 换行陷阱、U+200B、混合 EOL 声明） |
| `docs/backlog-1.1.x.md` | 裁决记录 + **收口状态表（15 项：已修 12 / 保持现状 1 / 已声明限制 2）** |
| `docs/analysis-1.1.10/{shortcuts,math-cursor,source-mode}.md` | 三路只读分析（**注意 source-mode §4.1 数字已过期，见文档顶部提示**） |
| `docs/verification-*.md` | 五份独立验证报告（保真/source-mode/公式光标/快捷键+Tab/设置页高亮） |
| `docs/markdown-extension-spec.md` | `ke-*` 方言规范（P2 已澄清：工具不得**自动**改写未知标记；源码模式下用户主动改写属授权） |
| `docs/release-acceptance-checklist.md` | 发布验收清单（已更新到 pre.2 基线，含实际证据） |
| `CHANGELOG_DEV.md` | 每个版本的发布记录（内容/门禁/验证/冒烟/已知问题） |

## 4. 环境与工具（Windows 宿主 + WSL 开发）

- WSL 下 **没有 `python` 别名**，用 `python3`；Windows 侧 Python：`/mnt/c/Users/y8882/AppData/Local/Python/pythoncore-3.14-64/python.exe`
- `gh.exe`：`/mnt/c/Program Files/GitHub CLI/gh.exe`（参数里的路径必须是 **Windows 路径**）
- cargo：`/mnt/f/Work/Dev/cargo/bin/cargo.exe`；`CARGO_TARGET_DIR=F:\Work\Dev\cargo-target`（仓库内**无** target）
- CDP 探针：端口 **9333**，脚本 `C:\ke-tmp\cdp-eval.py`（用 Windows python 跑）；启动 GUI 时设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333 --remote-allow-origins=*'`
- 打包脚本：`C:\ke-tmp\rebuild-nsis.sh`、`C:\ke-tmp\rebuild-exe.sh`（临时把 `beforeBuildCommand` 换成 no-op，trap 还原并**逐字节校验还原**）
- 清单生成：`C:\ke-tmp\gen-manifest.py`（产出 `desktop/src-tauri/binaries/{manifest.sha256,versions.json}`）
- 截图目录：`D:\KE-Project-shots\`

## 5. 坑（血泪版）

1. **React #300**：NodeView 是**独立 React 根** —— 任何要改文档的 UI 必须放在 EditorArea 层，别在 NodeView 里做。
2. **Rust `from_value_lenient` 白名单**：新增设置字段必须**三处同步**（`settings.ts` → IPC → `settings.rs` 结构体 + 白名单），否则 IPC 返回 null、设置**静默失效**（已有守门测试）。
3. **Tiptap 版本**：实际 `3.31.3`（分析文档里的 3.29.2 已过期）；升级前看 `docs/dependency-compatibility.md`。
4. **npm 依赖**：加包用 `npm install --package-lock-only --save <pkg>@^x.y.z`（不要 `npm install` 全量），保证 lock 与 package.json 一致；已踩过「只靠传递提升 → 换 node-linker 即构建失败」。
5. **换行**：编辑器内部**恒 LF 无 BOM**；磁盘写入靠 `applyDocTraits(captureDocTraits(raw))` 还原。`<textarea>` 的 value 会被 DOM 归一为 LF → **源码模式保存必须显式还原**（否则等于重新引入 F-5）。
6. **frontmatter**：`stripFrontmatter`/`frontmatterBlockOf`/`withFrontmatter` 三函数必须**行为一致**（共享 `scanFrontmatter` 行扫描）；开块判定要容忍首行空行与顶层序列，同时不得把「行首 HR + 正文 + 行尾 HR」当 frontmatter（否则**整篇丢失**，历史真事故）。
7. **验证要冻结**：给验证方 sha 前确认**没有在飞写任务会碰同批文件**；否则验证结论作废（已踩过）。
8. **文本默认规则**：`window.alert`/`askConfirm` 等对话框在自动化下不可点，验收脚本要么避开要么用 CDP 处理。
9. **WebView2 焦点下原生菜单加速键可能不送达**（2026-09-20 真机发现，用户报「Ctrl+Q 没反应」）：
   原生菜单（muda）定义的 `Ctrl+Q`/`Ctrl+R` 在 WebView 获得焦点时**不保证**触发 `on_menu_event`；
   `Ctrl+R` 还会被 WebView2 当**浏览器加速键**自行刷新（看起来"正常"，实则跳过我们的 flush 握手，
   会丢尾部防抖内容）。**结论：桌面壳的全局快捷键必须在 WebView 层再兜一层**
   （见 `frontend/src/desktop.ts::setupNativeShortcutFallback` → `invoke('app_request_exit'|'app_request_reload')`，
   与菜单共用同一个 Rust 握手函数）。
10. **退出路径禁止同步阻塞调用**：`cleanup_on_exit` 里**不要**放 PowerShell/WMI 查询（曾导致
   「窗口已隐藏但进程不退出」的假死）—— 清理必须放独立线程 + 有界预算，主线程之后**无条件** `app.exit(0)`。
11. **`#[tauri::command]` 要放在子模块**：在 crate 根（lib.rs）定义命令又被同文件的 `generate_handler!`
   注册，会触发 `__cmd__*` 宏重名（E0255）。放进 `menu`/`settings`/`sidecar` 等子模块并用 `模块::命令` 注册。
12c. **悬浮菜单/浮层必须显式给宿主定位上下文**（2026-09-22 用户报「点 ⋮ 没反应」）：
   公式互转菜单用 `absolute right-0 top-full`，而 `.ke-math` 没有 `position` → 菜单锚到最近的
   定位祖先（`.ProseMirror{position:relative}`）→ 实测被放到 (1090, 2078)（**视口外**），
   用户看到的就是「点了没反应」。修法：`.ke-math{position:relative}`。
   **验收方法学**：`element.click()` 不校验命中位置，会漏掉这类问题 —— 必须用
   **真实鼠标事件（mousePressed/Released）+ 断言目标 rect 在视口内**（本仓库的
   `C:\ke-tmp\probe-moremenu.py` 是现成模板）。
12b. **大块编辑面的 focus 环**：`index.css` 有一条全局 `:is(button,a,input,select,textarea):focus-visible
   { outline: 2px solid var(--ring) !important }`（F2/K3 无障碍回退）。WebView2 下**鼠标点击也会匹配
   `:focus-visible`** → 大块编辑面（正文编辑器、源码模式 textarea）会出现「凭空一圈蓝框」。
   正文用 `.ke-editor-prose{outline:none}` 豁免，源码模式用新增的 `.ke-source-textarea` 同口径豁免 ——
   **以后新增任何大块编辑面都要按此豁免**（用户对这类视觉问题很敏感，已两次回报）。
12. **`capabilities/*.json` 必须是纯 JSON**（不能有 `//` 注释）——含注释会让 `tauri-build` 直接 panic；
   而 `rebuild-nsis.sh` 的 tail 输出**会掩盖**这类失败：**构建后务必核对产物大小/资源名变化**，
   并确认 GUI 已关闭（否则 `tauri-build` 报 PermissionDenied 静默失败，容易拿旧产物当新构建验证）。

## 6. 流程规矩（沿用，别省）

1. **改 D 层（`ke-*` 格式 / Markdown 单源语义）先改规范**，再改实现。
2. **B 层标识冻结**：`com.knowledgeeditor.desktop`、`%APPDATA%\KnowledgeEditor`、`knowledgeeditor.exe`、sidecar 名 —— 不可改。
3. **每报必修**：任何报告的问题（含验证方发现的）都要有证据的修复或明确降级声明，不许「无法复现」敷衍。
4. **独立对抗验证**：实现者与验证者分离；验证方复算冻结 sha、跑真实命令、给 PASS/FAIL + 未验证项；发现 FAIL 立即上报而非自行改源码。
5. **视觉判断归主理人/Lead**：用 CDP 截图 + 目视，别只信断言。
6. **发布剧本**：bump → 前端构建（核对 dist 版本串）→ 侧车重建（**版本串必须同步**，否则版本不一致横幅）→ NSIS（绕 `beforeBuildCommand`）→ manifest → GUI 验收 → tag + push + `gh release create`（预发布加 `--prerelease`）。
7. **打包前问主理人**（他要求过在打包前停一下）。
8. 主理人偏好**短句决策**、要**如实报告**（含失败与未验证项）、讨厌粉饰。
