import * as monaco from 'monaco-editor/editor/editor.api.js'
// 只注册常用语言的高亮，其他语言的 Diff 按纯文本显示
import 'monaco-editor/languages/definitions/bat/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/dart/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/kotlin/register.js'
import 'monaco-editor/languages/definitions/less/register.js'
import 'monaco-editor/languages/definitions/lua/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/php/register.js'
import 'monaco-editor/languages/definitions/powershell/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/swift/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
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
