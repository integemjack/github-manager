import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  DeviceLoginUpdate,
  McpStatus,
  ReleaseInfo,
  Repo,
  RunJob,
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

  // mcp
  mcpStatus: (): Promise<McpStatus> => ipcRenderer.invoke('mcp:status'),
  setMcpEnabled: (enabled: boolean): Promise<McpStatus> => ipcRenderer.invoke('mcp:setEnabled', enabled),

  // misc
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  appInfo: (): Promise<{ version: string; platform: string; electron: string }> =>
    ipcRenderer.invoke('app-info')
}

contextBridge.exposeInMainWorld('gm', api)
export type GmApi = typeof api
