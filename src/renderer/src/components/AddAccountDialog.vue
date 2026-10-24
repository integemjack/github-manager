<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api, type DeviceLoginUpdate } from '../api'
import { addDialogOpen, loadAccounts, refreshRepos } from '../store'

type Mode = 'choose' | 'token' | 'device'

const mode = ref<Mode>('choose')
const token = ref('')
const tokenBusy = ref(false)
const tokenError = ref<string | null>(null)
const deviceState = ref<DeviceLoginUpdate>({ phase: 'pending_code' })
const deviceError = ref<string | null>(null)
let unsub: (() => void) | null = null

function switchMode(m: Mode): void {
  mode.value = m
  tokenError.value = null
  deviceError.value = null
}

async function submitToken(): Promise<void> {
  const t = token.value.trim()
  if (!t) return
  tokenBusy.value = true
  tokenError.value = null
  try {
    await api.addTokenAccount(t)
    await loadAccounts()
    close()
    void refreshRepos(true)
  } catch (err: any) {
    tokenError.value = err?.message ?? String(err)
  } finally {
    tokenBusy.value = false
  }
}

async function startDeviceLogin(): Promise<void> {
  deviceError.value = null
  deviceState.value = { phase: 'pending_code' }
  unsub?.()
  unsub = api.onDeviceLoginUpdate((u) => {
    deviceState.value = u
  })
  const res = await api.startDeviceLogin()
  unsub?.()
  unsub = null
  if (res.ok) {
    await loadAccounts()
    close()
    void refreshRepos(true)
  } else if (res.error !== 'cancelled') {
    deviceError.value = res.error ?? '登录失败'
  }
}

function cancelDeviceLogin(): void {
  void api.cancelDeviceLogin()
}

function close(): void {
  unsub?.()
  unsub = null
  addDialogOpen.value = false
  mode.value = 'choose'
  token.value = ''
  tokenError.value = null
  deviceError.value = null
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  unsub?.()
})
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && addDialogOpen.value) close()
}
</script>

<template>
  <div class="overlay" v-if="addDialogOpen" @click.self="close">
    <div class="dialog">
      <div class="dialog-head">
        <h3>添加 GitHub 账号</h3>
        <button class="x" @click="close">✕</button>
      </div>

      <div class="mode-tabs" v-if="mode === 'choose'">
        <div class="choice" @click="switchMode('token')">
          <div class="choice-icon">🔑</div>
          <div class="choice-title">Token 登录</div>
          <div class="choice-desc">粘贴 Personal Access Token（推荐 classic token，勾选 repo / workflow / read:org）</div>
        </div>
        <div class="choice" @click="switchMode('device'); startDeviceLogin()">
          <div class="choice-icon">🌐</div>
          <div class="choice-title">网页登录</div>
          <div class="choice-desc">浏览器设备授权：打开 GitHub 页面输入设备码即可</div>
        </div>
      </div>

      <div v-if="mode === 'token'" class="form">
        <label>Personal Access Token</label>
        <input
          type="password"
          v-model="token"
          placeholder="ghp_… 或 github_pat_…"
          @keydown.enter="submitToken"
          autofocus
        />
        <div class="hint">
          在 <a href="#" @click.prevent="api.openExternal('https://github.com/settings/tokens')">github.com/settings/tokens</a>
          生成；token 只保存在本机（Windows 凭据加密）。
        </div>
        <div class="err" v-if="tokenError">⚠ {{ tokenError }}</div>
        <div class="actions">
          <button @click="switchMode('choose')">← 返回</button>
          <button class="primary" :disabled="tokenBusy || !token.trim()" @click="submitToken">
            {{ tokenBusy ? '验证中…' : '添加账号' }}
          </button>
        </div>
      </div>

      <div v-if="mode === 'device'" class="form device">
        <template v-if="deviceState.phase === 'pending_code'">
          <div class="empty"><span class="spin" style="margin-right: 8px"></span>正在向 GitHub 请求设备码…</div>
        </template>
        <template v-else-if="deviceState.phase === 'awaiting_authorization'">
          <div class="device-code">{{ deviceState.userCode }}</div>
          <div class="device-tip">
            已在浏览器打开 GitHub 授权页。若未打开，请手动访问：<br />
            <a href="#" @click.prevent="api.openExternal(deviceState.verificationUri ?? 'https://github.com/login/device')">{{
              deviceState.verificationUri
            }}</a>
          </div>
          <div class="hint">输入上面的设备码并授权。等待授权中<span class="dots"></span></div>
          <div class="actions">
            <button class="danger" @click="cancelDeviceLogin">取消登录</button>
            <button @click="api.openExternal(deviceState.verificationUri ?? 'https://github.com/login/device')">重新打开网页</button>
          </div>
        </template>
        <template v-else>
          <div class="err" v-if="deviceError">⚠ {{ deviceError }}</div>
          <div class="actions">
            <button @click="switchMode('choose')">← 返回</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 460px;
  max-width: calc(100vw - 40px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.x { background: none; border: none; color: var(--fg-muted); font-size: 13px; padding: 4px; }
.mode-tabs { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.choice {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.choice:hover { border-color: var(--accent); background: var(--panel-2); }
.choice-icon { font-size: 20px; }
.choice-title { font-weight: 600; margin-top: 6px; }
.choice-desc { font-size: 12px; color: var(--fg-muted); margin-top: 3px; line-height: 1.5; }
.form { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.form label { font-size: 13px; color: var(--fg-muted); }
.hint { font-size: 12px; color: var(--fg-dim); line-height: 1.6; }
.hint a { color: var(--accent); text-decoration: none; }
.err { color: #ffa198; font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.device { align-items: center; text-align: center; padding: 8px 0 4px; }
.device-code {
  font-family: var(--mono);
  font-size: 30px;
  letter-spacing: 6px;
  background: #010409;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  color: #7ee787;
  user-select: all;
}
.device-tip { font-size: 12px; color: var(--fg-muted); line-height: 1.8; }
.device-tip a { color: var(--accent); text-decoration: none; word-break: break-all; }
.dots::after {
  content: '';
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
</style>
