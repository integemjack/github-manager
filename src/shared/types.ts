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
