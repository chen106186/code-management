/** 拖动项目卡片到左侧分类时用的数据类型，其他拖动内容不会被当作项目 */
export const PROJECT_DRAG_TYPE = 'application/x-code-management-project'

/** 拖动左侧分类时用的数据类型 */
export const CATEGORY_DRAG_TYPE = 'application/x-code-management-category'

/** 拖动的可能是多选的一批项目 */
export function startProjectDrag(event: DragEvent, paths: string[]): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(PROJECT_DRAG_TYPE, JSON.stringify(paths))
  event.dataTransfer.effectAllowed = 'move'
}

export function draggedProjects(event: DragEvent): string[] {
  const data = event.dataTransfer?.getData(PROJECT_DRAG_TYPE)
  return data ? (JSON.parse(data) as string[]) : []
}
