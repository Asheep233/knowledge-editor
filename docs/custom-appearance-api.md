# 自定义 UI 外观接口（基于 v1.2.16）

整套前端自由改造与一键切换的扩展方向见 [UI 创意工坊设计](ui-workshop-design.md)。该文为后续架构提案；本页描述当前已实现的轻量外观包。

## 结论与边界

可以让用户把外观需求交给 Agent，生成独立 JSON 外观包，再在 AstraNota 中预览和应用。保存、搜索、工作区、Markdown 保真、公式、模块、附件、历史、快捷键、源码模式和 PDF 仍由 v1.2.16 的原组件与原业务逻辑负责。

本实现开放界面配色、界面字体、字号、控件圆角、两侧栏宽度和导航左右位置。它不是任意 React 前端的热替换接口：替换整套前端需要另行建立完整命令、状态订阅、功能清单与插件生命周期协议。仅靠一个主题接口，无法保证任意第三方代码完整保留现有和未来功能。

外观包不加载 JavaScript、CSS、HTML、远程资源或组件，不写文档，不注册快捷键，不改变事件处理、编辑器插件或序列化。Agent 也不需要修改应用源码。新增功能仍由宿主组件正常渲染；包没有提供的参数沿用宿主默认值。

## 用户流程

1. 打开「设置 → 外观 → 自定义外观包」，载入示例或导出当前外观。
2. 将包和本规范交给 Agent，描述想要的界面。
3. 导入 Agent 返回的 JSON，先校验，再预览。设置暂时隐藏，在主界面显示最长 30 秒的预览确认条；保留、取消或到期后返回设置，关闭设置也会取消。
4. 点击应用后保存；可以恢复默认、回滚上一次保存的外观、导出当前包或原始备份。

首次可以直接试用内置「静谧青绿」示例，或导入 [完整示例 JSON](examples/appearance-quiet-sage.json)。已有明暗主题及强调色设置继续可用；包内提供的颜色只在界面区域覆盖同名颜色，未提供的颜色继承原主题。

## 包格式

```json
{
  "schemaVersion": 1,
  "appearanceApi": 1,
  "id": "my-sage",
  "name": "我的青绿界面",
  "version": "1.0.0",
  "font": "sans",
  "tokens": {
    "light": {
      "primary": "#42745b",
      "primary-foreground": "#ffffff",
      "sidebar": "#eff4ec",
      "sidebar-foreground": "#24332d",
      "sidebar-accent": "#ddebdc",
      "sidebar-accent-foreground": "#294b36",
      "ring": "#42745b"
    },
    "dark": {
      "primary": "#9ac5a0",
      "primary-foreground": "#1c3325",
      "sidebar": "#1f2b23",
      "sidebar-foreground": "#e5ece3",
      "sidebar-accent": "#354c3a",
      "sidebar-accent-foreground": "#d8ead4",
      "ring": "#9ac5a0"
    }
  },
  "metrics": {
    "sidebarWidth": 280,
    "inspectorWidth": 300,
    "controlRadius": 8,
    "uiFontSize": 13
  },
  "layout": { "navigationSide": "left" }
}
```

必须提供前五个标识字段，其余可省略。`id` 为 1–64 位小写字母、数字、点、下划线或连字符，以字母或数字开头；`name` 为 1–80 个可显示字符；`version` 为语义版本号。包的 UTF-8 大小不超过 64 KiB。所有未知字段、未知 token、非法值和不支持的协议版本均整包拒绝，不会部分应用。

| 参数 | 可用值 |
| --- | --- |
| `font` | `system` / `sans` / `serif` / `mono`；使用本地字体栈，无外链加载 |
| `tokens.light` / `tokens.dark` | 只接受 `#RGB` / `#RRGGBB`，归一化为六位十六进制色值 |
| `metrics.sidebarWidth` | 220–420 px；小窗口最多占 30vw |
| `metrics.inspectorWidth` | 260–440 px；小窗口最多占 32vw |
| `metrics.controlRadius` | 0–20 px；仅普通界面控件 |
| `metrics.uiFontSize` | 12–18 px；按原界面字号比例缩放 |
| `layout.navigationSide` | `left` / `right`；通过视觉顺序调整，组件不卸载重建 |

Token 名称：`background`、`foreground`、`card`、`card-foreground`、`popover`、`primary`、`primary-foreground`、`secondary`、`secondary-foreground`、`muted`、`muted-foreground`、`accent`、`accent-foreground`、`border`、`input`、`ring`、`sidebar`、`sidebar-foreground`、`sidebar-accent`、`sidebar-accent-foreground`、`sidebar-border`。

请成对设计前景/背景并检查两种主题下的可读性。校验器验证数据格式，不承诺自动修正任意配色的对比度。

## Agent 通用接口

