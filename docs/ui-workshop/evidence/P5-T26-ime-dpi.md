# P5-T26 补充证据：产品壳 IME 组词 + DPI/缩放后编辑面可用 — W 7/7 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 155（隔离测试构建 com.astranota.uiws.e2e）
- 工具：`tools/run_t26_ime_dpi_probe.py`（隔离 APPDATA + 临时工作区 + CDP 驱动真实产品编辑器）
- 原始结果：`evidence/T26-IME-DPI-results.json` · 证据类型：**W（真实产品 WebView2 渲染层/编辑器）**

## 实测结果：7/7 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-IME/DPI-1 产品启动 + 打开文章编辑器 | PASS |
| W-T26-IME/DPI-2 编辑器可聚焦（contenteditable activeElement） | PASS |
| **W-T26-IME/DPI-3 IME 组词进入编辑面（中文组词）** | PASS |
| **W-T26-IME/DPI-4 DPI/缩放生效（devicePixelRatio 2 → 1.5）** | PASS |
| **W-T26-IME/DPI-5 缩放后编辑面仍可输入 + DPI 恢复** | PASS |
| W-T26-IME/DPI-6 主进程存活 | PASS |
| W-T26-IME/DPI-7 用户运行中的 AstraNota 未受影响 | PASS |

## 诚实边界

- IME 路径为 **CDP `Input.imeSetComposition` + `insertText`**（真实 WebView2 渲染/编辑器管线），
  **不是物理键盘 + 系统 IME 全链路**；DPI 为 CDP `Emulation.setDeviceMetricsOverride`（真实渲染层）。
  因此本证据证明「产品编辑器在 WebView2 的 IME/缩放路径可用」，但**不能**替代人工真实输入法验收；
  T26 认证仍需人工真实 IME（中文输入法）与多 DPI 显示器实测（建议在 T27 验收包内人工执行）。

## 结论

- T26 自动化可覆盖部分补全：IME 合成输入、DPI 缩放、缩放后输入、焦点均通过；
- T26 剩余：**人工真实系统 IME/多 DPI 验收**、安装包升级/回滚演练（T27）。
