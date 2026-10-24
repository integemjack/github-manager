import { reactive, readonly, ref } from 'vue'
import { api, type Account, type McpStatus, type Repo } from './api'

export const accounts = ref<Account[]>([])
export const repos = ref<Repo[]>([])
export const loadingRepos = ref(false)
export const reposError = ref<string | null>(null)
export const selectedRepo = ref<Repo | null>(null)
export const accountFilter = ref<string>('') // '' = all
export const searchQuery = ref('')
export const addDialogOpen = ref(false)
export const settingsOpen = ref(false)
export const mcp = reactive<McpStatus & { loading: boolean }>({
  enabled: false,
  running: false,
  url: '',
  port: 0,
  tools: [],
  loading: false
})
export const appInfo = reactive({ version: '', platform: '', electron: '' })

export async function loadAccounts(): Promise<void> {
  accounts.value = await api.getAccounts()
  if (accountFilter.value && !accounts.value.some((a) => a.login === accountFilter.value)) {
    accountFilter.value = ''
  }
}

let refreshSeq = 0
export async function refreshRepos(force = false): Promise<void> {
  const seq = ++refreshSeq
  loadingRepos.value = true
  reposError.value = null
  try {
    const list = await api.listRepos(force)
    if (seq !== refreshSeq) return
    repos.value = list
  } catch (err: any) {
    if (seq !== refreshSeq) return
    reposError.value = err?.message ?? String(err)
  } finally {
    if (seq === refreshSeq) loadingRepos.value = false
  }
}

export async function loadMcpStatus(): Promise<void> {
  mcp.loading = true
  try {
    const s = await api.mcpStatus()
    Object.assign(mcp, s)
  } finally {
    mcp.loading = false
  }
}

export function openRepo(repo: Repo): void {
  selectedRepo.value = repo
}

export function closeRepo(): void {
  selectedRepo.value = null
}

export async function initApp(): Promise<void> {
  const info = await api.appInfo()
  Object.assign(appInfo, info)
  await loadAccounts()
  await loadMcpStatus()
  if (accounts.value.length > 0) void refreshRepos()
}
