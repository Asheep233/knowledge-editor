/**
 * UI 工坊 P2-T16：打印产品化 Core —— 指定 revision 快照的打印 Job 队列/取消/超时。
 *
 * 红线（ARCHITECTURE / T16）：
 * - 打印只使用**指定 revision 的可信快照**（content+revision），不读取当前编辑 DOM、不隐式保存；
 * - Job 状态机：queued → rendering → printing → done/failed/canceled；取消可发生在任意阶段；
 * - 有界并发（默认 1，打印是串行资源）、超时 abort、失败不 panic、目标路径先校验（不覆盖/不越界）；
 * - 渲染与打印通过注入接口实现（产品：隐藏 WebView2 renderer + Rust PrintToPdf；测试：内存实现）。
 *
 * 无 DOM/React 依赖。
 */
export type PrintJobState = 'queued' | 'rendering' | 'printing' | 'done' | 'failed' | 'canceled'

export interface PrintSnapshot {
  relPath: string
  /** 可信快照绑定的文档 revision（打印结果可追溯；与当前编辑内容无关） */
  revision: number
  content: string
}

export interface RenderedPrint {
  html: string
  /** 页数；渲染器无法得知时返回 null（产品 Rust PrintToPdf 不回传页数），不得伪造 */
  pages: number | null
}

export interface PrintedPdf {
  pdfPath: string
  /** 页数；传输层无法得知时为 null（T26 G3：产品链路返回 null） */
  pages: number | null
  bytes: number
}

export interface PrintRenderer {
  render(snapshot: PrintSnapshot, signal: AbortSignal): Promise<RenderedPrint>
}

export interface PrintTransport {
  /** 打印已渲染快照到目标路径（实现方负责原子/不覆盖与清理） */
  print(rendered: RenderedPrint, targetPath: string, signal: AbortSignal): Promise<PrintedPdf>
}

export interface PrintJob {
  jobId: string
  relPath: string
  revision: number
  targetPath: string
  state: PrintJobState
  pages?: number
  pdfPath?: string
  error?: string
}

export interface PrintJobManagerOptions {
  renderer: PrintRenderer
  transport: PrintTransport
  /** 串行打印资源上限（默认 1） */
  maxConcurrent?: number
  /** 单 job 超时（毫秒，默认 60s） */
  timeoutMs?: number
  /** 目标路径校验（产品注入：必须在工作区之外、不覆盖已有文件；抛错即拒绝） */
  validateTargetPath?: (targetPath: string) => void
  onStateChange?: (job: PrintJob) => void
}

interface InternalJob extends PrintJob {
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  resolve: (job: PrintJob) => void
  reject: (err: Error) => void
  snapshot: PrintSnapshot
}

let seq = 0

export class PrintJobManager {
  private readonly options: Required<Omit<PrintJobManagerOptions, 'onStateChange' | 'validateTargetPath'>> &
    Pick<PrintJobManagerOptions, 'onStateChange' | 'validateTargetPath'>
  private readonly jobs = new Map<string, InternalJob>()
  private readonly order: string[] = []
  private active = 0
  private readonly listeners = new Set<(job: PrintJob) => void>()

  constructor(options: PrintJobManagerOptions) {
    this.options = {
      renderer: options.renderer,
      transport: options.transport,
      maxConcurrent: options.maxConcurrent ?? 1,
      timeoutMs: options.timeoutMs ?? 60000,
      onStateChange: options.onStateChange,
      validateTargetPath: options.validateTargetPath,
    }
  }

  list(): PrintJob[] {
    return this.order.map((id) => this.publicJob(this.jobs.get(id)!)).filter(Boolean)
  }

  subscribe(listener: (job: PrintJob) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 入队打印指定快照；返回的 Promise 在 done/failed/canceled 时 settle。 */
  enqueue(snapshot: PrintSnapshot, targetPath: string): Promise<PrintJob> {
    if (!snapshot || typeof snapshot.content !== 'string' || !snapshot.relPath) {
      return Promise.reject(new Error('E_SNAPSHOT: 缺少可信快照'))
    }
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
      return Promise.reject(new Error('E_SNAPSHOT: 非法 revision'))
    }
    if (this.options.validateTargetPath) {
      try {
        this.options.validateTargetPath(targetPath)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    const jobId = `print-${++seq}-${Date.now().toString(36)}`
    return new Promise<PrintJob>((resolve, reject) => {
      const internal: InternalJob = {
        jobId,
        relPath: snapshot.relPath,
        revision: snapshot.revision,
        targetPath,
        state: 'queued',
        controller: new AbortController(),
        resolve,
        reject,
        snapshot: { ...snapshot },
      }
      this.jobs.set(jobId, internal)
      this.order.push(jobId)
      this.emit(internal)
      this.pump()
    })
  }

  /** 取消 Job（任意阶段）；返回是否找到该 Job。 */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (['done', 'failed', 'canceled'].includes(job.state)) return false
    job.controller.abort()
    this.settle(job, 'canceled', new Error('E_CANCELED: 打印已取消'))
    return true
  }

  private pump(): void {
    if (this.active >= this.options.maxConcurrent) return
    const next = this.order.map((id) => this.jobs.get(id)!).find((j) => j.state === 'queued')
    if (!next) return
    this.active += 1
    void this.run(next).finally(() => {
      this.active -= 1
      this.pump()
    })
  }

  private async run(job: InternalJob): Promise<void> {
    this.setState(job, 'rendering')
    job.timer = setTimeout(() => {
      job.controller.abort()
      this.settle(job, 'failed', new Error('E_TIMEOUT: 打印超时'))
    }, this.options.timeoutMs)
    try {
      const rendered = await this.options.renderer.render(job.snapshot, job.controller.signal)
      if (job.controller.signal.aborted) return
      this.setState(job, 'printing')
      const printed = await this.options.transport.print(rendered, job.targetPath, job.controller.signal)
      if (job.controller.signal.aborted) return
      job.pages = printed.pages ?? undefined
      job.pdfPath = printed.pdfPath
      this.settle(job, 'done')
    } catch (e) {
      if (job.controller.signal.aborted) return
      this.settle(job, 'failed', e instanceof Error ? e : new Error(String(e)))
    }
  }

  private settle(job: InternalJob, state: PrintJobState, error?: Error): void {
    if (['done', 'failed', 'canceled'].includes(job.state)) return
    if (job.timer) clearTimeout(job.timer)
    job.state = state
    if (error) job.error = error.message
    this.emit(job)
    if (state === 'done') job.resolve(this.publicJob(job))
    else job.reject(error ?? new Error(`E_${state.toUpperCase()}`))
  }

  private setState(job: InternalJob, state: PrintJobState): void {
    job.state = state
    this.emit(job)
  }

  private emit(job: InternalJob): void {
    const pub = this.publicJob(job)
    this.options.onStateChange?.(pub)
    for (const l of this.listeners) l(pub)
  }

  private publicJob(job: InternalJob): PrintJob {
    return {
      jobId: job.jobId,
      relPath: job.relPath,
      revision: job.revision,
      targetPath: job.targetPath,
      state: job.state,
      pages: job.pages,
      pdfPath: job.pdfPath,
      error: job.error,
    }
  }
}
