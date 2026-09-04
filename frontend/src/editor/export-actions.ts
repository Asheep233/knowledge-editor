/**
 * 导出动作（共享路径）：三种导出模式的「载荷构造 + 保存」，可独立测试。
 *
 * - KE 格式：withFrontmatter（保留 ke_version 与 ke-* 扩展标记）；
 * - 普通 Markdown：plainMarkdown 降级（无 ke_version / 已知 ke-* 标记）；
 * - 文档包：调后端 exportPackage 打包附件 → 保存 zip。
 * 保存统一走 import-export.saveOrDownload（原生另存为优先，见其文档注释）。
 */
import type { Editor } from '@tiptap/core'
import type { ArticleMeta } from '../types'
import { exportPackage } from '../api/client'
import { extractAttachmentRefs, slugForDownload } from './import-export'
import { KE_VERSION, withFrontmatter } from './ke'
import { metaFromArticle, plainMarkdown } from './plain-export'
import { saveOrDownload } from './import-export'

export interface ExportTarget {
  blob: Blob
  filename: string
}

/** 「导出 Markdown（KE 格式）」载荷：保留 KE 方言。 */
export function keExportPayload(editor: Editor, title: string): ExportTarget {
  const md = withFrontmatter(editor.getMarkdown(), KE_VERSION)
  return { blob: new Blob([md], { type: 'text/markdown' }), filename: `${slugForDownload(title)}.md` }
}

/** 「导出普通 Markdown (.md)」载荷：KE 方言降级为朴素 Markdown。 */
export function plainExportPayload(editor: Editor, article: ArticleMeta): ExportTarget {
  const md = plainMarkdown(editor.getMarkdown(), metaFromArticle(article))
  return { blob: new Blob([md], { type: 'text/markdown' }), filename: `${slugForDownload(article.title)}.md` }
}

/** 导出并保存（KE / 普通共用）。 */
export async function runExport(target: ExportTarget): Promise<void> {
  await saveOrDownload(target.blob, target.filename)
}

/** 「导出文档包 (.zip)」：序列化正文 → 后端打包附件 → 保存（API 失败向上抛出）。 */
export async function packageExportAndSave(title: string, md: string): Promise<void> {
  const refs = extractAttachmentRefs(md)
  const { blob, filename } = await exportPackage({ title, md, refs })
  await saveOrDownload(blob, filename)
}
