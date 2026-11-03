import { pathKey } from './store'

/** 同一仓库的 Fetch 依次执行，避免单个和批量 Fetch 同时跑；不同仓库互不影响 */
export class RepoQueue {
  private tails = new Map<string, Promise<unknown>>()

  run<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const key = pathKey(repo)
    const previous = this.tails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    const tail = current
      .catch(() => {})
      .finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key)
      })
    this.tails.set(key, tail)
    return current
  }
}
