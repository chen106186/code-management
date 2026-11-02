import { describe, expect, it } from 'vitest'
import { parseLastCommit, parseStatus } from './gitParse'

const entries = (...tokens: string[]): string => tokens.join('\0') + '\0'

describe('parseStatus', () => {
  it('解析分支、上游和领先落后', () => {
    const status = parseStatus(
      entries(
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3'
      )
    )
    expect(status).toMatchObject({
      head: 'abc123',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 3
    })
  })

  it('尚无提交时 head 为 null，分支名保留', () => {
    const status = parseStatus(entries('# branch.oid (initial)', '# branch.head main'))
    expect(status.head).toBeNull()
    expect(status.branch).toBe('main')
  })

  it('游离 HEAD 时 branch 为 null', () => {
    const status = parseStatus(entries('# branch.oid abc123', '# branch.head (detached)'))
    expect(status.branch).toBeNull()
    expect(status.head).toBe('abc123')
  })

  it('按 XY 分别统计暂存和未暂存', () => {
    const status = parseStatus(
      entries(
        '1 M. N... 100644 100644 100644 a b 暂存.txt',
        '1 .M N... 100644 100644 100644 a b 未暂存.txt',
        '1 MM N... 100644 100644 100644 a b 两者都有.txt',
        '? 未跟踪.txt'
      )
    )
    expect(status).toMatchObject({ staged: 2, unstaged: 2, untracked: 1 })
  })

  it('重命名条目的原路径不算作独立条目', () => {
    const status = parseStatus(
      entries('2 R. N... 100644 100644 100644 a b R100 新 名.txt', '? 开头的原路径.txt', '? 真未跟踪.txt')
    )
    expect(status).toMatchObject({ staged: 1, untracked: 1 })
  })

  it('统计冲突，忽略被忽略的文件', () => {
    const status = parseStatus(
      entries('u UU N... 100644 100644 100644 100644 a b c 冲突.txt', '! 被忽略.txt')
    )
    expect(status).toMatchObject({ conflicted: 1, staged: 0, unstaged: 0, untracked: 0 })
  })

  it('空输出得到默认值', () => {
    expect(parseStatus('')).toMatchObject({ branch: null, head: null, ahead: 0, behind: 0 })
  })
})

describe('parseLastCommit', () => {
  it('解析字段，时间转为毫秒', () => {
    expect(parseLastCommit('abc\0修复：中文 主题\0作者\x001700000000\n')).toEqual({
      hash: 'abc',
      subject: '修复：中文 主题',
      author: '作者',
      time: 1700000000000
    })
  })

  it('输出不完整时返回 null', () => {
    expect(parseLastCommit('')).toBeNull()
  })
})
