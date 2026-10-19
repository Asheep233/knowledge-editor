# 交接快照（2026-10-19 夜）

## 1. 一句话

UI 工坊已按**接口级**交付：协议/SDK/manifest/能力/命令白名单/宿主生命周期完成并有真实 Windows W 证据；
分支已推送；**最终状态 `EXPERIMENTAL_TRUSTED_PACKS`**；T27 I 门禁因无 Windows 环境未执行（blocked），
不声明正式发布/更高里程碑。

## 2. 仓库状态

| 项 | 值 |
| --- | --- |
| 分支 | `feat/ui-workshop`（`origin/feat/ui-workshop` 已同步） |
| HEAD | 以 `git log -1` 为准（交接提交；远端 ref == 本地） |
| 工作树 | 干净；无未推送提交；无测试进程残留 |
| 策略 | 仅该分支推送；**未推 master、未创建 Release/标签** |
| 用户数据 | 未触碰真实笔记/用户 App；测试数据均在隔离目录（`C:\ke-tmp`） |

## 3. 交付物入口

| 内容 | 路径 |
| --- | --- |
| **工坊接口使用文档** | `docs/ui-workshop/WORKSHOP-INTEGRATION-GUIDE.md` |
| **接口维护规则 / 变更记录** | `WORKSHOP-INTERFACE-POLICY.md` / `WORKSHOP-INTERFACE-CHANGELOG.md` |
| 一页式最终状态 | `reports/FINAL-DELIVERY-STATUS.md` |
| 完整交接报告 | `HANDOVER-FINAL.md` |
| 逐任务状态（交接口径） | `reports/TASK-STATUS-HANDOVER.md` |
| 前端 Agent 接入/验证 Runbook | `reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md` |
| 证据索引 / 验证矩阵 | `EVIDENCE-INDEX.md` / `validation-matrix.csv` |
| T27 环境阻塞决策 | `reports/DECISION-T27-I-gate-blocked.md` |
| 云端 Windows VM 验收包 | `reports/cloud-handoff/`（README + scripts/tests/test-pack + 完整 sources.bundle） |
| 参考 UI（pack A/B） | `packs/pack-a/`、`packs/pack-b/` |
| SDK（发布形态） | `sdk/`（`dist/guest-sdk.js|mjs` 入仓；自检 4/4） |

## 4. 快速验收（可复现）

```bash
# 前端
cd frontend && npm ci && npx tsc -b --noEmit          # 0 错误
npx vitest run --maxWorkers=2                          # 143 files / 1981 passed + 1 skipped
# 后端
python3 -m pytest backend/tests -q                     # 847 collected / exit 0
# 仓库级
python3 docs/ui-workshop/tools/build_validation_matrix.py --check   # MATRIX GATE: PASS（63 行）
python3 docs/ui-workshop/tools/verify_delivery_consistency.py       # 9/9 PASS（含 DC-9 接口维护）
python3 -m pytest docs/ui-workshop/reports/cloud-handoff/tests -q   # 39 passed（交接脚本回归）
```

> 数字以实际运行为准；产品 W 探针仅 Windows 环境可跑（Linux/happy-dom 不能替代）。

## 5. 已交付功能（接口级）

- **安装/信任/启用生命周期**：ZIP/目录扫描 → 验签 → 事务安装 → 授信（community/trusted/builtin）→ 启用 guest
  → 停用/回滚/卸载/启动恢复/safeMode（产品壳 W 证据）。
- **协议**：5 方法（capabilities/snapshot/write/print/command）+ 5 宿主事件 + 11 错误码 + 心跳/超时/取消。
- **能力**：7 能力 allowlist + 等级上限；独立 origin + CSP 网络边界（guest 不能直调后端）。
- **编辑命令**：21 条协议名（14 切换 + 3 无参动作 + 4 参数化 link/math/table + `doc.save`），严格参数校验。
- **参考 UI**：pack A（侧栏阅读器）/ pack B（Dock/表单/命令），真实安装启用 W 24/24。
- **SDK/工具**：发布形态 SDK、create/sign pack 工具、脚手架、兼容自检。

## 6. 未闭环 / 不宣称（交接红线）

1. **T27 I 门禁 NOT_RUN**：无 Windows VM；Linux 预检 PASS 不是 I 证据；`verdict=FAIL` 仅表示未执行/未通过门禁。
2. **T26 认证未达成**：不能声明全功能/故障/平台认证通过。
3. **人工真实 IME / 多 DPI 未测**（仅有渲染层 CDP W 7/7）。
4. **F01–F16 guest 全量覆盖未达成**：部分域无受控协议；官方 UI 60 PASS，packA 26/packB 27 PASS，其余 NOT_RUN。
5. **W07 已知限制 3 项**：C2-7 不自动修复损坏包、B1-6/B2-5 运行期不自愈（重启/卸载可恢复，已定稿）。
6. **未发布**：无 Release/标签；对外只能称实验性/候选。

## 7. 下一任/恢复路径

1. 获得 Windows 10/11 VM（交互桌面 + 快照）→ 按 `reports/cloud-handoff/README.md` 跑 T27 U1–U6 + B 段 →
   回传 `windows-evidence` → 登记 I 门禁并复评里程碑。
2. 人工 IME/多 DPI：按 `reports/MANUAL-IME-DPI-CHECKLIST.md` 完成后回传。
3. 前端 UI Agent 接入：`reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md`；接口以 Guide 为准。
4. 任何接口改动：必须走 `WORKSHOP-INTERFACE-POLICY.md` 的 DoD 并更新 CHANGELOG；一致性检查 DC-9 会校验。
