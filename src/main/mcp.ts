import http from 'node:http'
import type { Account, Repo } from '../shared/types'
import { getAccounts } from './store'
import { GitHubError, listAllRepos, listReleaseInfoByTag, listReleases, listRunJobs, listRuns } from './github'

const SERVER_NAME = 'github-manager'
let SERVER_VERSION = '0.0.0'
export function setMcpVersion(v: string): void {
  SERVER_VERSION = v
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

function statusEmoji(status: string, conclusion: string | null): string {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success': return '✅'
      case 'failure': return '❌'
      case 'cancelled': return '🚫'
      case 'skipped': return '⏭️'
      default: return '⚪'
    }
  }
  return '⏳'
}

function fmtDate(iso: string): string {
  return iso ? iso.replace('T', ' ').replace('Z', ' UTC') : '-'
}

export function mcpTools(): ToolDef[] {
  return [
    {
      name: 'github_list_accounts',
      description: '列出本应用已登录的所有 GitHub 账号（登录名、类型、token 权限范围）。',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'github_list_repos',
      description:
        '列出所有已登录账号可见的仓库，按最后推送时间从新到旧排序，并带每个仓库最近一次 GitHub Actions 运行的状态。可用 query 按名称过滤。',
      inputSchema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '只看某个账号（登录名）名下的仓库' },
          query: { type: 'string', description: '按仓库全名/描述模糊过滤' },
          limit: { type: 'number', description: '返回条数，默认 30，最大 100' }
        }
      }
    },
    {
      name: 'github_list_workflow_runs',
      description: '列出某个仓库最近的 GitHub Actions 运行（状态、结论、触发者、分支、耗时）。',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: '仓库所有者（用户或组织名）' },
          repo: { type: 'string', description: '仓库名（不含 owner）' },
          limit: { type: 'number', description: '返回条数，默认 15' }
        },
        required: ['owner', 'repo']
      }
    },
    {
      name: 'github_get_workflow_run',
      description: '获取某一次 GitHub Actions 运行的详情：包含所有 job 和每个 job 的步骤（step）执行状态。',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          run_id: { type: 'number' }
        },
        required: ['owner', 'repo', 'run_id']
      }
    },
    {
      name: 'github_list_releases',
      description: '列出某个仓库的 Release（标签、名称、是否预发布、资源附件），最新在前。',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          limit: { type: 'number', description: '返回条数，默认 15' }
        },
        required: ['owner', 'repo']
      }
    },
    {
      name: 'github_get_latest_release',
      description: '获取某个仓库最新的（非预发布、非草稿的）Release 详情，包括 release 说明和可下载资源。',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' } },
        required: ['owner', 'repo']
      }
    },
    {
      name: 'github_get_release_by_tag',
      description: '按标签获取某个仓库指定 Release 的详情（说明、资源列表）。',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          tag: { type: 'string' }
        },
        required: ['owner', 'repo', 'tag']
      }
    }
  ]
}

function renderAccounts(): string {
  const accounts: Account[] = getAccounts()
  if (accounts.length === 0) return '还没有登录任何 GitHub 账号。请在 GitHub Manager 应用里添加账号。'
  return (
    `共 ${accounts.length} 个账号：\n` +
    accounts
      .map(
        (a) =>
          `- ${a.login}（${a.type}${a.name && a.name !== a.login ? '，' + a.name : ''}）权限: ${
            a.scopes.length ? a.scopes.join(', ') : '未知'
          }`
      )
      .join('\n')
  )
}

function renderRepos(repos: Repo[]): string {
  if (repos.length === 0) return '没有匹配的仓库。'
  return repos
    .map((r) => {
      const run = r.lastRun
      const runInfo = run
        ? `Actions: ${statusEmoji(run.status, run.conclusion)} ${run.name} — ${run.status}${
            run.conclusion ? '/' + run.conclusion : ''
          } @ ${fmtDate(run.createdAt)}`
        : 'Actions: （无运行记录）'
      return `- ${r.fullName}${r.private ? ' [私有]' : ''}${r.archived ? ' [归档]' : ''}${
        r.fork ? ' [fork]' : ''
      }\n  ${r.description ? r.description.slice(0, 120) : '（无描述）'}\n  ⭐${r.stars} · ${
        r.language ?? '-'
      } · 最后推送 ${fmtDate(r.updatedAt)}\n  ${runInfo}`
    })
    .join('\n')
}

