import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import { subtreeIds } from '@shared/categories'
import type { Category, Config, ThemeSetting } from '@shared/types'

export interface ProjectMeta {
  favorite?: boolean
  tags?: string[]
  categoryId?: string | null
  remark?: string | null
}

interface StoreData extends Config {
  version: 1
  /** 以 pathKey 为键 */
  meta: Record<string, ProjectMeta>
}

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20
const MAX_CATEGORY_NAME_LENGTH = 40
const MAX_REMARK_LENGTH = 60

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

/** 配置可能被手动改过：丢弃不完整的条目，父分类不存在的提到顶层 */
function parseCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) return []
  const valid = value.filter(
    (c): c is Category => c && typeof c.id === 'string' && typeof c.name === 'string'
  )
  const ids = new Set(valid.map((c) => c.id))
  return valid.map(({ id, name, parentId }) => ({
    id,
    name,
    parentId: typeof parentId === 'string' && ids.has(parentId) && parentId !== id ? parentId : null
  }))
}

function emptyData(): StoreData {
  return {
    version: 1,
    roots: [],
    manual: [],
    hidden: [],
    excluded: [],
    categories: [],
    theme: 'system',
    meta: {}
  }
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || value === 'light' || value === 'dark'
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
        categories: parseCategories(raw.categories),
        theme: isThemeSetting(raw.theme) ? raw.theme : 'system',
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
      excluded: [...excluded],
      categories: this.categories,
      theme: this.data.theme
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

  get theme(): ThemeSetting {
    return this.data.theme
  }

  setTheme(theme: ThemeSetting): void {
    this.data.theme = theme
    this.save()
  }

  get categories(): Category[] {
    return this.data.categories.map((c) => ({ ...c }))
  }

  private hasCategory(id: string): boolean {
    return this.data.categories.some((c) => c.id === id)
  }

  /** 校验名称：不能为空，同一层不能重名 */
  private validName(name: unknown, parentId: string | null, selfId?: string): string {
    const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_CATEGORY_NAME_LENGTH) : ''
    if (!trimmed) throw new Error('分类名称不能为空')
    const duplicate = this.data.categories.some(
      (c) => c.parentId === parentId && c.name === trimmed && c.id !== selfId
    )
    if (duplicate) throw new Error(`同一层已有分类“${trimmed}”`)
    return trimmed
  }

  createCategory(name: unknown, parentId: string | null): Category {
    if (parentId !== null && !this.hasCategory(parentId)) throw new Error('上级分类不存在')
    const category = { id: randomUUID(), name: this.validName(name, parentId), parentId }
    this.data.categories.push(category)
    this.save()
    return { ...category }
  }

  renameCategory(id: string, name: unknown): void {
    const category = this.data.categories.find((c) => c.id === id)
    if (!category) throw new Error('分类不存在')
    category.name = this.validName(name, category.parentId, id)
    this.save()
  }

  /** 移动到 parentId 下、beforeId 之前（null 排到最后）；同级顺序就是数组里的先后顺序 */
  moveCategory(id: string, parentId: string | null, beforeId: string | null): void {
    const list = this.data.categories
    const category = list.find((c) => c.id === id)
    if (!category) throw new Error('分类不存在')
    if (parentId !== null && !this.hasCategory(parentId)) throw new Error('目标分类不存在')
    if (parentId !== null && subtreeIds(list, id).has(parentId)) {
      throw new Error('不能把分类移动到它自己或它的子分类下')
    }
    if (beforeId !== null && list.find((c) => c.id === beforeId)?.parentId !== parentId) {
      throw new Error('目标位置不存在')
    }
    if (parentId !== category.parentId) this.validName(category.name, parentId, id)
    // 插到自己前面等于位置不变
    if (beforeId === id) return

    list.splice(list.indexOf(category), 1)
    category.parentId = parentId
    const index = beforeId === null ? list.length : list.findIndex((c) => c.id === beforeId)
    list.splice(index, 0, category)
    this.save()
  }

  /** 删除分类及其子孙；其中的项目变为未分类，项目本身不受影响 */
  deleteCategory(id: string): void {
    const removed = subtreeIds(this.data.categories, id)
    this.data.categories = this.data.categories.filter((c) => !removed.has(c.id))
    for (const meta of Object.values(this.data.meta)) {
      if (meta.categoryId && removed.has(meta.categoryId)) meta.categoryId = null
    }
    this.save()
  }

  setCategory(path: string, categoryId: string | null): void {
    if (categoryId !== null && !this.hasCategory(categoryId)) throw new Error('分类不存在')
    this.data.meta[pathKey(path)] = { ...this.metaOf(path), categoryId }
    this.save()
  }

  metaOf(path: string): Required<ProjectMeta> {
    const meta = this.data.meta[pathKey(path)]
    const categoryId =
      typeof meta?.categoryId === 'string' && this.hasCategory(meta.categoryId) ? meta.categoryId : null
    const remark = typeof meta?.remark === 'string' && meta.remark ? meta.remark : null
    return { favorite: meta?.favorite === true, tags: stringArray(meta?.tags), categoryId, remark }
  }

  /** 去掉首尾空白并限制长度；留空表示清除备注 */
  setRemark(path: string, remark: string): string | null {
    const normalized = remark.trim().slice(0, MAX_REMARK_LENGTH) || null
    this.data.meta[pathKey(path)] = { ...this.metaOf(path), remark: normalized }
    this.save()
    return normalized
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
