# T27 I 门禁 · 云端执行交接单（给云端 Codex）

> 目标：在**云端 Windows VM**（非用户日常机）执行安装 / 覆盖升级 / 回滚 / 卸载 / 重启，
> 产出 **I 类证据**，由 Lead 登记后更新 W03/W08 与里程碑。
> 当前状态：就绪检查 `evidence/T27-gate-readiness.json` = **NOT_READY(6/8)**，仅缺授权与隔离环境；
> 本文档 + `reports/T27-I-GATE-RUNBOOK.md` 是执行依据。禁止在用户日常机执行。
> 分支：`feat/ui-workshop`（本地开发分支；云端请从 GitHub `origin` 拉取对应 commit 或由 Lead 提供 bundle）。

## 1. 云端环境要求

| 项 | 要求 |
| --- | --- |
| OS | Windows 10/11 x64（虚拟机，可快照回滚） |
| 工具 | Node 20+/24、Rust stable + cargo、VS Build Tools（NSIS/Tauri 打包所需）、PowerShell 5.1+ |
| 隔离 | 全新 VM/全新用户目录；执行前快照；结束后销毁或回滚 |
| 网络 | 可访问 npm/crates 镜像与（如需）GitHub Releases |
| 授权 | 主理人已授权（记录授权来源/时间）；设置 `KE_T27_AUTHORIZED=1`、`KE_T27_ISOLATED_ENV=<VM 名称>` |

## 2. 获取/构建安装包

**候选版本（1.2.18 或工坊分支构建）**
```powershell
git clone https://github.com/Asheep233/knowledge-editor.git
cd knowledge-editor
git checkout <候选 commit，由 Lead 提供；本地分支 feat/ui-workshop HEAD>
# 单独 clone 后按仓库 README 构建（前端 + sidecar + NSIS）
cd desktop && npm run build        # = tauri build（NSIS 产物在 cargo target bundle/nsis）
# 产物：<CARGO_TARGET_DIR>\release\bundle\nsis\AstraNota_<version>_x64-setup.exe
```

**基线旧版本（覆盖升级起点）**：优先用同一构建流程 checkout 旧 tag（仓库有 `v1.2.5`…`v1.2.9`），
`cargo build --release` 后 `npm run build` 产出旧版安装包；或使用 Lead 提供的已有安装包哈希清单
（本地 `F:\Work\Dev\cargo-target\release\bundle\nsis` 有 28 个历史包，云端如无法获取则用 tag 自建）。

## 3. 执行步骤（U1–U6，完整命令见 `T27-I-GATE-RUNBOOK.md`）

| # | 动作 | 记录 |
| --- | --- | --- |
| U1 | 干净 VM 安装**旧版** → 启动 → 确认版本/无错误 | 截图+版本号+进程列表 |
| U2 | 安装**候选版**覆盖升级 → 版本/路径/设置/测试数据不丢 → 启动正常 | 截图+升级前后版本 |
| U3 | 升级后功能冒烟：打开工作区、编辑保存、打印、工坊入口（如启用） | 截图 |
| U4 | **回滚**：卸载候选→装回旧版（或安装器回滚）→ 数据可打开、版本回退 | 截图+数据校验 |
| U5 | **卸载**候选 → 程序目录清理、用户数据按策略保留（检查 `%APPDATA%\KnowledgeEditor`/工作区） | 文件树截图 |
| U6 | 升级/回滚后**重启 2 次** → 无 crash/recover 异常；单实例正常 | 启动日志/截图 |

**测试数据**：全部自建（如 `C:\t27-data\workspace` 写 `t27-test.md`），**禁止使用真实笔记**。

## 4. 证据交付格式（回传给 Lead）

```
docs/ui-workshop/evidence/T27-I-<YYYYMMDD>/
  U1-baseline-install/  *.png + version.txt
  U2-upgrade/           *.png + before-after.json
  U3-smoke/             *.png
  U4-rollback/          *.png + data-check.json
  U5-uninstall/         *.png + appdata-tree.txt
  U6-restart/           *.png + logs/
  T27-I-results.json    # 见下
  P5-T26-T27-I-gate.md  # 结论：PASS / PASS_WITH_FINDINGS / FAIL + 缺口
```

`T27-I-results.json` 建议结构（Lead 可直接登记矩阵）：
```json
{
  "generatedAt": "ISO8601", "environment": {"vm": "", "windows": "", "webview2": "", "authorizationRef": ""},
  "baselineVersion": "", "candidateVersion": "",
  "checks": [
    {"id": "U1", "name": "基线安装", "pass": true, "evidence": ["U1-baseline-install/setup.png"], "detail": {}},
    {"id": "U2", "name": "覆盖升级", "pass": true, "evidence": [], "detail": {"versionBefore": "", "versionAfter": "", "dataIntact": true}},
    {"id": "U3", "name": "升级后功能", "pass": true, "evidence": [], "detail": {}},
    {"id": "U4", "name": "回滚", "pass": true, "evidence": [], "detail": {"dataReadable": true}},
    {"id": "U5", "name": "卸载", "pass": true, "evidence": [], "detail": {"userDataPreserved": true}},
    {"id": "U6", "name": "重启恢复", "pass": true, "evidence": [], "detail": {"restarts": 2}}
  ],
  "verdict": "PASS",
  "notes": []
}
```

## 5. 红线（云端同样适用）

- 禁止在真实用户机/有真实数据的环境执行；禁止使用真实笔记；
- 失败/回滚失败/数据丢失 = FAIL，如实记录并附日志/截图；
- 不 push、不创建 Release；
- 完成后由 Lead 复核证据并更新 `validation-matrix.csv`、W03/W08、`milestone-assessment.md` 与交接文档。
