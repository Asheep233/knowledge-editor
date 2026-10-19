# Windows VM 验收交接包（v2，2026-10-19 Linux 预检后修正版）

**当前状态：Linux 预检 PASS；Windows T27 I 门禁 / 安装态工坊冒烟 NOT_RUN（环境阻塞：只有 Debian，无 Windows VM）。**
本包由云端 Codex 在 Debian 上完成预检与脚本修正；修正版脚本的 Linux 回归 39 项通过（见 `preflight/script-validation.json`）。
**Windows 执行路径尚未实机验证**，必须按本文件在专用 Windows VM 中执行后回传证据，才能登记 I 门禁。

## 包内文件

| 文件 | 用途 |
| --- | --- |
| `sources.bundle` | 完整 Git 历史（含候选分支 `feat/ui-workshop` 与基线标签 `v1.2.9`），**无需外部基础提交** |
| `scripts/` | 修正版构建 / T27 / 安装态冒烟脚本 + 测试包准备脚本（版本与审计见 `preflight/`） |
| `tests/` | 脚本回归测试（39 项，Linux 已通过；Lead 本地复核 39/39） |
| `test-pack/` | 已签名的临时测试 guest（含候选参考包真实握手实现）+ **仅测试公钥**（不可作生产信任根） |
| `preflight/` | Codex Linux 预检证据：原 T27 结果（BLOCKED）、脚本校验、脚本审计、来源信息 |
| `TASKS.md` | 原始 Windows 验收任务文档（U1–U6 + B 段） |
| `T27-I-results.schema.json` | I 门禁证据 JSON 结构 |

## Windows 执行前提

- 专用 Windows 10/11 x64 VM，**先打快照**；管理员用户；只使用自建测试数据；不推送代码/不创建 Release。
- 安装：Git、**PowerShell 7（pwsh，必须）**、Node.js **24**、Python 3.10+、Rust stable
  `x86_64-pc-windows-msvc`、VS Build Tools（C++ 桌面工作负载）、WebView2 Runtime。
- 网络：npm / pip / crates / NSIS 首次下载可用。
- 说明：仓库构建脚本为 UTF-8 无 BOM 中文，**Windows PowerShell 5.1 可能解析失败，必须用 pwsh**；
  backend 依赖按 `backend/requirements.txt` 完整安装（构建脚本会创建独立 venv）。

## 1. 解压与取代码

```powershell
Set-Location C:\ke-cloud
git clone --branch feat/ui-workshop .\sources.bundle .\repo
git -C .\repo rev-parse HEAD            # 记录候选 commit（应为当前分支 HEAD）
git -C .\repo rev-parse 'v1.2.9^{commit}'
```

## 2. 构建三个安装包（基线 / 候选默认 / 候选 workshop-enabled）

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\cloud_build.ps1 -Repo C:\ke-cloud\repo
$manifest = Get-Content C:\ke-cloud\installers\build-manifest.json -Raw | ConvertFrom-Json
$baseline  = ($manifest.installers | Where-Object label -eq 'baseline-v1.2.9-default').path
$candidate = ($manifest.installers | Where-Object label -eq 'candidate-default').path
$workshop  = ($manifest.installers | Where-Object label -eq 'candidate-workshop').path
```

## 3. T27 I 门禁（先 dry-run，再仅在专用 VM 执行）

```powershell
python .\scripts\cloud_t27_gate.py --baseline $baseline --candidate $candidate --workdir C:\ke-cloud\t27-run
$env:KE_CLOUD_VM = '1'
$env:KE_CLOUD_SNAPSHOT_ID = '<实际 VM 快照标识>'
python .\scripts\cloud_t27_gate.py --baseline $baseline --candidate $candidate --workdir C:\ke-cloud\t27-run --vm-id $env:COMPUTERNAME --execute
```

- **请在交互终端运行**：U2 后脚本暂停，需人工完成 U3（工作区编辑保存、重开、打印导出、默认入口隐藏）
  并关闭候选窗口后才继续 U4；非交互运行会停在升级态（后续 not_run）。
- U3/U6 的人工语义无法由脚本独立签发 PASS，必须按 `TASKS.md` 补齐截图/文件/日志；详见 `--help`。
- 若中途退出：同 VM/workdir/安装包下用原命令 `--resume`（核对 runId/hash/版本/fixture，不重跑 U1/U2）。

## 4. 安装态工坊 B（另用快照或先卸载默认候选包）

```powershell
python -m venv C:\ke-cloud\smoke-venv
& C:\ke-cloud\smoke-venv\Scripts\python.exe -m pip install websocket-client psutil
$pubkeys = Get-Content C:\ke-cloud\test-pack\pubkeys.json -Raw
# 安装 $workshop 后（记录实际 exe 路径）；必须在交互桌面用户会话执行：
& C:\ke-cloud\smoke-venv\Scripts\python.exe .\scripts\cloud_verify_installed.py --exe $exe --expect-entry yes --pack-dir C:\ke-cloud\test-pack\pack --pubkeys $pubkeys --data-dir C:\ke-cloud\smoke-data --out C:\ke-cloud\windows-evidence\cloud-workshop-verify-enabled.json
# 再卸载启用版、安装 $candidate，做默认关闭反证：
& C:\ke-cloud\smoke-venv\Scripts\python.exe .\scripts\cloud_verify_installed.py --exe $exe --expect-entry no --data-dir C:\ke-cloud\smoke-data --out C:\ke-cloud\windows-evidence\cloud-workshop-verify-default.json
```

## 5. 人工补齐与回传

按 `TASKS.md` §4 补齐 U1–U6 截图/版本/数据 hash/文件树；证据打包：

```
C:\ke-cloud\windows-evidence\
  T27-I-results.json（按 schema，含真实 VM/快照信息与逐项结果）
  cloud-workshop-verify-enabled.json / cloud-workshop-verify-default.json
  U1..U6/（截图）、logs/、P5-T26-T27-I-gate.md（结论+缺口）
```

**红线**：快照 VM、自建数据、不 push/不 Release、失败保留 VM 现状与日志；任何未执行项如实 NOT_RUN。

## 已修正的原脚本问题（Codex 审计，详见 `preflight/script-audit.txt`）

1. T27 每次 launch 重写测试文件 → 数据丢失可能被掩盖（改为一次性 fixture + 内容 hash）。
2. U3 无条件自动通过（实际没执行）→ 保留人工补证、不自动签发 PASS。
3. 缺签名包/公钥时 still-pass → yes 流程强制签名包 + 公钥 + 信任/active/停用检查。
4. 异常不落结果 / 截图返回值被忽略 / 清理范围过宽 → 失败关闭、证据落盘、只清理自身进程树。
5. 构建脚本未固定候选 HEAD、未还原环境、CARGO_TARGET_DIR 外的包可能取旧 → 独立 worktree/target + 逐包溯源。
