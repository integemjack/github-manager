<script setup lang="ts">
import { onUnmounted, onMounted, ref } from 'vue'
import { api, type ReleaseInfo, type Repo } from '../api'
import { fmtBytes, fmtDateTime, relativeTime, renderMarkdown } from '../utils'

const props = defineProps<{ repo: Repo }>()

const releases = ref<ReleaseInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref<ReleaseInfo | null>(null)
const selectedHtml = ref('')
let timer: number | undefined

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
        <div class="assets-title">附件（{{ selected.assets.length }}）</div>
        <div class="asset-row" v-for="a in selected.assets" :key="a.id">
          <button class="link-like asset-name" @click="openExternal(a.downloadUrl)" :title="a.downloadUrl">
            ⬇ {{ a.name }}
          </button>
          <span class="asset-size">{{ fmtBytes(a.size) }}</span>
          <span class="asset-count">{{ a.downloadCount }} 次下载</span>
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
