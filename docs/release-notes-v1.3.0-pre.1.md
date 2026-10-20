# AstraNota v1.3.0-pre.1（预发布）

> **预发布版本**：用于先试用 Focus 新版 UI；不替代正式版，Latest 仍为 `v1.2.18`。
> 本版为前端 UI 深度重构（Focus 设计交接包全面对齐），不涉及文档格式/索引结构变化，工作区无需迁移。

## 本版内容（Focus UI 全面对齐 + 补齐缺失功能）

- **壳层**：去掉顶栏/标签栏/常驻右栏；256px 浮动侧栏、860px 居中纸面 + 680px 阅读列、46px 浮动命令条、右侧按需「文档信息」浮层；窄屏抽屉。
- **页面化导航**：知识库 / 搜索 / 模块 / 资料 / 回收站改为独立整页视图（继续写作、最近编辑、标签、文件夹、上传、恢复等保留）。
- **⌘K 命令面板**：最近文档 / 命令（新建、导出 PDF、源码、专注、外观、设置、页面导航）/ 打开的文档（当前标记 + 关闭），替代常驻标签栏。
- **设置页**：独立页形态（← 知识库 / 分组 tab / 分组卡 / 关于）。
- **浮层与菜单**：文档信息浮层（大纲优先、折叠至一级）；历史版本改右侧 sheet；命令条「⋯」菜单十条目（大纲与信息 / 文档属性 / 历史 / 源码 / 微分 d / 打印预览 / 导入 / 专注 / 外观 / 设置）。
- **专注模式**：顶栏「← 文档标题｜● 已保存 ☾」+ 极简格式底栏（沉底居中）+ Esc 退出。
- **启动器**：官方品牌标 + 46px 标题 + 720 列 + 常驻路径条（浏览…/打开）+ 右上主题/帮助。
- **其它**：引用块纯左竖线、文档元信息精简、启动器/空态装饰小字清理、命令条窄窗口滚动条修复、回收站恢复刷新侧栏；保留 1.2.18 全部功能（Tiptap 编辑/导出/历史/回收站/附件/模块/外观包/快捷键/打印/工坊入口）。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-pre.1_x64-setup.exe` | 51,129,095 B | `dbc8f0e968490b140a7b22068a3ff0ab96ceb0392e18f715729a87413ed421d7` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,247,909 B | `35e3e8f0f671a41ff47bbf5e9bdabe56b9d9bf0f6f9beb8f8a0ba08053d9bf70` |
| `manifest.sha256`（79 个产物） | 9,930 B | `386e87ac07fbc52c11ed9e6310f52b57e41697a40a6f546b1fe0eb85055f34cd` |
| `versions.json` | 16,026 B | `c7d5c68e4a77999c84e9cfcdf50fc4cfe4aa6403850fc9f1ccb934fdfc6c8391` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-pre.1`（NSIS x64，未签名）。

## 验证结果

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-pre.1`） |
| 前端全量测试 | **149/149 文件、2055 passed + 1 skipped**、EXIT=0 |
| 后端全量测试（Windows Python 3.14） | pytest exit 0（约 700 项，含 skip） |
| 侧车产物版本一致性 | 以随机端口拉起 sidecar → `/api/health.version = 1.3.0-pre.1` 与源码一致（运行时校验通过） |
| 视觉验收 | `KE_STRICT=1 node docs/focus-ui/verify-ui.cjs` → **16 张截图 / 178/178 断言 PASS / 0 DIFF** |
| 独立验收（qa-visual） | 两轮独立复验全 PASS（`docs/focus-ui/VERIFICATION-REPORT.md` §11/§12） |
| 产物校验 | 安装包内嵌版本 `1.3.0-pre.1`；manifest 覆盖 79 个产物（1 sidecar + 78 前端 dist 文件） |

> 诚实说明：本轮**未做 NSIS 实机安装 + GUI 端到端验收**（未在干净机/本机安装测试），也未做 Windows W 模式/DPI/IME 人工视觉回归；上述门禁覆盖代码/构建/版本一致性/视觉断言。安装/首启/导出闭环建议按 `docs/release-acceptance-checklist.md` 复核后再转正式版。

## 已知残留（P3，详见 `docs/focus-ui/VERIFICATION-REPORT.md` §12.4）

- 模块页筛选口径为标签而非设计稿「类型（定义/公式/定理/模板）」、卡片缺「被 N 篇引用」（需后端模块 API 扩展字段）；
- 设置独立页保留顶部分组 tab（可用性保留，设计稿为单列）；
- 启动器「最近使用」行无时间列（后端 recent-workspaces 仅返回 path/exists）；
- Windows/Tauri 真机 W 模式/DPI/IME 人工视觉未复验（以 WSL/headless 证据为准的结论不可冒充 W 真机验收）。

## 升级/回滚

- 预发布，可与 1.2.18 并存；直接覆盖安装即可（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（GitHub Releases 中仍为 Latest）。
