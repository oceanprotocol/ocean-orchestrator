import * as assert from 'assert'
import { generateJobName } from '../../helpers/jobNames'

suite('jobNames helper', () => {
  test('generateJobName should return a string matching adjective-animal format', () => {
    const jobName = generateJobName()
    assert.match(jobName, /^[a-z]+-[a-z]+$/)
  })

  test('two calls to generateJobName can return different values', () => {
    // Generate multiple job names and verify they're not all identical
    const names = new Set<string>()
    for (let i = 0; i < 10; i++) {
      names.add(generateJobName())
    }
    // With 10 random samples from two dictionaries, we should get variation
    assert.ok(names.size > 1, 'Expected at least 2 unique names across 10 calls')
  })

  test('generateJobName returns lowercase only', () => {
    for (let i = 0; i < 5; i++) {
      const jobName = generateJobName()
      assert.strictEqual(jobName, jobName.toLowerCase())
    }
  })

  test('generateJobName has exactly one hyphen separator', () => {
    const jobName = generateJobName()
    const parts = jobName.split('-')
    assert.strictEqual(parts.length, 2)
    assert.ok(parts[0].length > 0)
    assert.ok(parts[1].length > 0)
  })
})
