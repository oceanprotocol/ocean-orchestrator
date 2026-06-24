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
  // computeStart returns jobIds as "<clusterHash>-<id>", but getComputeStatus
  // and the incentive backend use the bare <id>. Dedup on the bare id (the part
  // after the first '-', mirroring the node) plus trim/lowercase, so the two
  // forms of the same job never render twice.
  const bareId = (id: string) => {
    const s = (id ?? '').trim()
    const i = s.indexOf('-')
    return (i > 0 ? s.slice(i + 1) : s).toLowerCase()
  }

  const incentiveMap = new Map<string, IncentiveJob>()
  for (const job of incentive) {
    incentiveMap.set(bareId(job.jobId), job)
  }

  // One output entry per normalized id, so repeated ids within the local
  // store also collapse (the old code only deduped local-vs-incentive).
  const byId = new Map<string, JobView>()

  for (const rec of local) {
    const key = bareId(rec.jobId)
    if (byId.has(key)) {
      continue
    }
    const inc = incentiveMap.get(key)
    if (inc) {
      const localStatus = mapStatus(rec.status ?? 'queued', false)
      const incStatus = mapStatus(inc.statusText, inc.isRunning)
      const status = statusRank(incStatus) >= statusRank(localStatus) ? incStatus : localStatus
      byId.set(key, {
        // Keep the local id: it carries the "<clusterHash>-<id>" prefix the node
        // needs to route View logs / Download / status to the right cluster.
        jobId: rec.jobId,
        // Backend-persisted name (metadata.name) is authoritative; local name
        // is the fallback until the monitor indexes the fresh job.
        name: inc.name || rec.name,
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
    const key = bareId(inc.jobId)
    if (byId.has(key)) {
      continue
    }
    byId.set(key, {
      jobId: inc.jobId,
      // Show the persisted friendly name (metadata.name); fall back to the raw
      // jobId for jobs started before naming existed.
      name: inc.name || inc.jobId,
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
