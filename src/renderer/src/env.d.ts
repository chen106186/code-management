/// <reference types="vite/client" />
import type { Api, ApiEvents } from '@shared/ipc'

declare global {
  interface Window {
    api: Api & ApiEvents
  }
}
