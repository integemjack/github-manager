import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  Account,
  ConfigAccount,
  ConfigExportOptions,
  ConfigExportResult,
  ConfigFile,
  ConfigImportOptions,
  ConfigImportResult,
  ConfigImportSummary,
  ConfigSecrets
} from '../shared/types'
import { UI_PREF_KEYS } from '../shared/prefs'
import {
  decryptToken,
  getAccounts,
  getMcpEnabled,
  getStoredAccounts,
  setMcpEnabled,
  upsertAccount
} from './store'
import { GitHubError, invalidateRepoCache, verifyToken } from './github'
import { mcpHttpRunning, startMcpHttp, stopMcpHttp } from './mcp'

/**
 * Config export / import.
 *
 * The exported file always carries the account list and app settings (MCP
 * switch) plus UI preferences. Account tokens are secrets, so they are only
 * written when the user asks for them, and then always encrypted with
 * AES-256-GCM under a key derived from a password (scrypt) the user picks.
 * Without the password the file holds no usable credentials.
 */

export const CONFIG_FORMAT = 'github-manager-config'
export const CONFIG_VERSION = 1
const MIN_PASSWORD = 6
const SCRYPT = { N: 16384, r: 8, p: 1 }
const MCP_DEFAULT_PORT = 3745

// ---------------- helpers ----------------

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toConfigAccount(a: Account): ConfigAccount {
  return {
    id: a.id,
    login: a.login,
    name: a.name,
    avatarUrl: a.avatarUrl,
    htmlUrl: a.htmlUrl,
    type: a.type,
    scopes: [...a.scopes],
    addedAt: a.addedAt
  }
}

/** Keep only known UI preference keys with short string values. */
function cleanUiPrefs(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const allowed = new Set<string>(UI_PREF_KEYS)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) continue
    if (typeof value !== 'string' || value.length === 0 || value.length > 32) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function scryptKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32, SCRYPT)
}

function encryptSecrets(tokens: Record<string, string>, password: string): ConfigSecrets {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', scryptKey(password, salt), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ tokens }), 'utf-8'), cipher.final()])
  return {
    alg: 'aes-256-gcm',
    kdf: `scrypt-N${SCRYPT.N}-r${SCRYPT.r}-p${SCRYPT.p}`,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64')
  }
}

function decryptSecrets(secrets: ConfigSecrets, password: string): Record<string, string> {
  if (secrets.alg !== 'aes-256-gcm') throw new Error(`不支持的加密方式：${String(secrets.alg)}`)
  const salt = Buffer.from(secrets.salt, 'base64')
  const iv = Buffer.from(secrets.iv, 'base64')
  const tag = Buffer.from(secrets.tag, 'base64')
  const data = Buffer.from(secrets.data, 'base64')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', scryptKey(password, salt), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8')
    const parsed = JSON.parse(plain) as { tokens?: Record<string, unknown> }
    const tokens: Record<string, string> = {}
    for (const [login, token] of Object.entries(parsed.tokens ?? {})) {
      if (typeof token === 'string' && token.length > 0) tokens[login] = token
    }
    return tokens
  } catch {
    throw new Error('密码错误，无法解密配置中的 Token')
  }
}

function parseSecrets(input: unknown): ConfigSecrets | undefined {
  if (!input || typeof input !== 'object') return undefined
  const s = input as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  if (!str(s.salt) || !str(s.iv) || !str(s.tag) || !str(s.data)) return undefined
  return {
    alg: 'aes-256-gcm',
    kdf: typeof s.kdf === 'string' ? s.kdf : 'scrypt',
    salt: s.salt,
    iv: s.iv,
    tag: s.tag,
    data: s.data
  }
}

