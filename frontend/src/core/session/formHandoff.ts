/**
 * UI 工坊 W02 表单交接（Core，DOM-free）：guest UI 向官方编辑器表单提交 title/tags 等草稿。
 *
 * 语义（与 ACCEPTANCE W02 对齐）：
 * - 一次「表单交接」= begin(initial) → setField* → submit({requestId}) → 宿主 drain/commit；
 * - **迟到/重复提交**：提交后到位的结果按 requestId 幂等；已关闭交接的迟到提交被丢弃；
 * - **原子切写资格**：commit 成功前旧会话保持可编辑；commit 成功后旧连接失效；
 * - **失败可继续**：commit 抛错时旧会话保留（表单内容不丢），可重试或取消；
 * - 交由宿主的 onCommit 执行真正的原子写（产品里 = API 写 title/tags + 编辑器状态切换）。
 *
 * 不涉及 React/DOM；与官方编辑器适配由产品层完成（后续接线）。
 */
export interface FormValues {
  title?: string
  tags?: string[]
  /** 公式/其他草稿字段（字符串值，透传给宿主） */
  draft?: Record<string, string>
}

export interface FormHandoffOptions {
  /** 宿主执行原子提交；抛错 = 失败（旧会话保留） */
  onCommit: (values: FormValues, requestId: string) => Promise<void>
  /** 当前写入资格校验（例如会话/连接仍有效） */
  canCommit?: () => boolean
}

export interface FormSubmitResult {
  status: 'committed' | 'rejected' | 'closed' | 'duplicate'
  requestId: string
  reason?: string
}

export class FormHandoff {
  private readonly options: FormHandoffOptions
  private values: FormValues = {}
  private open = false
  private closed = false
  private committing = false
  private committedRequestId: string | null = null
  private pending: { requestId: string; promise: Promise<FormSubmitResult> } | null = null

  constructor(options: FormHandoffOptions) {
    this.options = options
  }

  get isOpen(): boolean {
    return this.open && !this.closed
  }

  get current(): FormValues {
    return { ...this.values, tags: this.values.tags ? [...this.values.tags] : undefined, draft: this.values.draft ? { ...this.values.draft } : undefined }
  }

  begin(initial: FormValues = {}): void {
    this.values = { ...initial, tags: initial.tags ? [...initial.tags] : undefined, draft: initial.draft ? { ...initial.draft } : undefined }
    this.open = true
    this.closed = false
    this.committing = false
    this.committedRequestId = null
    this.pending = null
  }

  setField<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    if (!this.isOpen) return
    this.values = { ...this.values, [key]: value }
  }

  /** 关闭未提交的表单（丢弃草稿）；返回是否曾提交。 */
  cancel(): boolean {
    const hadCommitted = this.committedRequestId !== null
    this.closed = true
    this.open = false
    this.pending = null
    return hadCommitted
  }

  /** 提交并等待宿主原子提交结果（同一 requestId 幂等）。 */
  async submit(requestId: string): Promise<FormSubmitResult> {
    if (this.committedRequestId === requestId) return { status: 'duplicate', requestId }
    if (this.closed) return { status: 'closed', requestId, reason: 'E_FORM_CLOSED: 表单交接已关闭' }
    if (!this.isOpen) return { status: 'rejected', requestId, reason: 'E_FORM_NOT_OPEN: 表单未打开' }
    if (this.options.canCommit && !this.options.canCommit()) {
      return { status: 'rejected', requestId, reason: 'E_STALE_CONNECTION: 连接已失效，保留旧会话' }
    }
    if (this.pending?.requestId === requestId) return await this.pending.promise
    this.committing = true
    const promise = (async (): Promise<FormSubmitResult> => {
      try {
        await this.options.onCommit(this.current, requestId)
        this.committedRequestId = requestId
        this.open = false
        this.closed = true
        this.committing = false
        return { status: 'committed', requestId }
      } catch (e) {
        this.committing = false
        return { status: 'rejected', requestId, reason: String((e as Error)?.message ?? e) }
      } finally {
        this.pending = null
      }
    })()
    this.pending = { requestId, promise }
    return await promise
  }

  /** 宿主 drain：等待当前在途提交完成（无在途立即返回）。 */
  async drain(): Promise<void> {
    if (this.pending) await this.pending.promise
  }

  get isCommitting(): boolean {
    return this.committing
  }
}

export function createFormHandoff(options: FormHandoffOptions): FormHandoff {
  return new FormHandoff(options)
}
