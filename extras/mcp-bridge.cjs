#!/usr/bin/env node
/**
 * github-manager MCP stdio bridge
 *
 * Streams JSON-RPC from stdin to the GitHub Manager app's built-in MCP
 * Streamable-HTTP server and writes responses back to stdout. Use this with
 * stdio-only MCP clients (e.g. Claude Desktop) on any platform:
 *
 *   { "mcpServers": { "github-manager": {
 *       "command": "node",
 *       "args": ["C:\\path\\to\\mcp-bridge.cjs"] } } }
 *
 * Requires the GitHub Manager desktop app to be running (it serves
 * http://127.0.0.1:3745/mcp). Override the port with GM_MCP_PORT.
 */
const http = require('node:http')

const PORT = Number(process.env.GM_MCP_PORT || 3745)
const HOST = process.env.GM_MCP_HOST || '127.0.0.1'

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body, 'utf-8')
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
      },
      (res) => {
        let chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }))
      }
    )
    req.on('error', reject)
    req.setTimeout(120000, () => req.destroy(new Error('timeout')))
    req.end(data)
  })
}

function write(line) {
  try {
    process.stdout.write(line + '\n')
  } catch {
    /* stdout closed */
  }
}

let buf = ''
let connectedOnce = false

async function handleLine(line) {
  if (!line.trim()) return
  try {
    JSON.parse(line) // validate; invalid lines are dropped
  } catch {
    write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
    return
  }
  let res
  try {
    res = await post(line)
    connectedOnce = true
  } catch (err) {
    const msg = connectedOnce
      ? `github-manager MCP server unreachable: ${err.message}`
      : `无法连接 GitHub Manager 应用（http://${HOST}:${PORT}/mcp）：${err.message}。请先启动 GitHub Manager 桌面应用并确认 MCP 服务已启用。`
    // Try to address the reply to the requester even when offline
    let id = null
    try {
      id = JSON.parse(line).id ?? null
    } catch {}
    write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32002, message: msg }
      })
    )
    return
  }
  if (res.status === 202 || !res.body) return // notifications
  write(res.body.trim())
}

process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    handleLine(line).catch((e) => process.stderr.write(String(e) + '\n'))
  }
})
process.stdin.on('end', () => process.exit(0))
