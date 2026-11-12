import { describe, expect, it, vi } from 'vitest'

// 过滤本身依赖浏览器环境，在应用里验证；这里只测路径判断
vi.mock('dompurify', () => ({ default: { addHook: () => {} } }))

const { localImagePath } = await import('./markdown')

describe('localImagePath', () => {
  it('相对路径转成仓库内路径', () => {
    expect(localImagePath('docs/a.png')).toBe('docs/a.png')
    expect(localImagePath('./docs/a.png?raw=true')).toBe('docs/a.png')
    expect(localImagePath('/docs/a.png')).toBe('docs/a.png')
    expect(localImagePath('docs/%E5%9B%BE.png')).toBe('docs/图.png')
  })

  it('远程地址和其他协议不当成本地文件', () => {
    expect(localImagePath('https://a.com/b.png')).toBeNull()
    expect(localImagePath('//a.com/b.png')).toBeNull()
    expect(localImagePath('data:image/png;base64,AA')).toBeNull()
    expect(localImagePath('file:///C:/a.png')).toBeNull()
    expect(localImagePath('C:\\a.png')).toBeNull()
  })
})
