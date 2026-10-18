# P4-T24/T23 证据：真实签名状态数据源接线（Rust list/scan → 工坊 UI）

- 日期：2026-10-19 · 代码：
  - 产品 Rust `pack_store.rs::list_packs`：读取 active 版本 manifest 并调用 `signature_status`
    → 返回 `signatureStatus`/`signatureReason`（`workshop_pack_scan` 已有同字段）；
  - `tauriPackAdapter`：
    - `listInstalled` → `InstalledPackView.signature = signatureStatus`（工坊列表展示真实签名徽章）；
    - `stageFromFile` → 预览 `signature` 取真实状态；**invalid → blocked + 原因 + 警告**
      （安装入口被禁，理由来自 Rust 验签）；
  - 工坊 UI（既有）：签名徽章 valid/invalid/missing 直接显示真实数据。
- 测试：产品 Rust 单测增加 list 签名状态断言（cargo **38 passed**）；tauriPackAdapter 新增
  list 映射 + scan invalid/valid 映射用例；工坊+packs **87 passed**；全量前端
  **130 files / 1795 passed + 1 skipped**、tsc 0。
- 证据类型：**U/B（Rust/TS 单测 + 全量回归）**；Windows 端到端验签安装 W 未做

## 结论

- T24 签名链路已贯通到用户可见 UI：**打包签名（工具）→ Rust 验签 → scan/list 状态 → 工坊徽章/安装阻止**；
  数据源为真实验签结果，不再是前端占位。
- 尚未完成（T24 收尾）：
  1. 正式发布密钥流程（离线签名/公钥进构建配置/轮换与撤销发布）；
  2. Windows 端到端 W：有效签名安装 → 撤销后拒绝 → 轮换重叠期可用；
  3. 非 active 版本签名状态（回滚前提示）与信任授权审计日志。
