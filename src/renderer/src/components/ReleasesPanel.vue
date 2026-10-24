<script lang="ts">
// Module-scope asset-download state: survives component re-mounts (switching
// repos / releases); downloads keep running in the main process regardless of
// this view, and these event subscriptions live for the whole app lifetime.
import { reactive } from 'vue'
import { api } from '../api'

interface DlState {
  status: 'downloading' | 'done' | 'error'
  percent: number
  received: number
  total: number // 0 when unknown
  speed: number // bytes/s
  path?: string
  error?: string
}

const dlStates = reactive(new Map<number, DlState>())
const speedTrack = new Map<number, { t: number; received: number }>()

api.onAssetProgress((p) => {
  const s = dlStates.get(p.assetId)
  if (!s || s.status !== 'downloading') return
  const now = Date.now()
  const prev = speedTrack.get(p.assetId)
  let speed = 0
  if (prev && now > prev.t) {
    speed = Math.max(0, (p.received - prev.received) / ((now - prev.t) / 1000))
  }
  speedTrack.set(p.assetId, { t: now, received: p.received })
  s.received = p.received
  if (p.total > 0) s.total = p.total
  s.percent = s.total > 0 ? Math.min(100, Math.floor((p.received / s.total) * 100)) : 0
  s.speed = speed
})
api.onAssetDone((d) => {
  speedTrack.delete(d.assetId)
  dlStates.set(d.assetId, {
    status: 'done', percent: 100, received: d.size, total: d.size, speed: 0, path: d.path
  })
})
api.onAssetError((e) => {
  speedTrack.delete(e.assetId)
  if (e.cancelled) dlStates.delete(e.assetId)
  else {
    dlStates.set(e.assetId, {
      status: 'error', percent: 0, received: 0, total: 0, speed: 0, error: e.message
    })
  }
})
</script>

<script setup lang="ts">
import { onUnmounted, onMounted, ref, computed } from 'vue'
import type { ReleaseAsset, ReleaseInfo, Repo } from '../api'
import { fmtBytes, fmtDateTime, relativeTime, renderMarkdown } from '../utils'

const props = defineProps<{ repo: Repo }>()

const releases = ref<ReleaseInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref<ReleaseInfo | null>(null)
const selectedHtml = ref('')
let timer: number | undefined

const assetVms = computed(() =>
  (selected.value?.assets ?? []).map((a) => ({ a, st: dlStates.get(a.id) }))
)

function fmtSpeed(bps: number): string {
  return bps > 0 ? `${fmtBytes(bps)}/s` : ''
}

function clickAsset(a: ReleaseAsset): void {
  const s = dlStates.get(a.id)
  if (s?.status === 'downloading') return
  if (s?.status === 'done' && s.path) {
    void api.openAssetFile(s.path).catch((err: any) => {
      s.error = err?.message ?? String(err)
      s.status = 'error'
    })
    return
  }
  dlStates.set(a.id, { status: 'downloading', percent: 0, received: 0, total: a.size, speed: 0 })
  api
    .downloadAsset({ assetId: a.id, name: a.name, url: a.downloadUrl, accountId: props.repo.accountId })
    .catch((err: any) =>
      dlStates.set(a.id, {
        status: 'error', percent: 0, received: 0, total: 0, speed: 0, error: err?.message ?? String(err)
      })
    )
}

function cancelAsset(a: ReleaseAsset): void {
  void api.cancelAssetDownload(a.id)
}

function openAsset(s: DlState): void {
  if (!s.path) return
  void api.openAssetFile(s.path).catch((err: any) => {
    s.error = err?.message ?? String(err)
    s.status = 'error'
  })
}

async function deleteAsset(a: ReleaseAsset, s: DlState): Promise<void> {
  if (!s.path) return
  try {
    await api.deleteAssetFile(s.path)
    dlStates.delete(a.id)
  } catch (err: any) {
    s.error = err?.message ?? String(err)
    s.status = 'error'
  }
}

/** Mark assets whose file already sits in the downloads folder as done. */
async function checkSaved(list: ReleaseAsset[]): Promise<void> {
  if (list.length === 0) return
  try {
    const found = await api.checkAssetsSaved(list.map((a) => a.name))
    for (const a of list) {
      const p = found[a.name]
      const s = dlStates.get(a.id)
      if (p && (!s || s.status === 'error')) {
        dlStates.set(a.id, {
          status: 'done', percent: 100, received: a.size, total: a.size, speed: 0, path: p
        })
      }
    }
  } catch {
    /* non-fatal */
  }
}