function renderRuns(runs: any[]): string {
  if (runs.length === 0) return '没有 Actions 运行记录。'
  return runs
    .map(
      (r) =>
        `${statusEmoji(r.status, r.conclusion)} #${r.runNumber} ${r.displayTitle || r.name}\n` +
        `   run_id=${r.id} · workflow=${r.name} · ${r.event} · ${r.branch} · by ${r.actorLogin}\n` +
        `   ${r.status}${r.conclusion ? '/' + r.conclusion : ''} · ${fmtDate(r.createdAt)} · 耗时 ${Math.round(
          r.durationMs / 1000
        )}s`
    )
    .join('\n')
}

function renderRunDetail(run: any, jobs: any[]): string {
  let out =
    `${statusEmoji(run.status, run.conclusion)} #${run.runNumber} ${run.displayTitle || run.name}\n` +
    `run_id=${run.id} · workflow=${run.name} · ${run.event} · ${run.branch} · commit ${run.headSha}\n` +
    `触发者 ${run.actorLogin} · ${fmtDate(run.createdAt)} · ${run.status}${
      run.conclusion ? '/' + run.conclusion : ''
    } · 耗时 ${Math.round(run.durationMs / 1000)}s\n` +
    (run.commitMessage ? `提交信息: ${run.commitMessage.split('\n')[0]}\n` : '') +
    `链接: ${run.htmlUrl}\n`
  if (jobs.length === 0) out += '\n（没有 job 信息）'
  for (const job of jobs) {
    out += `\n【Job】${job.name} — ${job.status}${job.conclusion ? '/' + job.conclusion : ''}\n`
    for (const s of job.steps) {
      out += `  ${statusEmoji(s.status, s.conclusion)} #${s.number} ${s.name} [${s.status}${
        s.conclusion ? '/' + s.conclusion : ''
      }]\n`
    }
  }
  return out
}

function renderReleases(releases: any[], title: string): string {
  if (releases.length === 0) return title + '：没有找到 Release。'
  return releases
    .map(
      (r) =>
        `${r.prerelease ? '🧪' : '🚀'} ${r.tagName} — ${r.name}\n` +
        `   发布 ${fmtDate(r.publishedAt)} · by ${r.authorLogin}${r.draft ? ' · [草稿]' : ''}\n` +
        `   资源: ${
          r.assets.length
            ? r.assets.map((a: any) => `${a.name} (${(a.size / 1024 / 1024).toFixed(1)}MB, ${a.downloadCount}次)`).join('，')
            : '无'
        }\n` +
        (r.body ? `   说明: ${r.body.slice(0, 400)}${r.body.length > 400 ? '…' : ''}` : '   说明: 无') +
        `\n   链接: ${r.url}`
    )
    .join('\n\n')
}

async function callTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'github_list_accounts':
      return renderAccounts()

    case 'github_list_repos': {
      const limit = Math.min(Math.max(1, args?.limit ?? 30), 100)
      let repos = await listAllRepos()
      if (args?.account) repos = repos.filter((r) => r.accountId === args.account)
      if (args?.query) {
        const q = String(args.query).toLowerCase()
        repos = repos.filter(
          (r) => r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
        )
      }
      return `共 ${repos.length} 个仓库（按最后推送时间排序，显示前 ${limit} 个）：\n` + renderRepos(repos.slice(0, limit))
    }

    case 'github_list_workflow_runs': {
      const runs = await listRuns(`${args.owner}/${args.repo}`)
      const limit = Math.min(Math.max(1, args?.limit ?? 15), 30)
      return `${args.owner}/${args.repo} 最近的 Actions 运行：\n` + renderRuns(runs.slice(0, limit))
    }

    case 'github_get_workflow_run': {
      const fullName = `${args.owner}/${args.repo}`
      const runs = await listRuns(fullName)
      const run = runs.find((r) => r.id === Number(args.run_id))
      if (!run) return `未找到 run_id=${args.run_id} 的运行。`
      const jobs = await listRunJobs(fullName, run.id)
      return renderRunDetail(run, jobs)
    }

    case 'github_list_releases': {
      const releases = await listReleases(`${args.owner}/${args.repo}`)
      const limit = Math.min(Math.max(1, args?.limit ?? 15), 30)
      return `${args.owner}/${args.repo} 的 Release 列表：\n\n` + renderReleases(releases.slice(0, limit), 'Release')
    }

    case 'github_get_latest_release': {
      const releases = await listReleases(`${args.owner}/${args.repo}`)
      const latest = releases.find((r) => !r.draft && !r.prerelease)
      return latest
        ? `${args.owner}/${args.repo} 最新 Release：\n\n` + renderReleases([latest], '最新')
        : `${args.owner}/${args.repo} 没有正式 Release。`
    }

    case 'github_get_release_by_tag': {
      const release = await listReleaseInfoByTag(`${args.owner}/${args.repo}`, String(args.tag))
      return renderReleases([release], 'Release')
    }

    default:
      throw new Error(`未知工具: ${name}`)
  }
}

