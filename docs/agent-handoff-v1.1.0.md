# KnowledgeEditor 主 Agent 交接文档（v1.1.0 发布后）

> 交接时间：2026-09-05 | 交接方：主协调 agent（UI/UX 重构期间） | 接收方：下一任主 agent
> 状态快照：**v1.1.0 正式 Release 已发布**，工作区干净，远端 master = `31b3b55`

---

## 0. 一句话交接

项目处于 **v1.1.0（UI/UX 重构）正式发布后**的稳定状态：功能、审查（两轮：视觉 + K3 对抗式）、版本统一、NSIS/sidecar 产物全部闭环。下一阶段主任务 = **维护 1.1.x（backlog 四项）+ 按需继续 UI/功能迭代**，无紧急阻断项。

---

## 1. 事实基线

| 项 | 值 |
|---|---|
| 版本 | v1.1.0（Cargo/tauri/frontend/desktop/backend/version.ts/Cargo.lock 七处源一致） |
| 分支 | `master`（唯一远程分支，GitHub `Asheep233/knowledge-editor`） |
| HEAD | `31b3b55`（远端已确认，本地 origin 缓存可能陈旧——以 gh API 为准） |
| tag | `v1.0.2a`（旧）/ `v1.1.0-pre.1`（历史 pre）/ `v1.1.0`（正式，指 `98e041c`） |
| Release | https://github.com/Asheep233/knowledge-editor/releases/tag/v1.1.0 附件4件（sidecar exe / NSIS 安装包 / manifest.sha256 / versions.json） |
| 工作区 | `C:\Users\y8882\Documents\KE Workspace`（5 篇测试文档 + 111.md 已规范化） |
| 测试基线 | 前端 vitest 205 passed/1 skipped；后端 pytest 全绿；Rust 11 passed；导出专项 14 passed |
| 构建产物 | `frontend/dist-build/`（注意：不是 dist） |

## 2. 仓库结构速览

```
knowledge-editor/
├── frontend/            # React 19 + TS + Tiptap3 + Tailwind v4（@tailwindcss/vite）
│   ├── src/components/  # shell(壳) / editor(工具栏+nodeviews) / layout / settings / icons.tsx
│   ├── src/editor/      # Tiptap 扩展 + KE 方言序列化 + plain-export/export-actions（导出零改动红线）
│   ├── src/utils/slug.ts + slug.test.ts   # 文件名 slug（与后端契约一致）
│   └── dist-build/      # 构建产物（Tauri frontendDist 指向这里）
├── backend/             # FastAPI 侧车（PyInstaller 打包；__version__ 唯一版本源）
├── desktop/             # Tauri 壳（menu.rs 原生菜单 / settings.rs 设置 / Cargo.toml）
│   └── src-tauri/binaries/  # sidecar exe + manifest/versions（.gitignore，作为 Release 附件）
├── docs/                # 全部设计/Phase 报告/交接文档（见 §5 重点）
├── CHANGELOG_DEV.md     # 开发日志（v1.1.0 已登记）
├── README.md / PROJECT_STATE.md  # 已同步 v1.1.0
└── tauri-build-v110.log # 上次 NSIS 构建日志（可删）
```

## 3. 已完成主线（v1.0.2a → v1.1.0）

- **UI/UX 重构（9 提交 `5ee3102`..`9579775`）**：令牌层（浅/深 + `@theme inline` 桥接）→ 三栏壳 → 左栏/单行工具栏/右栏三卡 → 节点视觉（图片灯箱/公式/信息块/模块无边界）→ 设置/启动器页面 → 自定义强调色（浅深双套 + color-mix 派生）→ 参考稿对齐 + 三轮 agent 微调 → DM Sans 引入
- **审查闭环**：第一轮视觉审查（7 项修复）+ K3 对抗式审查（唯一阻断 RC-VERSION 已修；F1/F2/K3-V3 顺手修复）
- **发布链**：v1.1.0-pre.1（pre 票）→ 审查 → v1.1.0 正式（含 NSIS 本机构建成功、sidecar 运行时校验 =1.1.0、四附件上传）
- **文档**：CHANGELOG_DEV / README / PROJECT_STATE / backlog-1.1.x / tauri-build-env-notes 全部落库

## 4. 主理人拍板决策（不可回退，新 agent 必读）

| 决策 | 内容 |
|---|---|
| 深色强调色 | 默认 **#3b82f6 蓝**（参考稿 #fc2c50 为用户可自定义项，设置页可改；**勿改默认值**） |
| 模块无边界 | ke-module 必须 `display:none`（ModuleNodeView.tsx），任何微调不得加卡片/徽章/边框 |
| 导出零改动 | plain-export.ts / export-actions.ts 是红线：三种导出（KE/普通 md/zip）diff=0 维持 |
| 多标签 TabBar | 延后（不做）；工具栏单行左右滑，功能不收进折叠菜单 |
| 回收站 | 占位 disabled（延后） |
| 阴影 | 层级只靠边框，透明阴影（opacity 0） |
| DM Sans | 已引入（@fontsource 本地 400/500/700）；代价 +100KB 体积已接受 |
| 字体栈变化 | `--font-sans` 首项 DM Sans；无外部 webfont |
| 深色 `--border` | #333333 刻意保留（可辨识取舍，勿调暗） |

## 5. 可复用机制（新 agent 应立即掌握）

