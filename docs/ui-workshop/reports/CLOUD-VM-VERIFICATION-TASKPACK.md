# 云端 Windows VM 实机验收任务包（交付给 Codex 执行）

> 目的：把本地无法安全完成的 **I 类（安装/覆盖升级/回滚/卸载/重启）** 与 **安装态 UI 工坊冒烟**
> 放到**云端 Windows VM**（可快照、无真实用户数据）执行，回传证据后由 Lead 登记 W03/W08 与里程碑。
> **素材目录**：`docs/ui-workshop/reports/cloud-handoff/`；**一键打包**：`docs/ui-workshop/reports/cloud-vm-taskpack.zip`（约 4.9MB）

## 目录内容

| 文件 | 用途 |
| --- | --- |
| `cloud-handoff/TASKS.md` | **执行主文档**：环境、取代码、构建、U1–U6、安装态冒烟、证据回传、判定 |
| `cloud-handoff/README.md` | 最短路径命令 |
| `cloud-handoff/cloud_build.ps1` | 构建候选（默认 + workshop-enabled）与基线 v1.2.9 NSIS 安装包 |
| `cloud-handoff/cloud_verify_installed.py` | 安装态 CDP 冒烟（入口可见性/安装签名包/信任/启用 guest/会话 active） |
| `cloud-handoff/T27-I-results.schema.json` | I 门禁证据 JSON 结构（U1–U6 + verdict） |
| `cloud-handoff/ui-workshop.bundle` | `git bundle`（range `4c71233..refs/heads/feat/ui-workshop`，HEAD `689575b`，约 4.9MB） |

## 给执行方（Codex）的关键命令

```powershell
cd C:\ke-cloud\repo; git checkout 4c71233
git fetch C:\ke-cloud\ui-workshop.bundle 'refs/heads/feat/ui-workshop:feat/ui-workshop'; git checkout feat/ui-workshop
powershell -ExecutionPolicy Bypass -File C:\ke-cloud\cloud_build.ps1
python C:\ke-cloud\cloud_verify_installed.py --exe "<安装目录>\knowledgeeditor.exe" --expect-entry yes --pack-dir C:\ke-cloud\pack --pubkeys <json>
```

## 边界与红线

- 只在**快照 VM**执行；测试数据自建 `C:\ke-cloud\data`；不得使用真实笔记/真实用户目录；
- 不 push、不创建 Release；不改仓库提交；
- 安装包无 Authenticode 签名（P4-6 已知）→ 证据注明；
- 工坊默认关闭符合生产设计；workshop-enabled 包仅用于安装态验收；
- 任一步数据丢失/启动失败/回滚失败 = **FAIL**，附日志与截图。

## 回传与登记

回传 `C:\ke-cloud\evidence` zip（`T27-I-results.json`、`cloud-workshop-verify*.json`、U1–U6 截图、logs、
`P5-T26-T27-I-gate.md`）。Lead 登记 `validation-matrix.csv`（I 行）、W03/W08、`milestone-assessment.md`
与 `FINAL-DELIVERY-STATUS`，并复评里程碑是否可前进（需硬门禁全过 + 主理人授权发布）。
