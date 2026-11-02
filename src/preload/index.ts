import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, channelOf, type Api } from '@shared/ipc'

const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelOf(method), ...args)
  ])
) as unknown as Api

contextBridge.exposeInMainWorld('api', api)
