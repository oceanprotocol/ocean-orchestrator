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

  switch (statusText.toLowerCase()) {
    case 'running':
      return 'Running'
    case 'completed':
    case 'finished':
      return 'Completed'
    case 'failed':
    case 'timeout':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    case 'pending':
    case 'queued':
    case 'provisioning':
    default:
      return 'Queued'
  }
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
  const incentiveMap = new Map<string, IncentiveJob>()
  for (const job of incentive) {
    incentiveMap.set(job.jobId, job)
  }

  const localMap = new Map<string, LocalJobRecord>()
  for (const rec of local) {
    localMap.set(rec.jobId, rec)
  }

  const views: JobView[] = []

  for (const rec of local) {
    const inc = incentiveMap.get(rec.jobId)
    if (inc) {
      const localStatus = mapStatus(rec.status ?? 'queued', false)
      const incStatus = mapStatus(inc.statusText, inc.isRunning)
      const status = statusRank(localStatus) >= statusRank(incStatus) ? localStatus : incStatus
      views.push({
        jobId: rec.jobId,
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
      const localStatus = mapStatus(rec.status ?? 'queued', false)
      views.push({
        jobId: rec.jobId,
        name: rec.name,
        status: localStatus,
        envLabel: rec.envLabel,
        cost: rec.cost,
        createdAt: rec.createdAt,
        isLocalOnly: true
      })
    }
  }

  for (const inc of incentive) {
    if (!localMap.has(inc.jobId)) {
      views.push({
        jobId: inc.jobId,
        name: inc.jobId,
        status: mapStatus(inc.statusText, inc.isRunning),
        envLabel: inc.environment || inc.environmentId,
        cost: inc.cost,
        createdAt: inc.dateCreated,
        finishedAt: inc.dateFinished,
        outputsURL: inc.outputsURL,
        isLocalOnly: false
      })
    }
  }

  views.sort((a, b) => b.createdAt - a.createdAt)

  return views
}
