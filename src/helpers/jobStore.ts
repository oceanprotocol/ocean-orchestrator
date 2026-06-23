import type * as vscode from 'vscode'
import { LocalJobRecord, JobView, IncentiveJob } from '../types'

const KEY_LOCAL_JOBS = 'ocean.localJobs'
const KEY_SELECTED_JOB_ID = 'ocean.selectedJobId'

export function addLocalJob(
  context: vscode.ExtensionContext,
  rec: LocalJobRecord
): Thenable<void> {
  const withDefault: LocalJobRecord = { status: 'Running', ...rec }
  const existing = getLocalJobs(context).filter((j) => j.jobId !== withDefault.jobId)
  return context.globalState.update(KEY_LOCAL_JOBS, [withDefault, ...existing])
}

export function updateLocalJobStatus(
  context: vscode.ExtensionContext,
  jobId: string,
  status: string
): Thenable<void> {
  const jobs = getLocalJobs(context)
  const idx = jobs.findIndex((j) => j.jobId === jobId)
  if (idx === -1) return Promise.resolve()
  jobs[idx] = { ...jobs[idx], status }
  return context.globalState.update(KEY_LOCAL_JOBS, jobs)
}

export function getLocalJobs(context: vscode.ExtensionContext): LocalJobRecord[] {
  return context.globalState.get<LocalJobRecord[]>(KEY_LOCAL_JOBS) ?? []
}

export function getSelectedJobId(context: vscode.ExtensionContext): string | undefined {
  return context.globalState.get<string>(KEY_SELECTED_JOB_ID)
}

export function setSelectedJobId(
  context: vscode.ExtensionContext,
  id: string | undefined
): Thenable<void> {
  return context.globalState.update(KEY_SELECTED_JOB_ID, id)
}

function mapStatus(
  statusText: string,
  isRunning: boolean
): JobView['status'] {
  if (isRunning) { return 'Running' }

  // The node returns phrases ("Job finished", "Building algorithm image
  // failed"), not bare status words, so match on substrings. Failure is
  // checked first so "finished with errors" reads as Failed.
  const s = (statusText ?? '').toLowerCase()
  if (/fail|error|timeout/.test(s)) { return 'Failed' }
  if (/finish|complet/.test(s)) { return 'Completed' }
  if (/stop/.test(s)) { return 'Stopped' }
  if (/runn/.test(s)) { return 'Running' }
  return 'Queued'
}

function statusRank(s: JobView['status']): number {
  switch (s) {
    case 'Running': return 1
    case 'Completed':
    case 'Failed':
    case 'Stopped': return 2
    default: return 0
  }
}

export function mergeJobs(
  local: LocalJobRecord[],
  incentive: IncentiveJob[]
): JobView[] {
  // The id saved locally (from the node response) and the id the incentive
  // backend stores can differ by case or stray whitespace. Dedup on a
  // normalized key so a single job never renders twice — once "from
  // localStorage" and once "from envs".
  const norm = (id: string) => id.trim().toLowerCase()

  const incentiveMap = new Map<string, IncentiveJob>()
  for (const job of incentive) {
    incentiveMap.set(norm(job.jobId), job)
  }

  // One output entry per normalized id, so repeated ids within the local
  // store also collapse (the old code only deduped local-vs-incentive).
  const byId = new Map<string, JobView>()

  for (const rec of local) {
    const key = norm(rec.jobId)
    if (byId.has(key)) {
      continue
    }
    const inc = incentiveMap.get(key)
    if (inc) {
      const localStatus = mapStatus(rec.status ?? 'queued', false)
      const incStatus = mapStatus(inc.statusText, inc.isRunning)
      const status = statusRank(localStatus) >= statusRank(incStatus) ? localStatus : incStatus
      byId.set(key, {
        // Surface the incentive id: it is the canonical on-node form that
        // View logs / Download / status reads must use.
        jobId: inc.jobId,
        name: rec.name,
        status,
        envLabel: inc.environment || rec.envLabel,
        cost: inc.cost ?? rec.cost,
        createdAt: rec.createdAt || inc.dateCreated,
        finishedAt: inc.dateFinished,
        outputsURL: inc.outputsURL,
        isLocalOnly: false
      })
    } else {
      byId.set(key, {
        jobId: rec.jobId,
        name: rec.name,
        status: mapStatus(rec.status ?? 'queued', false),
        envLabel: rec.envLabel,
        cost: rec.cost,
        createdAt: rec.createdAt,
        isLocalOnly: true
      })
    }
  }

  for (const inc of incentive) {
    const key = norm(inc.jobId)
    if (byId.has(key)) {
      continue
    }
    byId.set(key, {
      jobId: inc.jobId,
      name: inc.jobId,
      status: mapStatus(inc.statusText, inc.isRunning),
      envLabel: inc.environment,
      cost: inc.cost,
      createdAt: inc.dateCreated,
      finishedAt: inc.dateFinished,
      outputsURL: inc.outputsURL,
      isLocalOnly: false
    })
  }

  const views = [...byId.values()]
  views.sort((a, b) => b.createdAt - a.createdAt)

  return views
}
