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
| A5 工坊信任 UI（入口/真实列表/签名徽章/授予撤销/TrustStore 持久化） | **11/11** | `P5-T26-A5-ui.md` |
| A8 Core 保存 flag 产品 UI（autosave→上下文写/frontmatter 保留） | **9/9** | `P5-T26-A8-save.md` |
| A7 产品侧包隔离宿主 + A5 能力上限运行时（自定义协议/心跳崩溃/safeMode/停用持久化） | **11/11** | `P5-T26-A7-A5-guest.md` |
| 原型壳 W 探针一键门禁 | **13/13** | `P5-T26-windows-witnesses.md` |
| 产品 IME 组词 + DPI/缩放后编辑面可用（CDP/WebView2 渲染层） | **7/7** | `P5-T26-ime-dpi.md` |

> 说明：A1–A8 全部已通过真实产品壳 W；T26 认证仍需补真实 IME/多 DPI、安装包升级/回滚演练（T27）。

## 2. 本轮发现并修复的真实缺陷（W 价值）

1. `PrintRenderState` 未 `.manage()` → 打印命令 State 注入失败（T16 单元/构建不可见）；
2. `workshop_pack_activate` 非幂等 → 重复激活破坏 previous/rollback 目标（已修复 + 单测）；
3. 隔离构建 `frontendDist` 绝对路径导致 file:// origin → IPC 失败（需相对路径嵌入资源）；
4. 测试构建与主构建共享 target 互相覆盖 exe（单实例静默接管）→ 固定测试 exe 目录。

## 3. 未完成项（不得省略）

- **A5/A7**：已完成（`P5-T26-A7-A5-guest.md` W 11/11）；首跑失败记录保留于
  `P5-T26-A7-A5-guest-attempt.md`（CSP 发现 → 自定义协议修复）；
- **A7**：产品侧包隔离宿主（真实入口资源 + 崩溃检测 + 停用/恢复持久化）—— 原型已 W 8/8，产品壳未接；
- **A8**：`VITE_KE_CORE_SAVE=1` 产品 UI 保存 **已完成 W 9/9**（autosave→`/api/context/write`、frontmatter
  保留；排查中修复 base URL/sidecar 版本/上下文写入 merge 三个真实缺陷），见 `P5-T26-A8-save.md`；
- **人工真实系统 IME/多 DPI**（CDP 路径已过 W 7/7，但不能替代人工输入法实测）；
- **安装包升级/回滚演练**（发布候选阶段 T27）；
- 正式发布密钥签发/分发流程（ADR-003 实施清单）。

## 4. 认证判定

- 当前**接近但未满足** T26 最终完成定义（A1–A8 全绿 ✅ 已达成；仍缺真实 IME/多 DPI、安装包升级演练）；按完成度词汇若需对外表述，项目级仍为
  **`P0_READY`**（工坊尚未在产品 UX 完整落地），不得使用 `EXPERIMENTAL_TRUSTED_PACKS` /
  `LOCAL_WORKSHOP_RELEASE_CANDIDATE` 等更高状态。
- 建议下一阶段顺序：A5/A7（产品包宿主 + 信任 UI）→ A8 → 真实 IME/多 DPI → 安装包升级/回滚 →
  重新评估认证与状态词汇。

## 5. 隔离缺陷与操作事故（2026-10-19，必须披露）

- **产品 `data_dir()` 不随 identifier 变化**（`%APPDATA%\KnowledgeEditor`）：T26 测试构建早期版本
  与用户运行实例共享该目录 → 测试实例读取到用户真实 app_config 的最近工作区，A8 首跑在 UI 上
  **只读显示**了用户真实工作区列表（无编辑/保存；索引/设置未被测试改写，已核对 mtime）。
  修复：全部 T26 runner 注入 `APPDATA=<隔离目录>`（已提交），之后 A8 只显示隔离工作区；
  已删除真实 app_config 中被测试注入的 1 条 `hello.md` recent_document 记录。
- **两次误杀用户 App**：① 早期 runner 清理误用 `taskkill /IM knowledgeeditor.exe`；
  ② 一次清理命令误用 `Stop-Process -Id <用户 PID>`。均已即时重启用户 App（当前运行正常），
  红线已写入工具文档：**测试进程只按自身 PID 终止；sidecar 只按测试路径白名单清理；
  禁止引用/操作 `D:\AstraNota` 用户进程**。
- 遗留：真实 `%APPDATA%\KnowledgeEditor\runtime\runtime.json` 可能仍记录测试 PID（stale）；
  用户 App 下次启动会重写/清理，不影响数据。
