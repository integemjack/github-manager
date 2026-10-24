<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import RepoList from './components/RepoList.vue'
import RepoDetail from './components/RepoDetail.vue'
import AddAccountDialog from './components/AddAccountDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import {
  NARROW_THRESHOLD_PX,
  applyNarrow,
  initApp,
  refreshRepos,
  selectedRepo,
  accounts,
  sidebarOpen,
  uiNarrow,
  setSidebarOpen
} from './store'

let timer: number | undefined

onMounted(async () => {
  // Open every <a> (incl. markdown-rendered release bodies) in the system browser
  document.addEventListener(
    'click',
    (e) => {
      const anchor = (e.target as HTMLElement)?.closest?.('a')
      if (anchor && anchor.getAttribute('href')) {
        e.preventDefault()
        const href = anchor.getAttribute('href') ?? ''
        if (/^https?:\/\//.test(href)) void window.gm.openExternal(href)
      }
    },
    true
  )

  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)
  onResize()

  await initApp()
  // Auto refresh repo list (with Actions status) every 60s while on the list view
  timer = window.setInterval(() => {
    if (!selectedRepo.value && accounts.value.length > 0 && document.hasFocus()) {
      void refreshRepos()
    }
  }, 60_000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
})

const showingList = computed(() => !selectedRepo.value)

// Auto-hide the sidebar when the window gets narrow; restore it when it
// widens again — unless the user had collapsed it manually.
function onResize(): void {
  applyNarrow(window.innerWidth < NARROW_THRESHOLD_PX)
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && uiNarrow.value && sidebarOpen.value) sidebarOpen.value = false
}
</script>

<template>
  <div class="app-shell">
    <Sidebar
      v-if="sidebarOpen"
      :class="{ 'sidebar-drawer': uiNarrow }"
      @collapse="setSidebarOpen(false)"
    />
    <div v-else class="sidebar-rail">
      <button class="rail-btn" title="显示侧边栏" @click="setSidebarOpen(true)">☰</button>
    </div>
    <div class="drawer-backdrop" v-if="uiNarrow && sidebarOpen" @click="sidebarOpen = false"></div>
    <main class="main-area">
      <UpdateBanner />
      <RepoList v-if="showingList" />
      <RepoDetail v-else :repo="selectedRepo!" />
    </main>
    <AddAccountDialog />
    <SettingsDialog />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.sidebar-rail {
  width: 40px;
  flex-shrink: 0;
  background: var(--bg-soft);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 10px;
}
.rail-btn {
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: 16px;
  padding: 6px;
  border-radius: 6px;
}
.rail-btn:hover { background: var(--panel); color: var(--fg); }
/* narrow mode: sidebar overlays content as a drawer (below dialogs, z-index 100) */
.sidebar-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 90;
  box-shadow: 8px 0 24px rgba(1, 4, 9, 0.55);
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.5);
  z-index: 89;
}
</style>
