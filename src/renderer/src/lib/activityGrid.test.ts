import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { aggregateActivity, buildWeeks, dayKey, levelOf, levelThresholds, monthLabels } from './activityGrid'

describe('活跃度网格', () => {
  it('53 周，每周从周一开始，最后一天是今天', () => {
    // 2026-11-04 是周三
    const weeks = buildWeeks(new Date(2026, 10, 4))
    expect(weeks).toHaveLength(53)
    expect(weeks[52]).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(weeks[51]).toHaveLength(7)
    expect(new Date(`${weeks[0][0]}T00:00:00`).getDay()).toBe(1)
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('月份标记只出现在进入新月份的那一周', () => {
    const labels = monthLabels([['2026-09-28'], ['2026-10-05'], ['2026-10-12'], ['2026-11-02']])
    expect(labels).toEqual([null, '10月', null, '11月'])
    expect(monthLabels(buildWeeks(new Date(2026, 10, 4))).filter(Boolean)).toHaveLength(12)
  })

  it('只汇总给出的项目，当天的项目按提交数排序', () => {
    const project = (path: string, remark: string | null = null): Project =>
      ({ path, name: path, remark }) as Project
    const activity = {
      a: { '2026-10-01': 1, '2026-10-02': 2 },
      b: { '2026-10-01': 3 },
      other: { '2026-10-01': 100 }
    }
    const days = aggregateActivity(activity, [project('a', '甲'), project('b'), project('missing')])
    expect(days.get('2026-10-01')).toEqual({
      total: 4,
      projects: [{ name: 'b', count: 3 }, { name: '甲', count: 1 }]
    })
    expect(days.get('2026-10-02')?.total).toBe(2)
  })

  it('分档不受个别极大值影响', () => {
    const thresholds = levelThresholds([1, 1, 2, 2, 3, 3, 4, 1000, 0])
    expect(levelOf(0, thresholds)).toBe(0)
    expect(levelOf(1, thresholds)).toBe(1)
    expect(levelOf(1000, thresholds)).toBe(4)
    expect(levelOf(3, thresholds)).toBeLessThan(4)
    expect(levelThresholds([])).toEqual([1, 1, 1])
    expect(levelOf(1, levelThresholds([1]))).toBe(1)
  })
})