async function load(): Promise<void> {
  try {
    const list = await api.listReleases(props.repo.fullName, props.repo.accountId)
    releases.value = list
    error.value = null
    if (!selected.value && list.length > 0) select(list[0])
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  }
}

function select(r: ReleaseInfo): void {
  selected.value = r
  selectedHtml.value = renderMarkdown(r.body ?? '*(此 release 没有说明文字)*')
  void checkSaved(r.assets)
}

function openExternal(url: string): void {
  void api.openExternal(url)
}

onMounted(() => {
  loading.value = true
  void load().finally(() => (loading.value = false))
  timer = window.setInterval(() => void load(), 60_000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="rel-panel">
    <div class="rel-col">
      <div class="col-head">
        Releases
        <span class="spin" v-if="loading" style="margin-left: 6px"></span>
      </div>
      <div class="error-banner" v-if="error">⚠ {{ error }}</div>
      <div class="empty small" v-if="!loading && releases.length === 0">此仓库还没有 Release</div>
      <div
        class="rel-item"
        v-for="(r, idx) in releases"
        :key="r.id"
        :class="{ selected: selected?.id === r.id }"
        @click="select(r)"
      >
        <div class="rel-row1">
          <span class="tag">{{ r.tagName }}</span>
          <span class="badge green" v-if="idx === 0 && !r.prerelease && !r.draft">Latest</span>
          <span class="badge yellow" v-if="r.prerelease">预发布</span>
          <span class="badge red" v-if="r.draft">草稿</span>
        </div>
        <div class="rel-name" v-if="r.name && r.name !== r.tagName">{{ r.name }}</div>
        <div class="rel-meta">
          {{ relativeTime(r.publishedAt || r.createdAt) }} · {{ r.authorLogin }} ·
          {{ r.assets.length }} 个附件
        </div>
      </div>
    </div>

    <div class="rel-detail" v-if="selected">
      <div class="rd-head">
        <div class="rd-title">
          <span class="tag big">{{ selected.tagName }}</span>
          <span class="rd-name">{{ selected.name }}</span>
        </div>
        <div class="rd-meta">
          发布于 {{ fmtDateTime(selected.publishedAt || selected.createdAt) }} · by {{ selected.authorLogin }}
          · <a href="#" @click.prevent="openExternal(selected.url)">在 GitHub 查看 ↗</a>
        </div>
      </div>

      <div class="assets" v-if="selected.assets.length">
        <div class="assets-title">附件（{{ selected.assets.length }}）· 点击下载到「下载」文件夹</div>
        <div class="asset-row" v-for="vm in assetVms" :key="vm.a.id">
          <button
            class="link-like asset-name"
            @click="clickAsset(vm.a)"
            :title="vm.st?.status === 'done' && vm.st.path ? vm.st.path : vm.a.downloadUrl"
          >
            {{ vm.st?.status === 'done' ? '📄' : '⬇' }} {{ vm.a.name }}
          </button>

          <template v-if="vm.st?.status === 'downloading'">
            <div class="dl-progress">
              <div class="dl-bar">
                <div class="dl-fill" :style="{ width: (vm.st.percent ?? 0) + '%' }"></div>
              </div>
              <span class="dl-info">
                {{ vm.st.total > 0 ? vm.st.percent + '% · ' : '' }}{{ fmtBytes(vm.st.received) }}
                <template v-if="vm.st.speed">· {{ fmtSpeed(vm.st.speed) }}</template>
              </span>
            </div>
            <button class="mini-btn" @click="cancelAsset(vm.a)" title="取消下载">✕</button>
          </template>

          <template v-else-if="vm.st?.status === 'done'">
            <span class="dl-done">✓ 已下载</span>
            <button class="mini-btn" @click="openAsset(vm.st)">打开</button>
            <button class="mini-btn" @click="deleteAsset(vm.a, vm.st)">删除</button>
          </template>

          <template v-else-if="vm.st?.status === 'error'">
            <span class="dl-error" :title="vm.st.error">⚠ {{ vm.st.error }}</span>
          </template>

          <span class="asset-size">{{ fmtBytes(vm.a.size) }}</span>
          <span class="asset-count">{{ vm.a.downloadCount }} 次下载</span>
          <button class="mini-btn" @click="openExternal(vm.a.downloadUrl)" title="在浏览器中打开">↗</button>
        </div>
      </div>

      <div class="rd-body md" v-html="selectedHtml"></div>
    </div>
    <div class="rel-detail placeholder" v-else>
      <div class="empty">选择左侧 Release 查看详情</div>
    </div>
  </div>
</template>

<style scoped>
.rel-panel { display: flex; height: 100%; overflow: hidden; }
.rel-col {
  width: 360px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
  padding: 8px;
}
.col-head { font-size: 12px; color: var(--fg-dim); padding: 4px 8px 8px; display: flex; align-items: center; }
.error-banner {
  margin: 6px 8px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: var(--radius);
  color: #ffa198; padding: 8px 12px; font-size: 12px;
}
.rel-item {
  padding: 9px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.rel-item:hover { background: var(--panel); }
.rel-item.selected { background: var(--panel-2); border-color: var(--border); }
.rel-row1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tag {
  font-family: var(--mono);
  font-size: 12px;
  color: #79c0ff;
  background: rgba(56, 139, 253, 0.12);
  border: 1px solid rgba(56, 139, 253, 0.35);
  padding: 1px 7px;
  border-radius: 6px;
}
.tag.big { font-size: 14px; }
.rel-name { font-size: 13px; font-weight: 600; margin-top: 3px; }
.rel-meta { font-size: 11px; color: var(--fg-dim); margin-top: 2px; }
.rel-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px; }
.rel-detail.placeholder { display: flex; align-items: center; justify-content: center; }
.rd-head { border-bottom: 1px solid var(--border-soft); padding-bottom: 10px; margin-bottom: 12px; }
.rd-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rd-name { font-size: 16px; font-weight: 600; }
.rd-meta { font-size: 12px; color: var(--fg-muted); margin-top: 5px; }
.rd-meta a { color: var(--accent); text-decoration: none; }
.assets { margin-bottom: 14px; }
.assets-title { font-size: 12px; color: var(--fg-dim); margin-bottom: 6px; }
.asset-row {
  display: flex; align-items: center; gap: 12px;
  padding: 5px 8px; border-radius: 6px; font-size: 13px;
}
.asset-row:hover { background: var(--panel); }
.asset-name { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-size { color: var(--fg-muted); font-size: 12px; }
.asset-count { color: var(--fg-dim); font-size: 12px; }
.dl-progress { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dl-bar {
  width: 110px; height: 4px; background: var(--border-soft);
  border-radius: 2px; overflow: hidden;
}
.dl-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.2s ease; }
.dl-info { font-size: 11px; color: var(--fg-muted); white-space: nowrap; }
.dl-done { font-size: 11px; color: #3fb950; white-space: nowrap; }
.dl-error {
  font-size: 11px; color: #ffa198; max-width: 220px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mini-btn {
  font-size: 11px; padding: 2px 8px;
  border: 1px solid var(--border); background: transparent;
  color: var(--fg-muted); border-radius: 5px; cursor: pointer; white-space: nowrap;
}
.mini-btn:hover { border-color: var(--accent); color: var(--accent); }
.rd-body { font-size: 13px; line-height: 1.65; }
.empty.small { padding: 20px; font-size: 12px; }
</style>

<style>
/* markdown content (global so v-html content gets styled) */
.md h1, .md h2, .md h3, .md h4 { margin: 14px 0 6px; line-height: 1.35; }
.md h1 { font-size: 18px; border-bottom: 1px solid var(--border-soft); padding-bottom: 5px; }
.md h2 { font-size: 16px; border-bottom: 1px solid var(--border-soft); padding-bottom: 4px; }
.md h3 { font-size: 14px; }
.md p { margin: 7px 0; }
.md ul, .md ol { margin: 7px 0; padding-left: 22px; }
.md li { margin: 3px 0; }
.md code {
  font-family: var(--mono);
  font-size: 12px;
  background: rgba(110, 118, 129, 0.25);
  border-radius: 4px;
  padding: 1px 5px;
}
.md pre.code code { background: none; padding: 0; }
.md a { color: var(--accent); }
.md pre.code { margin: 8px 0; max-height: 480px; }
</style>
