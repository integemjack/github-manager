<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import RepoList from './components/RepoList.vue'
import RepoDetail from './components/RepoDetail.vue'
import AddAccountDialog from './components/AddAccountDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { initApp, refreshRepos, selectedRepo, accounts } from './store'

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
})

const showingList = computed(() => !selectedRepo.value)
</script>

<template>
  <div class="app-shell">
    <Sidebar />
    <main class="main-area">
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
</style>
