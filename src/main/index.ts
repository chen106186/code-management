import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { ProjectService } from './services/projects'
import { StatsService } from './services/projectStats'
import { Store } from './services/store'
import { AppTray } from './services/tray'

const DATA_DIR = 'E:\\1024-code\\CodeManagement'

// 必须在 ready 之前设置；目录建不了（比如这台电脑没有 E 盘）时退回系统默认位置，保证程序能启动
try {
  const dataDir = process.env.CODE_MANAGEMENT_DATA_DIR ?? DATA_DIR
  mkdirSync(dataDir, { recursive: true })
  app.setPath('userData', dataDir)
} catch (error) {
  console.warn('无法使用数据目录，改用系统默认位置', error)
}

let mainWindow: BrowserWindow | null = null
let store: Store | null = null
/** 真正退出时才放行关闭，否则关窗口只是收到托盘 */
let quitting = false
/** 托盘没建起来时不能隐藏窗口，否则再也找不回来 */
let hasTray = false

function showWindow(): void {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

/** 和页面背景色一致，避免启动和切换主题时闪一下 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafafa'
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    icon,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (quitting || !hasTray || !store?.closeToTray) return
    event.preventDefault()
    window.hide()
  })

  // 页面内不跳转、不开新窗口；http(s) 链接交给系统浏览器
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('before-quit', () => {
    quitting = true
  })

  app
    .whenReady()
    .then(() => {
      // Windows 通知要靠它认出应用
      app.setAppUserModelId('com.chenng.code-management')
      store = new Store(join(app.getPath('userData'), 'store.json'))
      nativeTheme.themeSource = store.theme
      nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackground()))
      const stats = new StatsService(join(app.getPath('userData'), 'stats.json'))
      const projects = new ProjectService(store, stats)
      const autoFetch = registerIpc(store, projects, stats, () => mainWindow!)
      mainWindow = createWindow()

      // 托盘只是附加功能，出问题不能挡住窗口
      try {
        const tray = new AppTray(icon, {
          show: showWindow,
          fetchNow: () => void autoFetch.runNow(),
          quit: () => app.quit(),
          isFocused: () => mainWindow?.isFocused() ?? false
        })
        projects.onSnapshot = (snapshot) => tray.update(snapshot)
        hasTray = true
      } catch (error) {
        console.warn('无法创建托盘，关闭窗口时将直接退出', error)
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
      })
    })
    // 启动失败时明确告诉用户并退出，否则进程留在后台，之后再打开也没有反应
    .catch((error: Error) => {
      dialog.showErrorBox('Code Management Tool 启动失败', error.stack ?? error.message)
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
