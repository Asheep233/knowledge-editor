# P3-T23 证据：工坊控制面 UI 骨架（包列表/安装预览确认/回滚/修复，7 例 React 测试）

- 日期：2026-10-19 · 代码（产品仓库内 React 组件 + 适配器边界）：
  - `frontend/src/components/workshop/WorkshopPanel.tsx`：控制面骨架
    - 已安装包列表（版本/previous/激活态）+ 回滚/修复按钮
    - 安装预览（包身份/名称版本/来源/签名 + **能力风险徽章与影响说明** + warnings + blocked 阻止原因）
    - **确认安装**（blocked 时禁用）/ **取消**；错误与结果提示（role=alert/status）
  - `WorkshopAdapter` 注入接口：`listInstalled/stageFromFile/confirmInstall/cancelPreview/rollback/recover`
    （产品实现 = Tauri Rust 包命令；测试 = 内存替身）
  - `WorkshopPanel.test.tsx` 7 例（产品现有测试栈 react-dom/client + act，无 Testing Library 依赖）
- 证据类型：**U（React 组件测试）**；尚未集成进 App/路由（产品 Rust 包命令适配器未实现），无 Windows W 证据

## 测试结果

```text
$ npx vitest run src/components/workshop
Tests  7 passed (7)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证 |
| --- | --- |
| 已安装包渲染 | 名称/版本/previous/回滚入口 |
| 选择包预览 | 身份/来源/签名/能力风险/warnings 全部展示 |
| 确认安装 | 调用 `confirmInstall(token)` 并刷新列表、显示成功结果 |
| 取消 | 调用 `cancelPreview`、不触发安装、预览消失 |
| blocked 预览 | 确认按钮禁用 + 阻止原因 alert；点击不触发安装 |
| 回滚/修复 | 调用 adapter 并显示结果（rollback-corrupt-active） |
| 错误展示 | adapter 抛错 → role=alert 可读错误 |

## 结论

- T23 控制面的**交互骨架与安全门禁可视化**成立：预览→风险说明→显式确认/取消→回滚/修复链路
  已有组件与测试；blocked 包无法从 UI 安装。
- 尚未完成（T23 继续）：
  1. 集成进 App/路由（工坊入口、设置/侧栏 tab）与产品 **Tauri Rust 包命令适配器**（T17/T21 产品化）；
  2. 真实选择包（文件/zip/下载扫描）+ 安装进度/取消/错误恢复的可视化；
  3. Windows 实机交互 W 证据（T21/T26）与视觉验收（浅/深主题/DPI）。
