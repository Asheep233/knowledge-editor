# KnowledgeEditor Markdown 扩展规范

版本：1.0（Phase 1 确认稿）
状态：已确认（决策点 2）
适用范围：KnowledgeEditor 全部文档（Articles / Modules）

> **文档关系（P4-10）**：本文件是 **语义设计规范**（为何这样设计）；
> `docs/document-format.md` 是 **权威实现记录**（当前实现到底怎么行为）。
> 两者冲突时以 `document-format.md` 为准——规范的每一处改动都必须
> 先更新实现记录并补齐回归测试，再同步本文件。

---

## 1. 定位与设计原则

KnowledgeEditor 的 Markdown 方言 = **CommonMark + GFM 超集 + 数学公式 + KE 扩展**。

- 数学公式：行内 `$...$`、块级 `$$...$$`（KaTeX / MathLive）
- KE 扩展：注释（note）、模块（module）、附件（attach）、视频（video）四类节点

> **文本装饰说明（P4-11）**：删除线遵循 **GFM** 约定，`~~删除线~~` 为标准写法；
> 单波浪线 `~删除线~` 同样会被渲染为删除线（与 GFM 一致），**本编辑器不提供下标语法**，
> `~x~` 不会被解析为下标 `x`。如需下标，请使用 Unicode 下标字符（如 `x₁`）或行内公式 `$x_1$`。

KE 扩展以 **HTML 注释** 形式承载结构化元数据，设计原则：

| 编号 | 原则 | 含义 |
| --- | --- | --- |
| P1 | 透明性 | 注释在普通 Markdown 渲染器中不可见，文档可读性不受影响 |
| P2 | 幂等性 | 未知 `ke-*` 标记必须原样保留，任何工具不得删除或改写 |
| P3 | 宽容解析 | 非法 JSON / 未知类型按普通 HTML 注释处理，不破坏文档 |
| P4 | 引用稳定 | 每个节点携带 `id`（UUID），重命名/移动后引用不失效 |

## 2. 通用语法

### 2.1 标记格式

节点标记为**独占一行的 HTML 注释**：

```
<!-- ke-<type>: <json> -->
```

约束：

- `<type>` 仅限小写：`note` / `module` / `attach` / `video`
- `<json>` 为**单行**合法 JSON 对象（UTF-8），不允许包含字面换行
- 标记前后允许空行；与相邻段落之间建议空行分隔
- 行尾 LF / CRLF 均可

### 2.2 宽容解析规则

解析器（后端 `convert/`、前端 ProseMirror 插件）必须按下列规则处理：

| 输入情况 | 行为 |
| --- | --- |
| 合法 JSON + 已知类型 | 解析为对应节点 |
| 合法 JSON + 未知类型（如 `ke-chart`） | 原样保留，视为普通注释 |
| 非法 JSON（截断、语法错误） | 原样保留，视为普通注释 |
| 类型名大小写不符（如 `ke-NOTE`） | 原样保留，视为普通注释 |
| 非 `ke-` 前缀的普通注释 | 一律原样保留 |

> 规则 P3 的推论：**任何未知标记都不会导致文档损坏、内容丢失或渲染崩溃**。
> 这是对第三方 Markdown 编辑器友好性的硬性要求（决策点 2）。

## 3. 节点定义
### 3.1 注释节点 `ke-note`

用途：文内批注、信息块、待办提醒。编辑器内显示为信息块（NoteNodeView：
可自定义标题/标签/颜色，块内文字为真实可编辑内容，可插入脚注上标等 inline 节点）。

**包裹格式（当前序列化形式，v0.7.0 起）**：

```
<!-- ke-note: {"id":"9f8c4e1a-...","kind":"note","title":"要点","label":"提示","color":"yellow"} -->
块内内容（可含脚注上标等 inline 标记）
<!-- /ke-note -->
```

**旧自闭合格式（v0~v3，解析兼容）**：`<!-- ke-note: {json} -->`，
`content`/`text` 属性在解析时迁移为文本子节点，保存后自动升级为包裹格式。

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID，节点唯一标识（缺失时由标题/颜色/内容生成确定性 id） |
| `kind` | 是 | 固定为 `"note"` |
| `title` | 否 | 信息块标题（缺省「信息块 HH:mm」） |
| `label` | 否 | 左上角徽章文字（缺省空串，NodeView 显示时兜底「信息」） |
| `color` | 否 | `blue`（默认）/ `yellow` / `red` / `green` 等 |
| `author` / `created` / `updated` | 否 | 元信息（保留字段） |

