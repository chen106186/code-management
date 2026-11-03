/** 去掉 http(s) 地址里嵌的账号和令牌，它们不能出现在界面和剪贴板上 */
export function sanitizeRemoteUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^/]*@/i, '$1')
}

/** 换算成可在浏览器打开的地址；本地路径等无法换算时返回 null */
export function remoteWebUrl(url: string): string | null {
  const trimSuffix = (value: string): string => value.replace(/\/+$/, '').replace(/\.git$/i, '')

  if (/^https?:\/\//i.test(url)) return trimSuffix(sanitizeRemoteUrl(url))

  const ssh = /^(?:ssh|git\+ssh):\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url)
  if (ssh) return `https://${ssh[1]}/${trimSuffix(ssh[2])}`

  // scp 写法：git@github.com:owner/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(url)
  if (scp) return `https://${scp[1]}/${trimSuffix(scp[2].replace(/^\/+/, ''))}`

  return null
}

/** 同一个仓库的 https 和 ssh 地址换算成同一个值，用来认出移动过的项目；本地路径返回 null */
export function remoteIdentity(url: string): string | null {
  return remoteWebUrl(url)?.replace(/^https?:\/\//i, '').toLowerCase() ?? null
}
