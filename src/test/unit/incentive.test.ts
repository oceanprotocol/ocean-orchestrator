// Mock vscode before importing any helper that indirectly requires it.
// constants.ts calls vscode.workspace.getConfiguration for getBaseRpcUrl().
const mockRequire = require('mock-require')
mockRequire('vscode', {
  workspace: {
    getConfiguration: () => ({ get: (_key: string, def: unknown) => def })
  }
})

import * as assert from 'assert'
import * as sinon from 'sinon'
import {
  fetchPaidEnvironments,
  fetchComputeJobs,
  requestJobRefresh
} from '../../helpers/incentive'
import {
  INCENTIVE_API_ROOT,
  BASE_CHAIN_ID,
  SUPPORTED_TOKENS_BASE
} from '../../helpers/constants'

suite('incentive helper', () => {
  let fetchStub: sinon.SinonStub

  setup(() => {
    fetchStub = sinon.stub(globalThis, 'fetch' as any)
  })

  teardown(() => {
    sinon.restore()
  })

  suite('fetchPaidEnvironments', () => {
    test('builds the exact URL with correct query params', async () => {
      const mockResponse = {
        envs: [],
        pagination: { total: 0, page: 1, pageSize: 50 }
      }
      fetchStub.resolves({
        ok: true,
        json: async () => mockResponse
      } as any)

      await fetchPaidEnvironments()

      assert.ok(fetchStub.calledOnce)
      const calledUrl: string = fetchStub.firstCall.args[0]

      const url = new URL(calledUrl)
      assert.strictEqual(url.origin + url.pathname, `${INCENTIVE_API_ROOT}/envs`)
      assert.strictEqual(url.searchParams.get('page'), '1')
      assert.strictEqual(url.searchParams.get('pageSize'), '50')

      const filters = JSON.parse(url.searchParams.get('filters')!)
      assert.strictEqual(filters.network.operator, 'eq')
      assert.strictEqual(filters.network.value, String(BASE_CHAIN_ID))
      assert.strictEqual(filters.feeToken.operator, 'in')
      assert.deepStrictEqual(
        filters.feeToken.value,
        SUPPORTED_TOKENS_BASE.map((t) => t.address)
      )

      const sort = JSON.parse(url.searchParams.get('sort')!)
      assert.strictEqual(sort.benchmarkTotalScore, 'desc')
    })

    test('flattens 2 nodes × N envs into EnvSummary[] with correct nodeId', async () => {
      const mockResponse = {
        envs: [
          {
            id: 'node-a',
            multiaddrs: ['/ip4/1.2.3.4/tcp/9000'],
            friendlyName: 'Node Alpha',
            computeEnvironments: {
              environments: [
                {
                  id: 'env-a1',
                  consumerAddress: '0xAAA',
                  fees: { '8453': [{ feeToken: '0xfee1', prices: [] }] },
                  resources: [{ id: 'cpu', amount: 1 }]
                },
                {
                  id: 'env-a2',
                  consumerAddress: '0xAAB',
                  fees: { '8453': [{ feeToken: '0xfee2', prices: [] }] },
                  resources: []
                }
              ]
            }
          },
          {
            id: 'node-b',
            multiaddrs: ['/ip4/5.6.7.8/tcp/9000'],
            friendlyName: undefined,
            computeEnvironments: {
              environments: [
                {
                  id: 'env-b1',
                  consumerAddress: '0xBBB',
                  fees: { '8453': [{ feeToken: '0xfee3', prices: [] }] },
                  resources: null
                }
              ]
            }
          }
        ],
        pagination: { total: 3, page: 1, pageSize: 50 }
      }

      fetchStub.resolves({ ok: true, json: async () => mockResponse } as any)

      const result = await fetchPaidEnvironments()

      assert.strictEqual(result.length, 3)

      // First env from node-a
      assert.strictEqual(result[0].envId, 'env-a1')
      assert.strictEqual(result[0].nodeId, 'node-a')
      // bare addrs get /p2p/<nodeId> appended so they are dialable
      assert.deepStrictEqual(result[0].multiaddrs, ['/ip4/1.2.3.4/tcp/9000/p2p/node-a'])
      assert.strictEqual(result[0].label, 'Node Alpha')
      assert.strictEqual(result[0].consumerAddress, '0xAAA')

      // Second env from node-a
      assert.strictEqual(result[1].envId, 'env-a2')
      assert.strictEqual(result[1].nodeId, 'node-a')

      // feeTokens extracted from Base chain entry
      assert.deepStrictEqual(result[0].feeTokens, ['0xfee1'])

      // Env from node-b — label falls back to nodeId when no friendlyName
      assert.strictEqual(result[2].envId, 'env-b1')
      assert.strictEqual(result[2].nodeId, 'node-b')
      assert.strictEqual(result[2].label, 'node-b')
    })

    test('orders WebSocket addrs before raw TCP (extension can only dial WS)', async () => {
      const mockResponse = {
        envs: [
          {
            id: 'node-ws',
            // Node advertises raw TCP first, then WS/WSS — as real nodes do.
            multiaddrs: [
              '/ip4/9.9.9.9/tcp/42003',
              '/ip4/9.9.9.9/tcp/42558/tls/sni/host.libp2p.direct/ws',
              '/ip4/9.9.9.9/tcp/42558/ws'
            ],
            friendlyName: 'WS Node',
            computeEnvironments: {
              environments: [
                {
                  id: 'env-ws',
                  consumerAddress: '0xCCC',
                  fees: { '8453': [{ feeToken: '0xfee1', prices: [] }] },
                  resources: []
                }
              ]
            }
          }
        ]
      }
      fetchStub.resolves({ ok: true, json: async () => mockResponse } as any)

      const result = await fetchPaidEnvironments()
      const addrs = result[0].multiaddrs!

      // WS/WSS addrs come first; the raw /tcp/ addr is last.
      assert.ok(/\/wss?\//.test(addrs[0]), 'first addr should be a WebSocket addr')
      assert.ok(addrs[addrs.length - 1].endsWith('/tcp/42003/p2p/node-ws'), 'raw TCP addr last')
    })
  })

  suite('fetchComputeJobs', () => {
    test('maps computeJobs payload to IncentiveJob[] (cost from payment.cost)', async () => {
      const address = '0x1234'
      const mockPayload = {
        computeJobs: [
          {
            jobId: 'job-1',
            statusText: 'Finished',
            status: 70,
            isRunning: false,
            isFree: false,
            environment: 'env-name',
            dateCreated: '1700000000',
            dateFinished: '1700001000',
            payment: { token: '0xfee1', cost: 0.5 },
            outputsURL: 'https://example.com/output'
          },
          {
            jobId: 'job-2',
            statusText: 'Running',
            status: 10,
            isRunning: true,
            isFree: true,
            environment: 'env-name-2',
            dateCreated: '1700002000',
            dateFinished: '0',
            payment: null,
            outputsURL: undefined
          }
        ],
        pagination: { total: 2, page: 1, size: 100 }
      }

      fetchStub.resolves({ ok: true, json: async () => mockPayload } as any)

      const result = await fetchComputeJobs(address)

      assert.strictEqual(result.length, 2)

      assert.strictEqual(result[0].jobId, 'job-1')
      assert.strictEqual(result[0].statusText, 'Finished')
      assert.strictEqual(result[0].isRunning, false)
      assert.strictEqual(result[0].isFree, false)
      assert.strictEqual(result[0].environment, 'env-name')
      assert.strictEqual(result[0].cost, 0.5)
      // string epoch-seconds from the backend are coerced to numbers
      assert.strictEqual(result[0].dateCreated, 1700000000)
      assert.strictEqual(result[0].dateFinished, 1700001000)
      assert.strictEqual(result[0].outputsURL, 'https://example.com/output')

      // payment null → cost undefined; dateFinished "0" → undefined
      assert.strictEqual(result[1].cost, undefined)
      assert.strictEqual(result[1].isRunning, true)
      assert.strictEqual(result[1].isFree, true)
      assert.strictEqual(result[1].dateFinished, undefined)
    })

    test('includes correct URL with address and sort param', async () => {
      const address = '0xABCD'
      fetchStub.resolves({ ok: true, json: async () => ({ computeJobs: [] }) } as any)

      await fetchComputeJobs(address)

      const calledUrl: string = fetchStub.firstCall.args[0]
      const url = new URL(calledUrl)

      assert.ok(calledUrl.includes(`/owners/${address}/computeJobs`))
      assert.strictEqual(url.searchParams.get('page'), '1')
      assert.strictEqual(url.searchParams.get('size'), '100')

      const sort = JSON.parse(url.searchParams.get('sort')!)
      assert.strictEqual(sort.dateCreated, 'desc')
    })
  })

  suite('requestJobRefresh', () => {
    test('resolves without throwing when fetch rejects', async () => {
      fetchStub.rejects(new Error('network failure'))

      await assert.doesNotReject(() => requestJobRefresh('0x1234', 'job-99'))
    })

    test('resolves without throwing when fetch returns non-2xx', async () => {
      fetchStub.resolves({ ok: false, status: 404 } as any)

      await assert.doesNotReject(() => requestJobRefresh('0x1234', 'job-99'))
    })
  })
})
