import { describe, expect, it } from 'vitest'
import { flattenCategories, resolveDrop, subtreeIds } from './categories'
import type { Category } from './types'

const categories: Category[] = [
  { id: 'a', name: 'A', parentId: null },
  { id: 'b', name: 'B', parentId: null },
  { id: 'a1', name: 'A1', parentId: 'a' },
  { id: 'a11', name: 'A11', parentId: 'a1' },
  { id: 'a2', name: 'A2', parentId: 'a' }
]

describe('flattenCategories', () => {
  it('按树的顺序展开并给出层级', () => {
    const rows = flattenCategories(categories)
    expect(rows.map((r) => [r.category.id, r.depth, r.hasChildren])).toEqual([
      ['a', 0, true],
      ['a1', 1, true],
      ['a11', 2, false],
      ['a2', 1, false],
      ['b', 0, false]
    ])
  })

  it('折叠的节点隐藏所有子孙', () => {
    const ids = (collapsed: string[]): string[] =>
      flattenCategories(categories, new Set(collapsed)).map((r) => r.category.id)
    expect(ids(['a1'])).toEqual(['a', 'a1', 'a2', 'b'])
    expect(ids(['a'])).toEqual(['a', 'b'])
  })
})

describe('resolveDrop', () => {
  const drop = (id: string, position: 'before' | 'after' | 'inside', collapsed: string[] = []) =>
    resolveDrop(categories, new Set(collapsed), id, position)

  it('上边缘：插到目标之前，同一层', () => {
    expect(drop('a2', 'before')).toEqual({ parentId: 'a', beforeId: 'a2' })
    expect(drop('a', 'before')).toEqual({ parentId: null, beforeId: 'a' })
  })

  it('中间：放进目标，排到最后', () => {
    expect(drop('b', 'inside')).toEqual({ parentId: 'b', beforeId: null })
  })

  it('下边缘：插到下一个同级之前，最后一个时排到末尾', () => {
    expect(drop('a11', 'after')).toEqual({ parentId: 'a1', beforeId: null })
    expect(drop('b', 'after')).toEqual({ parentId: null, beforeId: null })
  })

  it('展开的文件夹下边缘放到第一个子分类之前；折叠时放到它后面', () => {
    expect(drop('a', 'after')).toEqual({ parentId: 'a', beforeId: 'a1' })
    expect(drop('a', 'after', ['a'])).toEqual({ parentId: null, beforeId: 'b' })
  })

  it('目标不存在时返回 null', () => {
    expect(drop('none', 'before')).toBeNull()
  })
})

describe('subtreeIds', () => {
  it('包含自身和所有子孙', () => {
    expect([...subtreeIds(categories, 'a')].sort()).toEqual(['a', 'a1', 'a11', 'a2'])
    expect([...subtreeIds(categories, 'b')]).toEqual(['b'])
  })

  it('数据里有环时也能结束', () => {
    const loop: Category[] = [
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' }
    ]
    expect([...subtreeIds(loop, 'x')].sort()).toEqual(['x', 'y'])
  })
})
