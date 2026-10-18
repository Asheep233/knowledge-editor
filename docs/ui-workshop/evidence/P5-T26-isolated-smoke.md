# P5-T26 证据：隔离安装产品冒烟（测试构建 + 独立 identifier）— 7/7 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2（真实产品壳测试构建）**
- 原始结果：`evidence/T26-isolated-smoke-results.json`
- 证据类型：**W（真实产品壳进程/窗口/文件系统），覆盖 T26 计划 A1 部分 + A3 部分**

## 隔离构建方式（可复现，已在会话内验证）

1. 复制 `desktop/src-tauri` → `C:\ke-tmp\uiws-t26\src-tauri`（不含 target；`CARGO_TARGET_DIR` 在外部复用依赖缓存）；
2. 覆盖 `tauri.conf.json`：`identifier = com.astranota.uiws.e2e`、`productName = AstraNota UIWS E2E`、
   `build.frontendDist = F:/Work/KE Project/knowledge-editor/frontend/dist-build`；
3. 从副本目录 `cargo build --release`（约 37s，复用依赖缓存）；二进制经 strings 校验含 e2e identifier；
4. 以 `KE_WS_PRINT_RENDER=1` 启动，采集进程/窗口/隔离数据目录；按 PID 停止（**绝不按镜像名杀进程**）。

**关键结果**：`TAURI_CONFIG` 环境变量对 plain cargo 构建不生效（未触发重编译/identifier 未变），
因此采用「副本 + 配置覆盖」方案；产品主构建未改动。

## 实测结果：7/7 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-S1 隔离 identifier 测试构建可产出 | PASS |
| **W-T26-S2 测试实例启动并显示主窗口（AstraNota）** | PASS（alive 14s、MainWindowHandle≠0） |
| **W-T26-S3 独立 appData 数据目录** | PASS（`%APPDATA%\com.astranota.uiws.e2e`） |
| **W-T26-S4 产品启动 recover 真实执行** | PASS（`workshop-packs\workshop-recover-status.json`：checked=0、safeMode=false） |
| W-T26-S5 隔离单实例（第二实例退出、无重复） | PASS |
| **W-T26-S6 用户运行中的 AstraNota 未受影响（PID 69108 不变）** | PASS |
| W-T26-S7 测试进程清理无残留 | PASS |

## 限制与下一步

- 本次为 **cargo 裸构建**：Tauri sidecar 后端未打包 → 后端/工作区相关场景（A2 打印、A4–A8）未覆盖；
  需用 `tauri build`（含 sidecar 打包）或手动放置正确命名的 sidecar 二进制后再测。
- 隐藏打印 renderer 的可见性/握手路径、工坊 UI 交互、签名安装等仍需后续 A2/A4–A8 脚本化验证。
- 结论：T26 **隔离构建与产品启动路径已打通**（不影响用户实例/数据），可作为后续产品 E2E 的基座。
