# 云端 Windows VM 实机验收任务包（给 Codex）

目标：在**云端 Windows VM**（可快照、无真实用户数据）对 UI 工坊分支做两类实机验证：
- **A. T27 安装/覆盖升级/回滚/卸载/重启 I 门禁**（ACCEPTANCE I 类证据；本地 W 证据不能替代）
- **B. 安装态 UI 工坊冒烟**（workshop-enabled 安装包：入口/安装签名包/信任/启用 guest/会话 active；
  并验证生产默认（workshop-off）安装包入口隐藏）

> 红线：只在快照 VM 执行；测试数据自建；不 push、不创建 Release；不使用真实笔记；失败如实记录。

## 0. 素材（本目录）

| 文件 | 说明 |
| --- | --- |
| `ui-workshop.bundle` | `git bundle`（range `4c71233..feat/ui-workshop`，需基础提交 4c71233 已存在） |
| `cloud_build.ps1` | 构建脚本：checkout 基础/分支、构建 sidecar+前端、产出 NSIS 安装包（默认/workshop-enabled） |
| `cloud_verify_installed.py` | 安装态 CDP 冒烟（入口可见性/安装包/启用 guest/会话 active） |
| `cloud_t27_gate.py` | **可选自动化**：U1–U6 安装/升级/回滚/卸载/重启 + 截图 + `T27-I-results.json`（默认 dry-run；仅 VM 加 `--execute`） |
| `T27-I-results.schema.json` | I 门禁证据 JSON 结构（回传时按此填写） |
| `README.md` | 快速步骤与回传格式 |

## 1. 环境

- Windows 10/11 x64 VM（可快照）；管理员权限；WebView2 Runtime（Win11 自带）
- Git、PowerShell 5.1+、Node.js **20+/24**、Python **3.10+**（`pip install pyinstaller websocket-client requests`）
- Rust stable + cargo（`rustup`）、VS Build Tools（C++ 桌面工作负载）、NSIS（`tauri build` 首次会自动下载）
- 工作目录建议 `C:\ke-cloud`；所有测试数据在 `C:\ke-cloud\data`

## 2. 代码获取

```powershell
cd C:\ke-cloud
git clone https://github.com/Asheep233/knowledge-editor.git repo
cd repo
git checkout 4c71233            # 基础提交（v1.2.18）
git bundle verify C:\ke-cloud\ui-workshop.bundle
git fetch C:\ke-cloud\ui-workshop.bundle 'refs/heads/feat/ui-workshop:feat/ui-workshop'
git checkout feat/ui-workshop    # 可选：git log --oneline -1 记录 HEAD
```

## 3. 构建安装包

见 `cloud_build.ps1`；也可手工：
```powershell
cd C:\ke-cloud\repo
.\scripts\build.ps1              # backend 测试 + PyInstaller sidecar + frontend 生产构建(dist-build)
cd desktop; npm ci; $env:CI='true'; npm run build   # NSIS 安装包（默认，workshop 关闭）
# workshop-enabled（用于 B 段冒烟）：
$env:VITE_KE_WORKSHOP='1'; $env:VITE_KE_CORE_SAVE='1'
cd ..\frontend; npm run build; cd ..\desktop; npm run build
# 产物：<CARGO_TARGET_DIR or target>\release\bundle\nsis\AstraNota_<version>_x64-setup.exe
```
基线旧版（U1 用）：`git checkout v1.2.9` → 同样构建（默认生产包即可）。

## 4. A. T27 I 门禁（U1–U6）

> 可手工执行，也可用自动化（先 dry-run 核对版本，再在专用 VM 执行）：
> ```powershell
> set KE_CLOUD_VM=1
> python C:\ke-cloud\cloud_t27_gate.py --baseline C:\ke-cloud\installers\baseline-v1.2.9-default_x64-setup.exe ^
>   --candidate C:\ke-cloud\installers\candidate-default_x64-setup.exe --workdir C:\ke-cloud\t27 --execute
> # 产出 C:\ke-cloud\t27\evidence\T27-I-results.json + U1..U6 截图 + logs
> ```
> 安全：默认 dry-run 只读；未设置 `KE_CLOUD_VM=1` 时 `--execute` 会被拒绝。

| 步骤 | 操作 | 记录 |
| --- | --- | --- |
| U1 | 快照 VM → 安装**旧版** v1.2.9 → 启动 → 记录版本/进程/数据目录 | 截图+版本 |
| U2 | 安装**候选版**（默认生产包）覆盖升级 → 版本/设置/测试数据（自建 workspace）不丢 → 启动 | 升级前后截图 |
| U3 | 升级后冒烟：打开 workspace、编辑保存、打印预览/导出、工坊入口（默认应隐藏） | 截图+文件 |
| U4 | 回滚：卸载候选 → 安装旧版 → 数据仍可打开 | 截图+数据校验 |
| U5 | 卸载候选 → 程序目录清理、`%APPDATA%\KnowledgeEditor` 数据保留（策略） | 文件树截图 |
| U6 | 升级/回滚后重启 2 次 → 无 crash/recover 异常；单实例正常 | 日志/截图 |

## 5. B. 安装态 UI 工坊冒烟（workshop-enabled 安装包）

1. 安装 workshop-enabled 候选包（**独立 VM 快照或先卸载默认包**）。
2. 准备隔离数据与测试工作区：
   ```powershell
   $env:APPDATA='C:\ke-cloud\data\appdata'
   $env:KE_WORKSPACE='C:\ke-cloud\data\workspace'
   # 预置 workspace/Articles/a.md 与 %APPDATA%\KnowledgeEditor\{app_config.json,settings.json}
   ```
3. 用 `cloud_verify_installed.py --exe "<安装路径>\knowledgeeditor.exe" --expect-entry yes` 启动并做 CDP 冒烟：
   - 工坊入口可见（workshop flag 生效）；
   - `workshop_pack_install` 安装本目录生成的签名测试包（先用仓库 `tools/create_pack.mjs`+`sign_pack.mjs` 生成，公钥经 `KE_WORKSHOP_PUBKEYS` 注入）；
   - 打开面板→授予信任→启用 guest→`workshop_session_status=active`；
   - 退出并检查无残留进程。
4. **反证**：用默认生产包重复 `--expect-entry no` → 入口不可见（工坊默认关闭）。
5. 可选：VM 显示缩放 100%/150%/200% 下启动，编辑/选区/光标是否正常（DPI 实机项；非人工 IME）。

## 6. 证据回传（打包发回 Lead）

```
C:\ke-cloud\evidence\
  T27-I-results.json          # 按 T27-I-results.schema.json 填
  cloud-workshop-verify.json  # cloud_verify_installed.py 输出（A/B 两次）
  U1..U6/                     # 每步截图（PNG）+ 版本输出
  logs/                       # 安装/启动日志、%APPDATA%\KnowledgeEditor 文件树
  P5-T26-T27-I-gate.md        # 结论 PASS / PASS_WITH_FINDINGS / FAIL + 缺口
```
把 `C:\ke-cloud\evidence` 打 zip 回传；Lead 负责登记矩阵/W03/W08/里程碑。

## 7. 判定

- 任一步数据丢失/启动失败/回滚失败/升级后不可用 = **FAIL**，附日志与截图；
- 安装包未签名（无 Authenticode）属已知（P4-6），不影响 I 门禁判定，但需在证据注明；
- 工坊功能默认关闭（生产包）符合设计；workshop-enabled 包仅用于 B 段验收，不作为发布默认。
