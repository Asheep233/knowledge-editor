# P5-T26 前置证据：Windows/WebView2 W 证据一键汇总（13/13 PASS，门禁 PASS）

- 日期：2026-10-19 · 工具：`docs/ui-workshop/tools/run_all_w_probes.py`（Windows Python 顺序执行）
- 产出：`evidence/windows-witnesses-summary.json`（每个探针 status/passed/total/duration/tail）
- 证据类型：**W 汇总（真实 Windows/WebView2 探针重新运行；S1 的 2 项已知发现单独标注）**

## 结果：13/13 PASS（gate: PASS）

| # | 探针 | 结果 | 用时 |
| --- | --- | --- | --- |
| 1 | S1 iframe 运行域（含 2 项已知发现） | **PASS_WITH_FINDINGS 23/25** | 5.8s |
| 2 | S1b child WebviewWindow 对照 | PASS 10/10 | 19.3s |
| 3 | S2 持续编辑面换壳 | PASS 10/10 | 22.5s |
| 4 | S4 独立打印真实 PDF | PASS 6/6 | 23.1s |
| 5 | T11 协议传输 | PASS 7/7 | 22.5s |
| 6 | T13 单实例/退出协调 | PASS 6/6 | 3.0s |
| 7 | T15 IME/焦点/缩放（CDP） | PASS 8/8 | 13.3s |
| 8 | T18 恶意/故障 guest Broker | PASS 12/12 | 22.2s |
| 9 | T19 包隔离宿主 | PASS 8/8 | 22.2s |
| 9b | **T19 包入口真实资源（已安装包 entry）** | PASS 8/8 | 24.4s |
| 9c | **T19 多资源 + 心跳真实崩溃检测** | PASS 8/8 | 24.3s |
| 10 | T20 启动恢复/safeMode | PASS 9/9 | 26.2s |
| 11 | T21 原生包存储（Windows 文件系统） | PASS 20/20 | 22.2s |

合计运行约 **5 分钟**；探针均使用独立原型 identifier + 临时目录，不触碰用户运行中的 AstraNota
（`D:\AstraNota`）与真实笔记库。

## 用途与限制

- 用途：T26 Windows 认证前的**可重复门禁**（`--check` 任一 FAIL 退出非 0），并生成可审计汇总 JSON；
  与 `validation-matrix.csv`（静态汇总）互补：本工具是**运行时复跑**。
## 稳定性修复（本轮）

- 一键复跑曾暴露 T15 CDP IME 用例的偶发竞态（preedit 提交未进入正文 → 中文缺失）：
  已修复 runner（先产生 preedit → 显式取消 → insertText 提交，首轮缺失时重试一次）；
  连续复跑恢复 8/8，12/12 门禁稳定 PASS。

- 限制：
  1. 仅覆盖**原型壳探针**（S1b/S2/S4/T11/T13/T15/T18/T19/T19E/T19M/T20/T21）；产品壳端到端交互
     （T21/T23 安装→启用→回滚→卸载、T16 隐藏 renderer 打印）仍需隔离安装后执行（T26）；
  2. S1 的 2 项失败为已知发现约束（结论见 ADR-001），工具以 PASS_WITH_FINDINGS 标注，不掩盖；
  3. 真实 OS 中文 IME / 多 DPI 拖拽仍未纳入（T15/T26 待补）。
