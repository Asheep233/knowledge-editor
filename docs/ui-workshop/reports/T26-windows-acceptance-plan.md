# T26 Windows 验收计划（隔离安装产品 E2E）

> 目标：在**不干扰用户正在运行的 AstraNota**、不触碰真实笔记库的前提下，对产品壳做真实
> Windows/WebView2 端到端验收，补齐 prototype 探针覆盖不到的产品交互（T16/T21/T23/T24）。
> 当前状态：计划已定，**尚未执行**（不能把计划当证据；执行后需产出 W 证据 JSON + 截图/日志）。

## 1. 隔离策略（红线）

1. **独立 identifier 测试构建**：测试构建必须使用与产品不同的 identifier（如
   `com.astranota.uiws.e2e`），使单实例锁、app_data、WebView2 数据目录均与用户实例隔离。
   - 候选方式（执行前先验证）：Tauri 构建期 config 覆盖（`TAURI_CONFIG` 环境变量/临时 config 副本），
     或临时复制 `desktop/src-tauri` 到独立目录改 identifier 后构建；
   - **禁止**直接运行产品构建（会与用户运行中的 App 单实例冲突/抢占 sidecar 端口）。
2. **隔离数据/工作区**：`C:\ke-tmp\uiws-t26\...` 临时目录；每次场景前清空；绝不使用 `D:\AstraNota` 或真实库。
3. **sidecar 端口**：确认测试构建 sidecar 端口与用户后端（90132/70000 等）不冲突；必要时用
   独立端口配置/临时 backend 目录；冲突时**不杀用户进程**，改用其它端口。
4. **清理**：场景后关闭测试实例、kill 测试进程、删除临时目录；保留证据文件到
   `docs/ui-workshop/evidence/`。
5. **不发布**：测试构建仅本地，不推送、不发布 Release。

## 2. 验收场景（W 证据）

| # | 场景 | 通过标准 | 关联任务 |
| --- | --- | --- | --- |
| A1 | 测试构建启动 + 隐藏打印 renderer（`KE_WS_PRINT_RENDER=1`） | 主窗口正常；renderer 隐藏不抢焦点；关闭无残留 | T16/T20 |
| A2 | 快照打印 | `print_snapshot_pdf` 产出 PDF；ready 握手路径生效（无超时日志）；内容/页数正确；**不覆盖已有文件**；取消后无残留 job | T16 |
| A3 | 启动 recover + safeMode | 预置损坏包 → 启动自动回退/`corrupt-no-fallback`；safeMode 徽标/横幅；应用可继续使用 | T20 |
| A4 | 签名安装 | 有效签名包 → 安装成功、扫描/列表显示 valid；篡改包 → 预览 blocked + 安装拒绝；撤销密钥 → 拒绝 | T24 |
| A5 | 工坊信任 UI | 授予 trusted/撤销 → TrustStore 持久化（重启后保留）；Broker 能力上限生效 | T23/T24 |
| A6 | 安装→启用→回滚→卸载 | 每步磁盘 state 正确；回滚后 active 版本正确；卸载清理目录与状态（附件/索引清理另列） | T21/T23 |
| A7 | 包隔离宿主（真实入口） | 安装真实包 → 启用后 guest 会话 active、能力受限；崩溃 → suspended/failed/safeMode；停用/恢复状态持久化 | T19 |
| A8 | Core 保存 flag（`VITE_KE_CORE_SAVE=1`） | 保存/切档/外部改盘/恢复点不回归；与旧链落盘字节一致 | T14 |

## 3. 前置条件

- [ ] 独立 identifier 测试构建可重复产出（脚本化，记录命令/版本/哈希）；
- [ ] 隔离 app_data/工作区/端口环境变量约定（写入 runner 脚本）；
- [ ] 证据落盘约定：`evidence/T26-<场景>-results.json` + 失败时截图/日志；
- [ ] 明确回滚：删除测试构建产物与临时目录，不影响用户实例。

## 4. 完成定义（T26 认证口径）

- A1–A8 全部通过（真实 Windows/WebView2，隔离环境，证据可复现），且
  `run_all_w_probes.py --check`（13/13 prototype 探针）保持 PASS；
- Windows 安装包升级/回滚演练（发布候选阶段，T27）另行补充；
- 任一场景失败：记录复现步骤/日志，**不得降级成 U/A 证据**，任务保持 in_progress。
