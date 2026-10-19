# UI 工坊交付状态（一页式 · 2026-10-19）

> 分支 `feat/ui-workshop`（**本地，未推送、未发布 Release**）。完整说明见 `HANDOVER-FINAL.md`；
> 里程碑判定见 `reports/milestone-assessment.md`；逐任务台账见 `progress.md`。
> 证据均为 `docs/ui-workshop/evidence/` 下文件；「通过」必须可追溯到证据文件，部分通过一律标「部分」。

## 0. 一句话结论

**项目里程碑 = `EXPERIMENTAL_TRUSTED_PACKS`（ACCEPTANCE A 节，不声明更高）。**
真实产品壳 W 证据已覆盖 A1–A8 + W01/W02/W04/W05/W06/W07（无限循环/内存/CPU）/W09（工坊口径）/IME-DPI；
但 **T26 任务级最终认证未达成**（缺人工真实 IME/多 DPI、T27 安装升级 I 门禁、W 部分类别）。

## 1. 已通过（有证据）

| 项 | 结果 | 级别 | 证据 |
| --- | --- | --- | --- |
| T26 A1 隔离构建/启动/独立 appData/recover/单实例 | 7/7 | W | `P5-T26-isolated-smoke.md` |
| T26 A2 隐藏 renderer 快照打印 + ready 握手 + 路径安全 | 9/9 | W | `P5-T26-A2-print.md` |
| T26 A3 启动 recover/safeMode | 9/9 | W | `P5-T26-A3-recover.md` |
| T26 A4+A6 签名信任链 + 安装/启用/回滚/卸载 | 16/16 | W | `P5-T26-A4-A6-install.md` |
| T26 A5 工坊信任 UI（列表/徽章/授予撤销/TrustStore） | 11/11 | W | `P5-T26-A5-ui.md` |
| T26 A7+A5 产品 guest 宿主（协议/能力/心跳崩溃/safeMode/停用） | 11/11 | W | `P5-T26-A7-A5-guest.md` |
| T26 A7 隔离核对（独立 origin/internals 自检/remote IPC 不可用） | 6/6 | W | `P5-T26-A7-isolation.md` |
| T26 A8 Core 保存 flag 产品 UI | 9/9 | W | `P5-T26-A8-save.md` |
| IME 组词 + DPI/缩放（CDP/WebView2 渲染层；非人工实测） | 7/7 | W | `P5-T26-ime-dpi.md` |
| W01 ZIP 离线包 staging/安装/解压安全 | 8/8 | U+W | `P5-T26-W01-zip.md` |
| W02 产品 title/tags 交接（guest→Broker→后端原子写） | 8/8（切片） | W | `P5-T26-W02-form.md` |
| W02 表单交接 Core 状态机 | 6/6 | U | `P5-T26-W02-formhandoff.md` |
| W04 外部开发者路径（脚手架→签名→安装→启用） | 7/7 + 自检 5/5 | W+B | `P5-T26-W04-sdk.md`、`W04-scaffold-selftest.json` |
| W04 SDK 发布形态（dist SDK→握手/snapshot） | 7/7 + 自检 4/4 | W+U | `P5-T26-W04-sdk-dist.md` |
| W05 产品协议线（Broker/Dispatcher↔SDK 握手+snapshot） | 7/7 | W | `P5-T26-W05-protocol.md` |
| W06 执行/网络边界（fetch/worker/WS/越权，功能级） | 8/8 | W | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环（宿主独立/心跳/failed+safeMode/停用） | 8/8（类别） | W | `P5-T26-W07-fault.md` |
| W07 guest 内存/CPU 压力（内存 11/11 + CPU 10/10，独立 renderer） | 21/21（扩展类别） | W | `P5-T26-W07-fault-mem.md` |
| W09 工坊口径（无复制/无逐字符广播/无泄漏） | 6/6 | W | `P5-T26-W09-workshop.md` |
| 原型壳 W 探针一键门禁 | 13/13 | W | `P5-T26-windows-witnesses.md` |
| 回归基线：frontend tsc 0 + vitest 143 files/1931 passed+1 skipped | PASS | U | `P6-final-verification.md`（W02 后追加） |
| 回归基线：backend 847 collected/exit 0 | PASS | A | `P6-final-verification.md` |
| 回归基线：产品 cargo 67 passed | PASS | U | `P6-final-verification.md`（W01 后追加） |
| 平台验证矩阵 `--check` | PASS | 静态汇总 | `validation-matrix.csv`、`tools/build_validation_matrix.py` |

