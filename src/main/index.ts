import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { ProjectService } from './services/projects'
import { Store } from './services/store'

// 必须在 ready 之前设置；开发期数据不写 C 盘
const dataDir =
  process.env.CODE_MANAGEMENT_DATA_DIR ??
  (app.isPackaged ? null : 'E:\\ClaudeData\\code-management')
if (dataDir) app.setPath('userData', dataDir)

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
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
