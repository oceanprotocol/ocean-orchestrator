import * as assert from 'assert'
import { mergeJobs } from '../../helpers/jobStore'
import { LocalJobRecord, JobView } from '../../types'
import { IncentiveJob } from '../../types'

suite('jobStore — mergeJobs (pure)', () => {
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function makeLocal(overrides: Partial<LocalJobRecord> = {}): LocalJobRecord {
    return {
      jobId: 'local-job-1',
      name: 'My Test Job',
      envLabel: 'Local Env',
      createdAt: 1700000000,
      ...overrides
    }
  }

  function makeIncentive(overrides: Partial<IncentiveJob> = {}): IncentiveJob {
    return {
      jobId: 'incentive-job-1',
      statusText: 'Running',
      isRunning: true,
      isFree: false,
      environmentId: 'env-1',
      environment: 'Incentive Env',
      dateCreated: 1700000100,
      ...overrides
    }
  }

  // -----------------------------------------------------------------------
  // (a) local-only id → Queued (no status set) + isLocalOnly true
  // -----------------------------------------------------------------------
  test('local-only job gets status Queued and isLocalOnly true', () => {
    const local: LocalJobRecord[] = [makeLocal({ jobId: 'local-only-1' })]
    const result = mergeJobs(local, [])

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].jobId, 'local-only-1')
    assert.strictEqual(result[0].status, 'Queued')
    assert.strictEqual(result[0].isLocalOnly, true)
    assert.strictEqual(result[0].name, 'My Test Job')
  })

  test('local-only job with status Completed reflects Completed', () => {
    const local: LocalJobRecord[] = [makeLocal({ jobId: 'local-completed', status: 'Completed' })]
    const result = mergeJobs(local, [])

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].status, 'Completed')
    assert.strictEqual(result[0].isLocalOnly, true)
  })

  test('matched job: local Completed beats incentive Queued (most-progressed wins)', () => {
    const sharedId = 'rank-test-1'
    const local: LocalJobRecord[] = [makeLocal({ jobId: sharedId, status: 'Completed' })]
    const incentive: IncentiveJob[] = [
      makeIncentive({ jobId: sharedId, statusText: 'queued', isRunning: false })
    ]

    const result = mergeJobs(local, incentive)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].status, 'Completed')
  })

  test('matched job: incentive Completed beats local Running (most-progressed wins)', () => {
    const sharedId = 'rank-test-2'
    const local: LocalJobRecord[] = [makeLocal({ jobId: sharedId, status: 'Running' })]
    const incentive: IncentiveJob[] = [
      makeIncentive({ jobId: sharedId, statusText: 'completed', isRunning: false })
    ]

    const result = mergeJobs(local, incentive)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].status, 'Completed')
  })

  // -----------------------------------------------------------------------
  // (b) id in both → incentive status wins + local name preserved
  // -----------------------------------------------------------------------
  test('job in both sources uses incentive status and local name', () => {
    const sharedId = 'shared-job-1'
    const local: LocalJobRecord[] = [
      makeLocal({ jobId: sharedId, name: 'My Named Job', createdAt: 1700000000 })
    ]
    const incentive: IncentiveJob[] = [
      makeIncentive({
        jobId: sharedId,
        statusText: 'completed',
        isRunning: false,
        environment: 'Remote Env',
        dateCreated: 1700000000,
        dateFinished: 1700001000,
        outputsURL: 'https://example.com/results',
        cost: 0.5
      })
    ]

    const result = mergeJobs(local, incentive)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].status, 'Completed')
    assert.strictEqual(result[0].name, 'My Named Job')
    assert.strictEqual(result[0].isLocalOnly, false)
    assert.strictEqual(result[0].finishedAt, 1700001000)
    assert.strictEqual(result[0].outputsURL, 'https://example.com/results')
    assert.strictEqual(result[0].cost, 0.5)
    assert.strictEqual(result[0].envLabel, 'Remote Env')
  })

  // -----------------------------------------------------------------------
  // (c) incentive-only id → included, isLocalOnly false
  // -----------------------------------------------------------------------
  test('incentive-only job is included with isLocalOnly false', () => {
    const incentive: IncentiveJob[] = [
      makeIncentive({ jobId: 'incentive-only-1', statusText: 'Running', isRunning: true })
    ]

    const result = mergeJobs([], incentive)

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].jobId, 'incentive-only-1')
    assert.strictEqual(result[0].isLocalOnly, false)
    assert.strictEqual(result[0].status, 'Running')
  })

  // -----------------------------------------------------------------------
  // (d) status mapping cases
  // -----------------------------------------------------------------------
  const statusMappings: Array<{ statusText: string; isRunning: boolean; expected: JobView['status'] }> = [
    { statusText: 'running', isRunning: false, expected: 'Running' },
    { statusText: 'Running', isRunning: false, expected: 'Running' },
    { statusText: 'RUNNING', isRunning: false, expected: 'Running' },
    { statusText: 'completed', isRunning: false, expected: 'Completed' },
    { statusText: 'Completed', isRunning: false, expected: 'Completed' },
    { statusText: 'failed', isRunning: false, expected: 'Failed' },
    { statusText: 'Failed', isRunning: false, expected: 'Failed' },
    { statusText: 'timeout', isRunning: false, expected: 'Failed' },
    { statusText: 'Timeout', isRunning: false, expected: 'Failed' },
    { statusText: 'stopped', isRunning: false, expected: 'Stopped' },
    { statusText: 'Stopped', isRunning: false, expected: 'Stopped' },
    { statusText: 'pending', isRunning: false, expected: 'Queued' },
    { statusText: 'queued', isRunning: false, expected: 'Queued' },
    { statusText: 'provisioning', isRunning: false, expected: 'Queued' },
    { statusText: 'unknown-status', isRunning: false, expected: 'Queued' },
    // isRunning=true forces Running regardless of statusText
    { statusText: 'pending', isRunning: true, expected: 'Running' },
    { statusText: 'Finished', isRunning: true, expected: 'Running' }
  ]

  for (const { statusText, isRunning, expected } of statusMappings) {
    test(`statusText="${statusText}" isRunning=${isRunning} → ${expected}`, () => {
      const incentive: IncentiveJob[] = [
        makeIncentive({ jobId: 'status-test', statusText, isRunning })
      ]
      const result = mergeJobs([], incentive)

      assert.strictEqual(result[0].status, expected)
    })
  }

  // -----------------------------------------------------------------------
  // (e) sorted by createdAt descending
  // -----------------------------------------------------------------------
  test('results are sorted by createdAt descending', () => {
    const local: LocalJobRecord[] = [
      makeLocal({ jobId: 'j-early', createdAt: 1700000000 }),
      makeLocal({ jobId: 'j-mid', createdAt: 1700001000 })
    ]
    const incentive: IncentiveJob[] = [
      makeIncentive({ jobId: 'j-late', dateCreated: 1700002000 })
    ]

    const result = mergeJobs(local, incentive)

    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].jobId, 'j-late')
    assert.strictEqual(result[1].jobId, 'j-mid')
    assert.strictEqual(result[2].jobId, 'j-early')
  })

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------
  test('empty inputs return empty array', () => {
    assert.deepStrictEqual(mergeJobs([], []), [])
  })

  test('deduplication: same jobId in both does not produce duplicate entries', () => {
    const sharedId = 'dup-job'
    const local = [makeLocal({ jobId: sharedId })]
    const incentive = [makeIncentive({ jobId: sharedId })]

    const result = mergeJobs(local, incentive)
    assert.strictEqual(result.length, 1)
  })

  test('local envLabel used when incentive environment is empty string', () => {
    const sharedId = 'env-fallback-job'
    const local = [makeLocal({ jobId: sharedId, envLabel: 'My Local Env' })]
    const incentive = [makeIncentive({ jobId: sharedId, environment: '' })]

    const result = mergeJobs(local, incentive)
    assert.strictEqual(result[0].envLabel, 'My Local Env')
  })

  test('incentive-only job name falls back to jobId', () => {
    const incentive = [makeIncentive({ jobId: 'inc-only-fallback' })]
    const result = mergeJobs([], incentive)

    assert.strictEqual(result[0].name, 'inc-only-fallback')
  })
})
