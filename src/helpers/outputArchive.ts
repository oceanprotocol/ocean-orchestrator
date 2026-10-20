import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import * as tar from 'tar'
import * as yauzl from 'yauzl'

export function isOutputResult(result: { type?: string }): boolean {
  return result.type === 'output'
}

export function outputArchiveExtension(filename: string): '.zip' | '.tar' {
  const extension = path.extname(filename).toLowerCase()
  if (extension !== '.zip' && extension !== '.tar') {
    throw new Error(`Unsupported output archive: ${filename}`)
  }
  return extension
}

export function nextOutputPrefix(dir: string, base: string): string {
  const exists = (prefix: string) =>
    ['.zip', '.tar'].some((extension) =>
      fs.existsSync(path.join(dir, prefix + extension))
    )
  if (!exists(base)) {
    return base
  }
  let n = 2
  while (exists(`${base}(${n})`)) {
    n++
  }
  return `${base}(${n})`
}

// Reject existing symlinks as well as links encoded in the archive. ZIP outputs from
// newer nodes contain only regular files/directories; older nodes still return TAR.
async function ensureDirectories(root: string, relative: string): Promise<void> {
  let current = root
  for (const part of relative
    .split(path.sep)
    .filter((part) => part !== '' && part !== '.')) {
    current = path.join(current, part)
    await fs.promises.mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error
      }
    })
    if (!(await fs.promises.lstat(current)).isDirectory()) {
      throw new Error(`Unsafe output directory: ${current}`)
    }
  }
}

export async function extractOutputArchive(
  file: string,
  destination: string
): Promise<void> {
  await fs.promises.mkdir(destination, { recursive: true })
  if (outputArchiveExtension(file) === '.tar') {
    await tar.x({ file, cwd: destination, strict: true })
    return
  }

  const root = await fs.promises.realpath(destination)
  const zip = await yauzl.openPromise(file, { strictFileNames: true })
  try {
    for await (const entry of zip.eachEntry()) {
      const target = path.resolve(root, entry.fileName)
      const relative = path.relative(root, target)
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(`Unsafe output archive entry: ${entry.fileName}`)
      }
      const mode = entry.externalFileAttributes >>> 16
      const type = mode & 0o170000
      if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
        throw new Error(`Unsupported output archive entry: ${entry.fileName}`)
      }
      if (entry.fileName.endsWith('/')) {
        await ensureDirectories(root, relative)
        continue
      }
      await ensureDirectories(root, path.dirname(relative))
      const existing = await fs.promises
        .lstat(target)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            throw error
          }
          return undefined
        })
      if (existing && !existing.isFile()) {
        throw new Error(`Unsafe output file: ${target}`)
      }
      const handle = await fs.promises.open(
        target,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_NOFOLLOW
      )
      try {
        if (type === 0o100000) {
          await handle.chmod(mode & 0o777)
        }
        const stream = await zip.openReadStreamPromise(entry)
        await pipeline(stream, handle.createWriteStream())
      } finally {
        await handle.close()
      }
    }
  } finally {
    zip.close()
  }
}
