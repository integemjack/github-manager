// Shared data types between main process, preload and renderer

export interface Account {
  id: string // = login
  login: string
  name: string | null
  avatarUrl: string
  htmlUrl: string
  type: string // User | Organization
  scopes: string[]
  addedAt: string // ISO date
}

export interface WorkflowRunSummary {
  id: number
  name: string
  displayTitle: string
  event: string
  branch: string
  status: string // queued | in_progress | completed
  conclusion: string | null
  createdAt: string
  updatedAt: string
  htmlUrl: string
  durationMs: number
}

export interface Repo {
  id: number
  accountId: string
  owner: string
  name: string
  fullName: string
  private: boolean
  fork: boolean
  description: string | null
  htmlUrl: string
  language: string | null
  stars: number
  updatedAt: string // pushed_at
  defaultBranch: string
  archived: boolean
  openIssues: number
  lastRun: WorkflowRunSummary | null
  hasActions: boolean
}

export interface RunStep {
  number: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface RunJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string
  completedAt: string | null
  url: string
  steps: RunStep[]
}

export interface WorkflowRun extends WorkflowRunSummary {
  runNumber: number
  runAttempt: number
  workflowId: number
  actorLogin: string
  triggerLogin: string
  headSha: string
  headBranch: string
  commitMessage: string | null
  jobsUrl: string
}

export interface ReleaseAsset {
  id: number
  name: string
  size: number
  downloadUrl: string
  downloadCount: number
  createdAt: string
}

export interface ReleaseInfo {
  id: number
  tagName: string
  name: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
  createdAt: string
  publishedAt: string
  url: string
  authorLogin: string
  assets: ReleaseAsset[]
}

// --- release asset downloads (in-app, to the OS downloads folder) ---

export interface AssetDownloadRequest {
  assetId: number
  name: string
  url: string // browser_download_url of the asset
  accountId?: string
}

export interface AssetDownloadProgress {
  assetId: number
  received: number
  total: number // 0 when content-length is unknown
}

export interface AssetDownloadDone {
  assetId: number
  path: string // where the file was saved
  size: number
}

export interface AssetDownloadError {
  assetId: number
  message: string
  cancelled: boolean
}

export interface McpToolInfo {
  name: string
  description: string
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  port: number
  tools: McpToolInfo[]
}

export interface DeviceLoginUpdate {
  phase: 'pending_code' | 'awaiting_authorization' | 'success' | 'error' | 'cancelled'
  userCode?: string
  verificationUri?: string
  message?: string
}

// --- config export / import (settings + accounts, optional password-protected tokens) ---

export interface ConfigAccount {
  id: string
  login: string
  name: string | null
  avatarUrl: string
  htmlUrl: string
  type: string
  scopes: string[]
  addedAt: string
}

/** AES-256-GCM blob holding the account tokens (key derived from the password). */
export interface ConfigSecrets {
  alg: 'aes-256-gcm'
  kdf: string // e.g. scrypt-N16384-r8-p1
  salt: string // base64
  iv: string // base64
  tag: string // base64 auth tag
  data: string // base64 ciphertext of { tokens: Record<login, token> }
}

/** On-disk config file (github-manager-config-*.json). */
export interface ConfigFile {
  format: 'github-manager-config'
  version: number
  exportedAt: string
  appVersion: string
  settings: { mcpEnabled: boolean }
  accounts: ConfigAccount[]
  ui?: Record<string, string> // UI preferences from localStorage (see shared/prefs.ts)
  secrets?: ConfigSecrets // present only when tokens were included
}

export interface ConfigExportOptions {
  includeTokens: boolean
  password?: string
  uiPrefs?: Record<string, string>
  /** Explicit target path; when omitted the save dialog is shown (tests use this). */
  path?: string
}

export interface ConfigExportResult {
  cancelled: boolean
  path?: string
  accounts: number
  accountsWithTokens: number
  includesSecrets: boolean
  uiPrefs: number
  warnings: string[]
}

/** What the renderer shows after the user picked a config file. */
export interface ConfigImportSummary {
  path: string
  fileName: string
  exportedAt: string
  appVersion: string
  accounts: { login: string; name: string | null; type: string }[]
  /** Accounts currently stored on this machine (for the replace-mode warning). */
  localAccounts: number
  hasSecrets: boolean
  mcpEnabled: boolean
  uiPrefs: number
}

export interface ConfigImportOptions {
  path: string
  password?: string
  importAccounts: boolean
  importSettings: boolean
  /** Replace instead of merge: drop local accounts that the file cannot restore. */
  replaceAccounts?: boolean
}

export interface ConfigImportResult {
  added: number
  updated: number
  skipped: number
  removed: number
  warnings: string[]
  settingsApplied: boolean
  mcpEnabled: boolean
  uiPrefs: Record<string, string> | undefined
}

// --- app self-update (last.json published alongside each GitHub release) ---

export interface UpdateAsset {
  url: string
  size: number
  sha512: string // hex
}

export interface UpdateManifest {
  version: string
  channel: 'stable' | 'rolling'
  pubDate: string
  notes: string
  releaseUrl: string
  platforms: Record<string, UpdateAsset> // keys: win-x64 | mac-x64 | mac-arm64 | linux-x64
}

export interface UpdateInfo {
  current: string
  latest: string
  channel: 'stable' | 'rolling'
  notes: string
  releaseUrl: string
  downloadUrl: string
  sha512: string
  size: number
  fileName: string
}
