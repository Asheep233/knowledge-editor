/**
 * UI 工坊 P2-T16：产品打印传输 —— 调用 Tauri 命令 `print_snapshot_pdf`（隐藏 renderer + PrintToPdf）。
 * 仅消费 Core PrintJob 的已渲染快照（html），不读取编辑器 DOM；输出路径由 Core/产品校验。
 */
import { invoke } from '@tauri-apps/api/core'

import type { PrintedPdf, PrintTransport, RenderedPrint } from './printJob'

export interface TauriPrintTransportOptions {
  invokeImpl?: typeof invoke
  /** 传入编辑器内容宽（页宽与编辑面一致；undefined → A4） */
  contentWidth?: number
}

export function createTauriPrintTransport(options: TauriPrintTransportOptions = {}): PrintTransport {
  const call = options.invokeImpl ?? invoke
  return {
    async print(rendered: RenderedPrint, targetPath: string, signal: AbortSignal): Promise<PrintedPdf> {
      if (signal.aborted) throw new Error('E_CANCELED: 打印已取消')
      const pdfPath = (await call('print_snapshot_pdf', {
        html: rendered.html,
        target: targetPath,
        contentWidth: options.contentWidth ?? null,
      })) as string
      if (signal.aborted) throw new Error('E_CANCELED: 打印已取消')
      return { pdfPath, pages: rendered.pages, bytes: 0 }
    },
  }
}
