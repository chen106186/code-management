/** 去掉 Electron 给 IPC 错误加的前缀，只留主进程抛出的信息 */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
