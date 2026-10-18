# P3-T17 证据：包清单校验 + 安装事务/回滚/损坏恢复（Core，无 UI）

- 日期：2026-10-19 · 代码（**产品仓库内 Core 包层，无 DOM/React/Tauri 依赖**）：
  - `frontend/src/core/packs/manifest.ts`：包清单类型 + **候选扫描无损拒绝**
    （id/版本/apiVersion/能力 allowlist/entry/assets/sha256/声明式命令；路径穿越与绝对路径拒绝）
  - `frontend/src/core/packs/store.ts`：`PackStore`（不可变版本目录 + staging→rename + **单提交点
    state.json** + journal；安装/激活/回滚/完整性校验/recover 自动回滚损坏 active）+ `MemoryPackFs`
  - `frontend/src/core/packs/pack.test.ts`：14 例
- 证据类型：**U（确定性单测，内存 FS）**；真实 Tauri fs / Windows 安装（T17/T21）尚未接入

## 测试结果

```text
$ npx vitest run src/core/packs
Tests  14 passed (14)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 合法清单 | 通过；entry/assets 路径归一化 |
| 非法路径（`../`/绝对） | `E_PATH` 拒绝（无损） |
| 未知能力（`system.exec`） | `E_CAPABILITY` 拒绝，**不静默降级** |
| apiVersion 不兼容 | `E_API_VERSION` 拒绝 |
| 哈希格式错误 / entry 不在 assets | `E_HASH` / `E_ENTRY` 拒绝 |
| 安装成功 | 不可变 `packs/<id>/<ver>/`、`state.json` 单提交、journal/staging 清理 |
| 资产哈希不匹配 | **无损拒绝**：无版本目录、state 不变、staging 清理 |
| 重复安装同版本 | `E_DUPLICATE`，旧状态保持 |
| 升级 | active=v2 previous=v1；回滚交换 active/previous（校验通过） |
| 无 previous 回滚 | `E_ROLLBACK` |
| 安装中途 rename 失败（模拟崩溃） | state 不变；`recover()` 清理半成品版本/staging/journal；可重新安装 |
| active 损坏 + previous 可用 | `verify=false` → `recover()` 自动回滚 `rollback-corrupt-active` |
| 激活损坏版本 | `E_HASH` 拒绝，旧 active 保持 |
| DOM/React 守卫 | 包层源码无 `document.`/`window.`/react 依赖 |

## 结论

- T17 的核心事务语义在 Core 层成立：**清单校验 → 候选无损拒绝 → staging 写入 → 原子 rename →
  state 单提交 → journal 清理**；升级/回滚/崩溃恢复/损坏回退均有确定性测试。
- 尚未完成（T17 继续）：
  1. 真实 **Tauri fs 实现**（`PackFileSystem` 的 Rust/plugin-fs 适配）与 Windows 安装实机证据（T21）；
  2. **包候选扫描**（下载目录/zip 解包后的扫描与预览信息）与首次安装确认 UI（T22）；
  3. 能力执行时强制（T18 broker）与包签名/来源校验；
  4. 与 Rust 原生恢复（S1 的 bootPending/safe mode）合并：包损坏导致启动失败时自动回退（T20/T24）。
