import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/basic-languages/monaco.contribution.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
// editor.api 不带图标字体，exports 也不暴露 css，只能按相对路径引入
import '../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'

// 只显示 Diff，语法高亮靠基础分词器，不需要各语言的语言服务 worker
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => monaco.editor.setTheme(dark.matches ? 'vs-dark' : 'vs')
dark.addEventListener('change', applyTheme)
applyTheme()

export function languageOf(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot) : ''
  const language = monaco.languages
    .getLanguages()
    .find((l) => l.extensions?.includes(extension) || l.filenames?.some((f) => f.toLowerCase() === name))
  return language?.id ?? 'plaintext'
}

export { monaco }
