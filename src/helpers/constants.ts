import * as vscode from 'vscode'
import addresses from '@oceanprotocol/contracts/addresses/address.json'

export const BASE_CHAIN_ID = 8453

const baseAddresses = Object.values(addresses).find(
  (c: any) => c && c.chainId === BASE_CHAIN_ID
) as { Escrow: string }

export const ESCROW_ADDRESS_BASE = baseAddresses.Escrow

export function getBaseRpcUrl(): string {
  return vscode.workspace
    .getConfiguration('ocean')
    .get<string>('baseRpcUrl', 'https://mainnet.base.org')
}

export const DASHBOARD_URL = 'https://dashboard.oncompute.ai'
export const INCENTIVE_API_ROOT = 'https://api.oncompute.ai'

export const SUPPORTED_TOKENS_BASE: { symbol: string; address: string; decimals: number }[] = [
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  { symbol: 'COMPY', address: '0x5494711392a67DA50D3bC7b1fcC2d1877cFaA4d2', decimals: 6 }
]

export function nodeFundingUrl(nodeId: string): string {
  return `${DASHBOARD_URL}/nodes/${nodeId}`
}

export function dashboardConnectUrl(): string {
  return `${DASHBOARD_URL}/run-job/environments`
}

export const defaultBootstrapAddresses = [
  '/ip4/212.146.66.248/tcp/30080/p2p/16Uiu2HAmTC7cW9fb5ooFUupm6sAkcRJHHLGhiq2Bor8CzAAwFJCo',
  '/dns4/node1.oceanprotocol.com/tcp/9000/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP',
  // '/dns4/node1.oceanprotocol.com/tcp/9001/ws/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP',
  // '/dns6/node1.oceanprotocol.com/tcp/9002/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP',
  // '/dns6/node1.oceanprotocol.com/tcp/9003/ws/p2p/16Uiu2HAmLhRDqfufZiQnxvQs2XHhd6hwkLSPfjAQg1gH8wgRixiP',
  '/dns4/node2.oceanprotocol.com/tcp/9000/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4',
  // '/dns4/node2.oceanprotocol.com/tcp/9001/ws/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4',
  // '/dns6/node2.oceanprotocol.com/tcp/9002/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4',
  // '/dns6/node2.oceanprotocol.com/tcp/9003/ws/p2p/16Uiu2HAmHwzeVw7RpGopjZe6qNBJbzDDBdqtrSk7Gcx1emYsfgL4',
  '/dns4/node3.oceanprotocol.com/tcp/9000/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U',
  // '/dns4/node3.oceanprotocol.com/tcp/9001/ws/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U',
  // '/dns6/node3.oceanprotocol.com/tcp/9002/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U',
  // '/dns6/node3.oceanprotocol.com/tcp/9003/ws/p2p/16Uiu2HAmBKSeEP3v4tYEPsZsZv9VELinyMCsrVTJW9BvQeFXx28U',
  '/dns4/node4.oceanprotocol.com/tcp/9000/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom'
  // '/dns4/node4.oceanprotocol.com/tcp/9001/ws/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom',
  // '/dns6/node4.oceanprotocol.com/tcp/9002/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom',
  // '/dns6/node4.oceanprotocol.com/tcp/9003/ws/p2p/16Uiu2HAmSTVTArioKm2wVcyeASHYEsnx2ZNq467Z4GMDU4ErEPom'
]
export const OPFNodes = [
  'https://node1.oceanprotocol.com:8000',
  'https://node2.oceanprotocol.com:8000',
  'https://node3.oceanprotocol.com:8000',
  'https://node4.oceanprotocol.com:8000'
]
