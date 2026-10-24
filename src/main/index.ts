import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Account, DeviceLoginUpdate } from '../shared/types'
import {
  getAccounts,
  getMcpEnabled,
  removeAccount,
  setMcpEnabled,
  upsertAccount
} from './store'
import {
  getJobLog,
  invalidateRepoCache,
  listAllRepos,
  listReleaseInfoByTag,
  listReleases,
  listRunJobs,
  listRuns,
  verifyToken
} from './github'
import {
  mcpHttpPort,
  mcpHttpRunning,
  mcpTools,
  setMcpVersion,
  startMcpHttp,
  startMcpStdio,
  stopMcpHttp
} from './mcp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- stdio MCP mode: run headless MCP server, no window ---
if (process.argv.includes('--mcp')) {
  setMcpVersion(app.getVersion())
  app.whenReady().then(() => {
    startMcpStdio()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
} else {
  void mainAsync()
}

async function mainAsync(): Promise<void> {
  setMcpVersion(app.getVersion())

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  await app.whenReady()

  // Dev-only helper: auto-import an account from GM_TEST_TOKEN for e2e testing
  if (process.env.ELECTRON_RENDERER_URL && process.env.GM_TEST_TOKEN && getAccounts().length === 0) {
    try {
      const { account } = await verifyToken(process.env.GM_TEST_TOKEN)
      await upsertAccount(account, process.env.GM_TEST_TOKEN)
      console.log(`[dev] auto-imported account ${account.login} from GM_TEST_TOKEN`)
    } catch (err) {
      console.warn('[dev] GM_TEST_TOKEN import failed:', err)
    }
  }

  if (getMcpEnabled()) {
    try {
      await startMcpHttp(3745)
    } catch (err) {
      console.error('[mcp] failed to start http server:', err)
    }
  }

  createWindow()

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('window-all-closed', () => {
    // macOS convention: keep running
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'GitHub Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

// ---------------- IPC handlers ----------------

function sendUpdate(win: BrowserWindow | null, payload: DeviceLoginUpdate): void {
  const w = win ?? BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()) ?? null
  w?.webContents.send('device-login:update', payload)
}

ipcMain.handle('accounts:list', () => getAccounts())

ipcMain.handle('accounts:addToken', async (_e, token: string): Promise<Account> => {
  if (typeof token !== 'string' || token.trim().length < 20) {
    throw new Error('Token 格式不正确')
  }
  const { account } = await verifyToken(token.trim())
  await upsertAccount(account, token.trim())
  invalidateRepoCache()
  return account
})

ipcMain.handle('accounts:remove', (_e, login: string) => {
  removeAccount(login)
  invalidateRepoCache()
  return getAccounts()
})

// Device (web) login state machine
let deviceLoginAbort: (() => void) | null = null

ipcMain.handle(
  'accounts:deviceLogin',
  async (event): Promise<{ ok: boolean; account?: Account; error?: string }> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // gh CLI's public OAuth app client id, used for the device flow
    const GH_CLIENT_ID = process.env.GM_OAUTH_CLIENT_ID || '178c6fc778ccc68e1d6a'
    let cancelled = false
    deviceLoginAbort = () => {
      cancelled = true
    }
    try {
      sendUpdate(win, { phase: 'pending_code' })
      const codeRes = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'github-manager' },
        body: JSON.stringify({ client_id: GH_CLIENT_ID, scope: 'repo read:org workflow read:user' })
      })
      if (!codeRes.ok) throw new Error(`无法发起设备登录 (${codeRes.status})`)
      const code = (await codeRes.json()) as {
        device_code: string
        user_code: string
        verification_uri: string
        expires_in: number
        interval: number
      }
      if (cancelled) return { ok: false, error: 'cancelled' }
      sendUpdate(win, {
        phase: 'awaiting_authorization',
        userCode: code.user_code,
        verificationUri: code.verification_uri
      })
      void shell.openExternal(code.verification_uri)

      const deadline = Date.now() + (code.expires_in ?? 900) * 1000
      const interval = Math.max(code.interval ?? 5, 5) * 1000
      while (Date.now() < deadline) {
        if (cancelled) {
          sendUpdate(win, { phase: 'cancelled' })
          return { ok: false, error: 'cancelled' }
        }
        await new Promise((r) => setTimeout(r, interval))
        if (cancelled) {
          sendUpdate(win, { phase: 'cancelled' })
          return { ok: false, error: 'cancelled' }
        }
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'github-manager'
          },
          body: JSON.stringify({
            client_id: GH_CLIENT_ID,
            device_code: code.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        })
        const data = (await tokenRes.json()) as {
          access_token?: string
          error?: string
          interval?: number
        }
        if (data.access_token) {
          const { account } = await verifyToken(data.access_token)
          await upsertAccount(account, data.access_token)
          invalidateRepoCache()
          sendUpdate(win, { phase: 'success', message: `已登录 ${account.login}` })
          return { ok: true, account }
        }
        if (data.error === 'authorization_pending') continue
        if (data.error === 'slow_down') {
          await new Promise((r) => setTimeout(r, 5000))
          continue
        }
        if (data.error === 'expired_token') throw new Error('设备码已过期，请重试')
        if (data.error === 'access_denied') throw new Error('您在网页上拒绝了授权')
        throw new Error(`设备登录失败: ${data.error ?? 'unknown'}`)
      }
      throw new Error('设备登录超时')
    } catch (err: any) {
      sendUpdate(win, { phase: 'error', message: err?.message ?? String(err) })
      return { ok: false, error: err?.message ?? String(err) }
    } finally {
      deviceLoginAbort = null
    }
  }
)

ipcMain.handle('accounts:cancelDeviceLogin', () => {
  deviceLoginAbort?.()
})

ipcMain.handle('repos:list', async (_e, force: boolean) => listAllRepos(!!force))

ipcMain.handle('runs:list', (_e, fullName: string, accountId?: string) => listRuns(fullName, accountId))
ipcMain.handle('runs:jobs', (_e, fullName: string, runId: number, accountId?: string) =>
  listRunJobs(fullName, runId, accountId)
)
ipcMain.handle('jobs:log', (_e, fullName: string, jobId: number, accountId?: string) =>
  getJobLog(fullName, jobId, accountId)
)

ipcMain.handle('releases:list', (_e, fullName: string, accountId?: string) => listReleases(fullName, accountId))
ipcMain.handle('releases:byTag', (_e, fullName: string, tag: string, accountId?: string) =>
  listReleaseInfoByTag(fullName, tag, accountId)
)

ipcMain.handle('mcp:status', async () => {
  const enabled = getMcpEnabled()
  const running = mcpHttpRunning()
  return {
    enabled,
    running,
    url: running ? `http://127.0.0.1:${mcpHttpPort()}/mcp` : '',
    port: mcpHttpPort(),
    tools: mcpTools().map((t) => ({ name: t.name, description: t.description }))
  }
})

ipcMain.handle('mcp:setEnabled', async (_e, enabled: boolean) => {
  setMcpEnabled(!!enabled)
  if (enabled && !mcpHttpRunning()) {
    await startMcpHttp(3745)
  } else if (!enabled && mcpHttpRunning()) {
    stopMcpHttp()
  }
  return {
    enabled: getMcpEnabled(),
    running: mcpHttpRunning(),
    url: mcpHttpRunning() ? `http://127.0.0.1:${mcpHttpPort()}/mcp` : '',
    port: mcpHttpPort(),
    tools: mcpTools().map((t) => ({ name: t.name, description: t.description }))
  }
})

ipcMain.handle('open-external', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
})

ipcMain.handle('app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron
}))
