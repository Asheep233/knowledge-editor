# P5-T26 A4+A6 证据：签名安装/拒绝 + 安装→启用→回滚→卸载 — W 16/16 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2（真实产品壳隔离测试构建 com.astranota.uiws.e2e）**
- 工具：`tools/run_t26_install_probe.py`（CDP 调真实 `workshop_pack_*` 命令；Node 签名工具生成
  有效/篡改/未签名包；env `KE_WORKSHOP_PUBKEYS` 提供公钥/撤销信任根）
- 原始结果：`evidence/T26-A4-A6-install-results.json` · 证据类型：**W（真实产品进程/命令/文件系统）**

## 实测结果：16/16 PASS

### A4 签名信任链（真实 Rust 验签 + 安装拒绝）

| 检查 | 结果 |
| --- | --- |
| W-T26-A4-2 有效签名 scan → `signatureStatus=valid` | PASS |
| W-T26-A4-3 未签名 scan → `missing` | PASS |
| W-T26-A4-4 篡改清单 scan → `invalid`（`E_SIGNATURE: 验签失败`） | PASS |
| **W-T26-A4-5 篡改包 install → 拒绝（E_SIGNATURE）** | PASS |
| **W-T26-A4-6 撤销密钥 scan → invalid（E_SIGNATURE_REVOKED）** | PASS |
| **W-T26-A4-7 撤销密钥 install → 拒绝** | PASS |

### A6 安装生命周期（磁盘 state 逐步校验）

| 检查 | 结果 |
| --- | --- |
| W-T26-A6-1 安装 signed v1 → active=1.0.0 | PASS |
| W-T26-A6-2 列表签名状态 = valid | PASS |
| W-T26-A6-3 安装 signed v2 → 自动激活 active=2.0.0/previous=1.0.0 | PASS |
| **W-T26-A6-4 重复 activate 当前 active → 幂等（previous 不变）** | PASS（见下修复） |
| **W-T26-A6-5 rollback → active=1.0.0/previous=2.0.0** | PASS |
| **W-T26-A6-6 uninstall → 列表空、包目录删除** | PASS |
| W-T26-A6-7 命令链路主进程存活 | PASS |

### 通用
- W-T26-A4/A6-9 用户运行中的 AstraNota 未受影响（PID 存在）PASS。

## 工程发现与修复（W 探针发现真实缺陷）

- **`workshop_pack_activate` 非幂等缺陷**：重复激活当前 active 版本会把 `previous` 改写成同一版本，
  导致后续 `rollback` 失去目标（回滚到自身）。首跑 A6-4/A6-5 因此失败。
  → 已修复：`activate` 对 `active == version` 直接返回原状态（不改 previous），并新增 Rust 单测
  `activate_same_version_is_idempotent`（产品 cargo **39 passed**）；修复后 A4/A6 全绿 16/16。
- 测试 runner 工程问题：清理 stale 测试实例（按 `C:\ke-tmp\uiws-t26\bin\*` 路径白名单）避免单实例
  静默接管；launch 失败时终止自身子进程，避免遗留。

## 结论

- T26 计划 **A4、A6 场景完成**：签名信任链（valid/missing/invalid/revoked → 安装拒绝）与安装生命周期
  （install/activate/rollback/uninstall）在真实产品壳闭环，且发现并修复一处状态机缺陷。
- 剩余：A5（信任 UI/能力上限产品侧）、A7（包隔离宿主产品侧）、A8（Core 保存 flag 产品 UI）、
  真实 OS 中文 IME/多 DPI、安装包升级/回滚演练。