- **审查包**：`/mnt/d/KE Project/ke-ui-fine-tune.zip` 等（历史，已过时）；新审查建议直接 `git diff 4732c5c..HEAD` + `docs/*.md` + `frontend/dist-build` 截图
- **证据截图**：`/mnt/d/KE Project/*.png`（final-align / settings / launcher / note-style / search-focus 等）
- **GUI 验证流程**（重要，含坑）：
  1. `cd frontend && npm run build` → 产物 `dist-build/`（**不是 dist**；构建后看时间戳确认刷新）
  2. `touch desktop/src-tauri/src/main.rs` + `cmd.exe /c C:\ke-tmp\rebuild-gui.bat`（cargo build）
  3. `cmd.exe /c "D:\KE Project\run-gui-cdp.bat"`（WebView2 带 CDP 9222）
  4. CDP 脚本（参考 `/mnt/c/ke-tmp/check-*.py`）：ws://127.0.0.1:9222/devtools/page/<id>，Windows python `-X utf8`
- **sidecar 重建**：`backend && pyinstaller knowledgeeditor-backend.spec` → 拷到 `target/debug/` 与 `binaries/`（版本变更时必须；`/api/health` 与前端一致）
- **后端测试**：`cd backend && pytest -q`（Windows python）
- **Rust 测试**：`cmd.exe /c C:\ke-tmp\cargo-test.bat`（**先杀 GUI**，否则 PermissionDenied）

## 6. v1.1.x Backlog（已确认，非阻断）

| ID | 问题 | 优先级 |
|---|---|---|
| K3-I1 | indexer 增量更新不刷新扫描签名，reconcile 退化全量重建 | P1 |
| B1 | reconcile 签名判据（size+mtime_ns）等长同 tick 漏更 + flaky 测试 | P1（先修 flaky） |
| K3-I2 | rename/move 非原子无 fsync | P2 |
| K3-T1 | applyTheme 每次调用累积 matchMedia 监听器（内存泄漏） | P2 |

详见 `docs/backlog-1.1.x.md`（含拍板记录）。

## 7. 环境注意事项（新 agent 必读，全部踩过坑）

1. **WSL 挂载盘 symlink**：`/mnt/d` 上 npm 创建的 `node_modules/.bin/*` 是 symlink，**Windows cmd/node 不认**。前端构建用 WSL bash；`tauri build` 的 beforeBuildCommand 会因 `tsc` 不可执行失败——**完整方案见 `docs/tauri-build-env-notes.md`**（已验证：WSL 预构建 + 临时 no-op beforeBuild + cmd 跑 tauri）
2. **npm 平台判定**：WSL npm 判定 Linux → 装 tauri-cli 需手动下 win32 包（npmmirror，下载后**校验完整性**——曾因截断二进制排障浪费一轮）
3. **git push**：origin 直连无凭据，必须用带 token URL（`https://asheep233:$(gh auth token)@github.com/...`）；push 后本地 `origin/master` 不刷新——**以 gh API 为准**，勿误判
4. **commit 消息**：长中文+换行会触发工具校验失败（`missing required property description`）——用单行简洁消息
5. **workspace 误切换**：历史上曾误打开 `C:\Users\y8882\Documents`（上级目录）导致"文档不见了/标签空"假象——先 `GET /api/workspace/current` 确认 root
6. **旧文档双标题**：v0x-journey-report 等旧文件正文含 `# 标题`（模板修复前创建）——审查/验证新建文档时勿拿旧文件当双标题未修复证据

## 8. 发布流程剧本（后续版本照此）

1. 全量回归：vitest / tsc -b / build(dist-build) / pytest / cargo test（先杀 GUI）
2. 版本七处同步（Cargo/tauri/frontend/desktop×2/version.ts/backend）+ WorkspacePicker import（单一事实源）
3. sidecar 重建 + 运行时校验（独立拉起 `/api/health` = 版本）
4. manifest/versions 重新生成（`/mnt/c/ke-tmp/gen-manifest.py`，81 项；**NSIS 不入 manifest**）
5. NSIS：`docs/tauri-build-env-notes.md` 流程（WSL 预构建 → no-op beforeBuild → cmd tauri build → 恢复配置）
6. git tag（SemVer 语义）+ push（token URL）+ `gh release create`（附件：sidecar/manifest/versions/NSIS）
7. 文档三件套更新（CHANGELOG_DEV / README / PROJECT_STATE）+ backlog 归档

## 9. 未做/待办（诚实的缺口）

- **tag 与 master 差 1 提交**：v1.1.0 tag 指 `98e041c`（含蓝框修复+NSIS 产物），master 又多了 `ccd6814`(tauri-cli 依赖) / `778b791`(env notes) / `31b3b55`(docs)——均为构建依赖与文档，**判定不入 tag 语义正确**；如主理人要求 tag 前移可做（纯文档/依赖，不影响安装包）
- **NSIS 未实机安装验收**：本机构建成功 + sidecar 运行时校验过，但未在干净 Windows 环境装包走 7 步验收（建议下一轮补）
- **v1.1.0-pre.1 Release 未删除**：历史 pre 票留在 Releases（如需清理，`gh release delete v1.1.0-pre.1`）
- **workspace 测试文档**：5 篇测试文档（111.md 等）非真实内容，可清理
- **`tauri-build-v110.log`** 在仓库根（可删，不入 git）

## 10. 当前未决（有待主理人/下任）

- 无阻断。可选：tag 前移 / pre Release 清理 / NSIS 实机验收 / 1.1.x 迭代规划
