import { ethers } from 'ethers'
import { EscrowContract } from '@oceanprotocol/lib'
import { getBaseRpcUrl, ESCROW_ADDRESS_BASE, SUPPORTED_TOKENS_BASE } from './constants'

export function formatUnitsToNumber(raw: bigint | string, decimals: number): number {
  return parseFloat(ethers.formatUnits(raw, decimals))
}

const decimalsCache = new Map<string, number>()

export async function getTokenDecimals(feeToken: string): Promise<number> {
  const lower = (feeToken || '').toLowerCase()
  const known = SUPPORTED_TOKENS_BASE.find((t) => t.address.toLowerCase() === lower)
  if (known) {
    return known.decimals
  }
  if (decimalsCache.has(lower)) {
    return decimalsCache.get(lower)!
  }
  const provider = new ethers.JsonRpcProvider(getBaseRpcUrl())
  const erc20 = new ethers.Contract(feeToken, ['function decimals() view returns (uint8)'], provider)
  const decimals = Number(await erc20.decimals())
  decimalsCache.set(lower, decimals)
  return decimals
}

const balanceCache = new Map<string, { value: number; at: number }>()
const BALANCE_TTL_MS = 5_000

export function invalidateEscrowBalance(): void {
  balanceCache.clear()
}

export async function getEscrowBalance(feeToken: string, payerAddress: string): Promise<number> {
  const key = `${(feeToken || '').toLowerCase()}|${(payerAddress || '').toLowerCase()}`
  const cached = balanceCache.get(key)
  if (cached && Date.now() - cached.at < BALANCE_TTL_MS) {
    return cached.value
  }

  const provider = new ethers.JsonRpcProvider(getBaseRpcUrl())

  const escrow = new EscrowContract(ESCROW_ADDRESS_BASE, provider as any, undefined)

  const funds = await escrow.getUserFunds(payerAddress, feeToken)
  const available: bigint = (funds?.available ?? funds?.[0] ?? BigInt(0)) as bigint

  const decimals = await getTokenDecimals(feeToken)

  const balance = formatUnitsToNumber(available, decimals)
  balanceCache.set(key, { value: balance, at: Date.now() })
  return balance
}

export type NodeAuthReason = 'ok' | 'none' | 'amount' | 'duration' | 'counts'
export type NodeAuthResult = { authorized: boolean; reason: NodeAuthReason; count: number }

const authCache = new Map<string, { value: any[]; at: number }>()
const AUTH_TTL_MS = 5_000

export function invalidateEscrowAuth(): void {
  authCache.clear()
}

export async function getNodeAuthorization(
  feeToken: string,
  payer: string,
  payee: string,
  amountWei?: string,
  minLockSeconds?: number
): Promise<NodeAuthResult> {
  const key = `${(feeToken || '').toLowerCase()}|${(payer || '').toLowerCase()}|${(payee || '').toLowerCase()}`
  const cached = authCache.get(key)
  let auths: any[]
  if (cached && Date.now() - cached.at < AUTH_TTL_MS) {
    auths = cached.value
  } else {
    const provider = new ethers.JsonRpcProvider(getBaseRpcUrl())
    const escrow = new EscrowContract(ESCROW_ADDRESS_BASE, provider as any, undefined)
    auths = (await escrow.getAuthorizations(feeToken, payer, payee)) as any[]
    authCache.set(key, { value: auths, at: Date.now() })
  }

  const count = Array.isArray(auths) ? auths.length : 0
  if (count === 0) {
    return { authorized: false, reason: 'none', count }
  }
  const a = auths[0]
  const maxLockedAmount = BigInt(a.maxLockedAmount ?? a[1])
  const currentLockedAmount = BigInt(a.currentLockedAmount ?? a[2])
  const maxLockSeconds = BigInt(a.maxLockSeconds ?? a[3])
  const maxLockCounts = BigInt(a.maxLockCounts ?? a[4])
  const currentLocks = BigInt(a.currentLocks ?? a[5])

  if (amountWei != null && currentLockedAmount + BigInt(amountWei) > maxLockedAmount) {
    return { authorized: false, reason: 'amount', count }
  }
  if (minLockSeconds != null && maxLockSeconds < BigInt(Math.ceil(minLockSeconds))) {
    return { authorized: false, reason: 'duration', count }
  }
  if (currentLocks + BigInt(1) > maxLockCounts) {
    return { authorized: false, reason: 'counts', count }
  }
  return { authorized: true, reason: 'ok', count }
}

const symbolCache = new Map<string, string>()

export async function getTokenSymbol(feeToken: string): Promise<string> {
  const lower = (feeToken || '').toLowerCase()
  if (!lower) {
    return ''
  }
  const known = SUPPORTED_TOKENS_BASE.find((t) => t.address.toLowerCase() === lower)
  if (known) {
    return known.symbol
  }
  if (symbolCache.has(lower)) {
    return symbolCache.get(lower)!
  }
  try {
    const provider = new ethers.JsonRpcProvider(getBaseRpcUrl())
    const erc20 = new ethers.Contract(feeToken, ['function symbol() view returns (string)'], provider)
    const sym: string = await erc20.symbol()
    symbolCache.set(lower, sym)
    return sym
  } catch {
    return feeToken.slice(0, 6) + '…'
  }
}
