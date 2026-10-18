# P4-T24 证据：包签名公钥信任根（Keyring）— 轮换/撤销/过期（8 例）

- 日期：2026-10-19 · 代码（Core，无 DOM/React）：
  - `frontend/src/core/packs/keyring.ts`：
    - `PackKeyring`：内置/签发的 ed25519 公钥集合（raw 或 hex），按 keyId 查找；
    - **轮换重叠期**：多把密钥可同时 active，新旧签名均可验；
    - **撤销/过期**：`revokedAt`/`expiresAt`（ISO 或 epoch ms）后立即失效，
      返回 `E_SIGNATURE_REVOKED` / `E_SIGNATURE_EXPIRED`；
    - `verify`/`status` 组合 T24 签名验证：未知密钥/非法公钥 → invalid，无签名 → missing，**不抛异常**；
    - `BUILTIN_PACK_KEYRING`：首发内置信任根（当前为空，产品发布密钥签发后登记；含轮换/重叠说明）。
  - `keyring.test.ts` 8 例
- 证据类型：**U（Core 单测）**；真实发布密钥签发/分发流程与 Rust 侧验签未实现（产品化待办）

## 测试结果

```text
$ npx vitest run src/core/packs/keyring.test.ts
Tests  8 passed (8)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证 |
| --- | --- |
| 有效密钥 | valid；activeKeyIds 仅含可用密钥 |
| **轮换重叠** | 新旧两把同时有效，各自签名均 valid |
| **撤销** | revokedAt 后 invalid（E_SIGNATURE_REVOKED），activeKeyIds 为空 |
| **过期** | expiresAt 后 invalid（E_SIGNATURE_EXPIRED） |
| 未知密钥/缺签名/非法公钥 | invalid/missing/invalid（不抛异常） |
| 篡改清单 | invalid（信任根不掩盖篡改） |
| hex 公钥 | 可用 |
| DOM/React 守卫 | 源码无 DOM/React |

## 结论

- T24 的**签名信任根**核心成立：信任根判定与签名验证组合完成，支持轮换重叠、撤销、过期，
  结果结构化可被安装预览/信任策略/诊断消费；内置信任根为显式空占位（不伪造发布密钥）。
- 尚未完成（T24 收尾）：
  1. **真实发布密钥**签发与分发（谁签、存储位置、轮换计划）→ 填入 `BUILTIN_PACK_KEYRING`；
  2. 打包器侧签名工具链与 **Rust 侧验签**（产品安装流程强制验证）；
  3. 工坊 UI 展示信任根判定结果（当前 UI 可展示 signature 状态，数据源待接线）；
  4. Windows 端到端安全演练（有效签名安装 → 撤销后拒绝 → 轮换重叠期可用）。
