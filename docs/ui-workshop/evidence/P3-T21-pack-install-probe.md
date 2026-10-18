# P3-T21 证据：Rust 原生包存储 — Windows 文件系统安装/升级/回滚/损坏与崩溃恢复（20/20 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - Rust：`docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/src/pack_store_proto.rs`
    （T17 TS 语义的**可执行等价物**：不可变版本目录、staging→rename、state.json 单提交点 + txn journal、
    清单/能力/路径/哈希校验、activate/rollback/verify/recover、测试钩子 pack_corrupt）
  - 探针：`docs/ui-workshop/core/packs/probe/pack_probe.ts`（真实 WebView2 窗口调用 Tauri 命令）
    + `run_pack_probe.py`（Windows Python 驱动 + 直接检查磁盘）
- 原始结果：`evidence/T21-pack-install-probe-results.json` · 证据类型：**W（Windows 真实文件系统）**

## 实测结果：**20/20 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T21-1/2 Rust setup 打开 pack-render 窗口；探针完成 | PASS |
| W-T21-3/4 安装 v1（active=1.0.0）→ 升级 v2（active=2.0.0, previous=1.0.0） | PASS |
| W-T21-5 回滚成功（active=1.0.0, previous=2.0.0） | PASS |
| W-T21-6 verify v1/v2（真实文件哈希） | PASS |
| W-T21-7/8 损坏 active → verify=false → **recover 自动回滚 `rollback-corrupt-active`（active=2.0.0）** | PASS |
| W-T21-9 坏哈希安装被拒（`E_HASH`）且不生成版本目录 | PASS |
| W-T21-10/11 路径穿越 `E_PATH`、重复安装 `E_DUPLICATE` | PASS |
| W-T21-12 **崩溃注入（rename 后失败）state 不变** | PASS |
| W-T21-13 崩溃后无孤儿版本（recover 后 verify=false，action=clean） | PASS |
| W-T21-14 重新安装 v4 成功，final active=4.0.0 | PASS |
| W-T21-15 磁盘 state.json：active=4.0.0 previous=2.0.0 | PASS |
| W-T21-16 磁盘版本目录 = {1.0.0, 2.0.0, 4.0.0}，3.0.0 不存在 | PASS |
| W-T21-17 **无 staging/journal 残留** | PASS |
| W-T21-18 磁盘文件内容与最新安装一致（`<html>v4</html>`） | PASS |
| W-T21-19 损坏文件保持损坏（未被静默修复/覆盖） | PASS |
| W-T21-20 真实 Windows 文件系统路径 `C:\ke-tmp\uiws-t21-probe\data` | PASS |

## 结论

- T17/T21 的安装事务语义在 **Rust + Windows 真实文件系统**上可执行：
  安装无半成品残留、升级保留 previous、回滚交换、损坏自动回退、崩溃注入后状态不变且可重装、
  越权/越界安装被类型化拒绝。
- 与 T17 Core TS `PackStore` 语义一致（同一套 staging/state/journal 规则），为 T20（Rust 原生恢复）
  与 T21（Windows 安装/升级/回滚验收）铺路。
- 尚未完成（T21 继续）：
  1. 将 Rust pack store 接入**产品 Tauri 主进程**（真实包目录/单实例/启动时 recover 与 safe mode）；
  2. 前端 `PackStore`（TS）与 Rust 原生命令的桥接/单一事实来源决策（避免双实现漂移）；
  3. 包下载/候选扫描/首次安装确认 UI（T22）、包签名与来源校验、Windows 安装包回归（T26）。
