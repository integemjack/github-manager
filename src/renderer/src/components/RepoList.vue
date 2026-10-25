<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../api'
import {
  accountFilter,
  accounts,
  addDialogOpen,
  loadingRepos,
  openRepo,
  refreshRepos,
  repos,
  reposError
} from '../store'
import { relativeTime } from '../utils'

const showPrivateOnly = ref(false)

const filtered = computed(() => {
  let list = repos.value
  if (accountFilter.value) list = list.filter((r) => r.accountId === accountFilter.value)
  if (showPrivateOnly.value) list = list.filter((r) => r.private)
  return list
})

function runClass(repo: { lastRun: { status: string; conclusion: string | null } | null }): string {
  const run = repo.lastRun
  if (!run) return 'none'
  if (run.status !== 'completed') return run.status === 'queued' ? 'queued' : 'running'
  switch (run.conclusion) {
    case 'success': return 'success'
    case 'failure': return 'failure'
    case 'cancelled': return 'neutral'
    case 'startup_failure': return 'failure'
    default: return 'neutral'
  }
}

function runLabel(repo: { lastRun: { status: string; conclusion: string | null; name: string | null } | null }): string {
  const run = repo.lastRun
  if (!run) return '无 Actions'
  if (run.status === 'in_progress') return `${run.name ?? '构建'} · 运行中`
  if (run.status === 'queued') return `${run.name ?? '构建'} · 排队中`
  const map: Record<string, string> = {
    success: '成功', failure: '失败', cancelled: '已取消',
    skipped: '已跳过', startup_failure: '启动失败', neutral: '未通过'
  }
  return `${run.name ?? '构建'} · ${map[run.conclusion ?? ''] ?? run.conclusion ?? '完成'}`
}

async function refresh(): Promise<void> {
  await refreshRepos(true)
}

function openRepoUrl(url: string, e: Event): void {
  e.stopPropagation()
  void api.openExternal(url)
}
</script>

<template>
  <div class="repo-list-view">
    <div class="toolbar">
      <h2 class="page-title">
        {{ accountFilter ? `${accountFilter} 的仓库` : '全部仓库' }}
        <span class="page-count" v-if="!loadingRepos">（{{ filtered.length }}，Actions 进行中的在前，其余按最后更新排序）</span>
      </h2>
      <div class="toolbar-actions">
        <label class="private-toggle">
          <input type="checkbox" v-model="showPrivateOnly" />
          仅私有
        </label>
        <button :disabled="loadingRepos" @click="refresh">
          <span v-if="loadingRepos" class="spin" style="margin-right: 6px"></span>
          {{ loadingRepos ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="error-banner" v-if="reposError">⚠ {{ reposError }}</div>

    <div class="empty" v-if="!loadingRepos && accounts.length === 0">
      还没有添加 GitHub 账号。<br />
      <button class="primary" style="margin-top: 12px" @click="addDialogOpen = true">添加账号</button>
      <div class="hint">支持 Personal Access Token 登录，或浏览器设备授权登录</div>
    </div>

    <div class="empty" v-else-if="!loadingRepos && filtered.length === 0">没有符合条件的仓库</div>

    <div class="rows" v-else>
      <div
        v-for="repo in filtered"
        :key="repo.fullName"
        class="row"
        @click="openRepo(repo)"
      >
        <div class="status-cell" :class="runClass(repo)" :title="runLabel(repo)">
          <span class="spinner" v-if="repo.lastRun && repo.lastRun.status === 'in_progress'"></span>
        </div>
        <div class="main-cell">
          <div class="title-line">
            <span class="repo-name">{{ repo.name }}</span>
            <span class="owner">/{{ repo.owner }}</span>
            <span class="badge" v-if="repo.private">私有</span>
            <span class="badge" v-if="repo.fork">fork</span>
            <span class="badge" v-if="repo.archived">归档</span>
          </div>
          <div class="desc" v-if="repo.description">{{ repo.description }}</div>
          <div class="meta-line">
            <span class="actions-label" :class="'t-' + runClass(repo)">
              {{ runLabel(repo) }}
            </span>
            <span class="meta-sep" v-if="repo.lastRun">·</span>
            <span class="meta-time" v-if="repo.lastRun" :title="repo.lastRun.createdAt">
              {{ relativeTime(repo.lastRun.createdAt) }}
            </span>
          </div>
        </div>
        <div class="side-cell">
          <span class="lang" v-if="repo.language"><span class="lang-dot"></span>{{ repo.language }}</span>
          <span class="stars" v-if="repo.stars">★ {{ repo.stars }}</span>
          <span class="updated" :title="repo.updatedAt">更新 {{ relativeTime(repo.updatedAt) }}</span>
        </div>
        <button class="ext" title="在浏览器打开" @click="openRepoUrl(repo.htmlUrl, $event)">↗</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.repo-list-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--border-soft);
  flex-wrap: wrap;
  gap: 8px;
}
.page-title { font-size: 16px; margin: 0; font-weight: 600; }
.page-count { font-size: 12px; color: var(--fg-dim); font-weight: 400; }
.toolbar-actions { display: flex; align-items: center; gap: 10px; }
.private-toggle {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--fg-muted); cursor: pointer; user-select: none;
}
.error-banner {
  margin: 10px 20px 0;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: var(--radius);
  color: #ffa198;
  padding: 8px 12px;
  font-size: 12px;
}
.hint { font-size: 12px; color: var(--fg-dim); margin-top: 10px; }
.rows { flex: 1; overflow-y: auto; padding: 6px 12px 20px; }
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid transparent;
}
.row:hover { background: var(--panel); border-color: var(--border-soft); }
.status-cell {
  width: 14px; height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.status-cell.none { border: 1.5px solid var(--border); }
.status-cell.success { background: var(--success); box-shadow: 0 0 8px rgba(63, 185, 80, 0.5); }
.status-cell.failure { background: var(--danger); box-shadow: 0 0 8px rgba(248, 81, 73, 0.5); }
.status-cell.running { background: var(--accent); box-shadow: 0 0 8px rgba(88, 166, 255, 0.6); animation: pulse 1.2s ease-in-out infinite; }
.status-cell.queued { background: var(--warning); box-shadow: 0 0 8px rgba(210, 153, 34, 0.5); }
.status-cell.neutral { background: var(--fg-dim); }
.spinner {
  position: absolute;
  inset: -3px;
  border: 2px solid transparent;
  border-top-color: rgba(88, 166, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes pulse { 50% { opacity: 0.55; } }
.main-cell { flex: 1; min-width: 0; }
.title-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.repo-name { font-weight: 600; font-size: 14px; }
.owner { color: var(--fg-dim); font-size: 12px; }
.desc {
  color: var(--fg-muted);
  font-size: 12px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-line { display: flex; gap: 6px; align-items: center; margin-top: 3px; font-size: 12px; color: var(--fg-dim); }
.actions-label.t-success { color: #7ee787; }
.actions-label.t-failure { color: #ffa198; }
.actions-label.t-running { color: #79c0ff; }
.actions-label.t-queued { color: #e3b341; }
.actions-label.t-none, .actions-label.t-neutral { color: var(--fg-dim); }
.side-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.lang { display: flex; align-items: center; gap: 5px; }
.lang-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
.stars { color: var(--fg-dim); }
.updated { color: var(--fg-dim); }
.ext {
  background: none; border: none; color: var(--fg-dim);
  font-size: 14px; padding: 4px; flex-shrink: 0;
}
.ext:hover { color: var(--accent); background: none; }
</style>
