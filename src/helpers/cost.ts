import { ProviderInstance } from '@oceanprotocol/lib'
import { EnvSummary } from '../types'
import { BASE_CHAIN_ID } from './constants'
import { formatUnitsToNumber as denominateCost, getTokenDecimals } from './escrow'

export { denominateCost }

export async function estimateCost(args: {
  env: EnvSummary
  resources: { id: string; amount: number }[]
  durationSeconds: number
  feeToken: string
}): Promise<{ cost: number; minLockSeconds: number }> {
  const { env, resources, durationSeconds, feeToken } = args

  const validUntil = Math.max(1, Math.ceil(durationSeconds))

  const addrs = env.multiaddrs ?? []
  const nodeUri = addrs.find((a) => a.includes('/p2p/')) ?? addrs[0]
  if (!nodeUri) {
    throw new Error('estimateCost: selected environment has no node address')
  }

  const cleanResources = resources.map((r) => ({ id: r.id, amount: r.amount }))

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

  return { cost, minLockSeconds }
}
