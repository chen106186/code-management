import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('去掉 IPC 前缀', () => {
    const error = new Error("Error invoking remote method 'api:commit': Error: 提交信息不能为空")
    expect(errorMessage(error)).toBe('提交信息不能为空')
  })

  it('其他错误原样返回', () => {
    expect(errorMessage(new Error('普通错误'))).toBe('普通错误')
    expect(errorMessage('字符串')).toBe('字符串')
  })
})
