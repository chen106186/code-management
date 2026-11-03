import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { ProjectService } from './services/projects'
import { Store } from './services/store'

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#fafafa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

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
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  void app.whenReady().then(() => {
    const store = new Store(join(app.getPath('userData'), 'store.json'))
    registerIpc(store, new ProjectService(store), () => mainWindow!)
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
