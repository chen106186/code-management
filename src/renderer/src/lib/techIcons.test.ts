import { describe, expect, it } from 'vitest'
import { siCplusplus, siNodedotjs, siPython, siSwift, siVuedotjs } from 'simple-icons'
import { techIcon } from './techIcons'

describe('techIcon', () => {
  it('不区分大小写，能认出常见写法', () => {
    for (const name of ['Vue', 'vue', ' VUE ', 'Vue.js', 'vuejs', 'Vue3', 'vue 3']) {
      expect(techIcon(name), name).toBe(siVuedotjs)
    }
    expect(techIcon('Swift')).toBe(siSwift)
    expect(techIcon('swift')).toBe(siSwift)
    expect(techIcon('Python3')).toBe(siPython)
    expect(techIcon('C++')).toBe(siCplusplus)
  })

  it('技术栈的展示名都有图标', () => {
    const labels = [
      'Electron', 'Next.js', 'Nuxt', 'Vue', 'React', 'Svelte', 'Angular', 'TypeScript', 'Vite',
      'Tailwind', 'Node.js', 'Python', 'Go', 'Rust', 'Java', '.NET', 'C/C++', 'HTML/JS'
    ]
    for (const label of labels) expect(techIcon(label), label).toBeDefined()
    expect(techIcon('Node.js')).toBe(siNodedotjs)
  })

  it('不是关键词时没有图标', () => {
    for (const name of ['后台', 'Vue 后台', 'Swiftly', '重要', '', '123']) {
      expect(techIcon(name), name).toBeUndefined()
    }
  })
})
