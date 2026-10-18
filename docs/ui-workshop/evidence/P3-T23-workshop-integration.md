# P3-T23/T21 证据：工坊入口 + Tauri 包命令适配器集成（前端 122 files/1733 passed）

- 日期：2026-10-19 · 代码（产品仓库前端）：
  - `frontend/src/core/packs/tauriPackAdapter.ts`：产品 Tauri 包命令 → `WorkshopAdapter`
    - `listInstalled` ← `workshop_pack_list`（映射 id/name/version/active/previous/capabilities）
    - `stageFromFile` ← `workshop_pack_scan`（**扫描/预览不写盘**；token=源目录）
    - `confirmInstall` ← `workshop_pack_install`（仅用户显式确认后调用）
    - `rollback` / `recover` ← 对应命令；`cancelPreview` 本地丢弃（扫描无服务端状态）；
      Rust 错误（如 `E_HASH`）原样转成 Error
  - `frontend/src/components/workshop/WorkshopEntry.tsx`：feature flag 入口
    （`enabled=false` → **零渲染**，既有 App/测试零影响；开启后按钮 + 模态面板）
  - `frontend/src/App.tsx`：`<WorkshopEntry enabled={(import.meta.env.VITE_KE_WORKSHOP ?? '') === '1'} />`
    （默认关闭；与 SettingsPanel 并列，不影响既有布局）
  - `installPolicy.ts` 导出 `capabilityRisk`（适配器复用能力风险说明）
- 证据类型：**U（适配器/入口组件测试 + 全量前端回归）**；尚未接真实目录选择与 Windows 交互 W

## 验证结果

```text
$ npx vitest run src/components/workshop src/core/packs
Tests  39 passed (39)          # 工坊 UI 10 + packs 29（store/policy/adapter）
$ npx tsc -b --noEmit
exit 0
$ npx vitest run --maxWorkers=2   # 全量前端（App 接入后）
Test Files  122 passed (122)
     Tests  1733 passed | 1 skipped (1734)
```

| 用例 | 验证 |
| --- | --- |
| adapter list/scan/install/rollback/recover 映射 | 调用参数与视图字段正确；token=源目录 |
| chooseSourceDir 返回 null | 不调用 scan |
| Rust 错误传播 | `E_HASH` 等错误以 Error 抛出（UI 可显示） |
| 入口 flag 关闭 | 容器零渲染 |
| 入口开启 | 按钮出现 → 点击打开 dialog → 面板加载已安装包 → 关闭消失 |

## 结论

- 工坊 UI 与产品 Rust 包存储命令**已打通**（前端适配器 + flag 入口），默认关闭不影响既有 App；
  全量前端回归通过。
- 尚未完成（T23/T21 继续）：
  1. 真实**包目录选择**（Tauri dialog/拖拽/zip 扫描）——`chooseSourceDir` 目前仅注入占位；
  2. Windows 实机端到端交互 W：打开工坊 → 选择包 → 预览/确认 → 安装 → 启用 → 回滚 → 卸载，
     含权限/首装确认/错误与 safe mode 场景（T21/T26）；
  3. 包签名/来源信任、卸载/清理、与 T20 启动 recover 合并；视觉验收（浅/深/DPI）。
