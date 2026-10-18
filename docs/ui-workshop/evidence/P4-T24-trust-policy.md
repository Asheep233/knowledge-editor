# P4-T24 证据：可信包限定 — 信任等级/签名策略/能力上限/授权持久化（Core 10 例）

- 日期：2026-10-19 · 代码（Core，无 DOM/React）：
  - `frontend/src/core/packs/trustPolicy.ts`：
    - `TrustTier`：`builtin`（内置）/ `trusted`（用户显式授予）/ `community`（默认最低）；
    - `evaluateTrust`：签名无效 → 阻止；下载未签名（默认策略）→ 阻止；**等级不允许的能力 → 阻止并列出违规**
      （不是静默裁剪）；给出 `effectiveCapabilities`（等级 ∩ manifest）与 `requiresExplicitConfirm`；
    - `TrustStore`（注入持久化；产品=Rust 设置/包元数据，测试=MemoryTrustStore）：
      `tierOf/grant/revoke/list`；`evaluateStoredTrust` 用持久化等级评估；
  - `packageHost.ts` 接入运行期**能力上限**：`capabilityCeiling(packId, declared)` → Broker 连接能力
    取「等级允许子集」，即使 manifest 声明更多也进不了会话。
  - `trustPolicy.test.ts` 9 例 + packageHost 新增 1 例（packs 合计 49 例）
- 证据类型：**U（Core 单测）**；产品侧信任授权 UI/签名验证（真实 PKI）尚未实现

## 测试结果

```text
$ npx vitest run src/core/packs
Tests  49 passed (49)          # store 14 + policy 9 + tauriAdapter 8 + packageHost 8 + trust 9 + installPolicy 9…
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证 |
| --- | --- |
| 签名无效 | 阻止（任何等级，E_SIGNATURE） |
| 下载未签名 | 阻止（默认策略）；本地包允许 |
| community 等级 | 不允许 `ui.shell`/`context.read` → 阻止并列出（不静默裁剪），effective 只剩允许项 |
| trusted/builtin | trusted 允许全能力集合；builtin 全允许且无需显式确认 |
| 显式确认 | builtin 不需要；其它等级需要 |
| 授权持久化 | 默认 community；grant→trusted、revoke→community、list 可审计 |
| 运行期上限 | PackageHost 用 `capabilityCeiling` 裁剪 → Broker 连接只含允许能力 |
| DOM/React 守卫 | trustPolicy 源码无 DOM/React |

## 结论

- T24 的**可信包限定**核心成立：安装期策略（签名/来源/等级/能力）与运行期上限（Broker 连接能力裁剪）
  双层生效，授权可持久化与撤销；与 T22 安装确认、T18 Broker 形成一致安全链。
- 尚未完成（T24 继续）：
  1. 真实签名验证（PKI/密钥管理）与来源信任 UI（工坊控制面授予 trusted/撤销）；
  2. 产品侧持久化 TrustStore（Rust 设置存储）与启动加载；
  3. 与 T20 safeMode、T21 安装流程端到端合并 + Windows 交互 W；
  4. 平台验证矩阵（T25）与 Windows 认证（T26）。
