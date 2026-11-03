import { nextTick, ref, type Ref } from 'vue'
import type { Project } from '@shared/types'
import { useProjectsStore } from '@renderer/stores/projects'

/** 卡片和列表行共用的备注编辑状态 */
export function useRemarkEditor(project: () => Project): {
  editing: Ref<boolean>
  draft: Ref<string>
  input: Ref<HTMLInputElement | null>
  start: () => Promise<void>
  commit: () => void
  cancel: () => void
} {
  const store = useProjectsStore()
  const editing = ref(false)
  const draft = ref('')
  const input = ref<HTMLInputElement | null>(null)

  async function start(): Promise<void> {
    draft.value = project().remark ?? ''
    editing.value = true
    await nextTick()
    input.value?.focus()
    input.value?.select()
  }

  function commit(): void {
    if (!editing.value) return
    editing.value = false
    const next = draft.value.trim()
    if (next !== (project().remark ?? '')) void store.setRemark(project().path, next)
  }

  function cancel(): void {
    editing.value = false
  }

  return { editing, draft, input, start, commit, cancel }
}
