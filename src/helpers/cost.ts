import { formatUnits } from 'ethers'
import { ProviderInstance } from '@oceanprotocol/lib'
import { EnvSummary } from '../types'
import { BASE_CHAIN_ID, SUPPORTED_TOKENS_BASE } from './constants'

export function denominateCost(amountRaw: string | bigint, decimals: number): number {
  return parseFloat(formatUnits(amountRaw, decimals))
}

export async function estimateCost(args: {
  env: EnvSummary
  resources: { id: string; amount: number }[]
  durationSeconds: number
  feeToken: string
}): Promise<{ cost: number; minLockSeconds: number }> {
  const { env, resources, durationSeconds, feeToken } = args

  const validUntil = Math.ceil(durationSeconds) < 1 ? 1 : Math.ceil(durationSeconds)

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
    resources,
    BASE_CHAIN_ID
  )

  if (!result.payment) {
    throw new Error('estimateCost: node returned no payment info — cannot estimate cost')
  }

  if ((result as any).status?.httpStatus !== undefined && (result as any).status?.httpStatus !== null && (result as any).status.httpStatus >= 400) {
    throw new Error(
      `estimateCost: node error ${(result as any).status.httpStatus}: ${(result as any).status.error ?? 'unknown'}`
    )
  }

  const { amount, minLockSeconds } = result.payment

  const tokenEntry = SUPPORTED_TOKENS_BASE.find(
    (t) => t.address.toLowerCase() === feeToken.toLowerCase()
  )
  const decimals = tokenEntry?.decimals ?? 18

  const cost = denominateCost(String(amount), decimals)

  return { cost, minLockSeconds }
}
