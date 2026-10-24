/** Relative time like "3 分钟前" */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '-'
  const diff = Date.now() - t
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? '前' : '后'
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (abs < min) return `${Math.max(1, Math.round(abs / 1000))} 秒${suffix}`
  if (abs < hour) return `${Math.round(abs / min)} 分钟${suffix}`
  if (abs < day) return `${Math.round(abs / hour)} 小时${suffix}`
  if (abs < 30 * day) return `${Math.round(abs / day)} 天${suffix}`
  return new Date(t).toLocaleDateString('zh-CN')
}

/** Duration like "1m 23s" */
export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '-'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(Date.parse(iso))
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', { hour12: false })
}

// ---- tiny & safe markdown renderer for release notes ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(md: string): string {
  let s = escapeHtml(md)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  // links: [text](https://...) — only http(s)
  s = s.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" data-ext-link="1" rel="noopener">${text || url}</a>`
  )
  // bare urls
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${url}" data-ext-link="1" rel="noopener">${url}</a>`
  )
  return s
}

/** Render a small subset of markdown (headings, lists, code fences, bold/italic, links) to HTML. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^```/.test(line.trim())) {
      closeList()
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        out.push('<pre class="code"><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(escapeHtml(raw))
      continue
    }
    if (!line.trim()) {
      closeList()
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol>')
        listType = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}
