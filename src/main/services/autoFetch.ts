import type { FetchAllItem } from '@shared/repo'
import type { AutoFetchStatus } from '@shared/types'

/** 定时跑一次全部 Fetch；上一次还没结束时不重复启动，失败不打断后续的定时 */
export class AutoFetcher {
  private timer: ReturnType<typeof setTimeout> | undefined
  private minutes = 0
  private running = false
  private lastStatus: AutoFetchStatus = { lastRun: null, succeeded: 0, failed: [] }

  constructor(
    private readonly fetchAll: () => Promise<FetchAllItem[]>,
    private readonly onDone: (status: AutoFetchStatus) => void
  ) {}

  get status(): AutoFetchStatus {
    return this.lastStatus
  }

  /** 0 表示关闭；改间隔后从现在开始重新计时 */
  setInterval(minutes: number): void {
    this.minutes = minutes
    this.schedule()
  }

  private schedule(): void {
    clearTimeout(this.timer)
    if (this.minutes > 0) this.timer = setTimeout(() => void this.runNow(), this.minutes * 60_000)
  }

  async runNow(): Promise<void> {
    if (this.running) return
    this.running = true
    clearTimeout(this.timer)
    try {
      const results = await this.fetchAll()
      this.lastStatus = {
        lastRun: Date.now(),
        succeeded: results.filter((r) => r.ok).length,
        failed: results
          .filter((r) => !r.ok && !r.cancelled)
          .map(({ name, message }) => ({ name, message }))
      }
    } catch (error) {
      this.lastStatus = {
        lastRun: Date.now(),
        succeeded: 0,
        failed: [{ name: '全部项目', message: (error as Error).message }]
      }
    } finally {
      this.running = false
      this.schedule()
    }
    this.onDone(this.lastStatus)
  }
}
