# 决策记录：T27 I 门禁因环境不可用未执行（2026-10-19）

- **决策**：以 **`EXPERIMENTAL_TRUSTED_PACKS`** 状态结项；**不声明** `IMPLEMENTED_WINDOWS_PENDING`
  完成态，**不声明** `LOCAL_WORKSHOP_RELEASE_CANDIDATE`。
- **依据**：T27 I 门禁（安装/覆盖升级/回滚/卸载/重启）必须在**真实 Windows 环境**执行才有 I 类证据；
  主理人确认**无 Windows VM 可用**（云端 Codex 环境为 Debian Linux）。已按事实登记
  `T27-I-preflight-results.json`：`executionStatus=BLOCKED`、U1–U6 全部 `NOT_RUN`、`verdict=FAIL`
  **仅表示门禁未通过（未执行），不表示产品故障**。
- **已完成的替代验证（不等于 I 门禁）**：Linux 预检 PASS（双前端构建、前后端测试、签名工具/测试 guest
  自检、脚本回归 39/39、包完整性 64/64）；本机真实 Windows/WebView2 W 证据（A1–A8、W01–W09、G1–G7、
  F01–F16 部分）见 `validation-matrix.csv`。
- **不采用替代方案**：不在主理人真实机器上安装/升级/回滚（红线：禁止真实笔记测试；避免影响在用实例）；
  不把 Linux 预检或本机隔离构建 W 当作 I 门禁证据。
- **后果与恢复路径**：里程碑停在 `EXPERIMENTAL_TRUSTED_PACKS`（TASK PACK 允许状态之一）；若日后获得
  专用 Windows VM/主机，直接使用 `reports/cloud-handoff/`（v2，完整 sources.bundle + 修正版脚本 +
  39 项测试 + 签名 test-pack + `README.md` 执行步骤）执行并回传，再按 `T27-I-results.schema.json` 登记，
  即可复评是否前移里程碑。交接材料由 `tools/build_cloud_handoff.py` 一键重建。
- **可选未做项**：人工真实 IME/多 DPI 检查（`reports/MANUAL-IME-DPI-CHECKLIST.md`）可在主理人本机
  非侵入完成；不阻塞本决策与结项，也不改变里程碑口径。
