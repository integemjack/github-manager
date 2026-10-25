import type {
  Account,
  ReleaseInfo,
  Repo,
  RunJob,
  WorkflowRun,
  WorkflowRunSummary
} from '../shared/types'
import { getAccounts, resolveToken } from './store'

const API = 'https://api.github.com'
const UA = 'github-manager-desktop'

export class GitHubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function gh<T = any>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(init?.headers ?? {})
    }
  })
  if (res.status === 401) throw new GitHubError('Token 无效或已过期 (401)', 401)
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    if (remaining === '0') throw new GitHubError('GitHub API 速率限制，请稍后重试', 403)
    throw new GitHubError('访问被拒绝 (403)，token 可能缺少所需权限', 403)
  }
  if (res.status === 404) throw new GitHubError('未找到 (404)', 404)
  if (!res.ok) throw new GitHubError(`GitHub API 错误 (${res.status})`, res.status)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function tokenScopes(resHeaders: Headers): string[] {
  const raw = resHeaders.get('x-oauth-scopes') ?? ''
  return raw ? raw.split(',').map((s) => s.trim()) : []
}

async function ghWithHeaders(token: string, path: string): Promise<{ data: any; headers: Headers }> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA
    }
  })
  if (res.status === 401) throw new GitHubError('Token 无效或已过期 (401)', 401)
  if (!res.ok) throw new GitHubError(`GitHub API 错误 (${res.status})`, res.status)
  return { data: await res.json(), headers: res.headers }
}

/** Verify a PAT and return the account profile. */
export async function verifyToken(token: string): Promise<{ account: Account; token: string }> {
  const { data, headers } = await ghWithHeaders(token, '/user')
  const account: Account = {
    id: data.login,
    login: data.login,
    name: data.name ?? null,
    avatarUrl: data.avatar_url,
    htmlUrl: data.html_url,
    type: data.type ?? 'User',
    scopes: tokenScopes(headers),
    addedAt: new Date().toISOString()
  }
  return { account, token }
}

function duration(started?: string | null, completed?: string | null): number {
  if (!started) return 0
  const s = Date.parse(started)
  const e = completed ? Date.parse(completed) : Date.now()
  const d = e - s
  return d > 0 ? d : 0
}

export function mapRun(r: any): WorkflowRunSummary {
  return {
    id: r.id,
    name: r.name ?? '(unnamed workflow)',
    displayTitle: r.display_title ?? r.name ?? '',
    event: r.event,
    branch: r.head_branch ?? '',
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    durationMs: duration(r.run_started_at ?? r.created_at, r.updated_at)
  }
}

function mapRepo(r: any, accountId: string): Repo {
  return {
    id: r.id,
    accountId,
    owner: r.owner?.login ?? '',
    name: r.name,
    fullName: r.full_name,
    private: !!r.private,
    fork: !!r.fork,
    description: r.description ?? null,
    htmlUrl: r.html_url,
    language: r.language ?? null,
    stars: r.stargazers_count ?? 0,
    updatedAt: r.pushed_at ?? r.updated_at,
    defaultBranch: r.default_branch ?? 'main',
    archived: !!r.archived,
    openIssues: r.open_issues_count ?? 0,
    lastRun: null,
    hasActions: false
  }
}

/** Simple concurrency limiter */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

// ---- Aggregated repo list (with caches) ----

interface RepoCache {
  at: number
  repos: Repo[]
  inflight?: Promise<Repo[]>
}
let repoCache: RepoCache | null = null
const REPO_CACHE_MS = 45_000
const RUNS_CHECK_LIMIT = 80 // how many newest repos get an Actions status check

export function invalidateRepoCache(): void {
  repoCache = null
}

async function fetchAccountRepos(login: string, token: string): Promise<Repo[]> {
  const repos: Repo[] = []
  for (let page = 1; page <= 5; page++) {
    try {
      const batch = await gh<any[]>(
        token,
        `/user/repos?per_page=100&page=${page}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`
      )
      if (!Array.isArray(batch) || batch.length === 0) break
      repos.push(...batch.map((r) => mapRepo(r, login)))
      if (batch.length < 100) break
    } catch (err) {
      // One account failing shouldn't kill the whole list
      console.warn(`[github] fetch repos for ${login} failed:`, (err as Error).message)
      break
    }
  }
  return repos
}

async function attachActionsStatus(repos: Repo[]): Promise<Repo[]> {
  const targets = repos.slice(0, RUNS_CHECK_LIMIT)
  await mapLimit(targets, 8, async (repo) => {
    try {
      const auth = await resolveToken(repo.accountId)
      if (!auth) return
      const res = await gh<any>(auth.token, `/repos/${repo.fullName}/actions/runs?per_page=1`)
      const run = res.workflow_runs?.[0]
      repo.hasActions = true
      if (run) repo.lastRun = mapRun(run)
    } catch (err: any) {
      if (err?.status === 404) {
        repo.hasActions = false
      } else if (err?.status === 403) {
        // rate limited while filling status; leave as-is
      } else {
        console.warn(`[github] actions status for ${repo.fullName}:`, err?.message)
      }
    }
  })
  return repos
}

