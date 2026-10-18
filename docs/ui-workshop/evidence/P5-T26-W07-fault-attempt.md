# P5-T26 W07 尝试记录：guest 无限循环故障（**未完成，不当作 W07 证据**）

- 日期：2026-10-19 · 状态：**NOT_RUN（探针未到达 guest 启用阶段）**
- 工具：`tools/run_t26_fault_probe.py`（隔离构建 + 故障包 + CDP）
- 原始结果：`evidence/T26-W07-fault-results.json`（5/6 checks，其中 W07-2 FAIL：guest 未启用）

## 事实

- 故障包可正常安装（W07-1 PASS）；
- 但该次产品实例停在 **WorkspacePicker**（"选择一个工作区开始"）：`KE_WORKSPACE` 指向的临时
  工作区已被后端激活（ws 下出现 Attachments/Drafts/Modules），前端仍未进入主 UI；`Page.reload`
  后依旧。→ 无法打开工坊、无法启用 guest，因此**未执行无限循环注入**；
- 宿主 IPC 在空闲态可响应（W07-3/4 PASS 仅说明空闲态），**不能用于结论**；
- 用户实例未受影响（W07-6 PASS）。

## 结论

- W07（原生故障恢复：无限循环/CPU/内存/boot crash/桥接超时/连续启动失败）**仍未验证**，
  保持 NOT_RUN；本次探针失败是**测试环境问题（前端未进入主 UI）**，不是产品恢复能力的证据。
- 未完成原因可进一步定位（例如：产品 UI 首次进入主界面依赖 app_config/recent workspace 而非
  KE_WORKSPACE；其他探针有时可进入，建议统一用 app_config 预置最近工作区）。
- 架构风险仍成立并记录：guest 与宿主同处一个 WebView2 渲染进程时，guest 无限循环可能阻塞宿主 JS；
  **独立 renderer/原生恢复（W07）必须单独设计与验证**，不得假定现有心跳检测覆盖 CPU 阻塞。
