import type { Branch } from './repo'

/** 去掉远程名：origin/feature/x -> feature/x */
function shortRemoteName(name: string): string {
  return name.slice(name.indexOf('/') + 1)
}

/** 切换菜单的内容：远程分支已有对应本地分支时不重复列出 */
export function switchableBranches(branches: Branch[]): { local: Branch[]; remote: Branch[] } {
  const local = branches.filter((b) => b.kind === 'local')
  const upstreams = new Set(local.map((b) => b.upstream))
  const localNames = new Set(local.map((b) => b.name))
  const remote = branches.filter(
    (b) => b.kind === 'remote' && !upstreams.has(b.name) && !localNames.has(shortRemoteName(b.name))
  )
  return { local, remote }
}
