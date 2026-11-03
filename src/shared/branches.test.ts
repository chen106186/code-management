import { describe, expect, it } from 'vitest'
import { switchableBranches } from './branches'
import type { Branch } from './repo'

const branch = (name: string, kind: Branch['kind'], upstream: string | null = null): Branch => ({
  name,
  kind,
  upstream,
  current: false,
  hash: 'abc',
  ahead: 0,
  behind: 0,
  gone: false,
  time: 0,
  subject: ''
})

describe('switchableBranches', () => {
  it('隐藏已被跟踪或与本地同名的远程分支，保留其余的', () => {
    const { local, remote } = switchableBranches([
      branch('main', 'local', 'origin/main'),
      branch('feature/a', 'local'),
      branch('origin/main', 'remote'),
      branch('origin/feature/a', 'remote'),
      branch('origin/feature/b', 'remote'),
      branch('upstream/main', 'remote')
    ])
    expect(local.map((b) => b.name)).toEqual(['main', 'feature/a'])
    expect(remote.map((b) => b.name)).toEqual(['origin/feature/b'])
  })
})