const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

/** Handle a single JSON-RPC request object. Returns result object, or null for notifications. */
export async function handleRpc(msg: any): Promise<any> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.has(params?.protocolVersion)
              ? params.protocolVersion
              : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
              'GitHub Manager MCP：访问本应用已登录的多个 GitHub 账号，查询仓库、Actions 运行状态和 Release。'
          }
        }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: mcpTools() } }
      case 'tools/call': {
        const name = params?.name
        const args = params?.arguments ?? {}
        try {
          const text = await callTool(name, args)
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], isError: false }
          }
        } catch (err: any) {
          const message = err instanceof GitHubError ? err.message : String(err?.message ?? err)
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: `工具调用失败：${message}` }], isError: true }
          }
        }
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } }
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } }
      default:
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        }
    }
  } catch (err: any) {
    if (isNotification) return null
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `Internal error: ${err?.message ?? err}` }
    }
  }
}

// ---------------- HTTP (Streamable HTTP transport) ----------------

let httpServer: http.Server | null = null
let httpPort = 0

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version, MCP-Session-Id, Authorization, Last-Event-ID',
  'Access-Control-Expose-Headers': 'MCP-Session-Id'
}

export async function startMcpHttp(preferredPort = 3745): Promise<number> {
  if (httpServer) return httpPort
  for (let port = preferredPort; port <= preferredPort + 20; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = http.createServer(handler)
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => {
        httpServer = srv
        httpPort = port
        resolve(true)
      })
    })
    if (ok) {
      console.log(`[mcp] streamable-http server listening on http://127.0.0.1:${httpPort}/mcp`)
      return httpPort
    }
  }
  throw new Error('MCP: no available port')
}

export function stopMcpHttp(): void {
  if (httpServer) {
    httpServer.close()
    httpServer = null
    httpPort = 0
  }
}

export function mcpHttpRunning(): boolean {
  return httpServer !== null
}

export function mcpHttpPort(): number {
  return httpPort
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '').split('?')[0]

  if (req.method === 'OPTIONS') {
    res.writeHead(204, COMMON_HEADERS)
    res.end()
    return
  }

  if (url === '/healthz' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...COMMON_HEADERS })
    res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }))
    return
  }

  if (url === '/mcp') {
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(403, COMMON_HEADERS)
      res.end(JSON.stringify({ error: 'forbidden host' }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST, OPTIONS', ...COMMON_HEADERS })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    let body = ''
    req.setEncoding('utf-8')
    for await (const chunk of req) body += chunk
    let parsed: any
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...COMMON_HEADERS })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
      return
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed]
    const replies: any[] = []
    for (const msg of batch) {
      const reply = await handleRpc(msg)
      if (reply) replies.push(reply)
    }
    if (replies.length === 0) {
      res.writeHead(202, COMMON_HEADERS)
      res.end()
      return
    }
    const out = Array.isArray(parsed) ? replies : replies[0]
    res.writeHead(200, { 'Content-Type': 'application/json', ...COMMON_HEADERS })
    res.end(JSON.stringify(out))
    return
  }

  res.writeHead(404, COMMON_HEADERS)
  res.end(JSON.stringify({ error: 'not found' }))
}

// ---------------- stdio transport (for clients that spawn a command) ----------------

export function startMcpStdio(): void {
  const { stdin, stdout, stderr } = process
  stdin.setEncoding('utf-8')
  let buf = ''
  stdin.on('data', (chunk: string) => {
    buf += chunk
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      handleRpcLine(line)
    }
  })
  stdin.on('end', () => {
    stderr.write('[mcp-stdio] stdin closed, exiting\n')
    process.exit(0)
  })

  async function handleRpcLine(line: string): Promise<void> {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      return
    }
    const reply = await handleRpc(msg)
    if (reply) stdout.write(JSON.stringify(reply) + '\n')
  }
  stderr.write(`[mcp-stdio] ${SERVER_NAME} v${SERVER_VERSION} ready\n`)
}
