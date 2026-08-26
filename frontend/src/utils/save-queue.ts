/**
 * 单飞保存队列（P1-6）：保存请求串行执行，latest-wins。
 *
 * 竞态背景：autosave 防抖与手动保存/Ctrl+S 可能并发 PUT，
 * 完成顺序不定时后到的旧响应会把磁盘覆盖回旧内容；恢复点也可能被
 * 旧响应清除。本队列把所有保存串行化——后一个任务总是等待前一个
 * 完成才发起请求，天然消除乱序响应；任一任务失败不会卡死整条链
 * （失败被吞掉，后续任务继续）。
 */
export interface SaveTask {
  docId: string
  md: string
  seq: number
}

export interface SaveQueue {
  /** 入队一条保存；返回该任务最终成功与否（前序失败不阻塞） */
  push(task: SaveTask): Promise<boolean>
}

export function createSaveQueue(exec: (task: SaveTask) => Promise<boolean>): SaveQueue {
  let chain: Promise<boolean> = Promise.resolve(true)
  return {
    push(task: SaveTask): Promise<boolean> {
      const next = chain.then(() => exec(task))
      // 队列自身吞错，避免一处失败卡死整条链；调用方拿到的 promise 也永不
      // reject——失败统一以 false 呈现（否则 await 的未处理 rejection 会告警）。
      chain = next.catch(() => false)
      return chain
    },
  }
}