/** Validate an arbitrary JSON value as a config file (throws on bad input). */
export function parseConfigFile(raw: unknown): ConfigFile {
  if (!raw || typeof raw !== 'object') throw new Error('文件内容不是有效的 JSON 配置')
  const f = raw as Record<string, any>
  if (f.format !== CONFIG_FORMAT) throw new Error('不是 GitHub Manager 的配置文件')
  if (typeof f.version !== 'number' || !Number.isFinite(f.version) || f.version < 1) {
    throw new Error('配置文件缺少有效的版本号')
  }
  if (f.version > CONFIG_VERSION) {
    throw new Error(`配置文件版本 ${f.version} 高于当前应用支持的 v${CONFIG_VERSION}，请先升级应用`)
  }
  if (!Array.isArray(f.accounts)) throw new Error('配置文件缺少账号列表')

  const accounts: ConfigAccount[] = []
  for (const item of f.accounts) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, any>
    if (typeof a.login !== 'string' || a.login.length === 0) continue
    accounts.push({
      id: typeof a.id === 'string' && a.id ? a.id : a.login,
      login: a.login,
      name: typeof a.name === 'string' ? a.name : null,
      avatarUrl: typeof a.avatarUrl === 'string' ? a.avatarUrl : '',
      htmlUrl: typeof a.htmlUrl === 'string' ? a.htmlUrl : `https://github.com/${a.login}`,
      type: typeof a.type === 'string' ? a.type : 'User',
      scopes: Array.isArray(a.scopes) ? a.scopes.filter((s: unknown) => typeof s === 'string') : [],
      addedAt: typeof a.addedAt === 'string' ? a.addedAt : new Date().toISOString()
    })
  }

  return {
    format: CONFIG_FORMAT,
    version: f.version,
    exportedAt: typeof f.exportedAt === 'string' ? f.exportedAt : '',
    appVersion: typeof f.appVersion === 'string' ? f.appVersion : '',
    settings: { mcpEnabled: f.settings?.mcpEnabled !== false },
    accounts,
    ui: cleanUiPrefs(f.ui),
    secrets: parseSecrets(f.secrets)
  }
}

