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
  dateCreated: string
  dateFinished: string
  payment?: { token?: string; cost?: number } | null
  outputsURL?: string
  metadata?: { [key: string]: string | number | boolean }
}

function orderDialable(addrs: string[]): string[] {
  const rank = (a: string): number => {
    const ws = /\/ws(\/|$)/.test(a)
    const tls = /\/tls\//.test(a)
    if (ws && tls) return 0
    if (ws) return 1
    return 2
  }
  return [...addrs].sort((a, b) => rank(a) - rank(b))
}

export async function fetchPaidEnvironments(
  search?: string,
  size = 100
): Promise<EnvSummary[]> {
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
    pageSize: String(size),
    size: String(size),
    sort
  })
  if (search) {
    params.set('search', search)
  }

  const resp = await globalThis.fetch(`${INCENTIVE_API_ROOT}/envs?${params.toString()}`)
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

export async function fetchEnvById(envId: string): Promise<EnvSummary | undefined> {
  return (await fetchPaidEnvironments(envId, 5)).find((e) => e.envId === envId)
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
    dateCreated: Number(job.dateCreated) || 0,
    dateFinished: Number(job.dateFinished) || undefined,
    outputsURL: job.outputsURL,
    name: job.metadata?.name ? String(job.metadata.name) : undefined
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
