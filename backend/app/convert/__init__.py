"""Markdown <-> ProseMirror JSON 转换层。

Phase 1：仅占位。完整实现（markdown 解析器 + PM schema 映射）在 Phase 2。
设计约束（来自 Phase 0 架构）：
- 数据流单向：文档模型 -> Markdown 文件（保存）；禁止反向渲染路径。
- 扩展节点（ke-note / ke-module / ke-attach / ke-video）的解析规则
  见 docs/markdown-extension-spec.md。
"""
