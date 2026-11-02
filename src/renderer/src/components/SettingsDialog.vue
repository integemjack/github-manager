<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, type ConfigImportResult, type ConfigImportSummary } from '../api'
import { UI_PREF_KEYS } from '../../../shared/prefs'
import {
  accounts,
  appInfo,
  loadAccounts,
  loadMcpStatus,
  mcp,
  refreshRepos,
  settingsOpen
} from '../store'

const busy = ref(false)

async function toggleMcp(): Promise<void> {
  busy.value = true
  try {
    const s = await api.setMcpEnabled(!mcp.enabled)
    Object.assign(mcp, s)
  } finally {
    busy.value = false
  }
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text)
}

function close(): void {
  settingsOpen.value = false
}

// ---------------- config export / import ----------------

function errMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // IPC rejections arrive wrapped: "Error invoking remote method 'x': Error: <message>"
  const unwrapped = raw.match(/Error invoking remote method '[^']+': (?:Error: )?([\s\S]*)$/)
  return (unwrapped ? unwrapped[1] : raw).trim()
}

/** UI preferences (column widths) living in localStorage. */
function collectUiPrefs(): Record<string, string> {
  const prefs: Record<string, string> = {}
  for (const key of UI_PREF_KEYS) {
    const value = localStorage.getItem(key)
    if (value) prefs[key] = value
  }
  return prefs
}

const MIN_PASSWORD = 6

// export
const exportPanel = ref(false)
const includeTokens = ref(true)
const exportPassword = ref('')
const exportPassword2 = ref('')
const exportBusy = ref(false)
const exportError = ref<string | null>(null)
const exportResult = ref<{ path: string; summary: string; warnings: string[] } | null>(null)

const passwordOk = computed(() => {
  const pw = exportPassword.value
  return pw.length >= MIN_PASSWORD && pw === exportPassword2.value
})

