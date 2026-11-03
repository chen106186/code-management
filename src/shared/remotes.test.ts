import { describe, expect, it } from 'vitest'
import { remoteWebUrl, sanitizeRemoteUrl } from './remotes'

describe('sanitizeRemoteUrl', () => {
  it('去掉 http(s) 地址里的账号和令牌', () => {
    expect(sanitizeRemoteUrl('https://ghp_secret@github.com/a/b.git')).toBe('https://github.com/a/b.git')
    expect(sanitizeRemoteUrl('https://user:p%40ss@gitlab.com/a/b')).toBe('https://gitlab.com/a/b')
    expect(sanitizeRemoteUrl('http://user:pa@ss@10.0.0.1:8080/a/b')).toBe('http://10.0.0.1:8080/a/b')
  })

  it('其他地址保持原样，路径里的 @ 不受影响', () => {
    expect(sanitizeRemoteUrl('https://github.com/a/b@c.git')).toBe('https://github.com/a/b@c.git')
    expect(sanitizeRemoteUrl('git@github.com:a/b.git')).toBe('git@github.com:a/b.git')
    expect(sanitizeRemoteUrl('E:\\repos\\b.git')).toBe('E:\\repos\\b.git')
  })
})

describe('remoteWebUrl', () => {
  it('换算常见地址', () => {
    expect(remoteWebUrl('https://github.com/a/b.git')).toBe('https://github.com/a/b')
    expect(remoteWebUrl('https://github.com/a/b/')).toBe('https://github.com/a/b')
    expect(remoteWebUrl('http://10.0.0.1:8080/a/b.git')).toBe('http://10.0.0.1:8080/a/b')
    expect(remoteWebUrl('git@github.com:a/b.git')).toBe('https://github.com/a/b')
    expect(remoteWebUrl('ssh://git@gitee.com:22/a/b.git')).toBe('https://gitee.com/a/b')
    expect(remoteWebUrl('https://token@github.com/a/b.git')).toBe('https://github.com/a/b')
  })

  it('本地路径和未知协议不能打开', () => {
    for (const url of ['E:\\repos\\b.git', 'E:/repos/b.git', '/srv/git/b.git', '../b.git', 'file:///srv/b.git']) {
      expect(remoteWebUrl(url)).toBeNull()
    }
  })
})
