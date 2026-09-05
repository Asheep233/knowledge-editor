"""KnowledgeEditor backend package."""
# 项目版本（Phase 5E：start.ps1 / 前端版本一致性检查以此为唯一版本来源）
# Phase 6E：统一为 v0.6.0（Phase 6 完成冻结基线）
# v0.6.1：拖拽添加附件；孤儿附件手动删除（仅手动、绝不自动）
# v0.6.2：信息块徽章文字（label）可自定义；脚注支持纯 Markdown 样式（文末 # 参考 + [n] 文本，样式选择记忆）
# v0.6.3：纯 Markdown 样式脚注补充正文上标 [n]（不创建 footnotes 节点、无连接）
# v0.6.4：修复插入脚注上标后自动换行（trailingNode 不再在 footnotes 后补空段；
#         光标显式复位到上标后同一行）；上标编号可点击自主修改（不影响底部参考栏）
# v0.6.5：修复插入脚注后光标状态与 DOM 错位导致的 Backspace 误删上标——
#         insertFootnote/insertPlainFootnote 改为单 transaction（tr.replaceWith 插入上标后
#         after = from + nodeSize 将光标置于上标之后同一行，杜绝 chain 模式下
#         insertContent 不立即 dispatch、selection 仍是插入前位置的根因）；
#         上标样式 line-height 由 0 改为 1，消除行尾视觉错位（不再像"换行"）；
#         行末/段末插入上标后补零宽空格 U+200B 锚点（isCaretAtLineEnd 判断光标是否落在
#         软换行文本前或块内容末尾，用 $pos.end() 而非 Node.end），避免浏览器把 caret
#         渲染到下一行行首（用户视角"光标跑到下一行"，实际输入位置仍是上标后）
# v0.7.0：信息块内容改为 PM 可编辑内容节点（content: 'inline*' + defining），
#         块内文字可直接插入注释上标（不再因 atom 整块选中被替换删除）；
#         块内容不再存于 content/text 属性，Markdown 改为包裹格式
#         <!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->，
#         旧自闭合格式（content/text 属性）解析时自动迁移为文本子节点
# v0.7.1（phase 6U）：修复信息块内无法输入文本（NodeViewWrapper 误设
#         contentEditable=false 导致 contentDOM 继承禁编辑；改为控件单独禁编辑）；
#         徽章颜色与信息块背景同步同一色系，徽章默认空文本（不再显示「信息」占位）
# v0.7.2：修复信息块内占位文字「输入信息块内容…」错误渲染到每个空颜色按钮上
#         （CSS [contenteditable]:empty 命中 contenteditable="false" 的空控件；
#         改为排除禁编辑控件，内容区占位符改由 node.content.size 驱动 class，
#         规避 PM 空容器内置 trailingBreak 导致 :empty 永远不成立的问题）
# v0.7.3：修复保存正文后右边栏「属性」创建/修改时间、字数、大小显示为「—」——
#         PUT /articles/{id} 此前未返回 created_at/updated_at/size/word_count，
#         前端保存成功后用空值整体替换文档状态；现保存响应与 get/meta 接口一致返回完整元信息
# v1.0.0（Phase 7 M7，进入 Alpha 测试）：桌面端发布基线。UI 左上角阶段徽标由 Phase 6 改为 Alpha；
#         版本号由 0.7.3 升为 1.0.0（v1.0.0 起算入 Alpha 测试期，发布前统一修正）
__version__ = "1.1.0-pre.1"
