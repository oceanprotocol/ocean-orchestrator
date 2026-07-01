import { ProviderInstance } from '@oceanprotocol/lib'
import { EnvSummary } from '../types'
import { BASE_CHAIN_ID } from './constants'
import { formatUnitsToNumber as denominateCost, getTokenDecimals } from './escrow'

export { denominateCost }

type CostResult = { cost: number; minLockSeconds: number; amountWei: string }
const costCache = new Map<string, { value: CostResult; at: number }>()
const COST_TTL_MS = 60_000

export async function estimateCost(args: {
  env: EnvSummary
  resources: { id: string; amount: number }[]
  durationSeconds: number
  feeToken: string
}): Promise<CostResult> {
  const { env, resources, durationSeconds, feeToken } = args

  const validUntil = Math.max(1, Math.ceil(durationSeconds))
  const cleanResources = resources.map((r) => ({ id: r.id, amount: r.amount }))

  const cacheKey = `${env.envId}|${feeToken}|${validUntil}|${JSON.stringify(cleanResources)}`
  const cached = costCache.get(cacheKey)
  if (cached && Date.now() - cached.at < COST_TTL_MS) {
    return cached.value
  }

  const addrs = env.multiaddrs ?? []
  const nodeUri = addrs.find((a) => a.includes('/p2p/')) ?? addrs[0]
  if (!nodeUri) {
    throw new Error('estimateCost: selected environment has no node address')
  }

  const result = await ProviderInstance.initializeCompute(
    [],
    { meta: { rawcode: 'rawcode' } } as any,
    env.envId,
    feeToken,
    validUntil,
    nodeUri as any,
    env.consumerAddress,
    cleanResources,
    BASE_CHAIN_ID
  )

  if (!result.payment) {
    throw new Error('estimateCost: node returned no payment info — cannot estimate cost')
  }

  const status = (result as any).status
  if (Number(status?.httpStatus) >= 400) {
    throw new Error(`estimateCost: node error ${status.httpStatus}: ${status.error ?? 'unknown'}`)
  }

  const { amount, minLockSeconds } = result.payment

  const decimals = await getTokenDecimals(feeToken)

  const cost = denominateCost(String(amount), decimals)

  const value = { cost, minLockSeconds, amountWei: String(amount) }
  costCache.set(cacheKey, { value, at: Date.now() })
  return value
}
