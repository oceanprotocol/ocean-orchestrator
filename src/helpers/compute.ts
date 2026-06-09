import * as vscode from 'vscode'
import { stripAnsi } from './strip-ansi'
import fs from 'fs'
import path from 'path'
import * as tar from 'tar'
import {
  ComputeAlgorithm,
  ComputeAsset,
  ComputeEnvironment,
  ComputeJob,
  ComputeResourceRequest,
  ComputeResultStream,
  ExtendedMetadataAlgorithm,
  FileObjectType,
  ProviderInstance
} from '@oceanprotocol/lib'
import { fetchDdoByDid } from './indexer'
import { SelectedConfig } from '../types'
import { Signer } from 'ethers'
import { once } from 'events'
import { UnexpectedEOFError } from '@libp2p/utils'

function getNodeUri(multiaddresses: string[] | undefined): string {
  if (!multiaddresses?.length) throw new Error('No multiaddress configured')
  return multiaddresses[0]
}

const getContainerConfig = (
  fileExtension: string,
  dockerImage?: string,
  dockerTag?: string,
  dockerfile?: string,
  additionalDockerFiles?: {
    [key: string]: string
  }
): ExtendedMetadataAlgorithm['container'] => {
  if (dockerfile) {
    return {
      image: '',
      tag: '',
      entrypoint: fileExtension === 'py' ? 'python $ALGO' : 'node $ALGO',
      dockerfile,
      additionalDockerFiles,
      checksum: ''
    }
  }

  if (dockerImage) {
    return {
      image: dockerImage,
      tag: dockerTag || 'latest',
      entrypoint:
        fileExtension === 'py'
          ? 'python $ALGO'
          : fileExtension === 'js'
            ? 'node $ALGO'
            : '',
      dockerfile,
      additionalDockerFiles,
      checksum: ''
    }
  }

  switch (fileExtension) {
    case 'py':
      return {
        image: 'oceanprotocol/c2d_examples',
        tag: 'py-general',
        entrypoint: 'python $ALGO',
        dockerfile,
        additionalDockerFiles,
        checksum: ''
      }
    case 'js':
      return {
        image: 'oceanprotocol/c2d_examples',
        tag: 'js-general',
        entrypoint: 'node $ALGO',
        dockerfile,
        additionalDockerFiles,
        checksum: ''
      }
    default:
      throw new Error(
        'Cannot start job. Do you have a .py/.js file or a docker image in Setup section?'
      )
  }
}

export const getComputeAsset = async (
  multiaddresses: string[] | undefined,
  dataset?: string
) => {
  try {
    if (!dataset) {
      return []
    }

    const isDatasetDid = dataset?.startsWith('did:')
    if (isDatasetDid) {
      const ddo = await fetchDdoByDid(multiaddresses, dataset)
      return [{ documentId: dataset, serviceId: ddo.services[0].id }]
    }

    const isDatasetUrl = dataset?.startsWith('http')
    if (isDatasetUrl) {
      return [{ fileObject: { type: FileObjectType.URL, url: dataset, method: 'GET' } }]
    }

    const isDatasetIpfs = dataset?.startsWith('Qm')
    if (isDatasetIpfs) {
      return [{ fileObject: { type: FileObjectType.IPFS, hash: dataset } }]
    }

    const arweaveUrl = `https://arweave.net/${dataset}`
    const isDatasetUnknownArweave = await fetch(arweaveUrl)
    if (isDatasetUnknownArweave.status === 200) {
      return [
        { fileObject: { type: FileObjectType.URL, url: arweaveUrl, method: 'GET' } }
      ]
    }

    const ipfsUrl = `https://ipfs.io/ipfs/${dataset}`
    const isDatasetUnknownIpfs = await fetch(ipfsUrl)
    if (isDatasetUnknownIpfs.status === 200) {
      return [{ fileObject: { type: FileObjectType.URL, url: ipfsUrl, method: 'GET' } }]
    }

    return []
  } catch (e) {
    return []
  }
}

export async function stopComputeJob(
  multiaddresses: string[] | undefined,
  jobId: string,
  signerOrAuthToken: Signer | string | null
) {
  if (!signerOrAuthToken) throw new Error('No signer or auth token provided')
  return ProviderInstance.computeStop(jobId, getNodeUri(multiaddresses), signerOrAuthToken)
}

