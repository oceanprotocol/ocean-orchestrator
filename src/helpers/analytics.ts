import * as vscode from 'vscode'
import { PostHog } from 'posthog-node'

const POSTHOG_API_KEY = 'phc_hD7bhooFbRUWqSWOvRAZiHv4tr6mYYgleeWGkQ52eWD'
const POSTHOG_HOST = 'https://eu.i.posthog.com'

// Capture native fetch before cross-fetch overrides globalThis.fetch in extension.ts
const nativeFetch = globalThis.fetch

let client: PostHog | null = null

export function initAnalytics(): void {
  client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST, fetch: nativeFetch })
}

export function identifyUser(walletAddress: string): void {
  if (!client) return
  client.identify({ distinctId: walletAddress })
}

export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  if (!client || !distinctId) return
  client.capture({
    distinctId,
    event,
    properties
  })
}

// Stage of the start-compute flow where a failure occurred. Shared vocabulary
// with the nodes-dashboard preflight stages so the funnel is queryable end-to-end.
export type ComputeStage =
  | 'auth_token'
  | 'read_files'
  | 'order_start'
  | 'polling'
  | 'results'

// Coarse classification of a compute failure. Kept identical to the dashboard's
// classifyError buckets so error_type is comparable across repos.
export type ComputeErrorType =
  | 'validation'
  | 'network'
  | 'provider'
  | 'auth'
  | 'insufficient_funds'
  | 'timeout'
  | 'oom'
  | 'user_rejected'
  | 'unknown'

export function classifyComputeError(error: unknown): ComputeErrorType {
  const err = error as Error | undefined
  const message = (err?.message ?? String(error ?? '')).toLowerCase()
  const name = (err?.name ?? '').toLowerCase()

  if (!message && !name) return 'unknown'
  if (message.includes('out of memory') || message.includes('oomkilled')) return 'oom'
  if (
    message.includes('insufficient') ||
    message.includes('not enough') ||
    message.includes('exceeds balance')
  )
    return 'insufficient_funds'
  if (
    message.includes('auth token') ||
    message.includes('authtoken') ||
    message.includes('unauthorized') ||
    message.includes('signature') ||
    message.includes('nonce')
  )
    return 'auth'
  if (
    message.includes('no multiaddress') ||
    message.includes('no environment id') ||
    message.includes('cannot start job') ||
    message.includes('invalid') ||
    message.includes('required')
  )
    return 'validation'
  if (message.includes('timeout') || message.includes('timed out') || name.includes('timeout'))
    return 'timeout'
  if (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    name.includes('fetcherror')
  )
    return 'network'
  if (
    message.includes('provider') ||
    message.includes('node') ||
    message.includes('status code') ||
    message.includes('http')
  )
    return 'provider'
  return 'unknown'
}

// Fires a structured `compute_job_failed` event so we can see *why* start-compute
// jobs fail, broken down by stage. Additive: keeps the historical `error` key.
export function trackComputeError(
  distinctId: string,
  params: {
    stage: ComputeStage
    error: unknown
    is_free_compute?: boolean
    environment_id?: string
    job_id?: string | null
    error_type?: ComputeErrorType
  }
): void {
  const { stage, error, is_free_compute, environment_id, job_id, error_type } = params
  const err = error as Error | undefined
  const message = err?.message ?? String(error)
  trackEvent(distinctId, 'compute_job_failed', {
    source: 'extension',
    stage,
    is_free_compute,
    environment_id,
    job_id: job_id ?? null,
    error: message, // historical key — preserved for existing insights/funnels
    reason: message,
    error_name: err?.name,
    error_type: error_type ?? classifyComputeError(error)
  })
}

export function trackP2PError(
  distinctId: string,
  error: unknown,
  context: string,
  extraProps?: Record<string, unknown>
): void {
  const err = error as Error | undefined
  trackEvent(distinctId, 'p2p_error', {
    context,
    message: err?.message ?? String(error),
    stack: err?.stack,
    name: err?.name,
    app_name: vscode.env.appName,
    vscode_version: vscode.version,
    node_version: process.versions.node,
    electron_version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    ...extraProps
  })
}

export async function shutdownAnalytics(): Promise<void> {
  if (!client) return
  await client.shutdown()
  client = null
}
