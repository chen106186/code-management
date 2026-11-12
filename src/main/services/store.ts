import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import { subtreeIds } from '@shared/categories'
import {
  AUTO_FETCH_OPTIONS,
  DEFAULT_AUTO_FETCH_MINUTES,
  type Category,
  type Config,
  type ProjectMetaValues,
  type ProjectPatch,
  type SavedView,
  type ThemeSetting
} from '@shared/types'

export interface ProjectMeta {
  favorite?: boolean
  tags?: string[]
  categoryId?: string | null
  remark?: string | null
  /** 以下三项用于认出移动过的项目 */
  remote?: string
  path?: string
  moveIgnored?: boolean
}

interface StoreData extends Config {
  version: 1
  /** 以 pathKey 为键 */
  meta: Record<string, ProjectMeta>
}

/** 导出文件里的标记，避免把别的 JSON 当成配置导入 */
const EXPORT_APP = 'code-management'

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20
const MAX_CATEGORY_NAME_LENGTH = 40
const MAX_REMARK_LENGTH = 60
const MAX_VIEW_NAME_LENGTH = 30
const MAX_QUERY_LENGTH = 200

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

/** 校验页面传来或文件里读到的视图；名称为空或字段类型不对时返回 null */
function parseView(value: unknown, id: string): SavedView | null {
  const raw = (value ?? {}) as Partial<SavedView>
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_VIEW_NAME_LENGTH) : ''
  if (!name || typeof raw.filter !== 'string' || typeof raw.scope !== 'string' || typeof raw.sort !== 'string') {
    return null
  }
  return {
    id,
    name,
    filter: raw.filter,
    scope: raw.scope,
    activeTag: typeof raw.activeTag === 'string' ? raw.activeTag : null,
    query: typeof raw.query === 'string' ? raw.query.slice(0, MAX_QUERY_LENGTH) : '',
    sort: raw.sort,
    sortReverse: raw.sortReverse === true
  }
}

function parseViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const view = typeof item?.id === 'string' ? parseView(item, item.id) : null
    return view ? [view] : []
  })
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
    autoFetchMinutes: DEFAULT_AUTO_FETCH_MINUTES,
    closeToTray: true,
    savedViews: [],
    meta: {}
  }
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isAutoFetchMinutes(value: unknown): value is number {
  return AUTO_FETCH_OPTIONS.includes(value as number)
}

function parseMeta(value: unknown): Record<string, ProjectMeta> {
  if (!value || typeof value !== 'object') return {}
  const entries = Object.entries(value).filter(([, meta]) => meta && typeof meta === 'object')
  return Object.fromEntries(entries.map(([path, meta]) => [pathKey(path), meta as ProjectMeta]))
}

function parseData(raw: Record<string, unknown>): StoreData {
  return {
    version: 1,
    roots: stringArray(raw.roots),
    manual: stringArray(raw.manual),
    hidden: stringArray(raw.hidden),
    excluded: stringArray(raw.excluded),
    categories: parseCategories(raw.categories),
    theme: isThemeSetting(raw.theme) ? raw.theme : 'system',
    autoFetchMinutes: isAutoFetchMinutes(raw.autoFetchMinutes)
      ? raw.autoFetchMinutes
      : DEFAULT_AUTO_FETCH_MINUTES,
    closeToTray: raw.closeToTray !== false,
    savedViews: parseViews(raw.savedViews),
    meta: parseMeta(raw.meta)
  }
}

/** 解析导出的配置文件；不是本应用导出的文件时报错 */
export function parseExport(text: string): StoreData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== EXPORT_APP) {
    throw new Error('这不是 Code Management Tool 导出的配置文件')
  }
  return parseData(raw as Record<string, unknown>)
}

/** 备注、标签、分类或收藏，有任意一项才算用户添加过信息 */
function hasUserInfo(meta: ProjectMetaValues): boolean {
  return meta.favorite || meta.tags.length > 0 || meta.categoryId !== null || meta.remark !== null
}

export class Store {
  private data: StoreData

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  get directory(): string {
    return dirname(this.file)
  }

  private load(): StoreData {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      return emptyData()
    }
    try {
      return parseData(JSON.parse(text))
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
      theme: this.data.theme,
      autoFetchMinutes: this.data.autoFetchMinutes,
      closeToTray: this.data.closeToTray,
      savedViews: this.savedViews
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
    this.hideMany([path])
  }

