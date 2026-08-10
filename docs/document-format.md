# KnowledgeEditor 文档格式维护手册

状态：以当前实现为准（Phase 3 完成稿）
适用范围：Articles / Modules 全部 Markdown 文档
关联文档：`markdown-extension-spec.md`（v1.0 设计稿，本文档为权威现状记录，两者冲突时以本文档为准）

本文档记录 KE Markdown 方言的**实际实现现状**与维护规则。格式在编辑器、后端、第三方 Markdown 工具间共用，修改前必须评估兼容性。

## 1. ke_version 规范

版本号写入文档 YAML frontmatter，随文档文件本身存储（移动/复制后仍在），不依赖 SQLite 或编辑器内存。

```markdown
---
ke_version: 1
---

正文内容…
```

解析与写入规则（实现于 `frontend/src/editor/ke.ts`）：

| 函数 | 行为 |
| --- | --- |
| `stripFrontmatter(md)` | 匹配 `^---\r?\n...\r?\n---` 头部；有头时解析 `ke_version: N` 并剥离正文，无头时返回 `{ version: 0, content: 原样 }` |
| `withFrontmatter(md, version = 1)` | 先剥离再包装，幂等；重复调用不叠加头部 |

约束：

- `ke_version` 只允许非负整数；解析失败视为 0
- frontmatter 在编辑器加载时剥离，**不进入 Document Model**
- 保存（自动保存热路径与 Ctrl+S）统一调用 `withFrontmatter(md, KE_VERSION)` 写入当前版本

版本演进约定：

| 变更类型 | 版本处理 |
| --- | --- |
| 新增可选字段、新增节点类型 | `ke_version` 不变（向前兼容） |
| 字段重命名、语义变化 | 解析层做 v0 兼容迁移（如 `text` → `content`），版本不变 |
| 破坏性变更（旧编辑器无法安全降级） | 提升 `KE_VERSION` 并建立迁移函数映射 |

## 2. 所有 ke-* 节点

已知 kind 列表（`ke.ts` 的 `KE_KINDS`）：`note`、`module`、`attach`、`video`、`footnote`，另加 `footnotes` 区域（专用 tokenizer 处理）。未知 kind 由 GenericFallback 保留。

### 2.1 块级节点

| Markdown 标记 | ProseMirror 节点 | attrs（序列化顺序） |
| --- | --- | --- |
| `<!-- ke-note: {...} -->` | `note`（InfoBlock 通用信息块） | `id, created, updated, author, title, color, content` |
| `<!-- ke-module: {...} -->` | `module` | `id, name, version, mode, params, source` |
| `<!-- ke-attach: {...} -->` | `attach` | `id, type, src, title, caption, width` |
| `<!-- ke-video: {...} -->` | `video` | `id, src, title, poster, controls, autoplay, loop` |
| footnotes 区域（见 2.3） | `footnotes` | `items: [{ id, n, text }]` |
| 未知 `<!-- ke-xxx: {...} -->` | `keFallback` | `raw`（原样保留） |
| GFM 表格 | `table / tableRow / tableHeader / tableCell` | — |
| `![alt](src)` | `image` | `src, alt, title` |
| `$$ ... $$` | `mathBlock` | `latex` |

### 2.2 行内节点

| Markdown 标记 | ProseMirror 节点 | attrs |
| --- | --- | --- |
| `<!-- ke-footnote: {...} -->` | `footnote`（渲染为上标 `[n]`） | `id, n` |
| 行内未知 `<!-- ke-xxx: {...} -->` | `keFallbackInline` | `raw` |
| `$...$` | `math` | `latex` |

### 2.3 footnotes 脚注区域

脚注列表是 Document Model 中的独立块级节点，Markdown 用唯一标记区域承载：

```markdown
正文脚注引用<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->在此。

<!-- ke-footnotes:start -->
<!-- ke-footnote-item: {"id":"f1","n":1,"text":"脚注内容"} -->
<!-- ke-footnotes:end -->
```

规则：

- 区域必须以 `<!-- ke-footnotes:start -->` 开头，以 `<!-- ke-footnotes:end -->` 结尾
- 条目标记为 `<!-- ke-footnote-item: {...} -->`，条目 JSON 与引用节点的 `id`、`n` 对应
- 正文中同名的「## 参考」标题与脚注区域互不影响
- 单条损坏：忽略该条目但保留整个区域，其余条目不丢失
- 正文标题不参与脚注编号；编号由 `insertFootnote` 命令统一维护

### 2.4 数学公式

| 形式 | 节点 | 约束 |
| --- | --- | --- |
| `$E=mc^2$` | `math` | 排除 `$$` 与转义 `\$`，LaTeX 非空 |
| `$$\n...\n$$` | `mathBlock` | 独占行，块级 |

### 2.5 通用语法约束

