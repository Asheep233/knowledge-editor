# AstraNota v1.3.0-pre.2（预发布）

> **预发布版本**：正式版仍为 `v1.2.18`（Latest）；本版在原 `v1.3.0-pre.1` 基础上修复两个发布后实测问题。
> 不涉及文档格式/索引结构变化，工作区无需迁移。

## 相对 v1.3.0-pre.1 的修复

### 1. 源码模式编辑框塌陷（用户实测）
- 现象：⋯ 菜单切到源码模式后，Markdown 编辑框只有 ~66px 高，长文只能在小框里滚动。
- 根因：Focus 纸面为「自动高度」（仅 `min-height`），源码模式视图根节点的 `h-full` 无法解析 → flex 高度链断裂。
- 修复：`[data-testid='source-mode-view'] { min-height: max(360px, calc(100vh - 340px)); }`。
- 实测（1440×900）：编辑区 **66px → 498px**，占满纸面、内部滚动正常、切回正文 ProseMirror 正常。
- 回归防护：`verify-ui.cjs` 新增源码模式断言 + `17-source-mode-1440x900.png`。

### 2. 导出 PDF 卡顿（用户实测，桌面 WebView2 复现）
- 现象：长文档点「导出 PDF」后明显卡顿/主线程冻住（实测 41885 节点 / 720 KaTeX / 正文 HTML 2.45MB 的文档，点击动作 >30s 未完成）。
- 根因：①打开对话框瞬间 `cloneNode` 深克隆整篇正文 DOM；②DOM 回退预览**按页复制 N 份整篇正文**（长文档 20+ 页）；③桌面态真 PDF 预览生成期间也先渲染 N 份副本。
- 修复：预览快照改为**按需克隆**（仅非桌面态/真预览失败时）；桌面生成期只渲染轻量占位；DOM 回退预览最多 8 页并提示「导出为完整 PDF」。
- 实测（同一 4 万节点文档，重建后桌面版）：对话框打开 **567ms**（修复前点击冻结 >30s）、生成期间 DOM 节点数保持 41.9k（无副本爆炸）、真 PDF 预览就绪 3.16s；短文档路径不变（打开 83ms / 预览 800ms / 导出 304ms）。
- 证据：`docs/focus-ui/evidence/export-perf/measurements.json`。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-pre.2_x64-setup.exe` | 51,127,924 B | `0c31e9e16846a67a0382da445bc8dc965da7751b2e948c1ea405f5960e01ef9a` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,247,753 B | `568a7deb5a6987c13ed4d29a97de773f845d80929e3fd6db9fcf99479ceb80c5` |
| `manifest.sha256`（79 个产物） | 9,930 B | `d8129929519f018ed8a3e38992c3f34d43b91d053ce2519b07ebc672e1e708d5` |
| `versions.json` | 16,026 B | `8cd5498ebed2e7c81c47703f3fdea5d9bfae0f942b7ba0ba77c08602702605c1` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-pre.2`（NSIS x64，未签名）。

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-pre.2`） |
| 前端全量测试 | **149/149 文件、2055 passed + 1 skipped**、EXIT=0 |
| 视觉验收 | 17 张截图、**184/184 断言 PASS**、0 DIFF |
| 后端 | 代码未变（仅版本号）；上轮 Windows pytest exit 0 |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-pre.2` 与源码一致 ✔ |
| 桌面导出实测 | 真实 WebView2（隔离 APPDATA/测试工作区）复现卡顿 → 修复后数据见上；**未做 NSIS 实机安装 + GUI 端到端验收**（诚实说明） |

## 已知残留（P3，详见 `docs/focus-ui/VERIFICATION-REPORT.md` §12.4）

- 模块页筛选口径为标签而非设计稿「类型（定义/公式/定理/模板）」、卡片缺「被 N 篇引用」（需后端模块 API 扩展字段）；
- 设置独立页保留顶部分组 tab（可用性保留，设计稿为单列）；
- 启动器「最近使用」行无时间列（后端 recent-workspaces 仅返回 path/exists）；
- Windows/Tauri 真机 W 模式/DPI/IME 人工视觉未复验；安装包未签名。

## 升级/回滚

- 预发布，可与 1.2.18 / 1.3.0-pre.1 覆盖安装（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）；`v1.3.0-pre.1` 保留在历史预发布中。
