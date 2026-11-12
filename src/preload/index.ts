import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  API_METHODS,
  channelOf,
  EVENT_AUTO_FETCHED,
  EVENT_REMOTE_PROGRESS,
  EVENT_REPO_CHANGED,
  EVENT_STATS_UPDATED,
  type Api,
  type ApiEvents
} from '@shared/ipc'

const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelOf(method), ...args)
  ])
) as unknown as Api

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const events: ApiEvents = {
  onRemoteProgress: (listener) => subscribe(EVENT_REMOTE_PROGRESS, listener),
  onRepoChanged: (listener) => subscribe(EVENT_REPO_CHANGED, listener),
  onAutoFetched: (listener) => subscribe(EVENT_AUTO_FETCHED, listener),
  onStatsUpdated: (listener) => subscribe(EVENT_STATS_UPDATED, listener)
}

contextBridge.exposeInMainWorld('api', { ...api, ...events })