const passwordHint = computed(() => {
  if (exportPassword.value.length > 0 && exportPassword.value.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`
  if (exportPassword2.value.length > 0 && exportPassword.value !== exportPassword2.value) return '两次输入的密码不一致'
  return ''
})

function openExport(): void {
  exportPanel.value = true
  exportResult.value = null
  exportError.value = null
}

function cancelExport(): void {
  exportPanel.value = false
  exportPassword.value = ''
  exportPassword2.value = ''
  exportError.value = null
}

async function doExport(): Promise<void> {
  exportBusy.value = true
  exportError.value = null
  exportResult.value = null
  try {
    const withTokens = includeTokens.value
    const res = await api.exportConfig({
      includeTokens: withTokens,
      password: withTokens ? exportPassword.value : undefined,
      uiPrefs: collectUiPrefs()
    })
    if (res.cancelled) return
    exportResult.value = {
      path: res.path ?? '',
      summary: withTokens
        ? `已导出 ${res.accounts} 个账号（其中 ${res.accountsWithTokens} 个 Token 已加密写入）`
        : `已导出 ${res.accounts} 个账号（不含 Token，导入后需重新登录）`,
      warnings: res.warnings
    }
    exportPassword.value = ''
    exportPassword2.value = ''
  } catch (err) {
    exportError.value = errMessage(err)
  } finally {
    exportBusy.value = false
  }
}

// import
const importSummary = ref<ConfigImportSummary | null>(null)
const importPassword = ref('')
const importAccounts = ref(true)
const importSettings = ref(true)
const importBusy = ref(false)
const importError = ref<string | null>(null)
const importResult = ref<ConfigImportResult | null>(null)

const SHOW_LOGINS = 6
const visibleLogins = computed(() => importSummary.value?.accounts.slice(0, SHOW_LOGINS) ?? [])
const hiddenLogins = computed(() => Math.max(0, (importSummary.value?.accounts.length ?? 0) - SHOW_LOGINS))

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return '未知'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function openImport(): Promise<void> {
  importError.value = null
  importResult.value = null
  importSummary.value = null
  importPassword.value = ''
  try {
    const summary = await api.pickImportConfig()
    if (!summary) return
    importSummary.value = summary
    importAccounts.value = summary.accounts.length > 0
    importSettings.value = true
  } catch (err) {
    importError.value = errMessage(err)
  }
}

function cancelImport(): void {
  importSummary.value = null
  importResult.value = null
  importError.value = null
  importPassword.value = ''
}

async function doImport(): Promise<void> {
  const summary = importSummary.value
  if (!summary) return
  importBusy.value = true
  importError.value = null
  importResult.value = null
  try {
    const res = await api.importConfig({
      path: summary.path,
      password: summary.hasSecrets ? importPassword.value : undefined,
      importAccounts: importAccounts.value,
      importSettings: importSettings.value
    })
    if (res.uiPrefs) {
      for (const [key, value] of Object.entries(res.uiPrefs)) localStorage.setItem(key, value)
    }
    if (importAccounts.value) {
      await loadAccounts()
      if (accounts.value.length > 0) void refreshRepos(true)
    }
    if (res.settingsApplied) await loadMcpStatus()
    importResult.value = res
    importPassword.value = ''
  } catch (err) {
    importError.value = errMessage(err)
  } finally {
    importBusy.value = false
  }
}

function reveal(path: string | undefined): void {
  if (path) void api.revealConfigFile(path)
}
</script>

<template>
  <div class="overlay" v-if="settingsOpen" @click.self="close">
    <div class="dialog">
      <div class="dialog-head">
        <h3>设置</h3>
        <button class="x" @click="close">✕</button>
      </div>

      <div class="section-title">MCP 服务</div>
      <div class="mcp-row">
        <div class="mcp-info">
          <div class="mcp-title">
            MCP Server
            <span class="badge" :class="mcp.running ? 'green' : 'yellow'">
              {{ mcp.running ? '运行中' : '已停止' }}
            </span>
          </div>
          <div class="mcp-desc">
            内置 Model Context Protocol 服务器，让 AI 助手（Claude、Cursor、Friday 等）访问你已登录账号的仓库、Actions 与 Release。
          </div>
        </div>
        <button class="primary" :disabled="busy" @click="toggleMcp">
          {{ mcp.enabled ? '停用' : '启用' }}
        </button>
      </div>

      <template v-if="mcp.enabled">
        <div class="field-label">Streamable HTTP 接入地址</div>
        <div class="url-box">
          <code>{{ mcp.url || '（未运行）' }}</code>
          <button v-if="mcp.url" @click="copy(mcp.url)">复制</button>
        </div>

        <div class="field-label">stdio 接入方式（Claude Desktop 等）</div>
        <div class="hint" style="margin-bottom: 6px">
          用仓库自带的 <code>extras/mcp-bridge.cjs</code> 桥接（需先启动本应用）：
        </div>
        <pre class="code snippet">{
  "mcpServers": {
    "github-manager": {
      "command": "node",
      "args": ["C:\\Users\\you\\github-manager\\extras\\mcp-bridge.cjs"]
    }
  }
}</pre>

        <div class="field-label">提供的工具（{{ mcp.tools.length }}）</div>
        <div class="tools">
          <div class="tool" v-for="t in mcp.tools" :key="t.name">
            <code class="tool-name">{{ t.name }}</code>
            <span class="tool-desc">{{ t.description }}</span>
          </div>
        </div>
      </template>

      <div class="divider"></div>

      <div class="section-title">配置备份与迁移</div>
      <div class="cfg-desc">
        把设置、账号列表和界面偏好导出成一个 JSON 文件，换机或重装后导入即可恢复。合并导入，不会删除本机已有账号。
      </div>
      <div class="cfg-actions">
        <button @click="openExport">导出配置…</button>
        <button @click="openImport">导入配置…</button>
      </div>

      <!-- export -->
      <div class="cfg-panel" v-if="exportPanel">
        <label class="check">
          <input type="checkbox" v-model="includeTokens" />
          <span>包含账号 Token</span>
        </label>
        <div class="hint">
          Token 会用下面的密码加密（AES-256-GCM + scrypt）后写入文件，导入时输入同一密码即可免登录恢复账号。不勾选则文件不含任何 Token，导入后需要重新登录。
        </div>
        <template v-if="includeTokens">
          <div class="field-label">加密密码（至少 {{ MIN_PASSWORD }} 位）</div>
          <input type="password" v-model="exportPassword" placeholder="设置一个用于加密 Token 的密码" />
          <div class="field-label">确认密码</div>
          <input type="password" v-model="exportPassword2" @keydown.enter="passwordOk && doExport()" />
          <div class="err" v-if="passwordHint">⚠ {{ passwordHint }}</div>
        </template>
        <div class="err" v-if="exportError">⚠ {{ exportError }}</div>
        <div class="ok" v-if="exportResult">
          <div>✓ {{ exportResult.summary }}</div>
          <div class="path" :title="exportResult.path">{{ exportResult.path }}</div>
          <button class="link-like" @click="reveal(exportResult.path)">在文件夹中显示</button>
          <div class="warn" v-for="w in exportResult.warnings" :key="w">· {{ w }}</div>
        </div>
        <div class="actions">
          <button @click="cancelExport">关闭</button>
          <button
            class="primary"
            :disabled="exportBusy || (includeTokens && !passwordOk)"
            @click="doExport"
          >
            {{ exportBusy ? '导出中…' : '选择位置并导出' }}
          </button>
        </div>
      </div>

      <!-- import -->
      <div class="cfg-panel" v-if="importSummary">
        <div class="file-line">
          <code :title="importSummary.path">{{ importSummary.fileName }}</code>
          <button class="link-like" @click="reveal(importSummary.path)">显示</button>
        </div>
        <div class="hint">
          导出于 {{ formatTime(importSummary.exportedAt) }}
          <template v-if="importSummary.appVersion"> · v{{ importSummary.appVersion }}</template>
          · 账号 {{ importSummary.accounts.length }} 个
          <template v-if="importSummary.uiPrefs"> · 界面偏好 {{ importSummary.uiPrefs }} 项</template>
        </div>

        <label class="check" v-if="importSummary.accounts.length > 0">
          <input type="checkbox" v-model="importAccounts" />
          <span>导入账号（{{ importSummary.accounts.length }}）</span>
        </label>
        <div class="logins" v-if="importSummary.accounts.length > 0">
          <span class="login-chip" v-for="a in visibleLogins" :key="a.login">{{ a.login }}</span>
          <span class="login-chip more" v-if="hiddenLogins">+{{ hiddenLogins }}</span>
        </div>
        <div class="hint" v-if="importAccounts && !importSummary.hasSecrets">
          该文件不含 Token，账号需要重新登录后才能使用。
        </div>

        <label class="check">
          <input type="checkbox" v-model="importSettings" />
          <span>导入偏好设置（MCP 服务：{{ importSummary.mcpEnabled ? '启用' : '停用' }}）</span>
        </label>

        <template v-if="importSummary.hasSecrets && importAccounts">
          <div class="field-label">文件密码</div>
          <input
            type="password"
            v-model="importPassword"
            placeholder="导出时设置的密码"
            @keydown.enter="importPassword && doImport()"
          />
        </template>

        <div class="err" v-if="importError">⚠ {{ importError }}</div>
        <div class="ok" v-if="importResult">
          <div>
            ✓ 导入完成：新增 {{ importResult.added }}，更新 {{ importResult.updated }}
            <template v-if="importResult.skipped">，跳过 {{ importResult.skipped }}</template>
          </div>
          <div v-if="importResult.settingsApplied">
            · 已应用偏好设置：MCP {{ importResult.mcpEnabled ? '启用' : '停用' }}
          </div>
          <div v-if="importResult.uiPrefs">· 界面偏好已保存，重启后生效</div>
          <div class="warn" v-for="w in importResult.warnings" :key="w">· {{ w }}</div>
        </div>
        <div class="actions">
          <button @click="cancelImport">关闭</button>
          <button
            class="primary"
            :disabled="
              importBusy ||
              (!importAccounts && !importSettings) ||
              (importSummary.hasSecrets && importAccounts && !importPassword)
            "
            @click="doImport"
          >
            {{ importBusy ? '导入中…' : '开始导入' }}
          </button>
        </div>
      </div>

      <div class="about">
        GitHub Manager v{{ appInfo.version }} · Electron {{ appInfo.electron }} · {{ appInfo.platform }}
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
  width: 560px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.x { background: none; border: none; color: var(--fg-muted); font-size: 13px; padding: 4px; }
.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 16px;
}
.mcp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 10px;
}
.mcp-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
.mcp-desc { font-size: 12px; color: var(--fg-muted); margin-top: 4px; line-height: 1.6; }
.field-label { font-size: 12px; color: var(--fg-dim); margin: 10px 0 5px; }
.url-box {
  display: flex;
  align-items: center;
  gap: 8px;
}
.url-box code {
  flex: 1;
  font-family: var(--mono);
  font-size: 12px;
  background: #010409;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 7px 10px;
  color: #7ee787;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet { font-size: 11.5px; }
.tools { display: flex; flex-direction: column; gap: 6px; }
.tool { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
.tool-name {
  font-family: var(--mono);
  color: #79c0ff;
  background: rgba(56, 139, 253, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tool-desc { color: var(--fg-muted); line-height: 1.5; }

.divider { height: 1px; background: var(--border-soft); margin: 18px 0 0; }
.cfg-desc { font-size: 12px; color: var(--fg-muted); line-height: 1.7; margin-top: 6px; }
.cfg-actions { display: flex; gap: 8px; margin-top: 10px; }
.cfg-panel {
  margin-top: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: #010409;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
}
.check input { accent-color: var(--accent); }
.hint { font-size: 12px; color: var(--fg-dim); line-height: 1.6; }
.cfg-panel .hint { margin-top: 2px; }
.err { color: #ffa198; font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.ok {
  font-size: 12px;
  color: #7ee787;
  line-height: 1.7;
  background: rgba(63, 185, 80, 0.08);
  border: 1px solid rgba(63, 185, 80, 0.3);
  border-radius: 6px;
  padding: 8px 10px;
}
.ok div + div { margin-top: 2px; }
.ok .path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warn { color: #e3b341; font-size: 11.5px; line-height: 1.6; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.file-line { display: flex; align-items: center; gap: 8px; }
.file-line code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-line button { font-size: 12px; }
.logins { display: flex; flex-wrap: wrap; gap: 5px; }
.login-chip {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--fg-muted);
  background: var(--panel-2);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 1px 7px;
}
.login-chip.more { color: var(--fg-dim); }
.about { margin-top: 18px; font-size: 11px; color: var(--fg-dim); text-align: center; }
</style>