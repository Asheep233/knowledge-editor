# P3-T22 证据：首次安装前确认 — 预览/风险说明/显式确认门禁（Core 9 例）

- 日期：2026-10-19 · 代码（Core，无 DOM/React 依赖）：
  - `frontend/src/core/packs/installPolicy.ts`：
    - `buildInstallPreview`：包身份/名称/版本/apiVersion/**来源**/签名状态/大小/声明能力 + 风险等级与说明 +
      warnings（下载未签名、本地包、高影响能力、声明命令列表）；**签名无效 → blocked**（不是警告后继续）；
    - `PendingInstallGate`：`stage()` 只生成预览 token（**无任何安装副作用**）；
      **安装只能经 `confirm(token)` 显式触发**；token 一次性；blocked/过期 token 拒绝；`cancel()` 丢弃；
    - 预览与最终安装清单一致性（同一 manifest/files 交给 PackStore）。
  - `installPolicy.test.ts` 9 例（连同 T17 packs 测试共 23 例）
- 证据类型：**U（Core 单测）**；UI（工坊控制面渲染/交互，T23）与真实下载/签名验证尚未实现

## 测试结果

```text
$ npx vitest run src/core/packs
Tests  23 passed (23)     # T17 store 14 + T22 policy 9
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 预览内容 | 身份/来源/能力风险（ui.shell=medium 等）/warnings/requiresExplicitConfirm |
| 签名无效 | `blocked=true` + `E_SIGNATURE` 原因，**不得安装** |
| 下载未签名 | 明确警告（需用户确认），不静默放行 |
| stage 无副作用 | 未写入任何包目录，仅暂存 token |
| confirm 安装 | token 一次性消费；重复 confirm 拒绝；安装成功 active=version |
| blocked 禁止 confirm | 不产生包目录 |
| cancel | 丢弃预览、不安装 |
| 过期 token | confirm 拒绝（需重新预览） |
| 预览↔安装一致 | 安装的 manifest id/version/capabilities 与预览一致 |

## 结论

- T22 的**安全门禁语义**成立：无法绕过确认安装；无效签名被阻止；预览信息（能力/影响/来源/命令）
  是最终安装清单的同一份数据，避免「预览一套、安装另一套」。
- 尚未完成（T22 继续）：
  1. **工坊控制面 UI**（T23）渲染 preview/风险说明并收集确认；安装进度/取消/回滚 UI；
  2. 真实**包下载/候选扫描/签名验证**（当前 source/signature 由调用方注入）；
  3. 来源信任策略与用户授权持久化（T18 三档）、Windows 实机交互 W 证据（T21/T26）。