export function getDefaultResourcesFromFreeEnv(
  env: ComputeEnvironment
): ComputeResourceRequest[] {
  const freeResources = env?.free?.resources ?? []
  const result: ComputeResourceRequest[] = []

  const addIfExists = (key: string, amount: number) => {
    const resource = freeResources.find((r) =>
      r.id.toLowerCase().includes(key.toLowerCase())
    )
    if (resource) {
      result.push({ id: resource.id, amount })
    }
  }

  addIfExists('cpu', 1)
  addIfExists('ram', 1)
  addIfExists('disk', 1)
  addIfExists('gpu', 1)
  return result
}

export async function computeStart(
  config: SelectedConfig,
  algorithmContent: string,
  fileExtension: string,
  dataset?: string,
  dockerImage?: string,
  dockerTag?: string,
  dockerfile?: string,
  additionalDockerFiles?: {
    [key: string]: string
  },
  envVars?: {
    [key: string]: string
  },
  additionalAssets?: ComputeAsset[],
  outputBucketId?: string
): Promise<ComputeJob> {
  try {
    const container = getContainerConfig(
      fileExtension,
      dockerImage,
      dockerTag,
      dockerfile,
      additionalDockerFiles
    )
    const inputAssets = (await getComputeAsset(
      config.multiaddresses,
      dataset
    )) as ComputeAsset[]
    const datasets: ComputeAsset[] = [...inputAssets, ...(additionalAssets || [])]
    const algorithm: ComputeAlgorithm = {
      meta: {
        rawcode: algorithmContent,
        container
      } as ExtendedMetadataAlgorithm,
      envs: envVars
    }

    if (!config.environmentId) {
      throw new Error('No environment ID provided')
    }

    const uri = getNodeUri(config.multiaddresses)

    if (!config.isFreeCompute) {
      const computeJob = await ProviderInstance.computeStart(
        uri,
        config.authToken!,
        config.environmentId,
        datasets,
        algorithm,
        Number(config.jobDuration),
        config.feeToken!,
        config.resources!,
        config.chainId!,
        undefined, // metadata
        undefined, // additionalViewers
        undefined, // output
        undefined, // policyServer
        undefined, // signal
        undefined, // queueMaxWaitTime
        undefined, // dockerRegistryAuth
        outputBucketId
      )
      return Array.isArray(computeJob) ? computeJob[0] : computeJob
    }

    const computeJob = await ProviderInstance.freeComputeStart(
      uri,
      config.authToken!,
      config.environmentId,
      datasets,
      algorithm,
      config.resources,
      undefined, // metadata
      undefined, // additionalViewers
      undefined, // output
      undefined, // policyServer
      undefined, // signal
      undefined, // queueMaxWaitTime
      undefined, // dockerRegistryAuth
      outputBucketId
    )
    return Array.isArray(computeJob) ? computeJob[0] : computeJob
  } catch (e) {
    console.error('Compute start error: ', e)
    throw e
  }
}

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function checkComputeStatus(
  config: SelectedConfig,
  jobId: string
): Promise<ComputeJob> {
  try {
    const result = await ProviderInstance.computeStatus(
      getNodeUri(config.multiaddresses),
      config.authToken!,
      jobId
    )
    return Array.isArray(result) ? result[0] : result
  } catch (error) {
    throw new Error('Failed to check compute status')
  }
}

export async function getComputeResult(
  config: SelectedConfig,
  jobId: string,
  index: number = 0
): Promise<ComputeResultStream> {
  return ProviderInstance.getComputeResult(
    getNodeUri(config.multiaddresses),
    config.authToken!,
    jobId,
    index,
    0
  )
}

export async function streamToString(
  stream: ComputeResultStream
): Promise<string> {
  const decoder = new TextDecoder('utf-8')
  let result = ''
  for await (const chunk of stream) {
    result += decoder.decode(chunk, { stream: true })
  }
  return result
}

export async function saveResults(
  results: any,
  destinationFolder?: string,
  prefix: string = 'result'
): Promise<string> {
  try {
    const resultsDir =
      destinationFolder ||
      path.join(
        process.cwd(),
        'results',
        `results-${new Date().toISOString().slice(0, 16).replace(/[:.]/g, '-')}`
      )
    const logsDir = path.join(resultsDir, 'logs')

    if (!fs.existsSync(logsDir)) {
      await fs.promises.mkdir(logsDir, { recursive: true })
    }

    const fileName = `${prefix}.txt`
    const filePath = path.join(logsDir, fileName)

    await fs.promises.writeFile(filePath, results, 'utf-8')

    if (!fs.existsSync(filePath)) {
      throw new Error(`Failed to create file at ${filePath}`)
    }

    return filePath
  } catch (error) {
    console.error('Error saving results:', error)
    throw new Error(`Failed to save results: ${error.message}`)
  }
}

