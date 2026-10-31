# AstraNota v1.3.0-pre.7（预发布）

> **预发布版本**：正式版仍为 `v1.2.18`（Latest）。本版修复用户实测的**公式编辑框焦点串到正文**问题：
> 打开公式编辑框后，点击预览/模板/空白区域再编辑或复制时，键盘焦点可能被抢回正文，导致输入/快捷键改到文档里。
> 其余内容与 pre.6 相同。

## 相对 v1.3.0-pre.6 的修复

### 公式编辑框焦点隔离（用户实测：「编辑/复制的时候有些时候会编辑到正文里」）
- **根因**（真机/浏览器复现 + 调用栈定位）：
  1. 公式模态用 `createPortal` 渲染到 `document.body`，但它仍写在滚动容器的 **React children** 里 ——
     点击模态内的「渲染预览 / 模板 / 空白」时，React 合成事件沿 **React 树** 冒泡回正文滚动容器的
     `onClick`，其中 `if (!editor.isFocused) editor.commands.focus()` 把焦点抢回 ProseMirror 正文；
     之后输入/复制/快捷键就作用在文档上（实测：点击预览后 `activeElement` 从公式 textarea 变成
     `.ProseMirror`，随后输入直接写进正文）。
  2. 模态自身未做焦点保持：点击非控件区域后 `activeElement` 掉到 `body`，首次按键前若再有其他
     focus 逻辑介入即串台。
- **修复**：
  1. 滚动容器 `onClick` 增加 DOM 包含关系守卫：**只处理容器内 DOM 的点击**（portal/浮层点击一律不聚焦正文）；
  2. 公式模态内点击任何非控件区域后，焦点**交还 LaTeX 输入框**（保留「拖选预览/原文准备复制」的选区，不强行抢焦点）；
     点击外圈遮罩不关闭、不丢焦点；
  3. 快捷键分发器增加焦点上下文守卫：焦点在输入框/textarea/select/非主编辑器的 contenteditable，
     或存在 `aria-modal` 对话框时，**不执行全局编辑器快捷键**（避免自定义键位把焦点抢回正文）。
- **回归防护**：`verify-ui.cjs` 新增 5 条真实浏览器断言（打开模态焦点在 textarea、点击预览后焦点仍在输入框、
  输入不写进正文、输入进入 textarea、Esc 后模态关闭）→ 断言总数 190→**195**；
  另新增单测：`MathEditorModal.batch.test.tsx` 焦点隔离用例 + `shortcuts.test.ts` 上下文守卫用例。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-pre.7_x64-setup.exe` | 51,130,390 B | `006d091ab7447a9e56fc5bcd295df3b92fac851955dfa1ab2239be67a1dadefc` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,247,891 B | `b1c6de6bf72214cf85221ac5d297f7fe124c0e42b9ef50cd9a06f5865696a466` |
| `manifest.sha256`（79 个产物） | 9,930 B | `5ff83c864eb35f753c4f0d5ab83d67ea9c48a0d3ada10d2d5013382868376f74` |
| `versions.json` | 16,026 B | `98b6aaacb5f32acbf551aeec5f90f3d6014bf698777c07ec20b694bcde163a68` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-pre.7`（NSIS x64，未签名——未提供证书）。

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-pre.7`） |
| 前端全量测试 | **151/151 文件、2065 passed + 1 skipped**、EXIT=0（新增焦点隔离/守卫单测） |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF（新增公式模态焦点 5 条） |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-pre.7` 与源码一致 ✔ |

## 包含 pre.6 的修复
- 启动看门狗（WebView2 初始化挂起兜底）、保存状态恢复、编辑器右侧自绘滚动条；以及 pre.5 的关窗加固/最近文档隔离、pre.1–pre.4 全部内容。

## 已知残留
同 pre.6（安装包未签名、125%/150% 缩放与多屏未补验、附件/模块端到端未补验、大文档性能待专项等）。

## 升级/回滚
- 预发布，可直接覆盖安装 pre.1–pre.6（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。