应用启动后提供 `window.astranotaAppearance`，适用于能操作浏览器或 WebView 的 Agent。只有文件操作能力的 Agent 可以生成包，由用户在设置中导入。此版本没有新增 HTTP 端点或内置 LLM 服务。

```js
const ui = window.astranotaAppearance
const contract = ui.contract // 当前宿主支持的 tokens、范围、槽位及协议版本
const current = ui.get()     // { state, status, preview } 的独立快照
const result = ui.validate(agentGeneratedJson)
if (!result.ok) throw new Error(result.errors.join('\n'))
ui.preview(result.package)  // 最长 30 秒，不写盘
// 用户要求应用时：
await ui.apply(result.package)
// 其余操作：
ui.cancelPreview()
const savedPackageJson = ui.export()
const rawBackup = ui.exportBackup()
await ui.reset()
await ui.rollback()
```

`apply/reset/rollback` 返回 Promise，只有持久化成功才提交新外观；失败会抛出错误，保留原状态。外观写入操作按调用顺序执行。预览失效、应用、恢复和回滚都会触发 `ke:appearance-changed`，事件内容和读取结果均为快照。

`export()` 导出当前包；没有当前包或处于兼容回退时，可能导出存储 envelope。`exportBackup()` 导出完整存储 envelope（包含 `current` / `previous`），或保留的原始不兼容备份。普通导入只接受单个包；修复备份时由 Agent 提取其中 `current`，依据当前 `contract` 迁移后重新校验，不能把完整备份直接当作外观包导入。

给 Agent 的提示词示例：

> 根据 AstraNota Appearance API v1，生成一个可导入的 JSON 外观包。需求：低饱和青绿、清晰的浅深色主题、适中圆角、左导航 300px、属性栏 320px。先读取当前 contract；只使用受支持字段，保留前景/背景可读性。不要修改 React、编辑器、快捷键、Markdown 或导出代码。生成后调用 validate，展示预览；应用时使用 apply，保留回滚能力。

## 升级与恢复

软件版本、外观协议版本和包自身版本分别管理。`appearanceApi: 1` 不与 `APP_VERSION` 比较，因此软件从 1.2.16 升到兼容 v1 协议的后续版本时，不需要重做外观。

| 情形 | 处理 |
| --- | --- |
| 宿主新增功能、组件或默认 token | 原功能组件直接显示；未指定外观值使用宿主默认 |
| 包仍满足当前协议 | 启动时继续应用，不改写原包 |
| 新版/旧版不认识包协议或字段 | 使用默认外观，在设置中说明原因，保留原始配置 |
| 包 JSON 损坏 | 回退默认，不使启动失败；仍可导出原始内容 |
| 回退后用户应用新包或恢复默认 | 覆盖前将不兼容原始配置保存到独立备份字段 |
| 新包效果不理想 | 取消预览、30 秒超时恢复、恢复默认或回滚上一次 |
| Web 环境需绕开启动包 | 用 `?appearance=off` 打开，本次不加载包且不改存储 |

桌面端存储于现有 `%APPDATA%\KnowledgeEditor\settings.json` 的 `ui.displayPreference.appearanceV1`，Web 端存储于当前站点 localStorage `ke.settings.v1` 的同名位置；原始不兼容备份使用 `appearanceBackupV1`。这两个字段都是 JSON **字符串**，避免设置深合并导致旧 token 残留。它们属于用户配置，不进入安装目录或文档工作区。桌面端既有 `displayPreference` 通道原样保留这些值；v1.2.16 本身不识别外观包，但会保留该配置，重新安装支持接口的版本后可继续读取。

现有桌面发行流程是 NSIS 覆盖安装，此项实现没有新增自动更新器。后续如需发布不兼容协议，必须保留已有协议解释器，或提供显式、可备份的迁移器；不要静默重写用户包。原始备份只保留最近一次被替换的不兼容配置，长期归档请导出文件。

## 功能兼容约束

宿主为实际界面区域添加稳定 `data-ke-slot` 和 `data-ke-appearance-scope="chrome"` 钩子。渲染器只生成宿主掌控的样式，放在 `style#ke-appearance-style[media="screen"]` 中；不在 `:root` 写外观变量，不移动、克隆或重建功能组件。

覆盖范围为导航、属性栏、状态栏、编辑器工具栏、文档标签栏和设置页。中央正文、源码编辑框、公式编辑器、PDF 预览和打印不纳入外观包；原有弹窗里尚未令牌化的硬编码颜色，也不保证全部跟随包变化。文档排版如需自定义，应作为单独协议明确导出语义。

修改接口时必须验证：未安装包的基线行为、已有编辑器与快捷键回归、导入/持久化/回滚/不兼容保留、真实浏览器样式、切换外观时编辑器实例和内容不变，以及打印媒体下样式不受影响。Windows 安装、WebView2 原生 PDF 与 NSIS 覆盖升级仍需在 Windows 验收，不能由 Linux 浏览器测试替代。
