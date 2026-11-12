import type { Activity, Project } from '@shared/types'

const WEEKS = 53

export interface DayActivity {
  total: number
  /** 按提交数从多到少 */
  projects: { name: string; count: number }[]
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 最近 53 周，每周从周一开始，最后一周只到今天 */
export function buildWeeks(today: Date): string[][] {
  const weekday = (today.getDay() + 6) % 7
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday - (WEEKS - 1) * 7)
  const end = dayKey(today)
  const weeks: string[][] = []
  for (let w = 0; w < WEEKS; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const key = dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d))
      if (key <= end) week.push(key)
    }
    weeks.push(week)
  }
  return weeks
}

/** 每周对应的月份标记：这一周开始进入新的月份时才有，第一周不标，避免和第二个标记挤在一起 */
export function monthLabels(weeks: string[][]): (string | null)[] {
  return weeks.map((week, index) => {
    const month = week[0]?.slice(5, 7)
    if (index === 0 || !month || month === weeks[index - 1][0]?.slice(5, 7)) return null
    return `${Number(month)}月`
  })
}

/** 只算给出的项目，这样热力图能跟着左侧选中的分类变化 */
export function aggregateActivity(activity: Activity, projects: Project[]): Map<string, DayActivity> {
  const days = new Map<string, DayActivity>()
  for (const project of projects) {
    for (const [day, count] of Object.entries(activity[project.path] ?? {})) {
      const entry = days.get(day) ?? { total: 0, projects: [] }
      entry.total += count
      entry.projects.push({ name: project.remark ?? project.name, count })
      days.set(day, entry)
    }
  }
  for (const entry of days.values()) entry.projects.sort((a, b) => b.count - a.count)
  return days
}

/** 按有提交的日子的四分位分成四档，个别提交特别多的日子不会把其他日子都压到最浅 */
export function levelThresholds(counts: number[]): number[] {
  const sorted = counts.filter((count) => count > 0).sort((a, b) => a - b)
  if (!sorted.length) return [1, 1, 1]
  return [0.25, 0.5, 0.75].map((q) => sorted[Math.floor((sorted.length - 1) * q)])
}

export function levelOf(count: number, thresholds: number[]): number {
  if (count <= 0) return 0
  return 1 + thresholds.filter((threshold) => count > threshold).length
}
