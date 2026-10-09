---
title: AstraNota 全节点往返审查
tags:
  - 审查
  - roundtrip
custom_audit_key: untouched-frontmatter
ke_version: 1
---

# AstraNota 全节点往返审查

仅编辑这一段中的 EDIT_TARGET_A，改成 EDIT_TARGET_B；其余所有节点均应保持此前渲染。

## 标准 Markdown

普通中文 ABC 123 😀；**粗体**、*斜体*、~~删除线~~、`code [^literal] $not_math$`。

[普通链接](https://example.com/a?x=1&y=2 "链接标题")，转义字符 \*星号\*、\[中括号\]、\$货币，实体 &copy; &amp;。

软换行第一行
软换行第二行。

硬换行第一行  
硬换行第二行。

> 引用第一段 **强调**。
>
> - 引用列表
> - [x] 已完成
> - [ ] 未完成

- 普通列表项
- [x] 已完成任务
- [ ] 未完成任务
  - 嵌套普通列表
  - [x] 嵌套任务
- 最后一项

3. 起始编号三
4. 下一项
   1. 嵌套编号

---

| 名称 | 左对齐 | 居中 | 右对齐 |
| :--- | :--- | :---: | ---: |
| 甲 | **粗体** | $x_1$ | 12 |
| 乙 | escaped \| pipe | `a\|b` | -0.5 |

```typescript
const literal = "$x$ 与 [^not-footnote]";
const unicode = "中文😀";
```

## 数学公式

行内公式：$E=mc^2$，相邻公式 $a$$b$，分式 $\frac{a_1+b^2}{\sqrt{x}}$，集合 $\{x\in\mathbb{R}:x>0\}$。

$$
\begin{aligned}
f(x)&=\int_0^x t^2\,\mathrm{d}t\\
&=\frac{x^3}{3}
\end{aligned}
$$

$$
\begin{pmatrix}1 & 2\\3 & 4\end{pmatrix}
$$

## KE 信息块

<!-- ke-note: {"kind":"note","id":"audit-note-rich","title":"不可变化的信息块标题","label":"审查","color":"#CFE9FA","author":"独立审查","audit_extra":{"retained":true}} -->
块内第一段 **粗体**、*斜体* 和公式 $a^2+b^2=c^2$。

块内第二段含多段落。

- 块内列表一
- 块内列表二

> 块内引用。
<!-- /ke-note -->

<!-- ke-note: {"kind":"note","id":"audit-note-empty","title":"空信息块","label":"空块","color":"accent"} -->
<!-- /ke-note -->

## 附件与视频（缺失文件占位也应稳定）

![标准 Markdown 图片](Attachments/images/audit-missing-standard.png "标准图片标题")

<!-- ke-attach: {"kind":"attach","id":"audit-image","type":"image","src":"Attachments/images/audit-missing-image.png","title":"审查配图","caption":"审查配图的独立图注","width":"320px","audit_extra":"image-extra"} -->

<!-- ke-attach: {"kind":"attach","id":"audit-file","type":"file","src":"Attachments/files/audit-missing-file.pdf","title":"审查附件 PDF","caption":"附件说明"} -->

<!-- ke-video: {"kind":"video","id":"audit-video","src":"Attachments/videos/audit-missing-video.mp4","title":"审查视频","poster":"Attachments/images/audit-missing-poster.png","controls":true,"autoplay":false,"loop":false} -->

<!-- ke-module: {"kind":"module","id":"audit-module","name":"审查隐藏模块","version":2,"mode":"card","params":{"nested":{"x":1}},"source":"Modules/audit-missing.md","audit_extra":"module-extra"} -->

## 未知语法与脚注

普通 HTML 注释应保留。

<!-- ordinary-comment: untouched -->

<!-- ke-chart: {"id":"audit-future","kind":"chart","data":{"x":[1,2,3]},"audit":"unknown-untouched"} -->

行内未知标记前<!-- ke-future-inline: {"id":"audit-inline","value":"unchanged"} -->后。

脚注引用甲<!-- ke-footnote: {"kind":"footnote","id":"audit-footnote-1","n":1} -->，同一个引用再次出现<!-- ke-footnote: {"kind":"footnote","id":"audit-footnote-1","n":1} -->，脚注乙<!-- ke-footnote: {"kind":"footnote","id":"audit-footnote-2","n":2} -->。

<!-- ke-footnotes:start -->
<!-- ke-footnote-item: {"id":"audit-footnote-1","n":1,"text":"第一条纯文本脚注；字面 **粗体** 与 $x$。\n第二行脚注。","audit_extra":"retain-item"} -->
<!-- ke-footnote-item: {"id":"audit-footnote-2","n":2,"text":"第二条脚注 😀"} -->
<!-- ke-footnotes:end -->