export async function getComputeLogs(
  config: SelectedConfig,
  jobId: string,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  try {
    outputChannel.show(true)
    const logs = await ProviderInstance.computeStreamableLogs(
      getNodeUri(config.multiaddresses),
      config.authToken!,
      jobId
    )

    const decoder = new TextDecoder('utf-8')
    for await (const chunk of logs) {
      outputChannel.append(stripAnsi(decoder.decode(chunk.subarray(), { stream: true })))
    }
  } catch (error) {
    console.error('Error fetching compute logs:', error)
  }
}

async function attemptSaveOutput(
  config: SelectedConfig,
  jobId: string,
  index: number,
  filePath: string,
  resultsDir: string,
  prefix: string,
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  totalSize?: number,
  cancelSignal?: AbortSignal
): Promise<string> {
  let fileHandle: fs.WriteStream | null = null
  let totalBytesWritten = 0

  try {
    let offset = 0
    try {
      const stat = await fs.promises.stat(filePath)
      offset = stat.size
    } catch {}

    console.log(`File path: ${filePath} (offset: ${offset})`)

    const contentStream = await ProviderInstance.getComputeResult(
      getNodeUri(config.multiaddresses),
      config.authToken!,
      jobId,
      index,
      offset
    )

    fileHandle = fs.createWriteStream(filePath, { flags: offset > 0 ? 'a' : 'w' })
    totalBytesWritten = offset

    try {
      for await (const bytes of contentStream) {
        if (cancelSignal?.aborted) throw new Error('Download cancelled')
        totalBytesWritten += bytes.length
        console.log(`Total bytes written: ${totalBytesWritten}`)
        if (onProgress) {
          onProgress(totalBytesWritten, totalSize ?? 0)
        }
        if (!fileHandle!.write(bytes)) {
          await new Promise<void>((resolve) => fileHandle!.once('drain', () => resolve()))
        }
      }
    } catch (e) {
      if (!(e instanceof UnexpectedEOFError)) {
        throw e
      }
    }

    fileHandle!.end()
    await once(fileHandle!, 'finish')

    const extractDir = path.join(resultsDir, `${prefix}_extracted`)
    await fs.promises.mkdir(extractDir, { recursive: true })

    await tar.x({
      file: filePath,
      cwd: extractDir,
      preservePaths: true
    })
    console.log(`Extracted contents to: ${extractDir}`)
    return filePath
  } catch (error: any) {
    console.log('--> Total bytes written:', totalBytesWritten)
    console.error('Error saving tar output:', error)
    throw new Error(`Failed to save tar output: ${error.message}`)
  } finally {
    if (fileHandle && !fileHandle.closed) {
      fileHandle.destroy()
    }
  }
}

export async function saveOutput(
  config: SelectedConfig,
  jobId: string,
  index: number,
  destinationFolder: string,
  prefix: string = 'output',
  onProgress?: (bytesWritten: number, totalBytes: number) => void,
  totalSize?: number,
  cancelSignal?: AbortSignal
): Promise<string> {
  const baseDir = destinationFolder || path.join(process.cwd(), 'results')
  const resultsDir = path.join(baseDir, jobId)
  const filePath = path.join(resultsDir, `${prefix}.tar`)
  await fs.promises.mkdir(resultsDir, { recursive: true })

  return withRetrial(() =>
    attemptSaveOutput(config, jobId, index, filePath, resultsDir, prefix, onProgress, totalSize, cancelSignal)
  )
}

export async function getComputeEnvironments(multiaddresses: string[] | undefined) {
  const environments = await ProviderInstance.getComputeEnvironments(getNodeUri(multiaddresses))
  if (!environments || environments.length === 0) {
    throw new Error('No compute environments available')
  }
  return environments
}

export async function generateAuthToken(
  multiaddresses: string[] | undefined,
  signer: Signer
) {
  return ProviderInstance.generateAuthToken(signer, getNodeUri(multiaddresses))
}

export async function withRetrial<T>(
  fn: () => Promise<T>,
  progress?: vscode.Progress<{ message?: string }>,
  maxRetries: number = 5,
  delay: number = 2000
): Promise<T> {
  let lastError: Error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries - 1) {
        throw lastError
      }

      const retryDelay = delay * Math.pow(2, attempt)
      if (progress) {
        progress.report({
          message: `Attempt ${attempt + 1} failed. Retry in ${retryDelay}ms...`
        })
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }
  }

  throw lastError!
}
