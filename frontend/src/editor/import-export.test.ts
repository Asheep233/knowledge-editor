/**
 * Phase 3E 前端工具测试：附件引用提取 / 下载文件名 / Content-Disposition 解析。
 */
import { describe, expect, it } from 'vitest'
import {
  extractAttachmentRefs,
  filenameFromDisposition,
  slugForDownload,
} from './import-export'

describe('Phase 3E：extractAttachmentRefs', () => {
  it('提取 ke-attach / ke-video 的 src 与标准图片路径', () => {
    const md = [
      '![架构图](Attachments/images/arch.png)',
      '',
      '<!-- ke-attach: {"kind":"attach","id":"a1","src":"Attachments/files/doc.pdf"} -->',
      '',
      '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4"} -->',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual([
      'Attachments/images/arch.png',
      'Attachments/files/doc.pdf',
      'Attachments/videos/demo.mp4',
    ])
  })

  it('F07：title/caption 含 `}` 时附件引用仍可提取（括号平衡）', () => {
    const md = [
      '<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"Attachments/files/doc.pdf","title":"含}花括号标题"} -->',
      '',
      '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4","title":"caption}带括号"} -->',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual([
      'Attachments/files/doc.pdf',
      'Attachments/videos/demo.mp4',
    ])
  })

  it('忽略网络 URL 与本地绝对路径（Phase 4 范围外，保持原样）', () => {
    const md = [
      '![远程](https://example.com/a.png)',
      '![本地](C:\\Users\\me\\Pictures\\b.png)',
      '![根绝对](D:/data/c.png)',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it('忽略非 Attachments/ 的相对路径与无 src 节点', () => {
    const md = [
      '![相对](images/foo.png)',
      '![无](foo.png)',
      '<!-- ke-note: {"kind":"note","id":"n1","content":"x"} -->',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it('处理 ./ 前缀与重复引用去重', () => {
    const md = [
      '![一](./Attachments/images/x.png)',
      '![二](Attachments/images/x.png)',
      '<!-- ke-attach: {"kind":"attach","id":"a1","src":"./Attachments/images/x.png"} -->',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual(['Attachments/images/x.png'])
  })

  it('非法 JSON 的 ke- 节点不抛错', () => {
    const md = '<!-- ke-attach: {bad json} -->\n\n正文。'
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it('P3-14：代码块/行内代码中的路径不被误判为附件引用', () => {
    const md = [
      '正文。',
      '',
      '```md',
      '![x](Attachments/images/fromcode.png)',
      '```',
      '',
      '文字 `![y](Attachments/images/inline.png)` 结束',
      '',
      '![real](Attachments/images/real.png)',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual(['Attachments/images/real.png'])
  })

  it('P3-14：URL 中的 Attachments 路径不被收集（仅真实 src 值）', () => {
    const md = '[text](https://example.com/Attachments/fake.png) and ![远程](http://x/a.png)'
    expect(extractAttachmentRefs(md)).toEqual([])
  })
})

describe('Phase 3E：slugForDownload（v1.1.8：保留原标题）', () => {
  it('保留 CJK 与大小写/空格，仅替换非法字符', () => {
    expect(slugForDownload('我的 文档: 测试')).toBe('我的 文档 测试')
    expect(slugForDownload('Hello World')).toBe('Hello World')
  })

  it('空标题回退 untitled', () => {
    expect(slugForDownload('   ')).toBe('untitled')
  })
})

describe('Phase 3E：filenameFromDisposition', () => {
  it('优先解析 RFC 5987 filename*', () => {
    const d = "attachment; filename=\"test_export.zip\"; filename*=UTF-8''%E5%AF%BC%E5%87%BA_export.zip"
    expect(filenameFromDisposition(d, 'fallback.zip')).toBe('导出_export.zip')
  })

  it('无 filename* 时回退普通 filename，无头时用 fallback', () => {
    expect(filenameFromDisposition('attachment; filename="a.zip"', 'f.zip')).toBe('a.zip')
    expect(filenameFromDisposition(null, 'f.zip')).toBe('f.zip')
  })
})

describe('FE-05（2026-10-17 审查）：含空格/括号/编码的附件引用必须进导出包', () => {
  it('角括号目标（含空格）', () => {
    expect(extractAttachmentRefs('![p](<Attachments/images/my pic.png>)')).toEqual([
      'Attachments/images/my pic.png',
    ])
  })

  it('平衡圆括号目标（pic(1).png）', () => {
    expect(extractAttachmentRefs('![p](Attachments/images/pic(1).png)')).toEqual([
      'Attachments/images/pic(1).png',
    ])
  })

  it('URI 编码目标解码为磁盘真实路径', () => {
    expect(extractAttachmentRefs('![p](Attachments/images/my%20pic.png)')).toEqual([
      'Attachments/images/my pic.png',
    ])
  })

  it('普通链接与带 title 的图片都收集；URL 仍忽略', () => {
    const md = [
      '[报告](Attachments/files/report.pdf)',
      '![p](<Attachments/images/new pic.png> "标题")',
      '[web](https://example.com/Attachments/fake.png)',
    ].join('\n')
    expect(extractAttachmentRefs(md)).toEqual([
      'Attachments/files/report.pdf',
      'Attachments/images/new pic.png',
    ])
  })

  it('代码块中的角括号/括号引用仍不收集（P3-14 不回归）', () => {
    const md =
      '```md\n![p](<Attachments/images/code pic.png>)\n```\n\n' +
      '![real](Attachments/images/real(1).png)'
    expect(extractAttachmentRefs(md)).toEqual(['Attachments/images/real(1).png'])
  })
})
