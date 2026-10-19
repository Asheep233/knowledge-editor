# P5-T26 W08/T27 证据（就绪检查，非 I 通过）：安装/覆盖升级门禁 dry-run — **NOT_READY（待授权+隔离环境）**

- 日期：2026-10-19 · 工具：`tools/run_t27_gate_check.py`（**只读 dry-run，绝不安装/绝不修改系统**）
- 原始结果：`evidence/T27-gate-readiness.json`
- 证据类型：**就绪检查（非 I 证据）**；W03/W08 的 I 门禁仍未执行

## 实测检查表（8 项，6 PASS / 2 FAIL 阻塞）

| 检查 | 结果 |
| --- | --- |
| T27-1 计划文档存在（T27-installer-upgrade-plan.md） | PASS |
| T27-2 打包目标 `nsis` | PASS |
| T27-3 版本号 = 1.2.18 | PASS |
| T27-4 历史安装包可用（覆盖升级旧版本） | PASS（28 个，含 1.2.5–1.2.9 等） |
| **T27-5 候选版本安装包存在**（`AstraNota_1.2.18_x64-setup.exe`） | PASS |
| **T27-6 主理人授权标志 `KE_T27_AUTHORIZED=1`** | **FAIL（未授权）** |
| **T27-7 专用隔离环境声明 `KE_T27_ISOLATED_ENV`** | **FAIL（未声明）** |
| T27-8 用户实例未运行（I 门禁禁止在用户机器直接执行） | PASS |

## 结论

- **I 门禁所需的产物已齐备**（候选 1.2.18 安装包 + 28 个历史安装包 + NSIS 打包配置），
  但**必须由主理人明确授权并提供专用隔离环境（VM/独立机器）**后才能执行安装/覆盖升级/回滚；
- 本脚本只读，不安装；W03/W08 的 I 证据仍为 **NOT_RUN**，不得以本文件冒充 I 通过；
- 授权后的执行顺序见 `reports/T27-installer-upgrade-plan.md`（U1–U6）。

## 若获授权，执行入口（计划）

```powershell
$env:KE_T27_AUTHORIZED='1'; $env:KE_T27_ISOLATED_ENV='<专用VM名称>'
# 在专用隔离环境内按 T27-installer-upgrade-plan.md U1–U6 执行并记录 evidence
```
