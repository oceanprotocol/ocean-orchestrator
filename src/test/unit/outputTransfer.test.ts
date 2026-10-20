import * as assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as tar from 'tar'
import sinon from 'sinon'
import { ProviderInstance } from '@oceanprotocol/lib'
const mock = require('mock-require')
try {
  require('vscode')
} catch {
  mock('vscode', {})
}
const { saveOutput } = require('../../helpers/compute')
mock.stop('vscode')

const ZIP = Buffer.from(
  'UEsDBBQAAAAAAAAAIQCGphA2BQAAAAUAAAAKAAAAcmVzdWx0LnR4dGhlbGxvUEsDBBQAAAAAAAAAIQDpwsmqBgAAAAYAAAAPAAAAbmVzdGVkL2RhdGEudHh0bmVzdGVkUEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAGAAAAZW1wdHkvUEsBAhQDFAAAAAAAAAAhAIamEDYFAAAABQAAAAoAAAAAAAAAAAAAAKSBAAAAAHJlc3VsdC50eHRQSwECFAMUAAAAAAAAACEA6cLJqgYAAAAGAAAADwAAAAAAAAAAAAAApIEtAAAAbmVzdGVkL2RhdGEudHh0UEsBAhQDFAAAAAAAAAAhAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAO1BYAAAAGVtcHR5L1BLBQYAAAAAAwADAKkAAACEAAAAAAA=',
  'base64'
)

suite('compute output transfers', function () {
  this.timeout(10000)
  let folder: string
  setup(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-transfer-'))
  })
  teardown(() => {
    sinon.restore()
    fs.rmSync(folder, { recursive: true, force: true })
  })

  test('resumes a failed ZIP transfer, keeps extension and extracts only complete bytes', async () => {
    const offsets: number[] = []
    let calls = 0
    sinon
      .stub(ProviderInstance, 'getComputeResult')
      .callsFake(async (_node: any, _auth: any, _job: any, _index: any, offset = 0) => {
        offsets.push(offset)
        const first = calls++ === 0
        return (async function* () {
          if (first) {
            yield ZIP.subarray(0, 17)
            await new Promise((resolve) => setTimeout(resolve, 50))
            throw new Error('Test interrupted transfer')
          }
          yield ZIP.subarray(offset)
        })()
      })
    const file = await saveOutput(
      { multiaddresses: ['http://test-node.invalid'], authToken: 'test-token' },
      'job-1',
      3,
      folder,
      'result-output',
      undefined,
      ZIP.length,
      undefined,
      'job-folder',
      'outputs.zip'
    )
    assert.deepStrictEqual(offsets, [0, 17])
    assert.strictEqual(path.basename(file), 'result-output.zip')
    assert.deepStrictEqual(fs.readFileSync(file), ZIP)
    assert.strictEqual(
      fs.readFileSync(
        path.join(folder, 'job-folder/result-output_extracted/result.txt'),
        'utf8'
      ),
      'hello'
    )
  })

  test('downloads and extracts legacy TAR using metadata extension', async () => {
    const source = path.join(folder, 'source')
    fs.mkdirSync(path.join(source, 'outputs'), { recursive: true })
    fs.writeFileSync(path.join(source, 'outputs/result.txt'), 'legacy')
    const archive = path.join(folder, 'legacy.tar')
    await tar.c({ file: archive, cwd: source }, ['outputs'])
    const bytes = fs.readFileSync(archive)
    sinon.stub(ProviderInstance, 'getComputeResult').callsFake(async () =>
      (async function* () {
        yield bytes
      })()
    )
    const file = await saveOutput(
      { multiaddresses: ['http://test-node.invalid'], authToken: 'test-token' },
      'job-1',
      2,
      folder,
      'result-output',
      undefined,
      bytes.length,
      undefined,
      'job-folder',
      'outputs.tar'
    )
    assert.strictEqual(path.basename(file), 'result-output.tar')
    assert.strictEqual(
      fs.readFileSync(
        path.join(folder, 'job-folder/result-output_extracted/outputs/result.txt'),
        'utf8'
      ),
      'legacy'
    )
  })
})
