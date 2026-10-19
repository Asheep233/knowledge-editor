/**
 * T26 G3：`print.snapshot` 的真实 `pdfToken` 注册表。
 *
 * 协议只回给 guest 一个**不透明 token**（不泄露绝对路径）；宿主侧保留 token → 真实 PDF
 * 元数据（路径/大小/页数/快照 revision）的映射，供诊断与后续受控取回（P2 预览/打印对话框）。
 *
 * 诊断：`window.__kePrintTokens()` 返回当前登记表快照（与既有 `__keGuestResults` 等
 * window 诊断钩子同风格；只有宿主主窗口可读，guest 在沙箱 iframe 内不可达）。
 */

export interface PrintTokenEntry {
  pdfToken: string
  pdfPath: string
  relPath: string
  revision: number
  /** 页数（不可得 → null） */
  pages: number | null
  bytes: number
  createdAt: number
}

export interface PrintTokenRegistration {
  pdfPath: string
  relPath: string
  revision: number
  pages: number | null
  bytes?: number
}

const MAX_ENTRIES = 32
const registry = new Map<string, PrintTokenEntry>()

interface PrintTokenWindow {
  __kePrintTokens?: () => PrintTokenEntry[]
}

function exposeDiagnostics(): void {
  if (typeof window === 'undefined') return
  ;(window as PrintTokenWindow).__kePrintTokens = () => listPrintTokens()
}

/** 登记一次真实打印产物，返回不透明 token。 */
export function registerPrintToken(registration: PrintTokenRegistration): string {
  if (typeof registration.pdfPath !== 'string' || registration.pdfPath.length === 0) {
    throw new Error('E_PRINT_TOKEN: 缺少真实 PDF 路径，拒绝登记 token')
  }
  const token = `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  registry.set(token, {
    pdfToken: token,
    pdfPath: registration.pdfPath,
    relPath: registration.relPath,
    revision: registration.revision,
    pages: registration.pages,
    bytes: registration.bytes ?? 0,
    createdAt: Date.now(),
  })
  if (registry.size > MAX_ENTRIES) {
    const oldest = registry.keys().next().value
    if (oldest !== undefined) registry.delete(oldest)
  }
  exposeDiagnostics()
  return token
}

export function lookupPrintToken(token: string): PrintTokenEntry | undefined {
  return registry.get(token)
}

export function listPrintTokens(): PrintTokenEntry[] {
  return [...registry.values()]
}

export function resetPrintTokensForTests(): void {
  registry.clear()
}