## 2. 部分通过（不得写成通过）

| 项 | 已通过部分 | 未完成部分 | 证据 |
| --- | --- | --- | --- |
| W01 ZIP 离线包 | 功能级 U+W 8/8 | I 门禁未执行；zip bomb 深层/嵌套压缩未覆盖 | `P5-T26-W01-zip.md` |
| W02 表单交接 | title/tags 交接 W 8/8 + Core U 6/6 | 公式/重命名草稿、迟到命令、候选启动失败、提交后 UI 同步、IME 交接 | `P5-T26-W02-form.md`、`-formhandoff` |
| W04 外部开发 | 外部路径 W 7/7 + SDK 发布形态 W 7/7 + 自检 | npm/tgz 发布流程、文档站/示例集/调试工具、第二套 UI 全任务覆盖、发布密钥分发 | `P5-T26-W04-sdk.md`、`-sdk-dist` |
| W05 协议线 | 握手+snapshot W 7/7 | subscribe/断连重放/慢包/超时 queryResult/取消冲突 | `P5-T26-W05-protocol.md` |
| W06 边界 | 网络/worker/WS/越权功能级 W 8/8 | 导航/下载/伪造消息系统化、loopback 白名单、Tauri 升级回归 | `P5-T26-W06-boundary.md` |
| W07 故障 | 无限循环 W 8/8 + 内存压力 W 11/11 + CPU 压力 W 10/10 | boot crash、桥接超时、连续启动失败、原生 Rust 恢复、I 门禁；自然 OOM 未触发（崩溃为 CDP `Page.crash` 注入，2GB 压力上限受同机安全约束） | `P5-T26-W07-fault.md`、`-fault-mem.md` |
| W09 性能 | 工坊口径 W 6/6 | 全量预算复跑；大文档首开为产品既有 `@tiptap/markdown` 限制（非工坊回归） | `P5-T26-W09-workshop.md`、`-perf`/`-diag`/`-plain` |
| F01–F16 功能基线 | 官方 UI 基线回归绿 | guest 入口全任务逐项覆盖 | `feature-baseline.csv`、`P6-final-verification.md` |
| T27/W08 I 门禁 | 就绪检查 dry-run 6/8（产物齐备） | **I 证据 NOT_RUN**：W08/W03/W01 I；阻塞=授权 + 隔离环境 | `P5-T26-W08-gate-prep.md`、`T27-gate-readiness.json` |

## 3. 未通过 / NOT_RUN（阻止更高状态）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 人工真实系统 IME / 多 DPI | **NOT_RUN** | CDP 路径已过 W 7/7，不能替代人工实测 |
| W08 安装/覆盖升级/降级/兼容 I | **NOT_RUN** | 计划与产物就绪；需主理人授权 + 专用隔离环境（`reports/T27-installer-upgrade-plan.md`） |
| W03 包与私有状态回滚 I | **NOT_RUN** | U 级 store/recover 有，I 门禁未做 |
| 正式发布密钥流程 | **NOT_RUN** | ADR-003 实施清单未执行 |
| T26 任务级最终认证 | **未达成** | A1–A8 W 已齐，但完成定义还含人工 IME/DPI、T27 I 门禁、W 全类别 |
| `IMPLEMENTED_WINDOWS_PENDING` 完成态 | **不声明** | 未满足 |
| `LOCAL_WORKSHOP_RELEASE_CANDIDATE` | **不声明** | 未满足，且未授权发布 |

## 4. 基线数字（最近一次）

- frontend：**134 files / 1819 passed + 1 skipped**，tsc 0（WSL/happy-dom，U 级）；
- backend：**847 collected / exit 0**（WSL；Windows Py3.10 曾全绿）；
- 产品 cargo：**50 passed**（Windows Rust 单测）；
- 原型 W 探针门禁：**13/13 PASS**；
- 验证矩阵：`validation-matrix.csv`（**51 行**），`build_validation_matrix.py --check` **PASS**；
  含 T27 就绪检查 READINESS 行——显式标注 NOT_READY 6/8，非验收通过。

## 5. 复现命令

```bash
cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2
python3 -m pytest backend/tests -q
cd desktop/src-tauri && cargo test --release
python3 docs/ui-workshop/tools/build_validation_matrix.py --check
python docs/ui-workshop/tools/run_all_w_probes.py --check   # Windows + 原型壳
```

