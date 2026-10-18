# P5-T26 A8 尝试记录：Core 保存 flag 产品 UI（**未通过，自动化手段限制**）

- 日期：2026-10-19 · 状态：**未完成（不得当作 A8 证据）**
- 工具：`tools/run_t26_save_probe.py`（VITE_KE_CORE_SAVE=1 的隔离产品构建 + CDP 驱动编辑器）
- 原始结果：`evidence/T26-A8-save-results.json`（6/8，失败项保留）

## 已达成

| 检查 | 结果 |
| --- | --- |
| W-T26-A8-1 flag 构建产品启动 + 隔离工作区主 UI 就绪 | PASS |
| W-T26-A8-2 打开文章并加载编辑器（ProseMirror） | PASS |
| W-T26-A8-3 编辑插入标记文本（DOM 内可见） | PASS |
| W-T26-A8-6 日志无保存错误 | PASS（但也没有任何保存调用） |
| W-T26-A8-7 主进程存活 / A8-8 用户实例不受影响 | PASS |

## 失败与原因（诚实记录）

- **W-T26-A8-4 保存落盘失败**：文件内容始终未变（后端日志中只有 GET，无 PUT/写）。
  尝试过：自动保存等待、Ctrl+S（rawKeyDown/keyDown）、失焦点击、OS 窗口激活 + CDP 真实鼠标点击、
  逐字符 `Input.dispatchKeyEvent(char)`——均未触发编辑器脏标记/保存。
  判定：CDP 合成输入使 ProseMirror DOM 变化但**未进入其事务管线**（未触发 onUpdate），
  因此 autosave 不触发；这是**自动化手段限制**，不能据此判断产品 flag 路径好坏。
- 因此 W-T26-A8-5（Core 上下文链日志）也无法验证；**A8 仍未完成**。

## 追加尝试（真实 SendInput + base URL 修复后，仍 6/8）

- 用 Windows `SendInput(KEYEVENTF_UNICODE)` 真实硬件级输入打 `A8MARK` 进入编辑器（DOM 内可见），
  仍无任何保存调用（后端日志只有 GET）→ 说明**不是输入事件未到**，更可能是产品 autosave 脏标记/
  保存调度未在当前自动化路径触发（或 flag 分支条件未满足）。
- 同时发现并修复一个**真实集成缺陷**：`coreSaveRuntime` 默认桥未使用产品后端 base URL
  （`window.__KE_API_BASE__`）→ 即使走到 Core 保存也会请求到 Tauri 资源域而不是后端。
  已修复为 `new CoreSaveBridge({ baseUrl: resolveCoreApiBase() })`（runtime 测试 5 例、tsc 0）。
- 结论：A8 保留 **pending**；后续需人工在隔离构建里真实编辑保存（或加仅测试保存入口），
  并观察 EditorArea 的 dirty/save 状态指示定位 autosave 未触发的具体环节。

## 后续正确验证方式（建议）

1. 用真实键盘输入（人工操作或 Windows UI Automation/SendInput 真实硬件级输入）在隔离构建中编辑并保存；
2. 或在产品中暴露仅测试用的「保存诊断」入口（不进入产品功能面），由 CDP 触发一次真实保存并断言
   `/api/context/write` 与字节一致；
3. 双路径对账：同一内容分别用 flag on/off 保存并比较磁盘字节（T14 已有 A 级 e2e 12/12）。
