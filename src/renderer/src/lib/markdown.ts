import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** 图片先记在这个属性上：本地图片由主进程读取，远程图片不加载，也就不会向外发请求 */
export const IMAGE_SOURCE_ATTR = 'data-readme-src'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'IMG') return
  const source = node.getAttribute('src')
  node.removeAttribute('src')
  if (source) node.setAttribute(IMAGE_SOURCE_ATTR, source)
})

/** README 来自仓库，内容不可信：转成 HTML 后一律过滤，只留排版用的元素 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio'],
    FORBID_ATTR: ['style', 'class', 'id']
  })
}

/** 相对路径转成仓库内路径；远程地址等其他写法返回 null */
export function localImagePath(source: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(source)) return null
  const path = source.split(/[?#]/)[0].replace(/^(\.\/|\/)+/, '')
  try {
    return decodeURI(path) || null
  } catch {
    return path || null
  }
}
