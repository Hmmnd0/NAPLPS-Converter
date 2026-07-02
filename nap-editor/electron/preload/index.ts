import { contextBridge, ipcRenderer } from 'electron'

export interface FileResult {
  data: number[]
  path: string
}

export interface NapAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (bytes: number[], filePath: string) => Promise<string>
  saveFileDialog: (bytes: number[], defaultName: string) => Promise<string | null>
  onMenuAction: (cb: (action: string) => void) => () => void
}

contextBridge.exposeInMainWorld('api', {
  openFile: (): Promise<FileResult | null> => ipcRenderer.invoke('open-file'),

  saveFile: (bytes: number[], filePath: string): Promise<string> =>
    ipcRenderer.invoke('save-file', bytes, filePath),

  saveFileDialog: (bytes: number[], defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('save-file-dialog', bytes, defaultName),

  onMenuAction: (cb: (action: string) => void): (() => void) => {
    const handler = (_: unknown, action: string): void => cb(action)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.off('menu-action', handler)
  },
} satisfies NapAPI)

declare global {
  interface Window {
    api: NapAPI
  }
}
