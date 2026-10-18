# P4-T24 证据：打包器签名工具（ed25519，跨语言 canonical 一致，self-test 5/5）

- 日期：2026-10-19 · 工具：`docs/ui-workshop/tools/sign_pack.mjs`（Node 24，`node:crypto`）
- 原始结果：`evidence/T24-sign-tool-selftest.json`
- 证据类型：**U/B（工具 self-test + 与 TS/Rust canonical 载荷三语言 parity）**

## 功能

```bash
# 1) 生成发布密钥（私钥 PEM + 公钥 raw hex）
node docs/ui-workshop/tools/sign_pack.mjs --generate-key release.pem

# 2) 给包目录签名（读 manifest.json → 规范化载荷 → 写入 manifest.signature）
node docs/ui-workshop/tools/sign_pack.mjs --dir ./my-pack --key release.pem --keyid ke-release-2026 [--write]

# 3) 自检（canonical parity/签名/篡改/密钥往返/公钥格式）
node docs/ui-workshop/tools/sign_pack.mjs --self-test
```

- 签名字段：`manifest.signature = { alg:"ed25519", keyId, signature:<128 hex> }`；
- canonical 载荷与 `frontend/src/core/packs/signature.ts`（T24 TS）及产品 Rust
  `pack_store::canonical_manifest_payload` **逐字节一致**（同一 fixture 字面量在三处测试锁定，防漂移）；
- 公钥 raw hex（64 chars）可直接填入产品 env `KE_WORKSHOP_PUBKEYS` 或 TS `BUILTIN_PACK_KEYRING`。

## self-test 结果：5/5 PASS

| 检查 | 结果 |
| --- | --- |
| canonical payload 与 TS/Rust 字面量逐字节一致（三语言 parity） | PASS |
| ed25519 签名可被标准实现验证 | PASS |
| 篡改清单后验签失败 | PASS |
| 私钥 PEM 重新导入后签名一致（确定性签名） | PASS |
| 公钥 raw hex 为 64 hex chars | PASS（示例 `215be950…b84bc4`） |

## 结论

- T24 的**打包侧签名工具链**落地：可生成发布密钥、为包清单签名；三语言 canonical 载荷由测试锁定，
  避免「TS 验过、Rust 不认」的协议漂移。
- 尚未完成（T24 收尾）：
  1. 正式发布密钥的生成/保管/轮换流程（谁持有私钥、离线签名、公钥进产品构建配置）；
  2. 工坊 UI 数据源接线（scan.signatureStatus → 面板签名徽章）；Windows 验签安装 E2E；
  3. 包签名与 zip 下载/更新流程整合（T17/T21 产品化）。