export async function listAllRepos(force = false): Promise<Repo[]> {
  // An in-flight fetch always wins — concurrent callers must not observe the
  // pre-seeded empty cache but await the same promise.
  if (repoCache?.inflight) return repoCache.inflight
  if (!force && repoCache && Date.now() - repoCache.at < REPO_CACHE_MS) {
    return repoCache.repos
  }

  const accounts = getAccounts()
  if (accounts.length === 0) return []

  const job = (async () => {
    const lists = await Promise.all(
      accounts.map(async (a) => {
        const t = await resolveToken(a.login)
        return t ? fetchAccountRepos(a.login, t.token) : ([] as Repo[])
      })
    )
    // Dedupe by full name (multiple accounts may see the same repo); keep the newest entry
    const byName = new Map<string, Repo>()
    for (const list of lists) {
      for (const r of list) {
        const prev = byName.get(r.fullName)
        if (!prev || Date.parse(r.updatedAt) > Date.parse(prev.updatedAt)) byName.set(r.fullName, r)
      }
    }
    const repos = [...byName.values()].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )
    await attachActionsStatus(repos)
    // 最近一次 Actions 还在跑（运行中/排队中）的仓库排到最前，其余保持最后推送顺序。
    // sort 是稳定排序，二次排序不会打乱组内顺序。
    const isWorking = (r: Repo) => !!r.lastRun && r.lastRun.status !== 'completed'
    const sorted = [...repos].sort(
      (a, b) =>
        Number(isWorking(b)) - Number(isWorking(a)) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )
    repoCache = { at: Date.now(), repos: sorted }
    return sorted
  })()

  repoCache = { at: Date.now(), repos: [], inflight: job }
  return job
}

// ---- Workflow runs ----

const runsCache = new Map<string, { at: number; runs: WorkflowRun[] }>()

export async function listRuns(fullName: string, accountId?: string): Promise<WorkflowRun[]> {
  const cacheKey = `${accountId ?? ''}|${fullName}`
  const cached = runsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 8000) return cached.runs
  const auth = await resolveToken(accountId)
  if (!auth) throw new GitHubError('没有可用的账号', 401)
  const res = await gh<any>(auth.token, `/repos/${fullName}/actions/runs?per_page=30`)
  const runs: WorkflowRun[] = (res.workflow_runs ?? []).map((r: any) => ({
    ...mapRun(r),
    runNumber: r.run_number,
    runAttempt: r.run_attempt,
    workflowId: r.workflow_id,
    actorLogin: r.actor?.login ?? '',
    triggerLogin: r.triggering_actor?.login ?? r.actor?.login ?? '',
    headSha: r.head_sha?.slice(0, 7) ?? '',
    headBranch: r.head_branch ?? '',
    commitMessage: r.head_commit?.message ?? null,
    jobsUrl: r.jobs_url
  }))
  runsCache.set(cacheKey, { at: Date.now(), runs })
  return runs
}

export async function listRunJobs(fullName: string, runId: number, accountId?: string): Promise<RunJob[]> {
  const auth = await resolveToken(accountId)
  if (!auth) throw new GitHubError('没有可用的账号', 401)
  const res = await gh<any>(auth.token, `/repos/${fullName}/actions/runs/${runId}/jobs?per_page=50`)
  return (res.jobs ?? []).map((j: any) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    url: j.html_url,
    steps: (j.steps ?? []).map((s: any) => ({
      number: s.number,
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
      startedAt: s.started_at,
      completedAt: s.completed_at
    }))
  }))
}

/** Download a job log (follows redirect). Returns tail (last 200 KB) as text. */
export async function getJobLog(fullName: string, jobId: number, accountId?: string): Promise<string> {
  const auth = await resolveToken(accountId)
  if (!auth) throw new GitHubError('没有可用的账号', 401)
  const res = await fetch(`${API}/repos/${fullName}/actions/jobs/${jobId}/logs`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'User-Agent': UA,
      Accept: 'application/vnd.github+json'
    },
    redirect: 'follow'
  })
  if (!res.ok) throw new GitHubError(`日志下载失败 (${res.status})`, res.status)
  const text = await res.text()
  const MAX = 200 * 1024
  if (text.length > MAX) {
    return `…（日志过长，仅显示最后 200 KB，全文 ${Math.round(text.length / 1024)} KB）…\n\n` + text.slice(-MAX)
  }
  return text
}

// ---- Releases ----

export function mapRelease(r: any): ReleaseInfo {
  return {
    id: r.id,
    tagName: r.tag_name,
    name: r.name ?? r.tag_name,
    body: r.body ?? null,
    draft: !!r.draft,
    prerelease: !!r.prerelease,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    url: r.html_url,
    authorLogin: r.author?.login ?? '',
    assets: (r.assets ?? []).map((a: any) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      downloadUrl: a.browser_download_url,
      downloadCount: a.download_count,
      createdAt: a.created_at
    }))
  }
}

export async function listReleases(fullName: string, accountId?: string): Promise<ReleaseInfo[]> {
  const auth = await resolveToken(accountId)
  if (!auth) throw new GitHubError('没有可用的账号', 401)
  const res = await gh<any>(auth.token, `/repos/${fullName}/releases?per_page=30`)
  return (Array.isArray(res) ? res : []).map(mapRelease)
}

export async function getLatestRelease(fullName: string, accountId?: string): Promise<ReleaseInfo | null> {
  const releases = await listReleases(fullName, accountId)
  return releases.find((r) => !r.draft && !r.prerelease) ?? null
}

export async function listReleaseInfoByTag(
  fullName: string,
  tag: string,
  accountId?: string
): Promise<ReleaseInfo> {
  const auth = await resolveToken(accountId)
  if (!auth) throw new GitHubError('没有可用的账号', 401)
  const res = await gh<any>(auth.token, `/repos/${fullName}/releases/tags/${encodeURIComponent(tag)}`)
  return mapRelease(res)
}
