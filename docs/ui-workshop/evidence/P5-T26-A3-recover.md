# P5-T26 A3 证据：真实产品壳启动 recover / safeMode — W 9/9 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2（真实产品壳隔离测试构建 com.astranota.uiws.e2e）**
- 工具：`tools/run_t26_recover_probe.py`（预置损坏包到隔离 appdata → 启动产品 → 读真实
  `workshop-recover-status.json` 与磁盘 state.json）
- 原始结果：`evidence/T26-A3-recover-results.json` · 证据类型：**W（真实产品进程/文件系统）**

## 场景与实测结果：9/9 PASS

### 场景 A：active v2 损坏 + previous v1 可用

| 检查 | 结果 |
| --- | --- |
| W-T26-A3-1 启动生成 recover 状态文件（checked=1） | PASS |
| **W-T26-A3-2 自动回退**（action=rollback-corrupt-active，recovered=true） | PASS |
| **W-T26-A3-3 磁盘 state.active 回退为 1.0.0** | PASS |
| W-T26-A3-4 safeMode=false（有可用回退） | PASS |
| W-T26-A3-5 产品主进程存活（恢复不阻断启动） | PASS |

### 场景 B：仅 active v1 损坏、无 previous

| 检查 | 结果 |
| --- | --- |
| **W-T26-A3-6 action=corrupt-no-fallback**（recovered=false） | PASS |
| **W-T26-A3-7 启动进入 safeMode=true** | PASS |
| **W-T26-A3-8 safeMode 下产品主进程仍存活** | PASS |
| W-T26-A3-9 用户运行中的 AstraNota 未受影响（PID 存在） | PASS |

## 工程发现（已记录并处理）

- **测试构建必须固定到独立目录**：测试构建与主构建共享 `CARGO_TARGET_DIR`，会互相覆盖
  `release/knowledgeeditor.exe`；若主构建覆盖测试 exe，启动会被用户实例的**单实例插件**接管
  （进程立即 exit 0、无窗口，曾导致 A3 首跑全失败）。
  → 现在测试构建后复制到 `C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（含 sidecar），A2/A3 探针
  均指向该稳定路径；主构建随后恢复 `com.knowledgeeditor.desktop`。
- 本次 A2 打印探针在稳定路径下复跑仍 **9/9 PASS**（可复现）。

## 结论

- T26 计划 **A3 场景完成**：产品级启动恢复（回退/无回退 safeMode）真实生效且不阻断启动；
- 剩余：A4（签名安装拒绝/撤销）、A5（信任 UI/能力上限）、A6（安装→启用→回滚→卸载）、
  A7（包隔离宿主产品侧）、A8（Core 保存 flag 产品 UI）、真实 OS 中文 IME/多 DPI、安装包升级/回滚。
