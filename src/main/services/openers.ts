import { spawn } from 'child_process'
import { shell } from 'electron'

/** 走 URL 协议打开，路径不经过 shell，无需担心特殊字符被解释 */
export function vscodeUrl(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/')
  const encoded = segments.map((s) => (/^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s)))
  return `vscode://file/${encoded.join('/').replace(/^\/+/, '')}`
}

export async function openInEditor(path: string): Promise<void> {
  await shell.openExternal(vscodeUrl(path))
}

function launch(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function openInTerminal(path: string): Promise<void> {
  try {
    // 用 cwd 传路径：wt 会把 -d 参数里的分号当作命令分隔符
    await launch('wt.exe', ['-d', '.'], path)
  } catch {
    await launch('powershell.exe', ['-NoExit'], path)
  }
}

export async function openInExplorer(path: string): Promise<void> {
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}
