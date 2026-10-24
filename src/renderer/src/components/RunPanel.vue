<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { api, type Repo, type RunJob, type WorkflowRun } from '../api'
import { fmtDateTime, fmtDuration, relativeTime } from '../utils'

const props = defineProps<{ repo: Repo }>()

const runs = ref<WorkflowRun[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref<WorkflowRun | null>(null)
const jobs = ref<RunJob[]>([])
const jobsLoading = ref(false)
const log = ref<string | null>(null)
const logJob = ref<string>('')
const logLoading = ref(false)
let runsTimer: number | undefined
let jobsTimer: number | undefined

const hasActive = computed(() =>
  runs.value.some((r) => r.status === 'queued' || r.status === 'in_progress')
)

async function loadRuns(): Promise<void> {
  try {
    const list = await api.listRuns(props.repo.fullName, props.repo.accountId)
    runs.value = list
    error.value = null
    // keep selection fresh
    if (selected.value) {
      const fresh = list.find((r) => r.id === selected.value!.id)
      if (fresh) selected.value = fresh
    } else if (list.length > 0) {
      selectRun(list[0])
    }
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  }
}

async function loadJobs(): Promise<void> {
  if (!selected.value) return
  const run = selected.value
  try {
    const list = await api.listRunJobs(props.repo.fullName, run.id, props.repo.accountId)
    // guard against race when selection changed during fetch
    if (selected.value?.id === run.id) jobs.value = list
  } catch {
    /* keep previous jobs on transient errors */
  }
}

function selectRun(run: WorkflowRun): void {
  selected.value = run
  jobs.value = []
  log.value = null
  logJob.value = ''
  void loadJobs()
}

async function showLog(job: RunJob): Promise<void> {
  logLoading.value = true
  logJob.value = job.name
  try {
    log.value = await api.getJobLog(props.repo.fullName, job.id, props.repo.accountId)
  } catch (err: any) {
    log.value = `日志加载失败: ${err?.message ?? err}`
  } finally {
    logLoading.value = false
  }
}

function runSelected(run: WorkflowRun | null): boolean {
  return !!run && selected.value?.id === run.id
}

function runClass(run: { status: string; conclusion: string | null }): string {
  if (run.status !== 'completed') return run.status === 'queued' ? 'queued' : 'running'
  switch (run.conclusion) {
    case 'success': return 'success'
    case 'failure': case 'startup_failure': return 'failure'
    case 'cancelled': return 'neutral'
    default: return 'neutral'
  }
}

function stepIcon(step: { status: string; conclusion: string | null }): string {
  if (step.status !== 'completed') {
    if (step.status === 'in_progress') return '◐'
    if (step.status === 'queued') return '○'
    return '·'
  }
  switch (step.conclusion) {
    case 'success': return '✓'
    case 'failure': case 'startup_failure': return '✗'
    case 'skipped': return '⤼'
    case 'cancelled': return '⊘'
    default: return '·'
  }
}

function stepClass(step: { status: string; conclusion: string | null }): string {
  if (step.status === 'in_progress') return 'running'
  if (step.status === 'queued') return 'queued'
  if (step.status !== 'completed') return 'queued'
  switch (step.conclusion) {
    case 'success': return 'success'
    case 'failure': case 'startup_failure': return 'failure'
    default: return 'skipped'
  }
}

function stepDuration(s: { startedAt: string | null; completedAt: string | null }): string {
  if (!s.startedAt || !s.completedAt) return ''
  return fmtDuration(Date.parse(s.completedAt) - Date.parse(s.startedAt))
}

watch(
  () => props.repo.fullName,
  async () => {
    stopTimers()
    runs.value = []
    selected.value = null
    jobs.value = []
    log.value = null
    loading.value = true
    await loadRuns()
    loading.value = false
    startTimers()
  },
  { immediate: true }
)

function startTimers(): void {
  stopTimers()
  runsTimer = window.setInterval(() => {
    // refresh list periodically; faster when something is in-flight (realtime feel)
    void loadRuns()
  }, hasActive.value ? 8_000 : 20_000)
  jobsTimer = window.setInterval(() => {
    if (selected.value && selected.value.status !== 'completed') void loadJobs()
  }, 8_000)
}

function stopTimers(): void {
  if (runsTimer) window.clearInterval(runsTimer)
  if (jobsTimer) window.clearInterval(jobsTimer)
  runsTimer = jobsTimer = undefined
}

// The runs interval depends on hasActive (8s while something is queued or
// running, else 20s), which is only evaluated when startTimers() runs. Watch
// it so e.g. triggering a new workflow from outside switches polling to the
// fast cadence without leaving and re-entering the repo.
watch(hasActive, () => {
  if (runsTimer || jobsTimer) startTimers()
})

onUnmounted(stopTimers)
</script>

<template>
  <div class="run-panel">
    <div class="runs-col">
      <div class="col-head">
        工作流运行
        <span class="spin" v-if="loading" style="margin-left: 6px"></span>
      </div>
      <div class="error-banner" v-if="error">⚠ {{ error }}</div>
      <div class="empty small" v-if="!loading && runs.length === 0">此仓库还没有 GitHub Actions 运行</div>
      <div class="run-item" v-for="run in runs" :key="run.id" :class="{ selected: runSelected(run) }" @click="selectRun(run)">
        <div class="ri-status" :class="runClass(run)">
          <span v-if="run.status === 'in_progress'" class="ring"></span>
          <span v-else-if="run.status === 'queued'" class="clock"></span>
        </div>
        <div class="ri-body">
          <div class="ri-title" :title="run.displayTitle">{{ run.displayTitle || run.name }}</div>
          <div class="ri-meta">
            #{{ run.runNumber }} · {{ run.event }}<template v-if="run.branch"> · {{ run.branch }}</template> · {{ run.actorLogin }}
          </div>
          <div class="ri-meta2">
            <span :class="'t-' + runClass(run)">
              {{ run.status === 'completed'
                ? (run.conclusion === 'success' ? '成功' : run.conclusion === 'failure' ? '失败' : run.conclusion)
                : run.status === 'in_progress' ? '运行中' : '排队中' }}
            </span>
            · {{ fmtDuration(run.durationMs) }} · {{ relativeTime(run.createdAt) }}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-col" v-if="selected">
      <div class="run-head">
        <div class="rh-line1">
          <span class="rh-title">{{ selected.displayTitle || selected.name }}</span>
          <span class="badge" :class="runClass(selected) === 'success' ? 'green' : runClass(selected) === 'failure' ? 'red' : runClass(selected) === 'running' ? 'blue' : runClass(selected) === 'queued' ? 'yellow' : ''">
            {{ selected.status === 'completed'
              ? (selected.conclusion === 'success' ? '成功' : selected.conclusion === 'failure' ? '失败' : selected.conclusion)
              : selected.status === 'in_progress' ? '运行中' : '排队中' }}
          </span>
        </div>
        <div class="rh-line2">
          工作流 {{ selected.name }} · #{{ selected.runNumber }} · 尝试 {{ selected.runAttempt }} ·
          {{ selected.event }} · 分支 {{ selected.headBranch }} · commit {{ selected.headSha }}<template v-if="selected.commitMessage"> · {{ selected.commitMessage.split('\n')[0] }}</template>
        </div>
        <div class="rh-line2">
          触发 {{ selected.actorLogin }} · 开始 {{ fmtDateTime(selected.createdAt) }} · 耗时
          {{ fmtDuration(selected.durationMs) }}<template v-if="selected.status !== 'completed'">（进行中）</template>
          · <a href="#" @click.prevent="api.openExternal(selected.htmlUrl)">在 GitHub 查看 ↗</a>
        </div>
      </div>

      <div class="jobs-area">
        <div class="job-card" v-for="job in jobs" :key="job.id">
          <div class="job-head">
            <span class="job-status" :class="runClass(job)"></span>
            <span class="job-name">{{ job.name }}</span>
            <span class="badge">{{ job.status === 'completed' ? (job.conclusion ?? '') : job.status }}</span>
            <span class="job-duration">{{
              fmtDuration(
                Date.parse(job.completedAt ?? new Date().toISOString()) - Date.parse(job.startedAt)
              )
            }}</span>
            <button class="log-btn" @click="showLog(job)">
              {{ logJob === job.name && log !== null ? '收起日志' : '查看日志' }}
            </button>
            <button class="log-btn" @click="api.openExternal(job.url)">↗</button>
          </div>
          <div class="steps">
            <div class="step" v-for="s in job.steps" :key="s.number">
              <span class="step-icon" :class="stepClass(s)">{{ stepIcon(s) }}</span>
              <span class="step-name" :class="{ skipped: stepClass(s) === 'skipped' }">{{ s.name }}</span>
              <span class="step-duration">{{ stepDuration(s) }}</span>
            </div>
          </div>
          <div class="log-box" v-if="logJob === job.name && logLoading">
            <div class="empty small"><span class="spin" style="margin-right: 6px"></span>日志加载中…</div>
          </div>
          <div class="log-box" v-else-if="logJob === job.name && log !== null">
            <pre class="code">{{ log }}</pre>
          </div>
        </div>
        <div class="empty small" v-if="jobs.length === 0 && selected.status === 'completed'">
          <span class="spin" style="margin-right: 6px"></span>正在加载 job 信息…
        </div>
      </div>
    </div>

    <div class="detail-col placeholder" v-else>
      <div class="empty">选择左侧一次运行查看详情</div>
    </div>
  </div>
</template>

<style scoped>
.run-panel {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.runs-col {
  width: 380px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
  padding: 8px;
}
.col-head {
  font-size: 12px;
  color: var(--fg-dim);
  padding: 4px 8px 8px;
  display: flex;
  align-items: center;
}
.run-item {
  display: flex;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.run-item:hover { background: var(--panel); }
.run-item.selected { background: var(--panel-2); border-color: var(--border); }
.ri-status {
  width: 12px; height: 12px; border-radius: 50%;
  margin-top: 4px; flex-shrink: 0; position: relative;
}
.ri-status.success { background: var(--success); }
.ri-status.failure { background: var(--danger); }
.ri-status.running { background: var(--accent); }
.ri-status.queued { background: var(--warning); }
.ri-status.neutral { background: var(--fg-dim); }
.ring {
  position: absolute; inset: -3px;
  border: 2px solid transparent; border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.9s linear infinite;
}
.clock { position: absolute; inset: -2px; border-radius: 50%; border: 1.5px dashed var(--warning); animation: spin 3s linear infinite; }
.ri-body { min-width: 0; flex: 1; }
.ri-title {
  font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ri-meta { font-size: 11px; color: var(--fg-dim); margin-top: 2px; }
.ri-meta2 { font-size: 11px; color: var(--fg-dim); margin-top: 1px; display: flex; gap: 5px; flex-wrap: wrap; }
.t-success { color: #7ee787; }
.t-failure { color: #ffa198; }
.t-running { color: #79c0ff; }
.t-queued { color: #e3b341; }
.error-banner {
  margin: 6px 8px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: var(--radius);
  color: #ffa198;
  padding: 8px 12px;
  font-size: 12px;
}
.detail-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 18px;
}
.detail-col.placeholder { display: flex; align-items: center; justify-content: center; }
.run-head { border-bottom: 1px solid var(--border-soft); padding-bottom: 10px; margin-bottom: 12px; }
.rh-line1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rh-title { font-size: 15px; font-weight: 600; }
.rh-line2 { font-size: 12px; color: var(--fg-muted); margin-top: 4px; }
.rh-line2 a { color: var(--accent); text-decoration: none; }
.jobs-area { display: flex; flex-direction: column; gap: 12px; }
.job-card { background: var(--panel); border: 1px solid var(--border-soft); border-radius: var(--radius); }
.job-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-soft);
  flex-wrap: wrap;
}
.job-status { width: 9px; height: 9px; border-radius: 50%; }
.job-status.success { background: var(--success); }
.job-status.failure { background: var(--danger); }
.job-status.running { background: var(--accent); animation: pulse 1.2s infinite; }
.job-status.queued { background: var(--warning); }
.job-status.neutral { background: var(--fg-dim); }
.job-name { font-weight: 600; font-size: 13px; flex: 1; min-width: 120px; }
.job-duration { font-size: 12px; color: var(--fg-dim); }
.log-btn { padding: 2px 8px; font-size: 12px; }
.steps { padding: 6px 0; }
.step {
  display: flex; align-items: center; gap: 10px;
  padding: 3px 14px; font-size: 12px;
}
.step-icon { width: 14px; text-align: center; flex-shrink: 0; }
.step-icon.success { color: var(--success); }
.step-icon.failure { color: var(--danger); font-weight: 700; }
.step-icon.running { color: var(--accent); display: inline-block; animation: spin 1.2s linear infinite; }
.step-icon.queued { color: var(--fg-dim); }
.step-icon.skipped { color: var(--fg-dim); }
.step-name { color: var(--fg-muted); flex: 1; }
.step-name.skipped { text-decoration: line-through; opacity: 0.6; }
.step-duration { color: var(--fg-dim); font-size: 11px; }
.log-box { padding: 10px 12px; border-top: 1px dashed var(--border-soft); }
.log-box pre.code { max-height: 420px; }
.empty.small { padding: 20px; font-size: 12px; }
@keyframes pulse { 50% { opacity: 0.4; } }
</style>