  hideMany(paths: string[]): void {
    for (const path of paths) Store.add(this.data.hidden, path)
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

  get autoFetchMinutes(): number {
    return this.data.autoFetchMinutes
  }

  setAutoFetchMinutes(minutes: number): void {
    this.data.autoFetchMinutes = minutes
    this.save()
  }

  get closeToTray(): boolean {
    return this.data.closeToTray
  }

  setCloseToTray(enabled: boolean): void {
    this.data.closeToTray = enabled
    this.save()
  }

  get savedViews(): SavedView[] {
    return this.data.savedViews.map((view) => ({ ...view }))
  }

  /** 同名视图保留原来的 id 和位置，内容被覆盖 */
  saveView(value: unknown): void {
    const view = parseView(value, randomUUID())
    if (!view) throw new Error('视图无效')
    const index = this.data.savedViews.findIndex((v) => v.name === view.name)
    if (index >= 0) this.data.savedViews[index] = { ...view, id: this.data.savedViews[index].id }
    else this.data.savedViews.push(view)
    this.save()
  }

  deleteView(id: string): void {
    this.data.savedViews = this.data.savedViews.filter((view) => view.id !== id)
    this.save()
  }

  /** 使用这个标签的项目数，包括已隐藏和当前不在列表里的项目 */
  tagUsage(tag: string): number {
    return Object.values(this.data.meta).filter((meta) => stringArray(meta.tags).includes(tag)).length
  }

  /** 改名后和已有标签相同就合并成一个；顺序保持在原来的位置 */
  renameTag(from: string, to: string): void {
    const [name] = normalizeTags([to])
    if (!name) throw new Error('标签名称不能为空')
    for (const meta of Object.values(this.data.meta)) {
      const tags = stringArray(meta.tags)
      if (tags.includes(from)) meta.tags = normalizeTags(tags.map((t) => (t === from ? name : t)))
    }
    this.save()
  }

  deleteTag(tag: string): void {
    for (const meta of Object.values(this.data.meta)) {
      const tags = stringArray(meta.tags)
      if (tags.includes(tag)) meta.tags = tags.filter((t) => t !== tag)
    }
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
    this.patchMeta(path, { categoryId })
    this.save()
  }

  /** 保留 remote 等内部字段，只改给出的字段 */
  private patchMeta(path: string, patch: ProjectMeta): void {
    const key = pathKey(path)
    this.data.meta[key] = { ...this.data.meta[key], ...this.metaOf(path), ...patch }
  }

  /** 批量修改只写一次文件 */
  updateProjects(paths: string[], patch: ProjectPatch): void {
    const { categoryId, favorite, addTag } = patch
    if (typeof categoryId === 'string' && !this.hasCategory(categoryId)) throw new Error('分类不存在')
    for (const path of paths) {
      const next: ProjectMeta = {}
      if (categoryId !== undefined) next.categoryId = categoryId
      if (favorite !== undefined) next.favorite = favorite
      if (addTag !== undefined) next.tags = normalizeTags([...this.metaOf(path).tags, addTag])
      this.patchMeta(path, next)
    }
    this.save()
  }

  /** 记下添加过信息的项目的 Git 地址，移动后靠它认出来；它已回到列表，之前的忽略也作废 */
  trackProjects(items: { path: string; remote: string | null }[]): void {
    let changed = false
    for (const { path, remote } of items) {
      const meta = this.data.meta[pathKey(path)]
      if (!meta) continue
      if (meta.moveIgnored) {
        delete meta.moveIgnored
        changed = true
      }
      if (!remote || !hasUserInfo(this.metaOf(path))) continue
      if (meta.remote === remote && meta.path === path) continue
      meta.remote = remote
      meta.path = path
      changed = true
    }
    if (changed) this.save()
  }

  /** 记录过 Git 地址且添加过信息的项目；路径是否还存在由调用方判断 */
  moveSources(): { from: string; remote: string }[] {
    return Object.entries(this.data.meta).flatMap(([key, meta]) =>
      typeof meta.remote === 'string' && !meta.moveIgnored && hasUserInfo(this.metaOf(key))
        ? [{ from: typeof meta.path === 'string' ? meta.path : key, remote: meta.remote }]
        : []
    )
  }

  /** 把旧路径的信息、手动添加和隐藏状态都转到新路径，一次写入 */
  migrateProjects(moves: { from: string; to: string }[]): void {
    for (const { from, to } of moves) {
      const source = this.data.meta[pathKey(from)]
      if (!source) continue
      delete this.data.meta[pathKey(from)]
      this.data.meta[pathKey(to)] = { ...source, path: normalizePath(to) }
      Store.remove(this.data.manual, from)
      if (this.data.hidden.some((p) => pathKey(p) === pathKey(from))) {
        Store.remove(this.data.hidden, from)
        Store.add(this.data.hidden, to)
      }
    }
    this.save()
  }

  ignoreMoves(paths: string[]): void {
    for (const path of paths) {
      const meta = this.data.meta[pathKey(path)]
      if (meta) meta.moveIgnored = true
    }
    this.save()
  }

  exportData(): Record<string, unknown> {
    return { app: EXPORT_APP, exportedAt: new Date().toISOString(), ...this.data }
  }

  /** 替换全部配置，先把当前配置备份在同一目录；返回备份文件的位置 */
  replaceData(data: StoreData): string | null {
    let backup: string | null = null
    if (existsSync(this.file)) {
      backup = `${this.file}.backup-${Date.now()}`
      copyFileSync(this.file, backup)
    }
    this.data = data
    this.save()
    return backup
  }

  metaOf(path: string): ProjectMetaValues {
    const meta = this.data.meta[pathKey(path)]
    const categoryId =
      typeof meta?.categoryId === 'string' && this.hasCategory(meta.categoryId) ? meta.categoryId : null
    const remark = typeof meta?.remark === 'string' && meta.remark ? meta.remark : null
    return { favorite: meta?.favorite === true, tags: stringArray(meta?.tags), categoryId, remark }
  }

  /** 去掉首尾空白并限制长度；留空表示清除备注 */
  setRemark(path: string, remark: string): string | null {
    const normalized = remark.trim().slice(0, MAX_REMARK_LENGTH) || null
    this.patchMeta(path, { remark: normalized })
    this.save()
    return normalized
  }

  setFavorite(path: string, favorite: boolean): void {
    this.patchMeta(path, { favorite })
    this.save()
  }

  setTags(path: string, tags: string[]): string[] {
    const normalized = normalizeTags(tags)
    this.patchMeta(path, { tags: normalized })
    this.save()
    return normalized
  }
}
