/**
 * 附件上传共享逻辑（工具栏按钮与拖拽添加共用）：
 * 上传 -> 构建 attach / video 节点（约束 4：src 存 workspace 相对路径）。
 */
import type { Schema } from '@tiptap/pm/model'
import type { UploadResult } from '../api/client'
import type { AttachmentAttrs } from './extensions/AttachmentExtension'
import { newId } from './ke'

/**
 * 根据上传结果构建编辑器节点：
 * - videos -> video 节点（spec 3.4 ke-video）
 * - images -> attach 节点（type=image）
 * - 其他   -> attach 节点（type=file）
 */
export function attachmentNode(schema: Schema, res: UploadResult, fileName: string) {
  if (res.category === 'videos') {
    return schema.nodes.video.create({ id: newId(), src: res.path, title: fileName })
  }
  const attrs: AttachmentAttrs = {
    id: newId(),
    type: res.category === 'images' ? 'image' : 'file',
    src: res.path,
    title: fileName,
  }
  return schema.nodes.attach.create(attrs)
}

/** 判断拖拽项是否为真实文件（跳过目录项） */
export function isRealFile(f: File): boolean {
  return f.size > 0 || f.type !== ''
}
