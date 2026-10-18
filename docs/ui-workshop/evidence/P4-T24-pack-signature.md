# P4-T24 证据：包签名验证 Core（Ed25519，公钥注入，8 例）

- 日期：2026-10-19 · 代码（Core，无 DOM/React）：
  - `frontend/src/core/packs/signature.ts`：
    - `canonicalManifestPayload`：**规范化签名载荷**（字段固定顺序 + UTF-8 JSON，含能力/entry/命令/资产
      sha256；不签名 signature 自身，防「签名内容被替换」）；
    - `verifyPackSignature`：Ed25519 验签，验签实现可注入（默认 WebCrypto，Node/浏览器可用）；
      三态结果 `valid`/`missing`/`invalid` + keyId + reason；**不抛异常**（未知密钥/非法 hex/非法算法/
      实现抛错 → invalid + reason）；
    - `parseHex` 严格校验；供 T22 安装预览（signature 状态）与 T24 信任策略（签名无效 → blocked）消费。
  - `signature.test.ts` 8 例（测试用 `node:crypto` Ed25519 生成/签名，注入 node 验签实现）
- 证据类型：**U（Core 单测）**；产品侧密钥分发/信任根、签名生成工具链与 Rust 侧验签尚未实现

## 测试结果

```text
$ npx vitest run src/core/packs/signature.test.ts
Tests  8 passed (8)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证 |
| --- | --- |
| 有效签名 | valid + keyId |
| 清单篡改 | invalid（E_SIGNATURE；能力/版本变化即破坏签名） |
| 未知 keyId / 无签名 | invalid（E_SIGNATURE_KEY）/ missing |
| 非法签名格式/算法 | invalid（E_SIGNATURE_FORMAT / E_SIGNATURE_ALG），不抛异常 |
| 验签实现抛错 | invalid + reason（宿主不崩溃） |
| canonical 稳定性 | 同内容（键顺序不同）→ 同字节 |
| parseHex | 严格校验 |
| DOM/React 守卫 | 源码无 DOM/React |

## 结论

- T24 的**签名验证核心**成立：签名载荷规范化、三态结果、错误不抛出，可与 T22 安装预览
  （`signature: valid/missing/invalid`）和 T24 信任策略（invalid → 阻止安装）直接串联。
- 尚未完成（T24 继续）：
  1. **密钥信任根**：内置公钥清单/轮换策略/撤销列表（产品配置与安全评审）；
  2. 签名生成工具链（打包器签名）与 Rust 侧验签（T17/T21 产品安装流程）；
  3. 工坊 UI 展示签名状态与来源信任授权（T23）；Windows 端到端交互 W。
