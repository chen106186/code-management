import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ScanProgress } from '@shared/types'
import {
  API_METHODS,
  EVENT_AUTO_FETCHED,
  EVENT_REMOTE_PROGRESS,
  EVENT_REPO_CHANGED,
  EVENT_SCAN_PROGRESS,
  EVENT_STATS_UPDATED,
  type Api,
  type ApiEvents
} from '@shared/ipc'

/** 所有方法都走同一个 Rust 命令，按方法名分发；参数保持原来的位置顺序 */
const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    async (...args: unknown[]) => {
      try {
        return await invoke('api', { method, args })
      } catch (error) {
        // Rust 端的错误是字符串，包成 Error 以便页面统一处理
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
  ])
) as unknown as Api

/** listen 是异步注册的；在注册完成前就取消订阅时，等注册完再取消 */
function subscribe<T>(event: string, listener: (payload: T) => void): () => void {
  let disposed = false
  const pending = listen<T>(event, (e) => {
    if (!disposed) listener(e.payload)
  })
  return () => {
    disposed = true
    void pending.then((unlisten) => unlisten())
  }
}

const events: ApiEvents = {
  onScanProgress: (listener) => listen<ScanProgress>(EVENT_SCAN_PROGRESS, (event) => listener(event.payload)),
  onRemoteProgress: (listener) => subscribe(EVENT_REMOTE_PROGRESS, listener),
  onRepoChanged: (listener) => subscribe(EVENT_REPO_CHANGED, listener),
  onAutoFetched: (listener) => subscribe(EVENT_AUTO_FETCHED, listener),
  onStatsUpdated: (listener) => subscribe(EVENT_STATS_UPDATED, listener)
}

window.api = { ...api, ...events }
