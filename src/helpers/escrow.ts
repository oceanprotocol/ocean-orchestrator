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
