import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { is } from '@electron-toolkit/utils'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  buildMenu(win)
  return win
}

function buildMenu(win: BrowserWindow): void {
  const send = (action: string) => (): void => {
    win.webContents.send('menu-action', action)
  }

  const template = Menu.buildFromTemplate([
    {
      label: 'NAP Editor',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
        { label: 'Deselect', accelerator: 'Escape', click: send('deselect') },
        { type: 'separator' },
        { label: 'Delete Selected', accelerator: 'Backspace', click: send('delete') },
        { label: 'Merge Selected', accelerator: 'CmdOrCtrl+M', click: send('merge') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Fit to Window', accelerator: 'CmdOrCtrl+0', click: send('fit') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
  ])

  Menu.setApplicationMenu(template)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'NAPLPS Files', extensions: ['nap'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const buf = await readFile(result.filePaths[0])
  return { data: Array.from(buf), path: result.filePaths[0] }
})

ipcMain.handle('save-file', async (_, bytes: number[], filePath: string) => {
  await writeFile(filePath, Buffer.from(bytes))
  return filePath
})

ipcMain.handle('save-file-dialog', async (_, bytes: number[], defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'NAPLPS Files', extensions: ['nap'] }],
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, Buffer.from(bytes))
  return result.filePath
})
