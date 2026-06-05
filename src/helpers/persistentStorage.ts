import * as fs from 'fs'
import {
  ProviderInstance,
  PersistentStorageAccessList,
  PersistentStorageBucket,
  PersistentStorageFileEntry,
  PersistentStorageObject
} from '@oceanprotocol/lib'
import { SelectedConfig } from '../types'

export class MissingDashboardConfigError extends Error {
  constructor() {
    super('Persistent storage requires dashboard handshake. Reconnect via dashboard.')
    this.name = 'MissingDashboardConfigError'
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Auth token expired. Reconnect via dashboard.')
    this.name = 'AuthExpiredError'
  }
}

export class FileTooLargeError extends Error {
  constructor() {
    super('File too large for node.')
    this.name = 'FileTooLargeError'
  }
}

function requireConfig(config: SelectedConfig): {
  nodeUri: string
  authToken: string
  address: string
  chainId: number
} {
  const nodeUri = config.multiaddresses?.[0]
  if (
    !nodeUri ||
    !config.authToken ||
    !config.address ||
    typeof config.chainId !== 'number'
  ) {
    throw new MissingDashboardConfigError()
  }
  return {
    nodeUri,
    authToken: config.authToken,
    address: config.address,
    chainId: config.chainId
  }
}

async function classify<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: any) => {
    const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : ''
    const status = err?.status ?? err?.httpStatus ?? err?.response?.status
    if (status === 401 || /unauthori[sz]ed|token.*expired|invalid token/.test(msg)) {
      throw new AuthExpiredError()
    }
    if (status === 413 || /too large|payload too large/.test(msg)) {
      throw new FileTooLargeError()
    }
    throw err
  })
}

export async function listBuckets(
  config: SelectedConfig,
  signal?: AbortSignal
): Promise<PersistentStorageBucket[]> {
  const { nodeUri, authToken, address } = requireConfig(config)
  return classify(
    ProviderInstance.getPersistentStorageBuckets(nodeUri, authToken, address, signal)
  )
}

export async function createBucket(
  config: SelectedConfig,
  accessLists: PersistentStorageAccessList[],
  label?: string,
  signal?: AbortSignal
): Promise<{
  bucketId: string
  owner: string
  accessList: PersistentStorageAccessList[]
  label?: string | null
}> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.createPersistentStorageBucket(
      nodeUri,
      authToken,
      { accessLists, label },
      signal
    )
  )
}

export async function renameBucket(
  config: SelectedConfig,
  bucketId: string,
  label: string | null,
  signal?: AbortSignal
): Promise<{ bucketId: string; label: string | null }> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.updatePersistentStorageBucket(
      nodeUri,
      authToken,
      bucketId,
      label,
      signal
    )
  )
}

export async function listFiles(
  config: SelectedConfig,
  bucketId: string,
  signal?: AbortSignal
): Promise<PersistentStorageFileEntry[]> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.listPersistentStorageFiles(nodeUri, authToken, bucketId, signal)
  )
}

export async function uploadFile(
  config: SelectedConfig,
  bucketId: string,
  fileName: string,
  content: AsyncIterable<Uint8Array>,
  signal?: AbortSignal
): Promise<PersistentStorageFileEntry> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.uploadPersistentStorageFile(
      nodeUri,
      authToken,
      bucketId,
      fileName,
      content,
      signal
    )
  )
}

export async function getFileObject(
  config: SelectedConfig,
  bucketId: string,
  fileName: string,
  signal?: AbortSignal
): Promise<PersistentStorageObject> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.getPersistentStorageFileObject(
      nodeUri,
      authToken,
      bucketId,
      fileName,
      signal
    )
  )
}

export async function deleteFile(
  config: SelectedConfig,
  bucketId: string,
  fileName: string,
  signal?: AbortSignal
): Promise<{ success: boolean }> {
  const { nodeUri, authToken } = requireConfig(config)
  return classify(
    ProviderInstance.deletePersistentStorageFile(
      nodeUri,
      authToken,
      bucketId,
      fileName,
      signal
    )
  )
}

export async function* fileToP2PStream(filePath: string): AsyncGenerator<Uint8Array> {
  const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    }
  } finally {
    stream.destroy()
  }
}
