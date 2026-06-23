// Mock vscode before importing any helper that indirectly requires it.
const mockRequire = require('mock-require')
mockRequire('vscode', {
  workspace: {
    getConfiguration: () => ({ get: (_key: string, def: unknown) => def })
  }
})

import * as assert from 'assert'
import { denominateCost } from '../../helpers/cost'

suite('cost helper', () => {
  suite('denominateCost', () => {
    test('1000000 string with 6 decimals equals 1', () => {
      assert.strictEqual(denominateCost('1000000', 6), 1)
    })

    test('2400000 string with 6 decimals equals 2.4', () => {
      assert.strictEqual(denominateCost('2400000', 6), 2.4)
    })

    test('BigInt(0) with 6 decimals equals 0', () => {
      assert.strictEqual(denominateCost(BigInt(0), 6), 0)
    })
  })
})
