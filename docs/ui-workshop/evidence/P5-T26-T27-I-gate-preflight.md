# P5-T26 T27 I 门禁：云端 Linux 预检结果（Windows 执行仍 NOT_RUN）

- 来源：用户转交的 Codex 交接包 `ke-cloud-handoff.zip`（31,792,031 bytes，sha256 `c35662ee…`）
- 环境：**Debian GNU/Linux 13 x86_64（无 Windows VM）**；候选提交 `689575b`、基线 `47675b9`（v1.2.9）
- 结论：**Linux 预检 PASS；Windows T27 I 门禁（U1–U6）与安装态工坊冒烟（B）均 NOT_RUN/BLOCKED**。
  `T27-I-results.json` 的 `verdict: FAIL` 仅表示**门禁未通过（未执行）**，不是产品故障；
  `executionStatus: BLOCKED`、逐项 `NOT_RUN` 已如实标注，**不得登记为 I 验收通过**。

## 一、预检已执行（Linux）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原始增量 bundle 校验（基础 `4c71233`） | PASS | `preflight/provenance.json` |
| 完整 `sources.bundle`（含候选分支 + v1.2.9 tag，无外部基础前提） | PASS | Codex `source-bundle-verification.txt`；Lead 本地 `git bundle list-heads` 复核 |
| 前端测试 | 143 files / 1931 passed / 1 skipped | Codex `logs/frontend-tests.log` |
| 后端测试 | 841 passed / 6 skipped，pip check 通过 | Codex `logs/backend-tests.log` |
| 默认前端构建 | PASS（workshop/core-save 开关 false） | `build-default.json`/`build-flags.json` |
| workshop-enabled 前端构建 | PASS（两开关 true） | `build-enabled.json`/`build-flags.json` |
| create_pack / sign_pack 自检 | 各 5/5 PASS | `tool-selftests/` |
| 自签测试 guest | 资产 hash + Ed25519 验签 PASS；篡改拒绝；**无私钥** | `test-pack/verification.json`（Lead 复扫无 PRIVATE KEY） |
| 修正版脚本回归 | **39/39 PASS**（Lead 本地复跑确认） | `preflight/script-validation.json` |
| 包完整性 | **SHA256SUMS 64/64 PASS**（Lead 本地复核） | `SHA256SUMS` |

## 二、Codex 审计发现并修正的脚本问题（真实缺陷）

1. `cloud_t27_gate.py` 每次 launch 重写 fixture → 数据丢失可能被掩盖；改为一次性 fixture + 内容 hash 校验。
2. U3「工作区编辑保存/打印导出」曾无条件自动通过；修正版**不自动签发 PASS**，保留人工补证要求。
3. 缺签名包/公钥时 `cloud_verify_installed.py` 仍可通过；修正版 yes 流程强制签名包 + 公钥 + 信任/active/停用检查。
4. 异常不落结果、截图返回值被忽略、清理按 exe 路径波及他人进程；修正版失败关闭、证据落盘、仅清理自身进程树。
5. `cloud_build.ps1` 未固定候选 HEAD、未还原 checkout、只搜 repo 内 target 可能取旧包；修正版独立 worktree/target +
   逐包溯源 + 环境还原。
6. 文档层面：需 **PowerShell 7**（仓库构建脚本 UTF-8 无 BOM，PS5.1 可能解析失败）、Node 24、backend 完整 requirements。

## 三、Windows 项目仍未执行（NOT_RUN）

| 项 | 状态 | 仍需证据 |
| --- | --- | --- |
| U1 基线安装/启动 | NOT_RUN | 快照、旧版窗口/进程/版本/数据路径 |
| U2 覆盖升级 | NOT_RUN | 候选版本、启动、设置与同一份测试数据保留 |
| U3 升级后功能 | NOT_RUN | 工作区编辑保存重开、打印预览/导出、默认入口隐藏 |
| U4 回滚 | NOT_RUN | 卸载候选→装旧版、版本回退、数据仍可打开 |
| U5 卸载候选 | NOT_RUN | 程序目录清理、隔离 APPDATA/工作区保留 |
| U6 恢复/单实例 | NOT_RUN | 两次重启、无 crash/recover、单实例 |
| B 工坊启用包/默认反证 | NOT_RUN | 安装态入口、签名包、信任、guest active、停用、默认隐藏 |

## 四、交付给 Windows VM 的 v2 交接包

仓库内：`docs/ui-workshop/reports/cloud-handoff/`（`sources.bundle` **当前 HEAD 完整历史**、修正版 `scripts/`、
39 项 `tests/`、已签名测试 `test-pack/`、`preflight/` 证据、`READ ME.md` 执行说明）；
一键包：`docs/ui-workshop/reports/cloud-vm-taskpack.zip`（由 `tools/build_cloud_handoff.py` 生成）。

**下一步（唯一路径）**：在专用 Windows 10/11 VM（快照、pwsh 7、Node 24、Python venv、VS Build Tools、WebView2）
按 `cloud-handoff/README.md` 执行 → 回传 `windows-evidence` 包 → Lead 登记 I 门禁并复评里程碑。
