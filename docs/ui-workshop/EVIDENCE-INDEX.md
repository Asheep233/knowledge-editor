# UI 工坊证据索引（自动生成）

- 生成时间：2026-10-19T21:16:27+0800
- 证据目录：`docs/ui-workshop/evidence/`（152 个文件；48 个 results JSON、95 个说明 md）
- 由 `tools/build_evidence_index.py` 生成；验收结论以 `validation-matrix.csv` 与各证据文件为准。

## 1. 验证矩阵行（按任务/场景）

| 证据 | 任务 | 类型 | 结果 | passed/total | 复现命令 |
| --- | --- | --- | --- | --- | --- |
| P0-S1-probe-results.json | T02 | U/W?（Linux 侧 U + Windows 混合，见文档） | PASS_WITH_FINDINGS(2) | 23/25 | `python run_s1_probe.py` |
| P0-S1-windows-probe-results.json | T02 | W | PASS | 10/10 | `python run_s1_windows_probe.py` |
| P0-S2-probe-results.json | T03 | W | PASS | 10/10 | `python run_s2_probe.py` |
| P0-S4-probe-results.json | T05 | W | PASS | 6/6 | `python run_s4_probe.py` |
| T10-e2e-results.json | T10 | A | PASS | 19/19 | `bash core/session/run_t10_e2e.sh` |
| T11-transport-probe-results.json | T11 | W | PASS | 7/7 | `python run_protocol_probe.py` |
| T13-core-gate-results.json | T13 | A | PASS | 21/21 | `bash core/gate/run_t13_gate.sh` |
| T13-instance-probe-results.json | T13 | W | PASS | 6/6 | `python run_instance_probe.py` |
| T14-bridge-e2e-results.json | T14 | A | PASS | 11/11 | `bash core/session/run_t14_bridge_e2e.sh` |
| T14-byte-consistency-results.json | T14 | A | PASS | 12/12 | `bash core/session/run_t14_byte_consistency.sh` |
| T15-ime-zoom-probe-results.json | T15 | W | PASS | 8/8 | `python run_t15_cdp_probe.py` |
| T18-broker-probe-results.json | T18 | W | PASS | 12/12 | `python run_broker_probe.py` |
| T19-multiasset-probe-results.json | T19 | W | PASS | 8/8 | `python run_t19_multiasset_probe.py` |
| T19-pack-entry-probe-results.json | T19 | W | PASS | 8/8 | `python run_t19_entry_probe.py` |
| T19-package-host-probe-results.json | T19 | W | PASS | 8/8 | `python run_t19_probe.py` |
| T20-startup-recover-probe-results.json | T20 | W | PASS | 9/9 | `python run_startup_recover_probe.py` |
| T21-pack-install-probe-results.json | T21 | W | PASS | 20/20 | `python run_pack_probe.py` |
| T26-A2-print-results.json | T26/A2 | W | PASS | 9/9 | `python tools/run_t26_print_probe.py` |
| T26-A3-recover-results.json | T26/A3 | W | PASS | 9/9 | `python tools/run_t26_recover_probe.py` |
| T26-A4-A6-install-results.json | T26/A4+A6 | W | PASS | 16/16 | `python tools/run_t26_install_probe.py` |
| T26-A5-ui-results.json | T26/A5 | W | PASS | 11/11 | `python tools/run_t26_ui_probe.py` |
| T26-A7-A5-guest-results.json | T26/A7+A5 | W | PASS | 11/11 | `python tools/run_t26_guest_probe.py` |
| T26-A7-isolation-results.json | T26/A7 | W | PASS | 6/6 | `python tools/run_t26_guest_isolation_probe.py` |
| T26-A8-save-results.json | T26/A8 | W | PASS | 9/9 | `python tools/run_t26_save_probe.py` |
| T26-F-ledger-results.json | T26/F01-F16 | W+U（官方 UI CDP + pack A/B 参考包 + 台账） | PASS_WITH_FINDINGS(checks 71/76；F03 42/42 全 PASS/F16 结构性审计/F14 导出 Documents 见台账) | 71/76 | `python tools/run_feature_entry_probe.py` |
| T26-G1G2-results.json | T26/G1G2 | W | PASS | 14/14 | `python tools/run_t26_guest_io_probe.py` |
| T26-G3G4-results.json | T26/G3G4 | W | PASS | 18/18 | `python tools/run_t26_guest_g3g4_probe.py` |
| T26-G7-reference-packs-results.json | T26/G7 | W | PASS | 24/24 | `python tools/run_reference_packs_probe.py` |
| T26-IME-DPI-results.json | T26/IME-DPI | W | PASS | 7/7 | `python tools/run_t26_ime_dpi_probe.py` |
| T26-W01-zip-results.json | T26/W01 | W | PASS | 8/8 | `python tools/run_t26_zip_probe.py` |
| T26-W02-form-results.json | T26/W02 | W | PASS | 12/12 | `python tools/run_t26_form_probe.py` |
| T26-W04-sdk-dist-results.json | T26/W04 | W | PASS | 7/7 | `python tools/run_t26_w04_sdk_probe.py` |
| T26-W04-sdk-results.json | T26/W04 | W | PASS | 7/7 | `python tools/run_t26_w04_probe.py` |
| T26-W05-protocol-results.json | T26/W05 | W | PASS | 7/7 | `python tools/run_t26_protocol_probe.py` |
| T26-W06-boundary-results.json | T26/W06 | W | PASS | 8/8 | `python tools/run_t26_boundary_probe.py` |
| T26-W07-boot-results.json | T26/W07 | W | PASS_WITH_FINDINGS(2 缺口：B1-6/B2-5 已知设计限制，重启可恢复) | 43/45 | `python tools/run_t26_boot_crash_probe.py` |
| T26-W07-bridge-results.json | T26/W07 | W | PASS_WITH_FINDINGS(1 缺口：C2-7 no-fallback 不自动修复，已知设计限制) | 45/46 | `python tools/run_t26_w07_bridge_probe.py` |
| T26-W07-fault-results.json | T26/W07 | W | PASS | 8/8 | `python tools/run_t26_fault_probe.py` |
| T26-W07-mem-results.json | T26/W07 | W | PASS | 21/21 | `python tools/run_t26_fault_mem_probe.py` |
| T26-W09-perf-diag-results.json | T26/W09 | W | KNOWN_FAIL(记录) | 4/5 | `python tools/run_t26_perf_diag_probe.py` |
| T26-W09-perf-plain-results.json | T26/W09 | W | KNOWN_FAIL(记录) | 4/8 | `python tools/run_t26_perf_plain_probe.py` |
| T26-W09-perf-results.json | T26/W09 | W | KNOWN_FAIL(记录) | 3/7 | `python tools/run_t26_perf_probe.py` |
| T26-W09-workshop-results.json | T26/W09 | W | PASS | 6/6 | `python tools/run_t26_w09_workshop_probe.py` |
| T26-cloud-handoff-results.json | T26/cloud | B（本地模拟自验） | PASS | 9/9 | `见 evidence/P5-T26-cloud-handoff-verification.md` |
| T26-isolated-smoke-results.json | T26/A1 | W | PASS | 7/7 | `手工隔离构建流程（见 evidence/P5-T26-isolated-smoke.md）` |
| T26-pack-editor-cmd-results.json | T26/F03-packB | W | PASS | 36/36 | `python tools/run_t26_pack_editor_cmd_probe.py` |
| T26-packA-editor-cmd-results.json | T26/F03-packA | W | PASS | 36/36 | `python tools/run_t26_pack_editor_cmd_probe.py --pack a` |
| P0-S3-prototype.md（pytest 10/10 双平台） | T04 | A/U | PASS |  | `pytest docs/ui-workshop/prototypes/p0/s3_save/test_s3.py` |
| P0-S5-prototype.md（pytest 10/10 双平台） | T06 | A/U | PASS |  | `pytest docs/ui-workshop/prototypes/p0/s5_txn/test_s5.py` |
| P5-T26-F16-native-menu-audit.md（11/11 结构性审计；W/DOM 未覆盖） | T26/F16 | U/静态（非 W） | NOT_RUN(结构性审计 11/11；W 未覆盖) |  | `只读审计 desktop/src-tauri/src/menu.rs（见 evidence/P5-T26-F16-native-menu-audit.md）` |
| T27-I-preflight-results.json | T27/W03/W08-prep | B（Linux 预检，非 I 验收证据） | PREFLIGHT_PASS / I-GATE_NOT_RUN（executionStatus=BLOCKED：无 Windows VM；verdict=FAIL 仅表示门禁未通过、非产品故障；脚本回归 39/39、SHA256 64/64 已复核） | 0/6 | `python scripts/cloud_t27_gate.py --baseline <baseline> --candidate <candidate>（Windows 执行见 cloud-handoff/README.md）` |
| T27-gate-readiness.json | T27/W08-prep | W-prep（I 门禁就绪检查，非验收证据） | NOT_READY(6/8)：阻塞=未授权 KE_T27_AUTHORIZED + 未声明 KE_T27_ISOLATED_ENV；W03/W08 I 仍 NOT_RUN |  | `python tools/run_t27_gate_check.py` |
| frontend: Core session 单测 | P1/P2 | U | PASS |  | `cd frontend && npx vitest run src/core/session` |
| frontend: Core protocol 单测 | P1 | U | PASS |  | `cd frontend && npx vitest run src/core/protocol` |
| frontend: Core broker 单测 | P1 | U | PASS |  | `cd frontend && npx vitest run src/core/broker` |
| frontend: Core packs 单测 | P2/P4 | U | PASS |  | `cd frontend && npx vitest run src/core/packs` |
| frontend: 运行时健康 banner 单测 | P3/T26 | U | PASS |  | `cd frontend && npx vitest run src/components/runtime` |
| frontend: 工坊 UI 单测 | P3/P4 | U | PASS |  | `cd frontend && npx vitest run src/components/workshop` |
| frontend: Core print 单测（P2–P4/T16 产品打印） | P2/P4 | U | PASS |  | `cd frontend && npx vitest run src/core/print` |
| frontend: tsc + vitest 全量 | P1–P4 | U | PASS |  | `cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2` |
| backend: pytest 全量 | P1 | A | PASS |  | `python3 -m pytest backend/tests -q（Windows: CI venv）` |
| cargo: 产品壳单测 | P2–P4 | U | PASS |  | `cd desktop/src-tauri && cargo test --release` |
| cargo: 原型壳单测（无独立测试，仅构建） | P0 | B | BUILD_OK |  | `cargo build --release（原型 tauri_sandbox）` |