格式不变量（v1.1.1 R3 修复）：**空内容也必须输出闭合标记**
`<!-- /ke-note -->`——否则与旧自闭合格式混淆，重开时后续信息块
可能被空信息块吞噬。解析器按行扫描，闭合标记只认「本块范围」内
（下一个块级 ke-* 标记之前）者。

### 3.2 模块节点 `ke-module`

用途：可复用模块。**当前实现（v1.1.0 拍板）采用「插入后复制内容」方案：
不做动态引用/嵌套解析。** 编辑器主交互为「插入模块」——从 `Modules/` 拉取
内容并复制为普通文档正文；本文中的 `ke-module` 标记仅用于解析/兼容既有文档。

**序列化格式**（原子节点，独占行）：

```
<!-- ke-module: {"id":"a1b2c3d4-...","kind":"module","name":"formula-tips","version":1,"mode":"card","params":{},"source":"Modules/formula-tips.md"} -->
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID |
| `kind` | 是 | 固定为 `"module"` |
| `name` | 否 | 模块名（保留字段） |
| `version` | 否 | 引用的模块版本（保留字段） |
| `mode` | 否 | 保留字段（历史上 `inline`/`card`）——**当前不产生任何渲染行为** |
| `params` | 否 | JSON 参数对象（保留字段） |
| `source` | 否 | 模块来源相对路径（Phase 5 记录，不参与动态同步） |

渲染约定（拍板：模块无边界）：

- **编辑器内不渲染卡片/徽章/边框**——ModuleNodeView 仅渲染
  `display:none` + `aria-hidden` 的不可见占位（节点仍在 Document Model，
  保存时照常序列化为注释；用户感知不到底层标记）。
- 无 `mode=inline` 展开、无 `mode=card` 链接、无嵌套层级解析——
  这些行为不在当前实现范围（旧版设计的残留字段仅作保留兼容）。
- 模块文件缺失 / 版本不符：与插入式方案一致，不产生错误提示。

### 3.3 附件节点 `ke-attach`

用途：图片 / 文件的附件卡片。存储位置按类型分类（决策点 5）：

```
Attachments/
├── images/   图片
├── videos/   视频（与 ke-video 共用）
└── files/    其他文件
```

```
<!-- ke-attach: {"id":"c7d8e9f0-...","kind":"attach","type":"image","src":"Attachments/images/20260808-a1b2c3.png","title":"系统架构图","caption":"图 1：整体架构","width":"100%"} -->
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID |
| `kind` | 是 | 固定为 `"attach"` |
| `type` | 是 | `image` / `file` / `video`，决定渲染形态 |
| `src` | 是 | 相对 workspace 的附件路径（`Attachments/{images\|videos\|files}/...`） |
| `title` | 否 | 卡片标题 |
| `caption` | 否 | 图注 / 文件说明 |
| `width` | 否 | 仅 `image` 使用，如 `100%` / `480px` |

渲染约定：

- `type=image`：`<img>` + 居中图注，可点击放大预览
- `type=file`：文件名 + 大小 + 下载按钮卡片
- `type=video`：内嵌 `<video>`（与 ke-video 行为一致，仅本地）
- `src` 文件缺失时显示破损占位，不阻塞文档

### 3.4 视频节点 `ke-video`

用途：视频展示。**v1 范围（决策点 4 确认）**：仅本地视频引用与展示；不做转码、字幕、在线视频源等复杂管理。

