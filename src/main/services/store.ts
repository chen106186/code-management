import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import type { Config } from '@shared/types'

export interface ProjectMeta {
  favorite?: boolean
  tags?: string[]
}

interface StoreData extends Config {
  version: 1
  /** 以 pathKey 为键 */
  meta: Record<string, ProjectMeta>
}

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20

export function normalizePath(path: string): string {
  return resolve(path)
}

/** Windows 路径不区分大小写，比较和做键时统一用这个 */
export function pathKey(path: string): string {
  const normalized = normalizePath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** path 是否等于 dir 或位于其下；按路径段比较，E:\code 不包含 E:\code-old */
export function isWithin(path: string, dir: string): boolean {
  const p = pathKey(path)
  const d = pathKey(dir)
  return p === d || p.startsWith(d.endsWith(sep) ? d : d + sep)
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
    if (result.length === MAX_TAGS) break
  }
  return result
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function emptyData(): StoreData {
  return { version: 1, roots: [], manual: [], hidden: [], excluded: [], meta: {} }
}

export class Store {
  private data: StoreData

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  private load(): StoreData {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      return emptyData()
    }
    try {
      const raw = JSON.parse(text)
      return {
        version: 1,
        roots: stringArray(raw.roots),
        manual: stringArray(raw.manual),
        hidden: stringArray(raw.hidden),
        excluded: stringArray(raw.excluded),
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
      }
    } catch {
      // 配置损坏时保留原文件以便找回，再从空配置开始
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      return emptyData()
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  get config(): Config {
    const { roots, manual, hidden, excluded } = this.data
    return {
      roots: [...roots],
      manual: [...manual],
      hidden: [...hidden],
      excluded: [...excluded]
    }
  }

  private static add(list: string[], path: string): void {
    const key = pathKey(path)
    if (!list.some((p) => pathKey(p) === key)) list.push(normalizePath(path))
  }

  private static remove(list: string[], path: string): void {
    const key = pathKey(path)
    const index = list.findIndex((p) => pathKey(p) === key)
    if (index >= 0) list.splice(index, 1)
  }

  addRoot(path: string): void {
    Store.add(this.data.roots, path)
    this.save()
  }

  removeRoot(path: string): void {
    Store.remove(this.data.roots, path)
    this.save()
  }

  addExcluded(path: string): void {
    Store.add(this.data.excluded, path)
    this.save()
  }

  removeExcluded(path: string): void {
    Store.remove(this.data.excluded, path)
    this.save()
  }

  /** 手动添加同时取消隐藏，否则用户重新添加隐藏过的项目会没有反应 */
  addManual(path: string): void {
    Store.add(this.data.manual, path)
    Store.remove(this.data.hidden, path)
    this.save()
  }

  hide(path: string): void {
    Store.add(this.data.hidden, path)
    this.save()
  }

  restore(path: string): void {
    Store.remove(this.data.hidden, path)
    this.save()
  }

  metaOf(path: string): Required<ProjectMeta> {
    const meta = this.data.meta[pathKey(path)]
    return { favorite: meta?.favorite === true, tags: stringArray(meta?.tags) }
  }

  setFavorite(path: string, favorite: boolean): void {
    this.data.meta[pathKey(path)] = { ...this.metaOf(path), favorite }
    this.save()
  }

  setTags(path: string, tags: string[]): string[] {
    const normalized = normalizeTags(tags)
    this.data.meta[pathKey(path)] = { ...this.metaOf(path), tags: normalized }
    this.save()
    return normalized
  }
}
