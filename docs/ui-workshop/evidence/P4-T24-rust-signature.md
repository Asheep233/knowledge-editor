# P4-T24 证据：产品壳 Rust 侧包签名验签（ed25519，跨语言载荷一致，cargo 38/38）

- 日期：2026-10-19 · 代码（产品仓库）：
  - `desktop/src-tauri/src/pack_store.rs`：
    - `canonical_manifest_payload`：与 TS `canonicalManifestPayload` **逐字节一致**的规范化载荷
      （字段固定顺序、`size:null`/`sdk:null` 语义；Rust 单测与 TS 单测使用同一字面量做跨语言 parity）；
    - `signature_status`：manifest 可选 `signature {alg,keyId,signature}`；公钥/撤销/过期来自
      env `KE_WORKSHOP_PUBKEYS`（`{keyId:{key:<hex32>,revoked?:bool,expiresAt?:ms}}`）；
      返回 `valid`/`missing`/`invalid` + reason（未知密钥/撤销/过期/格式/验签失败）；
    - `workshop_pack_scan` 返回 `signatureStatus`（+reason）；**install 拒绝 invalid 签名**
      （missing 交由 T22/T24 安装确认策略决定）；
  - `desktop/src-tauri/Cargo.toml`：新增 `ed25519-dalek = { version="2", features=["alloc"] }`；
  - `frontend/src/core/packs/signature.test.ts`：新增跨语言 canonical payload parity 用例。
- 证据类型：**U（产品 Rust 单测 + TS 单测）**；真实发布密钥签发/配置分发、UI 数据源接线、
  Windows 端到端安装验签 W 未做

## 验证结果

```text
$ cargo test --release         # 产品壳
test result: ok. 38 passed; 0 failed     # 34 + 4 signature tests
$ cargo build --release
Finished `release` profile [optimized]
$ npx vitest run src/core/packs/signature.test.ts
Tests  9 passed (9)            # 含跨语言 parity
$ npx tsc -b --noEmit
exit 0
```

| 单测 | 验证 |
| --- | --- |
| `canonical_payload_matches_ts_contract` | Rust 载荷字面量与 TS `canonicalManifestPayload` 一致（跨语言 parity） |
| `signature_status_valid_invalid_missing` | 有效签名 valid；篡改 invalid；未知 keyId invalid；无签名 missing |
| `signature_revoked_and_expired` | revoked → invalid(E_SIGNATURE_REVOKED)；expiresAt → invalid(E_SIGNATURE_EXPIRED) |
| `install_rejects_invalid_signature` | 验签失败 → 安装拒绝（E_SIGNATURE） |
| TS parity | canonical 载荷逐字节与 Rust 相同 |

## 结论

- T24 的**产品侧验签**落地：签名载荷跨语言一致、Rust 安装流程对无效签名硬拒绝、scan 暴露签名状态；
  与 T22 安装预览（signature 状态）和 T24 信任策略形成完整链路。
- 尚未完成（T24 收尾）：
  1. 真实发布密钥签发与配置分发（当前仅 env 注入；需产品化到设置/内置构建配置）；
  2. 工坊 UI 展示 scan 的真实 `signatureStatus`（当前 UI 可展示，数据源待接线）；
  3. Windows 端到端 W：有效签名安装 → 撤销后拒绝 → 轮换重叠期可用；
  4. 打包器侧签名工具链（生成 `signature` 字段）。