## 2. results JSON 对应说明文件（可维护性）

- `P0-S1-probe-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `P0-S1-windows-probe-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `P0-S2-probe-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `P0-S4-probe-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T10-e2e-results.json` → `P1-T10-e2e.md`
- `T11-transport-probe-results.json` → `P1-T11-transport-probe.md`
- `T13-core-gate-results.json` → `P1-T13-core-gate.md`
- `T13-instance-probe-results.json` → `P1-T13-instance-probe.md`
- `T14-bridge-e2e-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T14-byte-consistency-results.json` → `P2-T14-byte-consistency.md`
- `T15-ime-zoom-probe-results.json` → `P2-T15-ime-zoom-probe.md`
- `T18-broker-probe-results.json` → `P3-T18-broker-probe.md`
- `T19-multiasset-probe-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T19-pack-entry-probe-results.json` → `P3-T19-pack-entry-probe.md`
- `T19-package-host-probe-results.json` → `P3-T19-package-host-probe.md`
- `T20-startup-recover-probe-results.json` → `P3-T20-startup-recover-probe.md`
- `T21-pack-install-probe-results.json` → `P3-T21-pack-install-probe.md`
- `T26-A2-print-results.json` → `P5-T26-A2-print.md`
- `T26-A3-recover-results.json` → `P5-T26-A3-recover.md`
- `T26-A4-A6-install-results.json` → `P5-T26-A4-A6-install.md`
- `T26-A5-ui-results.json` → `P5-T26-A5-ui.md`
- `T26-A7-A5-guest-results.json` → `P5-T26-A7-A5-guest-attempt.md`
- `T26-A7-isolation-results.json` → `P5-T26-A7-isolation.md`
- `T26-A8-save-results.json` → `P5-T26-A8-save-attempt.md`
- `T26-F-ledger-results.json` → `P5-T26-F-ledger.md`
- `T26-G1G2-results.json` → `P5-T26-G1G2-content-io.md`
- `T26-G3G4-results.json` → `P5-T26-G3G4-print-events.md`
- `T26-G7-reference-packs-results.json` → `P5-T26-G7-reference-packs.md`
- `T26-IME-DPI-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T26-W01-zip-results.json` → `P5-T26-W01-zip.md`
- `T26-W02-form-results.json` → `P5-T26-W02-form.md`
- `T26-W04-sdk-dist-results.json` → `P5-T26-W04-sdk-dist.md`
- `T26-W04-sdk-results.json` → `P5-T26-W04-sdk-dist.md`
- `T26-W05-protocol-results.json` → `P5-T26-W05-protocol.md`
- `T26-W06-boundary-results.json` → `P5-T26-W06-boundary.md`
- `T26-W07-boot-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T26-W07-bridge-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T26-W07-fault-results.json` → `P5-T26-W07-fault-attempt.md`
- `T26-W07-mem-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T26-W09-perf-diag-results.json` → `P5-T26-W09-perf-diag.md`
- `T26-W09-perf-plain-results.json` → `P5-T26-W09-perf-plain.md`
- `T26-W09-perf-results.json` → `P5-T26-W09-perf-diag.md`
- `T26-W09-workshop-results.json` → `P5-T26-W09-workshop.md`
- `T26-cloud-handoff-results.json` → `P5-T26-cloud-handoff-verification.md`
- `T26-isolated-smoke-results.json` → `P5-T26-isolated-smoke.md`
- `T26-pack-editor-cmd-results.json` → `P5-T26-pack-editor-cmd.md`
- `T26-packA-editor-cmd-results.json` → **缺少对应说明 md（仅原始 JSON）**
- `T27-I-preflight-results.json` → **缺少对应说明 md（仅原始 JSON）**

## 3. 说明 md 未被主要交付文档引用（提示，不阻塞）

- `P5-T26-cloud-handoff-verification.md`
