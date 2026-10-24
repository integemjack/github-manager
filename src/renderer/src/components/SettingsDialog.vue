<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import { appInfo, mcp, settingsOpen } from '../store'

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
</script>

<template>
  <div class="overlay" v-if="settingsOpen" @click.self="close">
    <div class="dialog">
      <div class="dialog-head">
        <h3>设置 · MCP 服务</h3>
        <button class="x" @click="close">✕</button>
      </div>

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
.mcp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
}
.mcp-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
.mcp-desc { font-size: 12px; color: var(--fg-muted); margin-top: 4px; line-height: 1.6; }
.field-label { font-size: 12px; color: var(--fg-dim); margin: 14px 0 5px; }
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
.about { margin-top: 18px; font-size: 11px; color: var(--fg-dim); text-align: center; }
</style>
