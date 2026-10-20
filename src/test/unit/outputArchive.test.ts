import * as assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as tar from 'tar'
import {
  extractOutputArchive,
  isOutputResult,
  nextOutputPrefix,
  outputArchiveExtension
} from '../../helpers/outputArchive'

const ZIP = Buffer.from(
  'UEsDBBQAAAAAAAAAIQCGphA2BQAAAAUAAAAKAAAAcmVzdWx0LnR4dGhlbGxvUEsDBBQAAAAAAAAAIQDpwsmqBgAAAAYAAAAPAAAAbmVzdGVkL2RhdGEudHh0bmVzdGVkUEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAGAAAAZW1wdHkvUEsBAhQDFAAAAAAAAAAhAIamEDYFAAAABQAAAAoAAAAAAAAAAAAAAKSBAAAAAHJlc3VsdC50eHRQSwECFAMUAAAAAAAAACEA6cLJqgYAAAAGAAAADwAAAAAAAAAAAAAApIEtAAAAbmVzdGVkL2RhdGEudHh0UEsBAhQDFAAAAAAAAAAhAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAO1BYAAAAGVtcHR5L1BLBQYAAAAAAwADAKkAAACEAAAAAAA=',
  'base64'
)
const UNSAFE_ZIP = Buffer.from(
  'UEsDBBQAAAAAAAAAIQCOsOglBgAAAAYAAAANAAAALi4vZXNjYXBlLnR4dGVzY2FwZVBLAQIUAxQAAAAAAAAAIQCOsOglBgAAAAYAAAANAAAAAAAAAAAAAACkgQAAAAAuLi9lc2NhcGUudHh0UEsFBgAAAAABAAEAOwAAADEAAAAAAA==',
  'base64'
)
const SYMLINK_ZIP = Buffer.from(
  'UEsDBBQAAAAAAAAAIQAuxLsKBAAAAAQAAAAEAAAAbGluay90bXBQSwECFAMUAAAAAAAAACEALsS7CgQAAAAEAAAABAAAAAAAAAAAAAAA/6EAAAAAbGlua1BLBQYAAAAAAQABADIAAAAmAAAAAAA=',
  'base64'
)
const EMPTY_ZIP = Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64')

// Static ZIP fixtures keep the tests independent of the node repository and ZIP writers.
suite('compute output archives', () => {
  let folder: string
  setup(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-outputs-'))
  })
  teardown(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  })

  test('selects ZIP and legacy TAR outputs by type, excluding logs', () => {
    assert.ok(isOutputResult({ type: 'output' }))
    assert.ok(!isOutputResult({ type: 'algorithmLog' }))
    assert.ok(!isOutputResult({}))
    assert.strictEqual(outputArchiveExtension('outputs.zip'), '.zip')
    assert.strictEqual(outputArchiveExtension('outputs.tar'), '.tar')
    assert.throws(() => outputArchiveExtension('image.log'), /Unsupported output archive/)
  })

  test('extracts ZIP contents, nested files and empty directories', async () => {
    const file = path.join(folder, 'outputs.zip')
    const out = path.join(folder, 'out')
    fs.writeFileSync(file, ZIP)
    await extractOutputArchive(file, out)
    assert.strictEqual(fs.readFileSync(path.join(out, 'result.txt'), 'utf8'), 'hello')
    assert.strictEqual(
      fs.readFileSync(path.join(out, 'nested/data.txt'), 'utf8'),
      'nested'
    )
    assert.ok(fs.statSync(path.join(out, 'empty')).isDirectory())
    assert.ok(!fs.existsSync(path.join(out, 'outputs')))
  })

  test('extracts historical TAR with its original outputs directory', async () => {
    const source = path.join(folder, 'source')
    fs.mkdirSync(path.join(source, 'outputs'), { recursive: true })
    fs.writeFileSync(path.join(source, 'outputs/result.txt'), 'legacy')
    const file = path.join(folder, 'outputs.tar')
    await tar.c({ file, cwd: source }, ['outputs'])
    const out = path.join(folder, 'out')
    await extractOutputArchive(file, out)
    assert.strictEqual(
      fs.readFileSync(path.join(out, 'outputs/result.txt'), 'utf8'),
      'legacy'
    )
  })

  test('accepts an empty ZIP', async () => {
    const file = path.join(folder, 'outputs.zip')
    fs.writeFileSync(file, EMPTY_ZIP)
    await extractOutputArchive(file, path.join(folder, 'out'))
    assert.deepStrictEqual(fs.readdirSync(path.join(folder, 'out')), [])
  })

  test('rejects truncated archives', async () => {
    const file = path.join(folder, 'outputs.zip')
    fs.writeFileSync(file, ZIP.subarray(0, 80))
    await assert.rejects(extractOutputArchive(file, path.join(folder, 'out')))
  })

  test('rejects ZIP traversal and symlink entries', async () => {
    for (const data of [UNSAFE_ZIP, SYMLINK_ZIP]) {
      const file = path.join(folder, 'outputs.zip')
      fs.writeFileSync(file, data)
      await assert.rejects(extractOutputArchive(file, path.join(folder, 'out')))
    }
    assert.ok(!fs.existsSync(path.join(folder, 'escape.txt')))
  })

  test('rejects pre-existing symlink directories and files', async () => {
    const file = path.join(folder, 'outputs.zip')
    const out = path.join(folder, 'out')
    const outside = path.join(folder, 'outside')
    fs.mkdirSync(out)
    fs.mkdirSync(outside)
    fs.writeFileSync(file, ZIP)
    fs.symlinkSync(outside, path.join(out, 'nested'), 'dir')
    await assert.rejects(extractOutputArchive(file, out), /Unsafe output directory/)
    assert.deepStrictEqual(fs.readdirSync(outside), [])
    fs.unlinkSync(path.join(out, 'nested'))
    fs.writeFileSync(path.join(outside, 'result.txt'), 'untouched')
    fs.unlinkSync(path.join(out, 'result.txt'))
    fs.symlinkSync(path.join(outside, 'result.txt'), path.join(out, 'result.txt'))
    await assert.rejects(extractOutputArchive(file, out), /Unsafe output file/)
    assert.strictEqual(
      fs.readFileSync(path.join(outside, 'result.txt'), 'utf8'),
      'untouched'
    )
  })

  test('chooses a new filename across ZIP and TAR downloads', () => {
    fs.writeFileSync(path.join(folder, 'result-output.tar'), '')
    fs.writeFileSync(path.join(folder, 'result-output(2).zip'), '')
    assert.strictEqual(nextOutputPrefix(folder, 'result-output'), 'result-output(3)')
  })
})