- 节点标记为独占一行（或独占行开头）的 HTML 注释：`<!-- ke-<type>: <json> -->`
- `<type>` 严格小写；kind 允许连字符与数字（`ke-future-block:`、`ke-x2:` 均可被 fallback 保留）
- JSON 单行，字符串内引号必须转义；`ke-module` 的 `params` 等嵌套对象允许出现在 JSON 中
- 块级节点之间由编辑器序列化器统一输出单个空行（见第 4 节空行规范）
- `ke-footnotes` 区域的 kind 前缀与 `footnote` 相邻，由专用 tokenizer 解析，fallback 负向前瞻不干扰

## 3. Markdown 示例

完整文档示例（与 `phase3-roundtrip.test.ts` 的零漂移用例一致，可复制验证）：

````markdown
---
ke_version: 1
---

# 一级标题

## 二级标题

这是**粗体**、*斜体*、~~删除线~~ 与 [链接](https://example.com)。

- 无序项一
- 无序项二

1. 有序项一
2. 有序项二

> 引用内容

行内公式 $E=mc^2$，块级公式：

$$
\int_0^1 x \, dx
$$

| 列A | 列B |
| --- | --- |
| 值1 | 值2 |

![图片说明](Attachments/images/img.png)

<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"Attachments/files/doc.pdf","title":"文档"} -->

<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4","title":"演示"} -->

<!-- ke-module: {"kind":"module","id":"m1","name":"步骤","params":{"a":1}} -->

脚注引用<!-- ke-footnote: {"kind":"footnote","id":"f1","n":1} -->在此。

<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow","content":"重要内容"} -->

```ts
const a = 1
```

<!-- ke-futureblock: {"future":true} -->

<!-- ke-footnotes:start -->
<!-- ke-footnote-item: {"id":"f1","n":1,"text":"脚注内容"} -->
<!-- ke-footnotes:end -->
````

## 4. 兼容策略

| 场景 | 行为 |
| --- | --- |
| 合法 JSON + 已知 kind | 解析为对应节点，编辑器内可编辑 |
| 合法 JSON + 未知 kind（块级 / 行内） | GenericFallback 原样保留 `raw`，不报错、不删除 |
| 非法 JSON / 截断 / 大小写不符 | 原样保留，视为普通 HTML 注释 |
| 非 `ke-` 前缀的普通注释 | 一律原样保留 |
| 旧文档 `ke-note` 的 `text` 字段 | 解析时迁移为 `content`，保存后统一输出 `content`（v0 一次性迁移） |
| frontmatter | 编辑器内剥离，不进入 Document Model；保存时重新写入 |

序列化规则：

- 各节点按 `KE_FIELD_ORDER` 稳定输出字段顺序，空值字段剔除，`kind` 恒为第一键
- **未注册字段不保证保留**：序列化只输出 `KE_FIELD_ORDER` 列出的字段；新字段需在扩展 `addAttributes` 中显式注册（与 spec v1.0 第 6 节「未知属性不得丢弃」存在差异，以本文档为准）

空行规范（Phase 3 零漂移约束）：

- 块级节点的 `renderMarkdown` 不得自带首尾换行，块间距由 doc 级 `\n\n` 分隔符统一输出
- 手写文档中块级节点之间 2 个以上空行，首次保存被规范为 1 个空行；之后任意次往返输出一致
- 该行为与标准 Markdown 的空白折叠一致，属预期行为

## 5. 升级注意事项

### 5.1 新增节点类型

按顺序完成以下改动，缺一不可：

1. `ke.ts`：`KE_KINDS` 增加 kind，`KE_FIELD_ORDER` 增加字段顺序
2. `tokenizers.ts`：`KE_KNOWN_KINDS` 负向前瞻增加新 kind（否则新节点会被 fallback 以纯文本保留，安全降级但不结构化）
3. 新建扩展（节点定义 + parseMarkdown + renderMarkdown + markdownTokenName）
4. `editor/index.ts` 扩展数组注册（fallback 系列必须保持最先）
5. `phase3-roundtrip.test.ts` 增加往返与零漂移用例

### 5.2 字段变更

- 新增可选字段：直接加入 `KE_FIELD_ORDER` 与扩展 `addAttributes`，旧文档无需迁移
- 重命名字段：仿照 `text` → `content` 模式，`parseMarkdown` 同时读取新旧字段名，序列化统一输出新字段，实现一次性迁移

### 5.3 ke_version 提升

提升 `KE_VERSION` 前必须满足：旧版本编辑器打开新版本文档时，未知标记或字段能被 GenericFallback / 宽容解析安全降级。破坏性变更需同时提供「frontmatter 版本 → 迁移函数」映射（当前仅约定，尚未实现迁移框架）。

### 5.4 依赖升级触发条件

升级 `@tiptap/markdown` 或 `marked` 后，必须重新验证本文档 3 的完整示例可被解析且满足零漂移（`back2 === back1`）。相关机制依赖详见 `dependency-compatibility.md`。
