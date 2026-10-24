#!/usr/bin/env node
// Generate last.json — the self-update manifest shipped as a release asset.
//
// Scans a directory for electron-builder artifacts named
//   GitHub-Manager-<version>-<os>-<arch>.<ext>   (os: win|mac|linux)
// and writes <dir>/last.json with per-platform download URLs + sha512.
//
// Usage:
//   node tools/gen-last-json.mjs --dir dist --repo integemjack/github-manager \
//        --tag v0.1.3 --channel stable [--notes "Release notes" | --notes-file f]
//
// Kept dependency-free so CI can run it directly after downloading artifacts.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function arg(name, { required = false } = {}) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) {
    if (required) {
      console.error(`missing required arg --${name}`)
      process.exit(1)
    }
    return undefined
  }
  return process.argv[i + 1]
}

const dir = path.resolve(arg('dir', { required: true }))
const repo = arg('repo', { required: true })
const tag = arg('tag', { required: true })
const channel = arg('channel') === 'rolling' ? 'rolling' : 'stable'
let notes = arg('notes') ?? ''
const notesFile = arg('notes-file')
if (notesFile) notes = fs.readFileSync(notesFile, 'utf8')

// Primary installer per platform (nsis exe / dmg / AppImage). zip & deb are
// secondary and not part of the auto-update flow.
// electron-builder's ${arch} differs per target: win-x64 / mac-arm64 / linux-x86_64 —
// accept the common aliases so renames don't silently drop a platform again.
const wanted = [
  { re: /^GitHub-Manager-(.+)-win-(x64|amd64)\.exe$/, key: 'win-x64' },
  { re: /^GitHub-Manager-(.+)-mac-(x64|amd64)\.dmg$/, key: 'mac-x64' },
  { re: /^GitHub-Manager-(.+)-mac-arm64\.dmg$/, key: 'mac-arm64' },
  { re: /^GitHub-Manager-(.+)-linux-(x64|x86_64|amd64)\.AppImage$/, key: 'linux-x64' }
]

const files = fs.readdirSync(dir)
const platforms = {}
const versions = new Set()

for (const f of files) {
  for (const w of wanted) {
    const m = f.match(w.re)
    if (!m) continue
    versions.add(m[1])
    const buf = fs.readFileSync(path.join(dir, f))
    platforms[w.key] = {
      url: `https://github.com/${repo}/releases/download/${tag}/${f}`,
      size: buf.length,
      sha512: createHash('sha512').update(buf).digest('hex')
    }
  }
}

if (versions.size === 0) {
  console.error(`no GitHub-Manager-* artifacts found in ${dir}`)
  process.exit(1)
}
if (versions.size > 1) {
  console.error(`conflicting versions in ${dir}: ${[...versions].join(', ')}`)
  process.exit(1)
}

const version = [...versions][0]
const manifest = {
  version,
  channel,
  pubDate: new Date().toISOString(),
  notes,
  releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
  platforms
}

const out = path.join(dir, 'last.json')
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${out} (version ${version}, ${Object.keys(platforms).join(', ')})`)
