# 代码示例不应被导出器改写

EDIT_TARGET_A。

下面都是字面代码，不是文档节点：

```markdown
<!-- ke-note: {"kind":"note","id":"literal-note","title":"代码中的信息块","label":"字面","color":"blue"} -->
CODE_LITERAL_BODY
<!-- /ke-note -->

<!-- ke-attach: {"kind":"attach","id":"literal-attach","type":"file","src":"Attachments/files/literal.pdf","title":"字面附件"} -->

<!-- ke-module: {"kind":"module","id":"literal-module","name":"字面模块"} -->

<!-- ke-video: {"kind":"video","id":"literal-video","src":"Attachments/videos/literal.mp4","title":"字面视频"} -->

<!-- ke-footnotes:start -->
<!-- ke-footnote-item: {"id":"literal-foot","n":4,"text":"字面脚注"} -->
<!-- ke-footnotes:end -->
<!-- ke-version: 1 -->
```

行内字面代码：`before <!-- ke-footnote: {"kind":"footnote","id":"literal-inline","n":4} --> after`。

    <!-- ke-attach: {"kind":"attach","id":"literal-indented","type":"image","src":"Attachments/images/literal.png","title":"缩进代码图片"} -->

代码区域后的一段正常文字。
