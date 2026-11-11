# AstraNota v1.3.0-rc.5（Release Candidate 5）

> **发布候选版**：正式版仍为 `v1.2.18`（Latest）。RC.5 新增「**插入分割线**（水平线 / Horizontal Rule）」功能，Markdown 侧沿用 GFM `---`，编辑器/导出 PDF 均已接线。

## 新增：插入分割线

三个入口，同一命令（ProseMirror `setHorizontalRule`）：
1. **工具栏**：格式组「插入 ▾」→「分割线」；
2. **命令面板**：`⌘K` → 搜索「插入分割线 / 分割线 / 水平线 / hr / divider」；
3. **Markdown 输入**：空行处输入 `---` 后回车（既有 GFM 输入规则）同样会生成分割线。

行为与保真：
- 编辑器中以分隔线渲染（`--border` 细线，暗色/浅色主题一致）；
- 保存到 Markdown 是独立一行 `---`，重新打开仍解析为分割线（往返幂等，附带回归测试）；
- 导出 PDF / 打印预览中同样渲染为分隔线（沿用编辑器 `hr` 样式）；
- 源码模式下不提供插入命令（源码通道直接编辑 Markdown，`---` 可手写）。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-rc.5_x64-setup.exe` | 51,160,835 B | `2c791b9f78edb46b59d2d248f9305a2c07750a20d223be3116db27c284216ad7` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,252,175 B | `e77bac70d584d1de8e9b840fbc41a25c02ce6d72fcbd7c885130c044f14b57a5` |
| `manifest.sha256`（79 个产物） | 9,930 B | `44d23cabc483ef23e10a2f8745d6d1dfff242b35a9ca08ea95ca8eb76f7efa4e` |
| `versions.json` | 16,026 B | `65cfabe2b8645da821f4a0fbfd8c9eaa7c072b42716c98496865c5add8676f1a` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-rc.5`（NSIS x64，未签名）。

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-rc.5`） |
| 前端全量测试 | **157/157 文件、2105 passed + 1 skipped**、EXIT=0（新增分割线/工具栏/命令面板断言） |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-rc.5` 与源码一致 ✔ |
| 分割线专项 | `---` ↔ horizontalRule 双向、`setHorizontalRule` 保存/重开、幂等 3 例；工具栏插入菜单含「分割线」；⌘K 命令「插入分割线」可执行 |

## 已知限制（未变）

安装包未签名｜125%/150% 缩放与多屏未验｜附件/模块端到端未验｜10k 首次激活不支持｜20MiB 默认排版首开约 2 分钟｜富媒体图片保真/慢资源超时未验｜系统打印 fallback UNVERIFIED。

## 升级/回滚
- 可直接覆盖安装 rc.1–rc.4 及更早预发布（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。