```
<!-- ke-video: {"id":"e1f2a3b4-...","kind":"video","src":"Attachments/videos/20260808-xyz.mp4","title":"产品演示","poster":"Attachments/images/20260808-poster.png","controls":true,"autoplay":false,"loop":false} -->
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID |
| `kind` | 是 | 固定为 `"video"` |
| `src` | 是 | 本地视频路径，必须在 `Attachments/videos/` 下 |
| `title` | 否 | 标题 |
| `poster` | 否 | 封面图路径（`Attachments/images/` 下） |
| `controls` / `autoplay` / `loop` | 否 | HTML5 video 属性，默认 `controls=true, autoplay=false, loop=false` |

v1 明确**不支持**：外链视频（http/rtmp）、视频转码、多字幕轨道、倍速记忆、缩略图预览。

## 4. 兼容性矩阵

| 工具 | 对 KE 扩展标记的行为 |
| --- | --- |
| KnowledgeEditor（本产品） | 渲染为节点卡片，可编辑 |
| VS Code / 任意代码编辑器 | 显示为 HTML 注释，可正常编辑 |
| Typora / Obsidian / 其他 Markdown 编辑器 | 注释被忽略或折叠显示，文档不损坏 |
| markdown-it / commonmark.js | 解析为 HTML 注释块，原样输出 |
| GitHub / GitLab 渲染 | 注释被忽略，页面正常显示 |

验证方式：Phase 1 测试 `test_unknown_ke_marker_preserved` 断言未知 `ke-*` 标记在文档读写后原样保留。

## 5. 边界与约束

1. **禁止嵌套**：`ke-*` 标记内部不允许再出现另一个 `ke-*` 标记（JSON 字符串值除外）
2. **JSON 单行**：字符串内的引号必须转义（`\"`），禁止字面换行
3. **大小写敏感**：类型名严格小写；`ke-NOTE` 视为未知标记
4. **普通注释不受影响**：非 `ke-` 前缀的 `<!-- ... -->` 一律原样保留
5. **复制语义**：从编辑器复制节点时，整行注释一并复制，保证文档可移植
6. **frontmatter 保留**：`ke-module` 定义块只出现在 `Modules/` 文件的 frontmatter 中；`Articles/` 文档 frontmatter 仅使用标准字段（title/tags/created/updated）

## 6. 与编辑器数据模型的映射（Phase 2 实现）

| Markdown 标记 | ProseMirror 节点 | 关键 attrs |
| --- | --- | --- |
| `ke-note` | `note` | id, color, text, created |
| `ke-module` | `module` | id, name, version, mode, params |
| `ke-attach` | `attach` | id, type, src, title, caption |
| `ke-video` | `video` | id, src, title, poster, controls |

序列化规则：节点保存时按字段顺序重新生成单行注释；未知属性**不得丢弃**，随 JSON 原样保留（向前兼容）。

## 7. 演进策略

- 新节点类型沿用同一语法：`<!-- ke-<type>: <json> -->`，未知类型天然向前兼容
- 需要新的块级能力（如图表）时新增类型（如 `ke-chart`），无需破坏既有文档
- 规范版本号：`<!-- ke-version: 1 -->` 可在文档级标注所用方言版本（可选）

## 附录 A：EBNF 语法

```ebnf
document   ::= (block | ke_marker)* ;
block      ::= CommonMark/GFM 块结构 | 数学公式块 ;
ke_marker  ::= "<!--" ws "ke-" type ":" ws json ws "-->" ;
type       ::= "note" | "module" | "attach" | "video" ;
json       ::= 单行合法 JSON 对象（UTF-8，无字面换行） ;
```

## 附录 B：完整示例

```markdown
# 我的文章

这是正文，包含行内公式 $E=mc^2$。

<!-- ke-note: {"id":"9f8c4e1a-1111-4a5b-9c2d-000000000001","kind":"note","color":"yellow","text":"**待办**：补充实验数据来源"} -->

## 模块引用

<!-- ke-module: {"id":"a1b2c3d4-2222-4a5b-9c2d-000000000002","kind":"module","name":"formula-tips","mode":"card"} -->

## 图片附件

<!-- ke-attach: {"id":"c7d8e9f0-3333-4a5b-9c2d-000000000003","kind":"attach","type":"image","src":"Attachments/images/20260808-a1b2c3.png","caption":"图 1：整体架构"} -->

## 本地视频（v1）

<!-- ke-video: {"id":"e1f2a3b4-4444-4a5b-9c2d-000000000004","kind":"video","src":"Attachments/videos/20260808-xyz.mp4","title":"产品演示"} -->
```

以上文档在 VS Code / Typora / GitHub 中均能正常打开，四个扩展标记显示为 HTML 注释或被忽略，正文与公式完整保留。
