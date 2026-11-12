import { Menu, nativeImage, Notification, Tray, type NativeImage } from 'electron'
import type { Project, Snapshot } from '@shared/types'

const ICON_SIZE = 32
const DOT_RADIUS = 7

interface TrayActions {
  show: () => void
  fetchNow: () => void
  quit: () => void
  isFocused: () => boolean
}

const isChanged = ({ git }: Project): boolean =>
  !!git && git.staged + git.unstaged + git.untracked + git.conflicted > 0

/** 在图标右下角画一个琥珀色圆点，表示有项目落后远程 */
function withDot(base: NativeImage): NativeImage {
  const bitmap = Buffer.from(base.resize({ width: ICON_SIZE, height: ICON_SIZE }).toBitmap())
  const center = ICON_SIZE - DOT_RADIUS - 1
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      if ((x - center) ** 2 + (y - center) ** 2 > DOT_RADIUS ** 2) continue
      // toBitmap 的像素顺序是 BGRA
      bitmap.set([0x0b, 0x9e, 0xf5, 0xff], (y * ICON_SIZE + x) * 4)
    }
  }
  return nativeImage.createFromBuffer(bitmap, { width: ICON_SIZE, height: ICON_SIZE, scaleFactor: 2 })
}

export class AppTray {
  private readonly tray: Tray
  private readonly icon: NativeImage
  private readonly iconWithDot: NativeImage
  private behind: Set<string> | null = null

  constructor(
    iconPath: string,
    private readonly actions: TrayActions
  ) {
    const base = nativeImage.createFromPath(iconPath)
    if (base.isEmpty()) throw new Error(`读不到托盘图标：${iconPath}`)
    this.icon = base.resize({ width: ICON_SIZE, height: ICON_SIZE })
    this.iconWithDot = withDot(base)
    this.tray = new Tray(this.icon)
    this.tray.on('click', actions.show)
    this.render(0, 0, 0)
  }

  private render(changed: number, unpushed: number, behind: number): void {
    this.tray.setToolTip(`Code Management Tool\n有改动 ${changed} · 未推送 ${unpushed} · 落后远程 ${behind}`)
    this.tray.setImage(behind ? this.iconWithDot : this.icon)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示看板', click: this.actions.show },
        { type: 'separator' },
        { label: `有改动 ${changed} 个`, enabled: false },
        { label: `未推送 ${unpushed} 个`, enabled: false },
        { label: `落后远程 ${behind} 个`, enabled: false },
        { type: 'separator' },
        { label: '立即 Fetch 全部', click: this.actions.fetchNow },
        { label: '退出', click: this.actions.quit }
      ])
    )
  }

  /** 每次刷新后调用；有项目新变成落后远程、且用户不在看窗口时发一条通知 */
  update({ projects }: Snapshot): void {
    const behind = projects.filter((p) => (p.git?.behind ?? 0) > 0)
    this.render(
      projects.filter(isChanged).length,
      projects.filter((p) => (p.git?.ahead ?? 0) > 0).length,
      behind.length
    )
    const fresh = this.behind ? behind.filter((p) => !this.behind!.has(p.path)) : []
    this.behind = new Set(behind.map((p) => p.path))
    if (fresh.length && !this.actions.isFocused() && Notification.isSupported()) {
      const names = fresh.slice(0, 3).map((p) => p.remark ?? p.name).join('、')
      const notification = new Notification({
        title: `${fresh.length} 个项目落后远程`,
        body: fresh.length > 3 ? `${names} 等` : names
      })
      notification.on('click', this.actions.show)
      notification.show()
    }
  }
}