function readConfigFile(filePath: string): ConfigFile {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`无法读取配置文件：${errMessage(err)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('配置文件不是有效的 JSON')
  }
  return parseConfigFile(parsed)
}

function summarize(file: ConfigFile, filePath: string): ConfigImportSummary {
  return {
    path: filePath,
    fileName: path.basename(filePath),
    exportedAt: file.exportedAt,
    appVersion: file.appVersion,
    accounts: file.accounts.map((a) => ({ login: a.login, name: a.name, type: a.type })),
    hasSecrets: !!file.secrets,
    mcpEnabled: file.settings.mcpEnabled,
    uiPrefs: file.ui ? Object.keys(file.ui).length : 0
  }
}

// ---------------- export ----------------

export async function buildConfigFile(
  opts: ConfigExportOptions
): Promise<{ file: ConfigFile; warnings: string[]; tokenCount: number }> {
  const includeTokens = !!opts?.includeTokens
  const password = (opts?.password ?? '').trim()
  if (includeTokens && password.length < MIN_PASSWORD) {
    throw new Error(`导出 Token 需要至少 ${MIN_PASSWORD} 位密码`)
  }

  const warnings: string[] = []
  const file: ConfigFile = {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    settings: { mcpEnabled: getMcpEnabled() },
    accounts: getAccounts().map(toConfigAccount)
  }
  const ui = cleanUiPrefs(opts?.uiPrefs)
  if (ui) file.ui = ui

  let tokenCount = 0
  if (includeTokens) {
    const tokens: Record<string, string> = {}
    for (const stored of getStoredAccounts()) {
      try {
        const token = await decryptToken(stored.tokenEncrypted)
        if (token) {
          tokens[stored.login] = token
          tokenCount++
        }
      } catch {
        warnings.push(`${stored.login}：本机 Token 解密失败，未写入导出文件`)
      }
    }
    if (tokenCount === 0) warnings.push('没有任何可导出的账号 Token，导入后需要重新登录')
    file.secrets = encryptSecrets(tokens, password)
  }

  return { file, warnings, tokenCount }
}

// ---------------- import ----------------

async function applyMcpSetting(enabled: boolean, warnings: string[]): Promise<boolean> {
  if (enabled === getMcpEnabled()) {
    // Already matching — still make sure the server state reflects it.
    if (enabled && !mcpHttpRunning()) {
      try {
        await startMcpHttp(MCP_DEFAULT_PORT)
      } catch (err) {
        warnings.push(`MCP 服务启动失败：${errMessage(err)}`)
      }
    }
    return true
  }
  setMcpEnabled(enabled)
  try {
    if (enabled && !mcpHttpRunning()) await startMcpHttp(MCP_DEFAULT_PORT)
    else if (!enabled && mcpHttpRunning()) stopMcpHttp()
  } catch (err) {
    warnings.push(`MCP 服务${enabled ? '启动' : '停止'}失败：${errMessage(err)}`)
  }
  return true
}

export async function applyConfigFile(
  file: ConfigFile,
  opts: ConfigImportOptions
): Promise<ConfigImportResult> {
  let tokens: Record<string, string> = {}
  if (file.secrets) {
    const password = (opts.password ?? '').trim()
    if (!password) throw new Error('配置文件包含加密的 Token，请输入导出时设置的密码')
    tokens = decryptSecrets(file.secrets, password)
  }

  const warnings: string[] = []
  let added = 0
  let updated = 0
  let skipped = 0

  if (opts.importAccounts) {
    if (file.accounts.length === 0) warnings.push('配置文件中没有账号')
    const known = new Set(getAccounts().map((a) => a.login))
    for (const acc of file.accounts) {
      const token = tokens[acc.login]
      if (!token) {
        skipped++
        warnings.push(`${acc.login}：文件未包含 Token，已跳过（请重新登录该账号）`)
        continue
      }
      try {
        const { account } = await verifyToken(token)
        await upsertAccount(account, token)
        if (known.has(account.login)) updated++
        else added++
        known.add(account.login)
      } catch (err) {
        const authFailure = err instanceof GitHubError && (err.status === 401 || err.status === 403)
        if (authFailure) {
          skipped++
          warnings.push(`${acc.login}：Token 已失效（${errMessage(err)}），已跳过`)
          continue
        }
        // Network / GitHub outage: the token came from a real export, keep it.
        try {
          await upsertAccount({ ...acc, addedAt: new Date().toISOString() }, token)
          if (known.has(acc.login)) updated++
          else added++
          known.add(acc.login)
          warnings.push(`${acc.login}：无法在线校验（${errMessage(err)}），已按文件信息导入`)
        } catch (inner) {
          skipped++
          warnings.push(`${acc.login}：写入失败（${errMessage(inner)}）`)
        }
      }
    }
    if (added + updated > 0) invalidateRepoCache()
  }

  const settingsApplied = opts.importSettings ? await applyMcpSetting(file.settings.mcpEnabled, warnings) : false

  return {
    added,
    updated,
    skipped,
    warnings,
    settingsApplied,
    mcpEnabled: getMcpEnabled(),
    uiPrefs: file.ui
  }
}

// ---------------- IPC ----------------

function defaultExportPath(): string {
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const name = `github-manager-config-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.json`
  return path.join(app.getPath('documents'), name)
}

async function writeFile(target: string, file: ConfigFile): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, JSON.stringify(file, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
}

export function registerConfigIpc(): void {
  ipcMain.handle('config:export', async (event, opts: ConfigExportOptions): Promise<ConfigExportResult> => {
    const { file, warnings, tokenCount } = await buildConfigFile(opts ?? { includeTokens: false })
    let target = typeof opts?.path === 'string' ? opts.path : ''
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: '导出配置',
        defaultPath: defaultExportPath(),
        filters: [{ name: 'JSON 配置', extensions: ['json'] }]
      }
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) {
        return { cancelled: true, accounts: 0, accountsWithTokens: 0, includesSecrets: false, uiPrefs: 0, warnings: [] }
      }
      target = res.filePath
    }
    await writeFile(target, file)
    return {
      cancelled: false,
      path: target,
      accounts: file.accounts.length,
      accountsWithTokens: tokenCount,
      includesSecrets: !!file.secrets,
      uiPrefs: file.ui ? Object.keys(file.ui).length : 0,
      warnings
    }
  })

  ipcMain.handle('config:pickImport', async (event): Promise<ConfigImportSummary | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '导入配置',
      filters: [{ name: 'JSON 配置', extensions: ['json'] }],
      properties: ['openFile' as const]
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const filePath = res.filePaths?.[0]
    if (res.canceled || !filePath) return null
    return summarize(readConfigFile(filePath), filePath)
  })

  ipcMain.handle('config:import', async (_e, opts: ConfigImportOptions): Promise<ConfigImportResult> => {
    if (!opts?.path) throw new Error('缺少配置文件路径')
    return applyConfigFile(readConfigFile(opts.path), opts)
  })

  ipcMain.handle('config:reveal', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath)
  })
}