## 6. 建议下一步（按优先级）

1. **T27 I 门禁**（授权 + 专用隔离环境）→ 覆盖升级/降级/回滚/中断演练，更新 W08/W03/W01 I 状态；
2. **人工真实 IME / 多 DPI** 实测；
3. **W02/W05/W06/W07 剩余类别**（表单完整交接/协议断连/边界系统化/CPU·内存·boot crash 故障）；
4. **SDK 正式发布**（npm/tgz、文档站/示例集、密钥分发）；
5. **W09 大文档性能优化**后复跑全量预算；
6. 正式发布密钥流程 + Tauri 升级回归；
7. 全部完成并复评 T26 认证后，才可评估 `LOCAL_WORKSHOP_RELEASE_CANDIDATE`（发布需主理人授权）。

## 7. 待主理人操作项（不阻塞当前交付，但影响最终认证）

| 项 | 需要 | 入口 |
| --- | --- | --- |
| T27 安装/覆盖升级/回滚 I 门禁 | 授权 + 专用隔离环境（VM/实验机） | `reports/T27-I-GATE-RUNBOOK.md`；就绪检查 `evidence/T27-gate-readiness.json` |
| 人工真实 IME/多 DPI | 本机逐步操作 + 截图 | `reports/MANUAL-IME-DPI-CHECKLIST.md` |
| 正式发布/推送 | 主理人明确授权 | 当前分支本地，未推送/未 Release |

## 6b. 本轮追加证据（2026-10-19 后段）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| G1/G2 guest 内容读 + 真实写通道 | **W 14/14 PASS**（context.write 能力 trusted/builtin，假桩删除） | `P5-T26-G1G2-content-io.md` |
| W02 停用后迟到请求/旧连接失效 | **W 12/12 PASS**（重放验证，不落盘；如实标注注入方式） | `P5-T26-W02-form.md` |
| W07 boot crash/连续启动失败 | **PASS_WITH_FINDINGS 43/45**（A2-10 孤儿自愈、B1-4 失败日志、B3-4 settings 备份已修复；剩 B1-6/B2-5 运行期无自愈） | `P5-T26-W07-fault-boot.md` |
| W07 桥接超时 / sidecar 故障 / 原生恢复 | **PASS_WITH_FINDINGS 45/46**（B/C 类与 C2-3 入口角标已修复；剩 1 缺口：C2-7 no-fallback 不可自动修复） | `P5-T26-W07-fault-bridge.md` |
| F01–F16 逐项台账 | **v6 登记 72/130 行**（**F03 42/42 全 PASS**；F16 11/11 结构性审计 NOT_RUN；官方 UI 60 PASS/0 FAIL/70 NOT_RUN） | `P5-T26-F-ledger.md`、`P5-T26-F03-fail-audit.md` |
| G3/G4 真实打印 + 宿主事件 | **U+W 18/18 PASS**（心跳超时临时放宽等限制已记录） | `P5-T26-G3G4-print-events.md` |
| G7 pack A/B 参考 UI（SDK 读/写/打印/事件真实链路） | **W 24/24 PASS**（逐项台账仍未登记） | `P5-T26-G7-reference-packs.md` |
| T27 I 门禁 | 就绪检查 NOT_READY(6/8)；**云端执行交接单 + 安装包 sha256 清单已给**（VM 由主理人安排） | `T27-CLOUD-EXECUTION-HANDOFF.md`、`T27-ARTIFACTS.md` |
| F01–F16 覆盖审计 | 已实现 0 / 部分 3 / 未实现 13；G1/G2 已闭环结构阻塞 | `F01-F16-COVERAGE.md` |

## 8. W07 剩余缺口定稿（已知设计限制，不计划修复）

| 缺口 | 说明 | 决策 |
| --- | --- | --- |
| C2-7 corrupt-no-fallback 无自动修复 | 损坏且无可回退版本时自动「修复」等于删除用户数据或猜测内容；产品保留唯一安全路径=用户卸载/重装 | **保留为已知限制**，UI 明确提示（safe mode + notice） |
| B1-6 / B2-5 运行期无自愈 | 资源释放（端口/数据目录）后运行中的实例不自动重试，需重启应用（重启可恢复，W 证据覆盖） | **保留为已知限制**，失败原因已可观测（B1-4） |
