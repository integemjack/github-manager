import { app, ipcMain, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { resolveToken } from './store'
import type { AssetDownloadRequest } from '../shared/types'

const UA = 'github-manager-desktop'
const MAX_REDIRECTS = 6

interface DownloadHandle {
  abort: AbortController
  partPath: string | null
}

const active = new Map<number, DownloadHandle>()

function sendToWindows(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function downloadsDir(): string {
  return app.getPath('downloads')
}

/** Pick a non-existing target path, appending " (1)", " (2)"… when needed. */
function uniqueTarget(name: string): string {
  const dir = downloadsDir()
  let target = path.join(dir, name)
  if (!fs.existsSync(target)) return target
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  for (let i = 1; i < 1000; i++) {
    target = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(target)) return target
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

async function runDownload(req: AssetDownloadRequest, signal: AbortSignal): Promise<void> {
  const auth = await resolveToken(req.accountId)
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/octet-stream' }
  if (auth) headers.Authorization = `Bearer ${auth.token}`

  // Follow redirects manually: the signed object-storage URL behind the 302
  // rejects requests that carry an Authorization header, so it must be dropped.
  let url = req.url
  let res: Response | null = null
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const r = await fetch(url, { headers, redirect: 'manual', signal })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) throw new Error('重定向响应缺少地址')
      url = new URL(loc, url).toString()
      delete headers.Authorization
      continue
    }
    res = r
    break
  }
  if (!res) throw new Error(`重定向次数超过 ${MAX_REDIRECTS}`)
  if (!res.ok || !res.body) throw new Error(`下载失败 (HTTP ${res.status})`)

  const total = Number(res.headers.get('content-length') ?? 0)
  const target = uniqueTarget(req.name)
  const partPath = `${target}.part`
  active.get(req.assetId)!.partPath = partPath

  const out = fs.createWriteStream(partPath)
  let received = 0
  let lastSent = 0
  const nodeStream = Readable.fromWeb(res.body as unknown as NodeWebReadableStream)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastSent > 200 || (total > 0 && received >= total)) {
      lastSent = now
      sendToWindows('asset:progress', { assetId: req.assetId, received, total })
    }
  })

  try {
    await pipeline(nodeStream, out)
    if (received > 0 && total > 0 && received !== total) {
      throw new Error(`下载不完整 (${received}/${total} 字节)`)
    }
    await fs.promises.rename(partPath, target)
    sendToWindows('asset:done', { assetId: req.assetId, path: target, size: received })
  } catch (err) {
    out.destroy()
    try {
      fs.rmSync(partPath, { force: true })
    } catch {
      /* best effort */
    }
    throw err
  } finally {
    active.delete(req.assetId)
  }
}

export function registerDownloadIpc(): void {
  ipcMain.handle('asset:download', (_e, req: AssetDownloadRequest) => {
    if (!req?.url || typeof req.assetId !== 'number' || !req.name) {
      throw new Error('下载参数不完整')
    }
    if (active.has(req.assetId)) return // already downloading this asset
    const handle: DownloadHandle = { abort: new AbortController(), partPath: null }
    active.set(req.assetId, handle)
    sendToWindows('asset:progress', { assetId: req.assetId, received: 0, total: 0 })
    runDownload(req, handle.abort.signal).catch((err: any) => {
      const cancelled = err?.name === 'AbortError' || signalAborted(handle)
      sendToWindows('asset:error', {
        assetId: req.assetId,
        message: cancelled ? '已取消' : err?.message ?? String(err),
        cancelled
      })
    })
  })

  ipcMain.handle('asset:cancel', (_e, assetId: number) => {
    const h = active.get(assetId)
    if (!h) return
    h.abort.abort()
    if (h.partPath) {
      try {
        fs.rmSync(h.partPath, { force: true })
      } catch {
        /* the stream error path cleans up too */
      }
    }
  })

  // Which of the given file names already exist in the downloads folder?
  ipcMain.handle('asset:checkSaved', (_e, names: string[]): Record<string, string> => {
    const dir = downloadsDir()
    const found: Record<string, string> = {}
    for (const n of names ?? []) {
      if (typeof n !== 'string' || n.length === 0) continue
      const p = path.join(dir, n)
      try {
        if (fs.statSync(p).isFile()) found[n] = p
      } catch {
        /* not present */
      }
    }
    return found
  })

  ipcMain.handle('asset:open', async (_e, p: string) => {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })

  ipcMain.handle('asset:delete', (_e, p: string) => shell.trashItem(p))
}

function signalAborted(handle: DownloadHandle): boolean {
  return handle.abort.signal.aborted
}
