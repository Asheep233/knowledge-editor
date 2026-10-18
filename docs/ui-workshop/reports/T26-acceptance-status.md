# T26 Windows 验收状态（阶段，非最终认证）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 155 · 环境：隔离测试构建
  （独立 identifier `com.astranota.uiws.e2e`，测试数据在 `C:\ke-tmp`，不触碰用户实例/真实笔记）
- 结论口径：**A1–A6 已完成（真实产品壳 W 证据）；A7/A8/真实 IME/多 DPI/安装包升级未完成 →
  T26 尚未达到最终认证，不冒进标记。**

## 1. 已完成场景（真实产品壳 W）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A1 隔离构建/启动/独立 appData/启动 recover/单实例/用户 App 不受影响 | **7/7** | `P5-T26-isolated-smoke.md` |
| A2 隐藏 renderer + 快照打印 + ready 握手 + 路径安全/不覆盖 | **9/9** | `P5-T26-A2-print.md` |
| A3 启动 recover（回退/无回退 safeMode）不阻断启动 | **9/9** | `P5-T26-A3-recover.md` |
| A4 签名信任链（valid/missing/invalid/revoked → 安装拒绝） | **通过** | `P5-T26-A4-A6-install.md` |
| A6 安装→启用→回滚→卸载（磁盘 state 校验） | **通过** | 同上（A4+A6 合计 16/16） |
| 原型壳 W 探针一键门禁 | **13/13** | `P5-T26-windows-witnesses.md` |

## 2. 本轮发现并修复的真实缺陷（W 价值）

1. `PrintRenderState` 未 `.manage()` → 打印命令 State 注入失败（T16 单元/构建不可见）；
2. `workshop_pack_activate` 非幂等 → 重复激活破坏 previous/rollback 目标（已修复 + 单测）；
3. 隔离构建 `frontendDist` 绝对路径导致 file:// origin → IPC 失败（需相对路径嵌入资源）；
4. 测试构建与主构建共享 target 互相覆盖 exe（单实例静默接管）→ 固定测试 exe 目录。

## 3. 未完成项（不得省略）

- **A5**：信任授予/撤销 UI 的产品级验证（flag 构建 + CDP UI 交互）+ 能力上限在真实包会话的运行时验证
  （依赖 A7 产品侧 PackageHost 装配）；
- **A7**：产品侧包隔离宿主（真实入口资源 + 崩溃检测 + 停用/恢复持久化）—— 原型已 W 8/8，产品壳未接；
- **A8**：`VITE_KE_CORE_SAVE=1` 的产品 UI 保存/切档/外部改盘/恢复点验证；
- **真实 OS 中文 IME / 多 DPI**（T15/T26）；
- **安装包升级/回滚演练**（发布候选阶段 T27）；
- 正式发布密钥签发/分发流程（ADR-003 实施清单）。

## 4. 认证判定

- 当前**不满足** T26 最终完成定义（A1–A8 全绿）；按完成度词汇若需对外表述，项目级仍为
  **`P0_READY`**（工坊尚未在产品 UX 完整落地），不得使用 `EXPERIMENTAL_TRUSTED_PACKS` /
  `LOCAL_WORKSHOP_RELEASE_CANDIDATE` 等更高状态。
- 建议下一阶段顺序：A5/A7（产品包宿主 + 信任 UI）→ A8 → 真实 IME/多 DPI → 安装包升级/回滚 →
  重新评估认证与状态词汇。
