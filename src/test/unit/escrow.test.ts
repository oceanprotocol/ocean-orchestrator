// Mock vscode before importing any helper that indirectly requires it.
const mockRequire = require('mock-require')
mockRequire('vscode', {
  workspace: {
    getConfiguration: () => ({ get: (_key: string, def: unknown) => def })
  }
})

import * as assert from 'assert'
import { formatUnitsToNumber } from '../../helpers/escrow'

suite('escrow helper', () => {
  suite('formatUnitsToNumber', () => {
    test('1234500 (bigint) with 6 decimals equals 1.2345', () => {
      assert.strictEqual(formatUnitsToNumber(BigInt(1234500), 6), 1.2345)
    })

    test('"0" with 6 decimals equals 0', () => {
      assert.strictEqual(formatUnitsToNumber('0', 6), 0)
    })

    test('large value: 1_000_000_000_000 (bigint) with 6 decimals equals 1_000_000', () => {
      assert.strictEqual(formatUnitsToNumber(BigInt('1000000000000'), 6), 1_000_000)
    })
  })
})
