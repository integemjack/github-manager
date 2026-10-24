<script setup lang="ts">
import { ref } from 'vue'
import { api, type Repo } from '../api'
import { closeRepo } from '../store'
import RunPanel from './RunPanel.vue'
import ReleasesPanel from './ReleasesPanel.vue'

const props = defineProps<{ repo: Repo }>()
const tab = ref<'actions' | 'releases'>('actions')

function openExternal(url: string): void {
  void api.openExternal(url)
}
</script>

<template>
  <div class="detail-view">
    <div class="detail-header">
      <button class="back" @click="closeRepo()" title="返回列表">←</button>
      <div class="titles">
        <h2 class="repo-title">
          <span class="owner">{{ repo.owner }} /</span> {{ repo.name }}
          <span class="badge" v-if="repo.private">私有</span>
          <span class="badge" v-if="repo.archived">归档</span>
        </h2>
        <div class="repo-sub" v-if="repo.description">{{ repo.description }}</div>
        <div class="repo-meta">
          <span class="badge blue" v-if="repo.language">{{ repo.language }}</span>
          <span class="badge" v-if="repo.stars">★ {{ repo.stars }}</span>
          <span class="badge">默认分支 {{ repo.defaultBranch }}</span>
          <span class="badge" v-if="repo.openIssues">Issues {{ repo.openIssues }}</span>
          <span class="badge">账号 {{ repo.accountId }}</span>
        </div>
      </div>
      <button class="gh-open" @click="openExternal(repo.htmlUrl)">在 GitHub 打开 ↗</button>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'actions' }" @click="tab = 'actions'">Actions</button>
      <button :class="{ active: tab === 'releases' }" @click="tab = 'releases'">Releases</button>
    </div>

    <div class="detail-body">
      <RunPanel v-if="tab === 'actions'" :repo="repo" />
      <ReleasesPanel v-else :repo="repo" />
    </div>
  </div>
</template>

<style scoped>
.detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.detail-header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 20px 10px;
  border-bottom: 1px solid var(--border-soft);
}
.back {
  margin-top: 2px;
  padding: 4px 10px;
  font-size: 15px;
}
.titles { flex: 1; min-width: 0; }
.repo-title { margin: 0; font-size: 17px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.repo-title .owner { color: var(--fg-muted); font-weight: 400; }
.repo-sub { color: var(--fg-muted); font-size: 13px; margin-top: 3px; }
.repo-meta { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-soft);
}
.tabs button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 9px 14px;
  color: var(--fg-muted);
  font-size: 14px;
}
.tabs button:hover { background: none; color: var(--fg); }
.tabs button.active { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
.detail-body { flex: 1; overflow: hidden; min-height: 0; }
</style>
