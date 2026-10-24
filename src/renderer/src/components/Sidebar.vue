<script setup lang="ts">
import { computed } from 'vue'
import { api } from '../api'
import {
  accountFilter,
  accounts,
  addDialogOpen,
  appInfo,
  loadAccounts,
  mcp,
  repos,
  refreshRepos,
  settingsOpen
} from '../store'

const totalRepos = computed(() => repos.value.length)

const emit = defineEmits<{ (e: 'collapse'): void }>()

function selectAccount(login: string): void {
  accountFilter.value = accountFilter.value === login ? '' : login
}

async function removeAccount(login: string): Promise<void> {
  if (!confirm(`移除账号 ${login}？（不影响 GitHub 账号本身）`)) return
  await api.removeAccount(login)
  await loadAccounts()
  if (accounts.value.length > 0) void refreshRepos(true)
  else repos.value = []
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand" @click="accountFilter = ''">
      <svg class="gh-mark" viewBox="0 0 16 16" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
      <div class="brand-text">
        <div class="brand-name">GitHub Manager</div>
        <div class="brand-sub">v{{ appInfo.version }}</div>
      </div>
      <button class="collapse-btn" title="隐藏侧边栏" @click.stop="emit('collapse')">«</button>
    </div>

    <button class="primary add-btn" @click="addDialogOpen = true">+ 添加账号</button>

    <div class="section-title">
      账号
      <span class="count">{{ accounts.length }}</span>
    </div>
    <nav class="account-list">
      <button
        class="account-item all"
        :class="{ active: accountFilter === '' }"
        @click="accountFilter = ''"
      >
        <span class="avatar all-avatar">∑</span>
        <span class="login">全部仓库</span>
        <span class="repo-count">{{ totalRepos }}</span>
      </button>
      <div v-for="a in accounts" :key="a.login" class="account-row">
        <button class="account-item" :class="{ active: accountFilter === a.login }" @click="selectAccount(a.login)">
          <img class="avatar" :src="a.avatarUrl" alt="" loading="lazy" />
          <span class="login" :title="a.login">{{ a.login }}</span>
          <span class="type-badge" v-if="a.type === 'Organization'">org</span>
        </button>
        <button class="icon-btn remove" title="移除账号" @click.stop="removeAccount(a.login)">✕</button>
      </div>
    </nav>

    <div class="spacer"></div>

    <button class="mcp-pill" :class="{ on: mcp.enabled && mcp.running }" @click="settingsOpen = true" title="MCP 服务设置">
      <span class="dot" :class="{ on: mcp.enabled && mcp.running }"></span>
      <span class="mcp-text">MCP {{ mcp.enabled && mcp.running ? '运行中' : '未启用' }}</span>
    </button>
    <button class="settings-btn" @click="settingsOpen = true">⚙ 设置</button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 230px;
  flex-shrink: 0;
  background: var(--bg-soft);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  padding: 14px 12px;
  gap: 12px;
  overflow: hidden;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  cursor: pointer;
  color: var(--fg);
  padding: 2px 4px;
}
.brand-text { flex: 1; min-width: 0; }
.collapse-btn {
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 15px;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.collapse-btn:hover { background: var(--panel); color: var(--fg); }
.gh-mark { color: var(--fg); flex-shrink: 0; }
.brand-name { font-weight: 600; font-size: 14px; }
.brand-sub { font-size: 11px; color: var(--fg-dim); }
.add-btn { width: 100%; }
.section-title {
  font-size: 11px;
  color: var(--fg-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.count { font-size: 11px; color: var(--fg-muted); }
.account-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.account-row { display: flex; align-items: stretch; gap: 0; }
.account-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--fg-muted);
  font-size: 13px;
}
.account-item:hover { background: var(--panel); color: var(--fg); }
.account-item.active { background: var(--panel-2); color: var(--fg); box-shadow: inset 2px 0 0 var(--accent); }
.avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--panel-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.all-avatar { color: var(--accent); }
.login { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo-count { font-size: 11px; color: var(--fg-dim); }
.type-badge {
  font-size: 10px;
  color: var(--purple);
  border: 1px solid rgba(188, 140, 255, 0.4);
  border-radius: 8px;
  padding: 0 5px;
}
.icon-btn {
  background: none;
  border: none;
  color: var(--fg-dim);
  padding: 0 6px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
}
.account-row:hover .icon-btn { opacity: 1; }
.icon-btn.remove:hover { color: var(--danger); }
.spacer { flex: 1; }
.mcp-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--fg-muted);
}
.mcp-pill:hover { background: var(--panel); }
.dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--fg-dim);
}
.dot.on { background: var(--success); box-shadow: 0 0 6px rgba(63, 185, 80, 0.8); }
.settings-btn { background: none; border: none; color: var(--fg-muted); font-size: 12px; text-align: left; padding: 2px 6px; }
.settings-btn:hover { background: none; color: var(--fg); }
</style>
