import { lstat, readdir, readFile } from 'fs/promises'
import { extname, join } from 'path'
import type { Readme } from '@shared/types'
import { assertRepoPath } from './gitOps'

const MAX_README_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** README.md 优先，其次其他写法；不接受符号链接，避免读到仓库外的文件 */
export function pickReadme(names: string[]): string | null {
  const rank = (name: string): number => {
    const match = /^readme(\.(md|markdown|txt|rst))?$/i.exec(name)
    if (!match) return -1
    return match[2]?.toLowerCase() === 'md' ? 0 : match[2]?.toLowerCase() === 'markdown' ? 1 : 2
  }
  return names.filter((n) => rank(n) >= 0).sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export async function readReadme(dir: string): Promise<Readme | null> {
  const entries = await readdir(dir, { withFileTypes: true })
  const name = pickReadme(entries.filter((e) => e.isFile()).map((e) => e.name))
  if (!name) return null
  const bytes = await readFile(join(dir, name))
  return {
    name,
    content: bytes.subarray(0, MAX_README_BYTES).toString('utf8'),
    markdown: /\.(md|markdown)$/i.test(name),
    truncated: bytes.length > MAX_README_BYTES
  }
}

/** 只读仓库内的常规图片文件；不符合要求的一律返回 null，界面显示替代文字 */
export async function readReadmeImage(dir: string, relativePath: string): Promise<string | null> {
  try {
    const path = assertRepoPath(dir, relativePath)
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type) return null
    const full = join(dir, path)
    const info = await lstat(full)
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null
    return `data:${type};base64,${(await readFile(full)).toString('base64')}`
  } catch {
    return null
  }
}
