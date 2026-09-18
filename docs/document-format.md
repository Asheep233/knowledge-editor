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
| `<!-- ke-note: {...} -->` | `note`（InfoBlock 通用信息块，包裹格式见 §2.1.1） | `id, created, updated, author, title, color`（`content`/`text` 为 v0 遗留属性，解析时迁移为子节点）|
| `<!-- ke-module: {...} -->` | `module` | `id, name, version, mode, params, source` |
| `<!-- ke-attach: {...} -->` | `attach` | `id, type, src, title, caption, width` |
| `<!-- ke-video: {...} -->` | `video` | `id, src, title, poster, controls, autoplay, loop` |
| footnotes 区域（见 2.3） | `footnotes` | `items: [{ id, n, text }]` |
| 未知 `<!-- ke-xxx: {...} -->` | `keFallback` | `raw`（原样保留） |
| GFM 表格 | `table / tableRow / tableHeader / tableCell` | — |
| `![alt](src)` | `image` | `src, alt, title` |
| `$$ ... $$` | `mathBlock` | `latex` |

#### 2.1.1 `ke-note` 包裹格式与块内内容（v1.1.7 更新）

```
<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"blue"} -->
块内 Markdown 内容（**块级**）
<!-- /ke-note -->
```

- **块内内容为块级 Markdown**（v1.1.7 起）：列表 / 多段落 / 加粗段落等整体属于信息块；
  旧行内文档兼容（单段文本解析为一个段落，往返稳定）。
- 块内内容不得出现其他 `ke-*` 头标记（R3 不变量：结束标记只在块范围内有效）。
- 空信息块序列化为 `<!-- ke-note: {...} -->\n<!-- /ke-note -->`，解析时补一个空段落
  （保证编辑器内始终存在可输入的输入行）。

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

### 2.3.1 GFM 脚注语法的等价解析（v1.1.8 新增）

**背景（实测）**：`[^1]: 内容` 在 CommonMark 里是**链接引用定义**（label = `^1`）。`marked`
未实现 GFM 脚注，因此本产品此前会把 GFM 脚注文档解释为「链接」，产生三类损坏：

| 现象 | 后果 |
|---|---|
| `[^1]` 被解析为指向该定义的链接 | 保存后写成 `[^1](内容)`，脚注结构丢失 |
| 定义行被消费为「未使用的链接定义」| **整行消失**（无引用时）——数据丢失 |
| 4 空格续行被当作缩进代码块 | 多段落脚注被拆成代码块——结构错乱 |

> 注：GFM 规范中 `gfmFootnoteDefinitionCont = 4(spaceOrTab)`，**续行本就缩进 4 空格**
> （`plain-export` 的产出是正确的 GFM）。上述损坏纯属 marked 缺实现所致。

**识别规则**（解析为上文 §2.3 的同名节点，不新增节点类型）：

| 形态 | 判定 | 映射 |
| --- | --- | --- |
| `[^label]`（行内引用）| 未转义、不在代码/公式/HTML 内 | `footnote` 节点 `{id, n}` |
| `[^label]: 内容`（行首定义）| 行首（块级起始位置），**非** 4 空格缩进 | `footnotes` 节点 `items[]` 条目 |
| 定义续行（4 空格 / Tab）| 前缀剥离后并入该条目 `text`；空行+缩进=多段落 | 同上 |
| 定义**懒续行** | 紧随其后、非空且不开启新块的行（CommonMark/GFM 语义，GitHub 官方多行脚注示例即此形态）| 同上 |

- **label 文法**（对齐 GFM BNF）：`[^` + 1..999 个「非 `[` `\` `]` 字符或转义 `\[` `\\` `\]`」+ `]`
- **匹配规则**：引用与定义经**标识符归一化**后相等即匹配（去首尾空白、折叠内部空白、
  大小写不敏感）——与 GFM / micromark `normalizeIdentifier` 一致
- **重复定义**：**首个生效**；其余行**转义中和为字面文本**（`\[^1\]: …`）。
  中和是必要的：否则 marked 会把该行当 CommonMark 链接引用定义消费，**整行内容消失**
- **未定义引用**：**保持字面文本**（与 GFM 一致）
- **未收编的「定义样」行**（容器内 `> [^1]: x`、标题内 `## [^1]: x`、列表项内）：同样
  **转义中和**——cmark 允许容器内定义，本项目不解析它们，但**绝不允许其内容被 marked 消费而消失**
