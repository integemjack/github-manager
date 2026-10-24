import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  AssetDownloadDone,
  AssetDownloadError,
  AssetDownloadProgress,
  AssetDownloadRequest,
  DeviceLoginUpdate,
  McpStatus,
  ReleaseInfo,
  Repo,
  RunJob,
  UpdateInfo,
  WorkflowRun
} from '../shared/types'

const api = {
  // accounts
  getAccounts: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
  addTokenAccount: (token: string): Promise<Account> => ipcRenderer.invoke('accounts:addToken', token),
  removeAccount: (login: string): Promise<Account[]> => ipcRenderer.invoke('accounts:remove', login),
  startDeviceLogin: (): Promise<{ ok: boolean; account?: Account; error?: string }> =>
    ipcRenderer.invoke('accounts:deviceLogin'),
  cancelDeviceLogin: (): Promise<void> => ipcRenderer.invoke('accounts:cancelDeviceLogin'),
  onDeviceLoginUpdate: (cb: (u: DeviceLoginUpdate) => void): (() => void) => {
    const listener = (_e: unknown, payload: DeviceLoginUpdate) => cb(payload)
    ipcRenderer.on('device-login:update', listener)
    return () => ipcRenderer.removeListener('device-login:update', listener)
  },

  // repos & actions
  listRepos: (force = false): Promise<Repo[]> => ipcRenderer.invoke('repos:list', force),
  listRuns: (fullName: string, accountId?: string): Promise<WorkflowRun[]> =>
    ipcRenderer.invoke('runs:list', fullName, accountId),
  listRunJobs: (fullName: string, runId: number, accountId?: string): Promise<RunJob[]> =>
    ipcRenderer.invoke('runs:jobs', fullName, runId, accountId),
  getJobLog: (fullName: string, jobId: number, accountId?: string): Promise<string> =>
    ipcRenderer.invoke('jobs:log', fullName, jobId, accountId),

  // releases
  listReleases: (fullName: string, accountId?: string): Promise<ReleaseInfo[]> =>
    ipcRenderer.invoke('releases:list', fullName, accountId),
  getReleaseByTag: (fullName: string, tag: string, accountId?: string): Promise<ReleaseInfo> =>
    ipcRenderer.invoke('releases:byTag', fullName, tag, accountId),

  // release asset downloads (saved to the OS downloads folder)
  downloadAsset: (req: AssetDownloadRequest): Promise<void> => ipcRenderer.invoke('asset:download', req),
  cancelAssetDownload: (assetId: number): Promise<void> => ipcRenderer.invoke('asset:cancel', assetId),
  checkAssetsSaved: (names: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke('asset:checkSaved', names),
  openAssetFile: (path: string): Promise<void> => ipcRenderer.invoke('asset:open', path),
  deleteAssetFile: (path: string): Promise<void> => ipcRenderer.invoke('asset:delete', path),
  onAssetProgress: (cb: (p: AssetDownloadProgress) => void): (() => void) => {
    const listener = (_e: unknown, payload: AssetDownloadProgress) => cb(payload)
    ipcRenderer.on('asset:progress', listener)
    return () => ipcRenderer.removeListener('asset:progress', listener)
  },
  onAssetDone: (cb: (p: AssetDownloadDone) => void): (() => void) => {
    const listener = (_e: unknown, payload: AssetDownloadDone) => cb(payload)
    ipcRenderer.on('asset:done', listener)
    return () => ipcRenderer.removeListener('asset:done', listener)
  },
  onAssetError: (cb: (p: AssetDownloadError) => void): (() => void) => {
    const listener = (_e: unknown, payload: AssetDownloadError) => cb(payload)
    ipcRenderer.on('asset:error', listener)
    return () => ipcRenderer.removeListener('asset:error', listener)
  },

  // mcp
  mcpStatus: (): Promise<McpStatus> => ipcRenderer.invoke('mcp:status'),
  setMcpEnabled: (enabled: boolean): Promise<McpStatus> => ipcRenderer.invoke('mcp:setEnabled', enabled),

  // misc
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  appInfo: (): Promise<{ version: string; platform: string; electron: string }> =>
    ipcRenderer.invoke('app-info'),

  // self-update
  checkUpdate: (): Promise<UpdateInfo | null> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void): (() => void) => {
    const listener = (_e: unknown, payload: UpdateInfo) => cb(payload)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onUpdateProgress: (cb: (p: { percent: number }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { percent: number }) => cb(payload)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  onUpdateDownloaded: (cb: (p: { path: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { path: string }) => cb(payload)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  onUpdateError: (cb: (p: { message: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { message: string }) => cb(payload)
    ipcRenderer.on('update:error', listener)
    return () => ipcRenderer.removeListener('update:error', listener)
  }
}

contextBridge.exposeInMainWorld('gm', api)
export type GmApi = typeof api
