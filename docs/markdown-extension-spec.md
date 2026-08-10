# KnowledgeEditor Markdown 扩展规范

版本：1.0（Phase 1 确认稿）
状态：已确认（决策点 2）
适用范围：KnowledgeEditor 全部文档（Articles / Modules）

---

## 1. 定位与设计原则

KnowledgeEditor 的 Markdown 方言 = **CommonMark + GFM 超集 + 数学公式 + KE 扩展**。

- 数学公式：行内 `$...$`、块级 `$$...$$`（KaTeX / MathLive）
- KE 扩展：注释（note）、模块（module）、附件（attach）、视频（video）四类节点

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

用途：文内批注、评论、待办提醒。编辑器内显示为可折叠的高亮卡片。

```
<!-- ke-note: {"id":"9f8c4e1a-...","kind":"note","created":"2026-08-08T10:00:00+08:00","updated":"2026-08-08T10:00:00+08:00","author":"作者名","color":"yellow","text":"**待办**：补充数据来源"} -->
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID，节点唯一标识 |
| `kind` | 是 | 固定为 `"note"` |
| `created` / `updated` | 否 | ISO 8601 时间戳 |
| `author` | 否 | 作者名 |
| `color` | 否 | `yellow` / `red` / `green` / `blue` / `default` |
| `text` | 是 | 注释正文，允许包含 Markdown（渲染时解析） |

渲染约定：卡片样式 + 对应颜色底纹；`text` 按 Markdown 渲染；折叠状态由编辑器本地记忆，不写入文件。

### 3.2 模块节点 `ke-module`

用途：可复用模块系统。**定义**在 `Modules/` 目录的独立 `.md` 文件中，**引用**发生在文章内。

**模块定义**（`Modules/formula-tips.md` 的 frontmatter）：

```
---
title: 常用公式速查
ke-module:
  name: formula-tips
  version: 1
  description: 高频 LaTeX 公式集合
---
```

**文章内引用**：

```
<!-- ke-module: {"id":"a1b2c3d4-...","kind":"module","name":"formula-tips","version":1,"mode":"inline","params":{}} -->
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | UUID |
| `kind` | 是 | 固定为 `"module"` |
| `name` | 是 | 模块名，对应 `Modules/{name}.md` |
| `version` | 否 | 引用的模块版本；缺省取最新 |
| `mode` | 否 | `inline`（内嵌渲染，默认）/ `card`（卡片链接） |
| `params` | 否 | 传入模块的 JSON 参数对象 |

渲染约定：

- `mode=inline`：在引用位置展开模块正文，模块内可再次引用其他模块（嵌套层级 ≤ 8，防循环）
- `mode=card`：显示可点击的模块卡片，点击打开模块详情
- 模块文件缺失 / 版本不符时显示占位提示，不报错

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
