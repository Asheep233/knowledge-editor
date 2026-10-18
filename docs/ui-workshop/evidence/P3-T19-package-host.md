# P3-T19 证据：包隔离宿主 — 会话生命周期/崩溃处理/safe mode（Core 7 例）

- 日期：2026-10-19 · 代码（Core，无 DOM/React）：
  - `frontend/src/core/packs/packageHost.ts`：`PackageHost`
    - `start(packId,version)`：**先校验版本完整性**（损坏拒绝，不建立连接）→ 读取 manifest →
      生成**受限 Broker 连接**（role=guest、能力=manifest.capabilities、绑定当前 context/epoch、
      declaredCommands=manifest.commands）；
    - `reportCrash`：未超限 → `suspended`（可恢复）；超过 `maxCrashes` → `failed` + 停用资源 +
      自动 `recover`，失败则进入 **safeMode**（宿主提示修复/回滚/重装）；
    - `restart`：崩溃计数未超限且版本仍完整 → 重新建立会话（**切库后读取新 epoch**）；
    - `stop`：stopped + deactivate；`subscribe` 会话状态（UI/原生状态上报）。
  - `packageHost.test.ts` 7 例
- 证据类型：**U（Core 单测）+ W（Windows/WebView2 实机探针 8/8 内联 guest；升级版 8/8 已安装包 entry，
  见 `P3-T19-package-host-probe.md`、`P3-T19-pack-entry-probe.md`）**；真实 WebView 崩溃信号尚未接入

## 测试结果

```text
$ npx vitest run src/core/packs/packageHost.test.ts
Tests  7 passed (7)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证 |
| --- | --- |
| start 成功 | 校验→Broker 连接（guest/能力/命令白名单/context+epoch） |
| 版本损坏 | failed，不建立连接（E_HASH） |
| 崩溃未超限 | suspended → restart 复活且使用**新 epoch**（切库安全） |
| 崩溃超限 | failed + deactivate + recover + safeMode |
| recover 失败 / autoRecover 关闭 | safeMode 保持/按配置不进入 |
| stop | stopped + deactivate；状态订阅含 starting/active/stopped |
| DOM/React 守卫 | 源码无 `document.`/`window.`/react |

## 结论

- T19 的**隔离宿主控制面**成立：包会话的生命周期、完整性门槛、受限连接、崩溃升级与 safe mode
  均有确定性测试；与 T18 broker、T20 启动恢复、T17 存储的能力/命令声明一致。
- 尚未完成（T19 继续）：
  1. 真实 guest WebView（iframe）会话装配（探针已用内联 guest 验证控制面）：包入口 HTML/资源来自
     T17 产品化安装目录；崩溃信号来自 WebView（renderer crash/导航失败）；
  2. 与 T20 原生恢复合并（safeMode 联动 UI、停用/恢复状态持久化）；
  3. Windows 实机故障注入 W（guest 崩溃→suspended→超限→safeMode→修复）。
