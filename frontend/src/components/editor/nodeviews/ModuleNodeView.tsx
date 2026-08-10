/**
 * 模块节点视图（约束 3：v1 采用「插入后复制内容」方案，不做动态引用）。
 *
 * 用户要求：Markdown 中的 ke-module 注释保留，但编辑器内不渲染卡片。
 * 因此本视图仅渲染一个不可见占位：节点仍存在于 Document Model，
 * 保存时照常序列化为 `<!-- ke-module: {...} -->` 注释，
 * 打开时注释解析回该隐藏节点 —— 用户在编辑器中感知不到底层标记。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

export default function ModuleNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper
      contentEditable={false}
      aria-hidden="true"
      className="ke-module"
      style={{ display: 'none' }}
      data-ke-module-source={String(_props.node.attrs.source ?? '')}
    />
  )
}