- **编号 `n`**：按**定义首次被引用**在正文中出现的顺序编号 1..k（GFM 语义）；
  仅定义而无引用者，按定义顺序追加编号——**本项目保留其内容**，与 GFM 渲染（丢弃）不同，
  理由是编辑器不得丢失作者内容
- **与既有 ke 区域共存**：文档若已存在 `<!-- ke-footnotes:start -->` 区域，GFM 定义条目
  **并入该区域**，不新建第二个区域（ke 模型只有单一区域）

**边界（不识别为脚注）**：

| 形态 | 处理 | 依据 |
| --- | --- | --- |
| `\[^1]` | 字面量 | 已转义 |
| 行内代码 `` `[^1]` `` 内 | 字面量 | marked 先消费 codespan（已实测）|
| 围栏代码块内 | 字面量 | marked 先消费 fence（已实测）|
| 缩进代码块（4 空格）内 | 字面量 | 与 CommonMark 缩进代码块冲突（已实测）|
| 块级公式 `$$…$$` / 行内公式 `$…$` 内 | 字面量 | 不得污染公式源码（已实测）|
| HTML 注释 / HTML 块内 | 字面量 | 否则注释被提前终止（已实测）|
| **4 空格缩进**的 `[^label]:` | 字面量（缩进代码块）| 与 CommonMark 缩进代码块冲突 |
| 无同名定义的 `[^label]` | **字面量** | 与 GFM 一致（未定义引用不构成脚注）|
| `<!-- ke-footnote: ... -->` | 优先走 §2.3 路径 | 两者互不影响 |

> **掩码方向性（实现原则）**：文本级改写一律取**保守**方向——**宁可漏转（退化为字面文本，无损），
> 不可误转（污染代码/公式/HTML，有损）**。故掩码规则允许「可能多掩」。

**消歧取舍（2026-09-14 拍板 → 同日修订）**：采用**定义感知**而非无条件识别。
原方案建议「无条件识别」（任何 `[^label]` 均转脚注），其**唯一理由是 tokenizer 局部作用域
拿不到全文定义集合**。实现形态最终确定为「解析入口全文规范化」（见下方实现约束）后，
全文上下文天然可用，该成本归零。
定义感知**严格更优**：与 GFM 规范一致（未定义引用本就渲染为字面文本）、
对不含脚注定义的文档**零行为变化**、无正文误判。因此最终采用定义感知。

**方言转换（预期行为）**：GFM 脚注文档被打开并保存后，输出为 ke 方言
（`<!-- ke-footnote -->` + `<!-- ke-footnotes -->` 区域）——与既有「打开即规范化」行为一致；
`plain-export` 降级时再还原为 GFM 语法，故「导出普通 Markdown」的外部可读性不受影响。

### 2.3.2 脚注条目的已知边界：正文为纯文本（**有意为之，非缺陷**）

`footnotes` 节点的 `items[].text` 是**纯字符串**（`FootnotesExtension` 的 `text: string`，
NodeView 直接作为文本节点渲染，不走 Markdown 解析）。因此：

| GFM 定义中的写法 | 本项目行为 | 说明 |
| --- | --- | --- |
| `[^1]: 见 **重点**` | 渲染为字面 `**重点**`（不解析为粗体）| 条目正文非富文本 |
| `[^1]: 见 \`code\`` | 渲染为字面 `` `code` `` | 同上 |
| `[^1]: 第一段` + **8 空格**缩进行 | 作为条目内的普通段落（非代码块）| GFM 里 8 空格=脚注内代码块 |
| `[^1]: 多行` + 4 空格续行 | **保留为条目的多段落**（换行保真）| 见 §2.3.1 识别规则 |

**这是 ke 脚注模型的既有设计，非本方言转换引入**：ke 原生脚注由 `insertFootnote(text)`
插入的同样是纯文本，二者行为一致（修复前后不变）。**要消除该边界需把条目正文升级为块级
内容——属 D 层格式变更（红线），须独立批次 + 旧文档迁移。**

