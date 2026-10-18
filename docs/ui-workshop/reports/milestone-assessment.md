# UI 工坊里程碑评估（按 ACCEPTANCE.md A 节口径）

- 日期：2026-10-19 · 代码基线：分支 `feat/ui-workshop`（本地，未推送/未 Release）
- 结论：**`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包可用；隔离/离线/恢复仍有未通过项与残余风险）
- 明确**不**声明：`IMPLEMENTED_WINDOWS_PENDING` 已完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`

## 1. 判定依据

ACCEPTANCE A 节：
- `EXPERIMENTAL_TRUSTED_PACKS`：**只允许受信实验包；隔离、离线限制或恢复仍有未通过项**。

本实现现状与之一致：
- **只允许受信包**：T24 信任等级强制（community 能力不允许 → `E_CAPABILITY_TIER` 拒绝启动 guest，
  产品 W 已验证）；安装验签（篡改/撤销 → 拒绝安装）；签名/信任 UI 与 TrustStore 可用；
- **隔离**：guest 独立 origin（`http://workshop.localhost`）已成立；但 guest 仍可见
  `__TAURI_INTERNALS__`（invoke 实测 timeout、当前不可利用）→ **残余风险未通过**；
- **离线**：包为本地离线目录安装/加载；zip 离线包/多包格式未完成（W01 部分 NOT_RUN）；
- **恢复**：启动 recover/safeMode 产品级 W 9/9；但 W03（包与私有状态回滚）I 门禁、W07 原生故障
  恢复 I 门禁未执行；
- **Windows 实机**：A1–A8 均已真实产品壳 W 通过（smoke/A2 打印/A3 recover/A4+A6/A5 UI/A7+A5 guest/
  A8 保存/IME-DPI/A7 隔离）。

## 2. 已通过（证据索引）

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| P0 原型五切片 | ✅ W/U/A | `P0-S1/S2/S4`、S3/S5 pytest、ADR-001 |
| 协议/传输/包隔离 | ✅ 原型 W + Core U | `P1-T10/T11/T18`、`P3-T19-*` |
| 产品 Core 保存 flag | ✅ 产品 W 9/9 + 字节一致 e2e 12/12 | `P5-T26-A8-save`、`P2-T14-byte-consistency` |
| 签名/信任/安装生命周期 | ✅ 产品 W（A4+A6 16/16、A5 11/11） | `P5-T26-A4-A6-install`、`P5-T26-A5-ui` |
| 产品 guest 宿主（A7/A5） | ✅ 产品 W 11/11 + 隔离核对 5/5（残余风险已记录） | `P5-T26-A7-A5-guest`、`P5-T26-A7-isolation` |
| 打印（隐藏 renderer） | ✅ 产品 W 9/9 | `P5-T26-A2-print` |
| 启动 recover/safeMode | ✅ 产品 W 9/9 | `P5-T26-A3-recover` |
| IME/DPI（自动化路径） | ✅ 产品 W 7/7（人工真实 IME 未做） | `P5-T26-ime-dpi` |
| 回归基线 | ✅ 前端 1809/后端 847/cargo 44/W 13/13 | `P6-final-verification`、`validation-matrix.csv` |

## 3. 未完成 / NOT_RUN（阻止更高状态）

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| 真实人工系统 IME / 多 DPI | NOT_RUN | 需人工中文输入法与多显示器实测 |
| W08 覆盖升级/降级/兼容（I 证据） | NOT_RUN | 计划与命令已备：`T27-installer-upgrade-plan.md` |
| W01 ZIP 离线包/ZIP bomb/多资源完整性 | FAIL/部分 | 未实现 zip 安装与 bomb 防护 |
| W02 表单交接（IME/title/tags/公式草稿跨 UI） | NOT_RUN | 产品 guest 未接正式编辑器表单桥 |
| W03 包与私有状态回滚 | NOT_RUN | Core 有 store/recover，U 级；I 门禁未做 |
| W04 SDK 外部独立开发模板/CLI | NOT_RUN | 未提供外部开发模板与第二套 UI 全任务 |
| W05 协议 snapshot/subscribe/断连重放 | 部分 | 原型 Broker/协议 W 有；产品级未接完整消息线 |
| W06 执行/网络边界（IPC/loopback/fetch/worker） | 部分 | 隔离核对 5/5（IPC invoke timeout）；**页面内移除 Tauri globals 尝试无效**（不可配置属性，已记录）；网络/worker/伪造消息未系统验证 |
| W07 原生故障恢复（无限循环/CPU/内存/boot crash） | NOT_RUN | 仅启动 recover/safeMode W |
| W09 性能/资源预算 | NOT_RUN | 未做 256/512KB/大量事件压测 |
| F01–F16 全功能基线逐项 guest 覆盖 | 部分 | 官方 UI 基线回归绿；**guest 入口全任务覆盖**未逐项验证 |
| 正式发布密钥流程 | NOT_RUN | ADR-003 实施清单未执行（无正式密钥） |

## 4. 结论与建议

- 当前如实状态：**`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包，范围受限；上述 NOT_RUN 明确列出）。
- 进阶到 `LOCAL_WORKSHOP_RELEASE_CANDIDATE` 必须：完成 T27 I 门禁、W01/W02/W03/W04/W05/W06/W07/W09、
  guest 原生入口全任务覆盖、正式密钥流程；且人工 IME/DPI 通过。
- 本评估不改变分支本地/不发布约束；后续每项补完须附证据并更新本文件。
