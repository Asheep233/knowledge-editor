# P4-T24/T23 证据：信任授权 UI + 过渡持久化（全量前端 128 files/1783 passed）

- 日期：2026-10-19 · 代码：
  - `frontend/src/core/packs/localTrustStore.ts`：`LocalTrustStore`（注入 `KeyValueStorage`；
    产品=localStorage，测试=内存）：默认 community、grant/revoke 持久化、损坏 JSON 视为空、非法等级忽略；
  - `tauriPackAdapter`：`tierOf/grantTrust/revokeTrust`（经 TrustStore；默认 localStorage）；
  - `WorkshopPanel`：已安装包行新增 **信任等级徽章** + **签名状态徽章**（valid/invalid/missing）+
    「授予信任（trusted）」「撤销信任」按钮（按等级禁用）；每次刷新通过 `adapter.tierOf` 合并等级。
  - 测试：localTrustStore 3 例；WorkshopPanel 新增 2 例（信任徽章+授予/撤销、签名徽章）；
    tauriPackAdapter 新增 1 例（TrustStore 读写）；
- 证据类型：**U（单测 + 全量前端回归）**；产品最终应把 TrustStore 挪到 Rust 设置存储（T21/T24 产品化）

## 验证结果

```text
$ npx vitest run src/components/workshop src/core/packs
Tests  77 passed (77)
$ npx tsc -b --noEmit
exit 0
$ npx vitest run --maxWorkers=2      # 全量前端
Test Files  128 passed (128)
     Tests  1783 passed | 1 skipped (1784)
```

| 用例 | 验证 |
| --- | --- |
| LocalTrustStore | 默认 community；grant/revoke 跨实例持久化；损坏 JSON/非法等级容错 |
| TauriPackAdapter TrustStore | tierOf/grant/revoke 生效 |
| WorkshopPanel 信任 UI | 显示 community；授予→adapter(grantTrust,trusted)+刷新；撤销→adapter.revokeTrust+刷新 |
| WorkshopPanel 签名 UI | 签名状态徽章展示（invalid 等） |
| 全量回归 | 128 files / 1783 passed + 1 skipped（exit 0），无回归 |

## 结论

- T24 信任策略已**贯通到用户可见的工坊控制面**：信任等级可授予/撤销并在 UI 展示；签名状态可展示
  （数据源待接入真实验签）；持久化有过渡实现（localStorage），可平滑替换为 Rust 设置存储。
- 尚未完成（T24/T23 继续）：
  1. 签名状态数据源接入真实验签（tauriAdapter 扫描时调用 `verifyPackSignature` + 公钥信任根）；
  2. TrustStore 产品化（Rust 持久化、启动加载、授予时二次确认/审计）；
  3. Windows 端到端交互 W（授予 trusted → 能力上限生效 → 撤销后受限）与安全演练。