> 目的：把该边界**显式写入规范**，避免其被当作缺陷反复上报；同时明确
> 「不解析行内格式」是当前契约的一部分。

**实现约束（非规范，供维护参考）**：脚注编号需要**全文上下文**（引用通常出现在定义之前），
因此本转换在**解析入口 `setKeContent` 内、调用 `setContent` 之前**以纯函数方式完成
（生产环境 markdown 解析入口**仅此一处**：`handlePaste` 只处理文件粘贴，
编辑器初始 `content` 恒为空串）。**不新增 marked tokenizer**——避免与既有规则
（GFM 表格 / `$公式$` / `ke-*` / HTML 透传）发生注册顺序抢占。

> **附带修复（S-2 期间发现，既有缺陷）**：`keFallbackTokenizer` 的 `start` 原先会在
> 「1 个字符 + 行内脚注注释」处返回 0，导致 marked 把**段落从第 1 个字符截断**、注释被当
> 块级 fallback 消费（`一[^x] 二[^x] 三[^x]。` 的引用数由 3 变 2）。该缺陷在干净基线
> HEAD `c256515` 上用原生 ke 方言即可复现，**非 S-2 引入**；但 S-2 使普通 GFM 文档
> 可达该形态，故一并修复为 `start: () => -1`。

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

### 2.6 文件级与保真条款（v1.2.0-pre.1 新增）

> 背景：`docs/analysis-1.1.10/source-mode.md` §4.1 用 41 个构造实测出「经编辑器一次往返后逐字节一致 0/41」，
> 其中 5 项属**不可逆内容损坏**（下称 F-1…F-5）。本节把这些行为写成**显式契约**，
> 避免「未声明 → 每轮往返都悄悄改写用户文件」。

| 契约 | 规定 | 对应缺陷 |
|---|---|---|
| **任务列表** | `- [x] 任务` / `- [ ] 任务`（`+`/`*` 同样）属受支持内容：复选框状态必须**往返保留**；`[X]` 归一为小写 `x`（语义等价）；与普通列表混排各自保持 | F-1 |
| **行内 HTML** | 由 marked 正常转换的标签（`em`/`strong`/`b`/`i`/`a`/`code`/`del`/`ins`/`s`/`br`）仍走标准 Markdown 转换（**不**做 raw 保真，避免抢走既有行为）；**其余**标签（`span`/`mark`/`kbd`/`img`/`figure`/自定义标签等）**原样保留**，不得只留文本 | F-2 |
| **HTML 实体** | 命名实体（`&copy;`）、十进制（`&#169;`）、十六进制（`&#xA9;`）**原样保留**，不得二次转义为 `&amp;copy;`；裸 `&` 可规范化为 `&amp;`（等价） | F-3 |
| **BOM** | UTF-8 BOM 属**文件级标记**：解析前剥离（不得进入正文、不得使 frontmatter 失效），保存时按原文**原样写回**（原文无 BOM 则不得新增；重复 BOM 归一为单个） | F-4 |
| **换行风格** | **按文档保留**：CRLF 文档保存后仍为 CRLF，LF 文档不得被改成 CRLF；混排按主导风格处理。编辑器内部一律用 LF，还原发生在写入前 | F-5 |
| **唯一事实源不变** | 上述还原只作用于「写入字节」，不改变 `ke-*` 标记语义、不新增节点类型、不写入任何编辑器状态到文档 | — |

**实现落点**：任务列表 = 注册 `@tiptap/extension-list` 的 `TaskList`/`TaskItem`；
行内 HTML 与实体 = `editor/tokenizers.ts` 的 `html_passthrough_inline`；
BOM 与换行 = `editor/ke.ts` 的 `stripFrontmatter`/`withFrontmatter` + `captureDocTraits`/`applyDocTraits`（加载时捕获、保存时还原）。

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

<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow"} -->
**重要内容**（块级：段落/列表均可）
<!-- /ke-note -->

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
| GFM 脚注 `[^label]` / `[^label]: 内容` | 按 §2.3.1 等价解析为 `footnote` / `footnotes` 节点；保存后输出 ke 方言 |
| GFM 脚注重复定义 | 首个生效，其余**保留为普通文本**（不静默丢行）|
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
