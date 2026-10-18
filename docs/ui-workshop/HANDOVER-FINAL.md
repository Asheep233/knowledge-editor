# UI 工坊最终交接（截至 2026-10-19 会话末段）

> 本文件是**会话末段最终交接**，与 `HANDOVER.md`（完整状态表/证据索引）、
> `reports/milestone-assessment.md`（里程碑判定）、`reports/T26-acceptance-status.md`（Windows 验收）、
> `reports/T27-installer-upgrade-plan.md`、`progress.md`（逐任务台账）配合阅读。
> **分支本地，未推送、未发布 Release**；项目里程碑：**`EXPERIMENTAL_TRUSTED_PACKS`**（按 ACCEPTANCE A 节）。

## 1. 代码与基线

- 分支：`feat/ui-workshop`（基线 v1.2.18 `4c71233` + overlay `e54d37b`），本地，未推送/未 Release；
- 回归基线（最近一次）：frontend **133 files / 1811 passed + 1 skipped**（tsc 0）、backend
  **847 collected / exit 0**、产品 cargo **50 passed**、原型 W 探针 **13/13 PASS**、验证矩阵 **39 行** --check PASS；
- 关键复现命令：
  ```bash
  cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2
  python3 -m pytest backend/tests -q
  cd desktop/src-tauri && cargo test --release && cargo build --release
  python docs/ui-workshop/tools/build_validation_matrix.py --check
  python docs/ui-workshop/tools/run_all_w_probes.py --check        # Windows + 原型构建
  ```

## 2. 真实产品壳 W 验收（隔离测试构建，单独 identifier + 隔离 APPDATA/工作区 + 当前源码 sidecar）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A1 隔离构建/启动/独立 appData/启动 recover/单实例/用户 App 不受影响 | 7/7 | `P5-T26-isolated-smoke.md` |
| A2 隐藏 renderer 快照打印/ready 握手/路径安全 | 9/9 | `P5-T26-A2-print.md` |
| A3 启动 recover/safeMode 不阻断启动 | 9/9 | `P5-T26-A3-recover.md` |
| A4+A6 签名信任链 + 安装/激活/回滚/卸载 | 16/16 | `P5-T26-A4-A6-install.md` |
| A5 工坊信任 UI（真实列表/签名徽章/授予撤销/TrustStore） | 11/11 | `P5-T26-A5-ui.md` |
| A7+A5 产品 guest 宿主（自定义协议/能力上限/心跳崩溃/safeMode/停用持久化） | 11/11 | `P5-T26-A7-A5-guest.md` |
| A7 隔离核对（独立 origin / internals 自检上报 / remote IPC 不可用） | 6/6（残余风险记录） | `P5-T26-A7-isolation.md` |
| A8 Core 保存 flag（autosave→/api/context/write/frontmatter 保留） | 9/9 | `P5-T26-A8-save.md` |
| IME/DPI（CDP/WebView2 渲染层；非人工系统 IME） | 7/7 | `P5-T26-ime-dpi.md` |
| W01 ZIP 离线包 staging/安装/解压安全 | 8/8（I 门禁未做） | `P5-T26-W01-zip.md` |
| W05 产品 guest 协议线（握手+snapshot） | 7/7（完整协议语义未做） | `P5-T26-W05-protocol.md` |
| W06 guest 执行/网络边界（功能级） | 8/8（导航/伪造消息未做） | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环故障（部分类别） | 8/8（CPU/内存/boot crash/I 未做） | `P5-T26-W07-fault.md` |
| W09 大文档性能基线 | 部分（正常路径 OK；大公式文档打开 10.6–23s 偏慢；上轮部分测量已修正） | `P5-T26-W09-perf.md`、`P5-T26-W09-perf-diag.md` |

**总计：真实产品壳 W 探针 11 个场景，全部通过**；原型壳 W 13 探针一键门禁 13/13。

## 3. 里程碑判定（ACCEPTANCE A 节）

- 当前：**`EXPERIMENTAL_TRUSTED_PACKS`** —— 只允许受信实验包（community 能力不允许 → 拒绝启用；
  签名/撤销/信任等级强制），隔离/离线/恢复仍列未通过项与残余风险；
- **不声明** `IMPLEMENTED_WINDOWS_PENDING` 完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`；
- 完整 NOT_RUN 清单（人工真实 IME/多 DPI、W08 覆盖升级 I 门禁、W02 表单交接、W03 包/私有状态
  回滚 I、W04 SDK 外部开发、W05 协议线完整、W06 网络/worker 边界、W07 原生故障、W09 性能、
  F01–F16 guest 入口全任务覆盖、正式发布密钥流程）：见 `reports/milestone-assessment.md`。

## 4. 残余风险（必须随交付说明）

1. guest 仍可见 `__TAURI_INTERNALS__`（跨域 iframe 继承 Tauri 注入），**不可配置不可移除**；
   已实现 guest 自检上报 + 宿主残余风险提示；当前 `invoke` 实测 timeout（Tauri IPC authority 拒绝
   remote origin；capabilities 无 remote 声明）→ 当前不可利用但属实现细节；Tauri 升级必须复跑
   `run_t26_guest_isolation_probe.py`；
2. 人工真实系统 IME/多 DPI 未验证（CDP 路径已过）；
3. 安装/覆盖升级 I 证据未执行（T27 计划，需专用环境/授权）；
4. ZIP 更深攻击面（压缩比/嵌套）未覆盖；W01 无 I 门禁。

## 5. 约束遵守与事故记录

- 未推送/未 Release；无真实用户笔记写入测试；未隐藏旧 App（flag 默认关闭，双轨可回退）；
  未把 happy-dom/Linux 结果冒充 W；
- **事故（已披露并补救）**：① 早期 runner 误用 `taskkill /IM knowledgeeditor.exe` 误杀用户 App；
  ② 一次清理误用 `Stop-Process -Id <用户 PID>`；均即时重启用户 App 并把红线写入
  `tools/t26_isolated_build.md`；③ 产品 `data_dir()` 不随 identifier 变化，早期 T26 运行共享
  真实 `%APPDATA%\KnowledgeEditor`（只读显示用户最近工作区，无写入）→ 已强制全部 runner 注入隔离
  APPDATA + 清理测试 identifier 目录；真实 app_config 已清除测试注入条目。

## 6. 下一步建议（按优先级）

1. T27 安装/覆盖升级 I 门禁（专用环境/授权）→ 更新 W08；
2. 人工真实 IME/多 DPI 验收；
3. W05 协议线完整接线（Broker/Dispatcher ↔ guest SDK）、W02 表单交接；
4. W06 网络/worker/伪造消息边界系统验证 + Tauri 升级回归；
5. 正式发布密钥流程（ADR-003 实施清单）；
6. 全部通过后再评估 `LOCAL_WORKSHOP_RELEASE_CANDIDATE`。
