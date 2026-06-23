import {
  INCENTIVE_API_ROOT,
  BASE_CHAIN_ID,
  SUPPORTED_TOKENS_BASE
} from './constants'
import { EnvSummary, IncentiveJob } from '../types'

interface ComputeEnvironment {
  id: string
  consumerAddress: string
  fees?: { [chainId: string]: { feeToken: string; prices: { id: string; price: number }[] }[] }
  resources?: any[]
  [key: string]: any
}

interface NodeEnvironments {
  id: string
  multiaddrs?: string[]
  currentAddrs?: string[]
  friendlyName?: string
  computeEnvironments: { environments: ComputeEnvironment[] }
}

interface ComputeJob {
  jobId: string
  statusText: string
  status: number
  isRunning: boolean
  isFree: boolean
  environment: string
  // The backend returns timestamps as strings (epoch seconds, fractional).
  dateCreated: string
  dateFinished: string
  payment?: { token?: string; cost?: number } | null
  outputsURL?: string
}

// The extension's libp2p dials WebSockets, not raw TCP. Nodes advertise both
// (often a raw /tcp/ addr first), so order WS/WSS addrs first to ensure the
// node URI picked downstream (cost estimate, job run) is actually dialable.
function orderDialable(addrs: string[]): string[] {
  const isWs = (a: string) => /\/wss?\//.test(a)
  return [...addrs.filter(isWs), ...addrs.filter((a) => !isWs(a))]
}

export async function fetchPaidEnvironments(): Promise<EnvSummary[]> {
  const filters = JSON.stringify({
    network: { operator: 'eq', value: String(BASE_CHAIN_ID) },
    feeToken: {
      operator: 'in',
      value: SUPPORTED_TOKENS_BASE.map((t) => t.address)
    }
  })
  const sort = JSON.stringify({ benchmarkTotalScore: 'desc' })

  const params = new URLSearchParams({
    filters,
    page: '1',
    pageSize: '50',
    sort
  })

  const url = `${INCENTIVE_API_ROOT}/envs?${params.toString()}`
  const resp = await globalThis.fetch(url)

  if (!resp.ok) {
    throw new Error(`fetchPaidEnvironments: HTTP ${resp.status}`)
  }

  const data: { envs: NodeEnvironments[] } = await resp.json()

  const result: EnvSummary[] = []
  for (const node of data.envs ?? []) {
    const envs = node.computeEnvironments?.environments ?? []
    for (const env of envs) {
      const feeTokens: string[] =
        env.fees?.[String(BASE_CHAIN_ID)]?.map((f) => f.feeToken) ?? []

      result.push({
        envId: env.id,
        nodeId: node.id,
        multiaddrs: orderDialable(
          (node.multiaddrs ?? node.currentAddrs ?? []).map((a) =>
            a.includes('/p2p/') ? a : `${a}/p2p/${node.id}`
          )
        ),
        consumerAddress: env.consumerAddress,
        label: node.friendlyName ?? node.id,
        resources: env.resources ?? undefined,
        fees: env.fees,
        feeTokens
      })
    }
  }

  return result
}

export async function fetchComputeJobs(address: string): Promise<IncentiveJob[]> {
  const sort = JSON.stringify({ dateCreated: 'desc' })
  const url =
    `${INCENTIVE_API_ROOT}/owners/${address}/computeJobs` +
    `?page=1&size=100&sort=${encodeURIComponent(sort)}`

  const resp = await globalThis.fetch(url)

  if (!resp.ok) {
    throw new Error(`fetchComputeJobs: HTTP ${resp.status}`)
  }

  const data: { computeJobs: ComputeJob[] } = await resp.json()

  return (data.computeJobs ?? []).map((job) => ({
    jobId: job.jobId,
    statusText: job.statusText,
    isRunning: job.isRunning,
    isFree: job.isFree,
    environment: job.environment,
    cost: job.payment?.cost,
    dateCreated: Number(job.dateCreated),
    dateFinished: Number(job.dateFinished) || undefined,
    outputsURL: job.outputsURL
  }))
}

export async function requestJobRefresh(address: string, jobId: string): Promise<void> {
  try {
    await globalThis.fetch(
      `${INCENTIVE_API_ROOT}/owners/${address}/computeJobs/${jobId}/refresh`,
      { method: 'POST' }
    )
  } catch {
  }
}
