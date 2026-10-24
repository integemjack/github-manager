import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Account } from '../shared/types'

interface StoredAccount extends Account {
  tokenEncrypted: string // base64(safeStorage.encrypt(token))
}

interface StoreFile {
  accounts: StoredAccount[]
  mcpEnabled: boolean
}

const storePath = (): string => path.join(app.getPath('userData'), 'github-manager-store.json')

function readStore(): StoreFile {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return { accounts: parsed.accounts ?? [], mcpEnabled: parsed.mcpEnabled ?? true }
  } catch {
    return { accounts: [], mcpEnabled: true }
  }
}

function writeStore(store: StoreFile): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
}

let encryptionAvailable: boolean | null = null
async function canEncrypt(): Promise<boolean> {
  if (encryptionAvailable === null) {
    encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  }
  return encryptionAvailable
}

export async function encryptToken(token: string): Promise<string> {
  if (await canEncrypt()) {
    return (await safeStorage.encryptStringAsync(token)).toString('base64')
  }
  // Fallback: plain base64 with a marker (still local-only file, but unencrypted)
  return 'plain:' + Buffer.from(token, 'utf-8').toString('base64')
}

export async function decryptToken(encrypted: string): Promise<string> {
  if (encrypted.startsWith('plain:')) {
    return Buffer.from(encrypted.slice(6), 'base64').toString('utf-8')
  }
  const { result } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
  return result
}

export function getAccounts(): Account[] {
  // No token decryption needed here — just strip the encrypted blob
  return readStore().accounts.map(({ tokenEncrypted: _t, ...rest }) => rest)
}

export async function getTokenFor(login: string): Promise<string | null> {
  const acc = readStore().accounts.find((a) => a.login === login)
  return acc ? decryptToken(acc.tokenEncrypted) : null
}

export async function getAnyToken(): Promise<{ login: string; token: string } | null> {
  const accounts = readStore().accounts
  if (accounts.length === 0) return null
  return { login: accounts[0].login, token: await decryptToken(accounts[0].tokenEncrypted) }
}

/** Pick the token to use for a repo: the account that listed it, else any account. */
export async function resolveToken(accountId?: string): Promise<{ login: string; token: string } | null> {
  if (accountId) {
    const t = await getTokenFor(accountId)
    if (t) return { login: accountId, token: t }
  }
  return getAnyToken()
}

export async function upsertAccount(account: Account, token: string): Promise<void> {
  const store = readStore()
  const tokenEncrypted = await encryptToken(token)
  const idx = store.accounts.findIndex((a) => a.login === account.login)
  if (idx >= 0) {
    store.accounts[idx] = { ...account, tokenEncrypted }
  } else {
    store.accounts.push({ ...account, tokenEncrypted })
  }
  writeStore(store)
}

export function removeAccount(login: string): void {
  const store = readStore()
  store.accounts = store.accounts.filter((a) => a.login !== login)
  writeStore(store)
}

export function getMcpEnabled(): boolean {
  return readStore().mcpEnabled
}

export function setMcpEnabled(enabled: boolean): void {
  const store = readStore()
  store.mcpEnabled = enabled
  writeStore(store)
}
