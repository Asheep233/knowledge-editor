# 发布验收清单（NSIS 实机安装 + 通用门禁）

> 起草：2026-09-06（v1.1.1 正式发布后） | 用途：
> ① **v1.1.1 补验**——NSIS 未实机安装验收（v1.1.0/v1.1.1 共同缺口）；
> ② **后续版本通用门禁**——发布前逐项打勾（参考 v0.7.3 M6 七步验收先例与 v1.1.1-pre.1 审查 UNVERIFIED 清单）。
> 用法：每项标注 ✅/❌ + 证据（截图/日志/命令输出）；❌ 项必须修复或降级后复验。

---

## 验收记录

| 项 | 值 |
|---|---|
| 验收版本 | （如 v1.1.1） |
| 验收包 | `KnowledgeEditor_1.1.1_x64-setup.exe`（sha256：____） |
| 环境 | 干净 Windows（____）· 纯净 `%APPDATA%\KnowledgeEditor`（先备份→清空模拟首装） |
| 日期 / 验收人 | ____ / ____ |
| 结论 | ① 通过 ② 有条件通过（附列表） ③ 不通过 |

---

## A. NSIS 实机安装验收（7 步闭环）

> 步骤 1-2 参考 v0.7.3 M6 已验流程；步骤 3-7 补齐 review UNVERIFIED #1/#2/#3/#5/#6。

### A1 安装与卸载元数据
- [ ] 静默/常规安装成功：安装目录（`%LOCALAPPDATA%\KnowledgeEditor` 等）、开始菜单+桌面快捷方式齐全
- [ ] 注册表 `Uninstall DisplayVersion` = 验收版本；卸载可清安装目录/快捷方式/注册表项
- [ ] 数据目录（runtime/workspace/app_config.json/settings.json）卸载后**保留**

### A2 首启与侧车
- [ ] 首次启动进入欢迎/引导（或默认工作区）；主界面完整渲染（文件树/状态栏/右栏）
- [ ] 任务管理器见 `knowledgeeditor-backend*.exe`；`/api/health` = 版本（前后端版本告警不出现）
- [ ] 侧车崩溃自动拉起：杀侧车进程 → 应用重试拉起 → health 恢复（「崩溃自动拉起」契约）

### A3 编辑保存闭环（字节级）
- [ ] 新建文档 → 输入 → 3s 自动保存 → 状态栏「已保存」
- [ ] **关闭 → 重新打开**：磁盘 .md 与关闭前**字节一致**（含 frontmatter `ke_version` = 版本）
- [ ] 会话重开（缓存路径）与冷开（解析路径）内容一致；大文档（≥256KB）重开可用

### A4 三种导出（重点——v1.0.2 曾静默失败）
- [ ] 导出 Markdown（KE 格式）：真实落盘；内容含 ke-* 标记与 frontmatter
- [ ] 导出普通 Markdown：KE 方言全部降级（无 ke-* 注释、无 ke_version）；与 `plain-export.test.ts` 用例口径一致
- [ ] 导出文档包 .zip：md + 附件齐全；**二次导出**结果一致（防静默失败）
- [ ] 每项做「文件字节比较 + 二次导出」双验证

### A5 R1 改名回归（防抖窗口内输入不丢）
- [ ] 输入草稿 → 3s 内页眉标题改名 → **编辑器内容保留**；磁盘新文件含草稿、旧文件消失
- [ ] 无「保存失败：文档已被删除（404）」假警报；文件树新路径激活
- [ ] （如可）子目录文档改名不再误报 409（F11）

### A6 R2 外部修改回归（外部版本胜出）
- [ ] 外部编辑器修改当前文档 → 弹窗 → 「重新加载外部版本」→ 编辑器 = 外部版本
- [ ] **等待 ≥ 一节自动保存周期**：磁盘仍 = 外部版本（未决保存未覆盖）
- [ ] 「保留当前编辑内容」分支：编辑器保持本地内容、不弹窗骚扰

### A7 综合回归
- [ ] 历史版本：保存数次 → 列表/预览/恢复弹窗；恢复后内容与索引一致
- [ ] 主题三态：浅色 / 深色 / 自定义强调色（含重启保持）；切换无监听器泄漏表现（无功能异常即可，泄漏看 F13 单测）
- [ ] 搜索：点击结果高亮 = 目标文档（F/K3 已修复项）
- [ ] 多实例互斥：同应用二次启动被引导或拒绝；原生菜单（新建/打开/最近/退出）可用
- [ ] 关窗握手：WM_CLOSE → 8s 内退出、侧车无残留、runtime 释放；`beforeunload` flush 兜底不弹阻断

---

## B. 通用发布门禁（每版本发布前逐项）

### B1 回归
- [ ] `frontend`：`npx vitest run` 全绿；`npx tsc -b --noEmit` 0 错误
- [ ] `frontend`：`npm run build` → `dist-build/`（**不是 dist**；看时间戳确认刷新）
- [ ] `backend`：`pytest -q` 全绿（WSL python3 即可复跑）
- [ ] `desktop`：`cargo test settings` 11 passed（**先杀 GUI**）
- [ ] 导出专项：plain-export.test + export-actions.test 全绿且 `plain-export.ts`/`export-actions.ts` **diff=0**（红线）

### B2 版本一致性
- [ ] 九处源 = 目标版本且 grep 无旧串残留（backend `__init__.py` / frontend package+lock / desktop package+lock / Cargo.toml+Cargo.lock / tauri.conf.json / version.ts）
- [ ] sidecar 重建（PyInstaller）+ 独立拉起 `/api/health` = 版本
- [ ] manifest/versions 重生成（gen-manifest.py ≥81 项；**NSIS 不入 manifest**）

### B3 产品与拍板红线复核（逐条对照）
- [ ] 深色强调色默认 `#3b82f6` 未改（参考稿 #fc2c50 仅为用户可自定义）
- [ ] ke-module `display:none` 无边界（无卡片/徽章/边框）
- [ ] 三种导出零改动；多标签 TabBar/回收站仍为拍板延后
- [ ] 阴影透明（层级只靠边框）；DM Sans 400/500/700 在位；深色 `--border` #333333 未调暗
- [ ] `dist-build` 路径、`frontendDist` 同步；`/api/health` 与前端 `APP_VERSION` 一致

### B4 发布动作（照剧本）
- [ ] git tag（SemVer）+ push（token URL；以 gh API 为准核对远端）
- [ ] `gh release create` 四附件（sidecar / NSIS / manifest.sha256 / versions.json）；Latest/Pre 标记正确
- [ ] 文档三件套（CHANGELOG_DEV / README / PROJECT_STATE）+ 本清单过一遍；backlog/迭代计划归档

---

## C. 已知缺口（每次验收在报告中单列，勿混入通过项）

1. **Windows 真机 GUI 验证**：若验收机缺 CDP/输入自动化，步骤 A5/A6 以「代码级回归 + 上轮 CDP 证据」备注替代，并在报告注明。
2. **多实例/原生菜单/关窗握手**：仅真机可验；CI 与沙箱环境一律标「未验证」。
3. **大文档性能**：F22 未修前，A3 大文档项只做「可用性」验收（不卡死），不做性能承诺。
