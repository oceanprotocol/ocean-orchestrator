import type * as vscode from 'vscode'
import { LocalJobRecord, JobView, IncentiveJob } from '../types'
import { toMs } from './time'

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
  const bareId = (id: string) => {
    const s = (id ?? '').trim()
    const i = s.indexOf('-')
    return (i > 0 ? s.slice(i + 1) : s).toLowerCase()
  }

  const incentiveMap = new Map<string, IncentiveJob>()
  for (const job of incentive) {
    incentiveMap.set(bareId(job.jobId), job)
  }

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
        jobId: rec.jobId,
        name: inc.name || rec.name,
        status,
        envLabel: inc.environment || rec.envLabel,
        cost: inc.cost ?? rec.cost,
        createdAt: toMs(rec.createdAt || inc.dateCreated),
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
      name: inc.name || inc.jobId,
      status: mapStatus(inc.statusText, inc.isRunning),
      envLabel: inc.environment,
      cost: inc.cost,
      createdAt: toMs(inc.dateCreated),
      finishedAt: inc.dateFinished,
      outputsURL: inc.outputsURL,
      isLocalOnly: false
    })
  }

  const views = [...byId.values()]
  views.sort((a, b) => b.createdAt - a.createdAt)

  return views
}
