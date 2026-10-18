# ADR-003 包签名密钥生命周期与发布流程（T24）

- 决策 ID / 日期：ADR-003 / 2026-10-19
- 背景：T24 已实现 ed25519 签名验证（TS/Rust 双端、三语言 canonical parity）、打包器签名工具、
  工坊信任 UI 与数据源贯通。当前缺口是**发布密钥的运行流程**：谁生成/保管、公钥如何进产品、
  轮换与吊销如何分发。
- 关联：`P4-T24-trust-policy.md`、`P4-T24-pack-signature.md`、`P4-T24-keyring.md`、
  `P4-T24-rust-signature.md`、`P4-T24-sign-tool.md`、`P4-T24-signature-datasource.md`；
  工具 `tools/sign_pack.mjs`；产品 env `KE_WORKSHOP_PUBKEYS`；TS `BUILTIN_PACK_KEYRING`。

## 决策

1. **密钥类型与算法**：ed25519；签名载荷 = 规范化清单 JSON（三语言一致性已锁定）。
2. **密钥分级（草案）**
   - `release`（发布签名）：离线生成，长期（按年轮换）；用于正式上架包签名；
   - `channel-*`（渠道/实验）：可分发到测试渠道，轮换更频繁；
   - 每个 key 有 `keyId`（含年份/用途，如 `ke-release-2026`）。
3. **私钥保管（离线）**
   - 私钥仅在离线签名机/受控环境存在，PEM 权限收紧；禁止进入仓库/构建产物/日志；
   - 签名由打包流程单独步骤执行（人工触发 + 审计日志：包 id/version/sha256/keyId/时间）。
4. **公钥进入产品（信任根）**
   - 产品 Rust：内置/配置 `KE_WORKSHOP_PUBKEYS`（构建配置或设置层注入），发布时包含 release 公钥；
   - 前端 TS：`BUILTIN_PACK_KEYRING` 同步登记（与 Rust 一致），用于打包/预览端一致性校验；
   - 公钥 fingerprint 进入发布说明，便于外部核对。
5. **轮换（重叠期）**
   - 新 keyId 与旧 keyId **同时 active**（T24 keyring 已支持多把同时有效）；
   - 新包用新 key 签名；旧包在重叠期内仍可验证；重叠期结束前发布公告；
   - 重叠期结束：旧 key 从 active 列表移除（不再接受旧签名新包），保留验证历史（审计只读）。
6. **吊销/紧急响应**
   - 吊销通过撤销列表分发（T24 已支持 `revoked`/`expiresAt`；产品 env/配置更新即生效）；
   - 撤销后：所有用该 key 的包在 scan/install/UI 显示 invalid 并拒绝安装；已安装包的
     后续启动应由 T20 recover/safeMode 提示修复/回滚/卸载（联动待实现）；
   - 吊销操作需记录：原因、影响包列表、发布时间。
7. **审计与可验证性**
   - 每次发布输出：包 id/version、manifest sha256、资产哈希、keyId、签名者、时间；
   - `validation-matrix`/发布说明附签名验证方法（工具 self-test / Rust scan）。

## 被拒方案

- **把私钥放 CI secrets 自动签名**：当前阶段包量小，降低密钥暴露面优先；后续可评估迁移。
- **只在前端验签**：Rust 安装流程必须硬拒绝（已实现），前端只做展示。
- **服务端集中签名**：引入服务可用性/密钥托管复杂度，暂不做。

## 实施清单（T24/T26 收尾）

- [ ] 生成正式 release 密钥（离线）并登记公钥 fingerprint；
- [ ] 公钥注入产品构建配置（Rust env/配置文件）与 TS `BUILTIN_PACK_KEYRING`；
- [ ] 打包脚本串联：build → manifest → 资产哈希 → 签名（`sign_pack.mjs --write`）→ 校验
      （Rust scan `signatureStatus=valid`）→ 归档；
- [ ] 撤销/轮换演练（Windows E2E W）：有效签名安装 → 撤销后拒绝 → 轮换重叠期可用；
- [ ] 发布说明附签名验证信息与轮换公告模板。
