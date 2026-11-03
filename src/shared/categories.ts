import type { Category } from './types'

export interface CategoryRow {
  category: Category
  depth: number
  hasChildren: boolean
}

function childrenByParent(categories: Category[]): Map<string | null, Category[]> {
  const children = new Map<string | null, Category[]>()
  for (const category of categories) {
    const siblings = children.get(category.parentId)
    if (siblings) siblings.push(category)
    else children.set(category.parentId, [category])
  }
  return children
}

export type DropPosition = 'before' | 'after' | 'inside'

export interface MoveTarget {
  parentId: string | null
  /** 插到这个同级分类之前，null 表示排到最后 */
  beforeId: string | null
}

/** 把拖放到某一行的位置换算成移动目标 */
export function resolveDrop(
  categories: Category[],
  collapsed: ReadonlySet<string>,
  targetId: string,
  position: DropPosition
): MoveTarget | null {
  const target = categories.find((c) => c.id === targetId)
  if (!target) return null
  const children = childrenByParent(categories)
  if (position === 'inside') return { parentId: target.id, beforeId: null }
  if (position === 'before') return { parentId: target.parentId, beforeId: target.id }

  // 展开的文件夹下边缘紧挨着它的第一个子分类，放下去的位置就是那里
  const ownChildren = children.get(target.id)
  if (ownChildren?.length && !collapsed.has(target.id)) {
    return { parentId: target.id, beforeId: ownChildren[0].id }
  }
  const siblings = children.get(target.parentId) ?? []
  const next = siblings[siblings.indexOf(target) + 1]
  return { parentId: target.parentId, beforeId: next?.id ?? null }
}

/** 该分类自身及其所有子孙的 id */
export function subtreeIds(categories: Category[], id: string): Set<string> {
  const children = childrenByParent(categories)
  const ids = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    if (ids.has(current)) continue
    ids.add(current)
    for (const child of children.get(current) ?? []) stack.push(child.id)
  }
  return ids
}

/** 按树的显示顺序展开成一维列表，折叠节点的子孙不出现 */
export function flattenCategories(
  categories: Category[],
  collapsed: ReadonlySet<string> = new Set()
): CategoryRow[] {
  const children = childrenByParent(categories)
  const rows: CategoryRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const category of children.get(parentId) ?? []) {
      const hasChildren = children.has(category.id)
      rows.push({ category, depth, hasChildren })
      if (hasChildren && !collapsed.has(category.id)) walk(category.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}
