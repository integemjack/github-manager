<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { appInfo, update } from '../store'

let unsubs: (() => void)[] = []

function dismiss(): void {
  update.status = 'idle'
}

async function download(): Promise<void> {
  // Windows: in-app download + relaunch installer; other platforms open the browser
  if (appInfo.platform === 'win32') {
    update.status = 'downloading'
    update.percent = 0
    void api.downloadUpdate()
  } else {
    void api.openExternal(update.latest?.releaseUrl ?? 'https://github.com/integemjack/github-manager/releases')
    dismiss()
  }
}

function install(): void {
  void api.installUpdate()
}

onMounted(() => {
  unsubs = [
    api.onUpdateAvailable((info) => {
      update.current = info.current
      update.latest = info
      update.status = 'available'
      update.error = null
    }),
    api.onUpdateProgress((p) => {
      update.percent = p.percent
    }),
    api.onUpdateDownloaded(() => {
      update.status = 'downloaded'
    }),
    api.onUpdateError((e) => {
      update.status = 'error'
      update.error = e.message
    })
  ]
})

onUnmounted(() => {
  unsubs.forEach((u) => u())
})
</script>

<template>
  <div class="update-banner" v-if="update.status !== 'idle'">
    <template v-if="update.status === 'available' && update.latest">
      <span class="up-icon">⬆</span>
      <span class="up-text">
        发现新版本 v{{ update.latest.latest }}
      </span>
      <button class="primary up-btn" @click="download">下载更新</button>
      <button class="up-dismiss" title="本次忽略" @click="dismiss">✕</button>
    </template>
    <template v-else-if="update.status === 'downloading'">
      <span class="up-icon">⬇</span>
      <div class="up-progress">
        <div class="up-progress-bar"><div class="up-progress-fill" :style="{ width: update.percent + '%' }"></div></div>
        <span class="up-text">{{ update.percent }}%</span>
      </div>
    </template>
    <template v-else-if="update.status === 'downloaded'">
      <span class="up-icon">✓</span>
      <span class="up-text">v{{ update.latest?.latest ?? '' }} 已就绪</span>
      <button class="primary up-btn" @click="install">重启并安装</button>
      <button class="up-dismiss" title="稍后再说" @click="dismiss">✕</button>
    </template>
    <template v-else-if="update.status === 'error'">
      <span class="up-icon err">⚠</span>
      <span class="up-text">更新失败：{{ update.error }}</span>
      <button class="up-dismiss" title="关闭" @click="dismiss">✕</button>
    </template>
  </div>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(31, 111, 235, 0.12);
  border-bottom: 1px solid rgba(88, 166, 255, 0.35);
  font-size: 12.5px;
  color: var(--fg);
  flex-shrink: 0;
}
.up-icon { color: var(--accent); }
.up-icon.err { color: var(--warning); }
.up-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-btn { padding: 3px 12px; font-size: 12px; flex-shrink: 0; }
.up-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.up-progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 4px;
  background: var(--panel-2);
  overflow: hidden;
}
.up-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.2s;
}
.up-dismiss {
  background: none;
  border: none;
  color: var(--fg-dim);
  padding: 2px 6px;
  font-size: 12px;
  flex-shrink: 0;
}
.up-dismiss:hover { color: var(--fg); background: none; }
</style>
