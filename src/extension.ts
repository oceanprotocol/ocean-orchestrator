import * as vscode from 'vscode'
import { OceanProtocolViewProvider } from './viewProvider'
import { StoragePanel } from './storagePanel'
import { ConfigureJobPanel } from './configureJobPanel'
import * as fs from 'fs'
import * as path from 'path'
import fetch from 'cross-fetch'
import {
  checkComputeStatus,
  computeStart,
  delay,
  generateAuthToken,
  getComputeEnvironments,
  getDefaultResourcesFromFreeEnv,
  getComputeLogs,
  getComputeResult,
  saveOutput,
  saveResults,
  streamToString,
  stopComputeJob,
  withRetrial
} from './helpers/compute'
import { stripAnsi, stripControlChars } from './helpers/strip-ansi'
import { SelectedConfig } from './types'
import { ethers, Signer } from 'ethers'
import { checkAndReadFile, listDirectoryContents } from './helpers/path'
import * as persistentStorage from './helpers/persistentStorage'
import {
  MissingDashboardConfigError,
  AuthExpiredError,
  FileTooLargeError
} from './helpers/persistentStorage'
import * as mountRegistry from './helpers/persistentMountRegistry'
import * as outputBucketRegistry from './helpers/outputBucketRegistry'
import { StorageErrorCode } from './types'
import { DEFAULT_MULTIADDR } from './helpers/p2p'
import { ComputeAsset, ProviderInstance } from '@oceanprotocol/lib'
import {
  initAnalytics,
  identifyUser,
  trackEvent,
  trackP2PError,
  shutdownAnalytics
} from './helpers/analytics'
import { randomUUID } from 'crypto'
import {
  fetchPaidEnvironments,
  fetchEnvById,
  fetchComputeJobs,
  requestJobRefresh
} from './helpers/incentive'
import { estimateCost } from './helpers/cost'
import { getEscrowBalance, getTokenSymbol, invalidateEscrowBalance, getNodeAuthorization } from './helpers/escrow'
import { generateJobName, jobResultsFolderName } from './helpers/jobNames'
import {
  addLocalJob,
  updateLocalJobStatus,
  getLocalJobs,
  mergeJobs,
  getSelectedJobId,
  setSelectedJobId
} from './helpers/jobStore'
import { BASE_CHAIN_ID, escrowFundingUrl, dashboardConnectUrl, nodeDashboardUrl } from './helpers/constants'

// @oceanprotocol/lib bundles libp2p's browser user-agent helper which reads
// globalThis.navigator.userAgent. VSCode's extension host defines `navigator`
// as a getter that returns undefined (plain assignment throws "only a getter"),
// so we must redefine the property. Without this any P2P call throws
// "Cannot read properties of undefined (reading 'userAgent')".
if (!(globalThis as any).navigator?.userAgent) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'ocean-orchestrator' },
    writable: true,
    configurable: true
  })
}

globalThis.fetch = fetch

const outputChannel = vscode.window.createOutputChannel('Ocean Orchestrator')
let config: SelectedConfig = new SelectedConfig({
  isFreeCompute: true,
  multiaddresses: [DEFAULT_MULTIADDR]
})
let provider: OceanProtocolViewProvider
let anonymousId: string
let globalContext: vscode.ExtensionContext | undefined

function nodeConfig(nodeUri: string | undefined, authToken: string | undefined): SelectedConfig {
  return new SelectedConfig({ multiaddresses: nodeUri ? [nodeUri] : undefined, authToken })
}

let selectedProject: { algorithmPath: string; resultsFolderPath: string } | undefined
let pendingJobName: string | undefined
let lastEstimatedCost: number | undefined

export function setSelectedProject(p: { algorithmPath: string; resultsFolderPath: string } | undefined) {
  selectedProject = p
  globalContext?.globalState.update('ocean.selectedProject', p)
}

function isGpuResource(r: any): boolean {
  return (r?.type || '').toLowerCase() === 'gpu' || (r?.id || '').toLowerCase().includes('gpu')
}

// Must match the webview's GPU grouping key so requested and live GPUs line up.
const gpuGroupKey = (r: any): string => r?.description || r?.id

function mergeLiveInUse<T extends { id: string }>(resources: T[], liveResources: any[]): T[] {
  const liveById = new Map((liveResources || []).map((r: any) => [r.id, r]))
  return resources.map((r) => (liveById.get(r.id)?.inUse != null ? { ...r, inUse: liveById.get(r.id).inUse } : r))
}

async function liveEnvResources(
  multiaddrs: string[] | undefined,
  envId: string
): Promise<any[] | null> {
  try {
    const liveEnv = (await getComputeEnvironments(multiaddrs))?.find((le: any) => le.id === envId)
    return liveEnv?.resources ?? null
  } catch { /* fall back to incentive API data */ }
  return null
}

async function liveResourcesFor(
  env: { envId: string; multiaddrs?: string[]; resources?: any[] },
  multiaddrs?: string[]
): Promise<any[]> {
  const live = await liveEnvResources(multiaddrs ?? env.multiaddrs, env.envId)
  return live ? mergeLiveInUse(env.resources || [], live) : env.resources || []
}

async function pushEnvInfo() {
  if (!provider || !config.address || config.isFreeCompute || !config.environmentId || !config.feeToken) {
    provider?.sendMessage({ type: 'envInfo', cost: null, balance: null, symbol: '' })
    return
  }
  provider.sendMessage({ type: 'envInfo', loading: true })
  const symbol = await getTokenSymbol(config.feeToken).catch(() => '')
  let cost: number | null = null
  let balance: number | null = null
  let available: { id: string; max: number; inUse?: number }[] = []
  try {
    const env = await fetchEnvById(config.environmentId)
    if (env) {
      const merged = await liveResourcesFor(env, config.multiaddresses)
      available = merged.map((r: any) => ({ id: r.id, max: r.max ?? r.maximum ?? r.total, inUse: r.inUse }))
      const r = await estimateCost({
        env: { ...env, multiaddrs: config.multiaddresses ?? env.multiaddrs },
        resources: config.resources || [],
        durationSeconds: Number(config.jobDuration) || 3600,
        feeToken: config.feeToken
      })
      cost = r.cost
    }
  } catch (e) {
    console.error('pushEnvInfo: cost estimate failed', e)
  }
  try {
    balance = await getEscrowBalance(config.feeToken, config.address)
  } catch (e) {
    console.error('pushEnvInfo: escrow balance failed', e)
  }
  provider.sendMessage({ type: 'envInfo', cost, balance, symbol, available })
}

function currentMountScope(): mountRegistry.MountScope {
  return { nodeUri: config.multiaddresses?.[0], chainId: config.chainId }
}

function pushStorageConfigSnapshot() {
  StoragePanel.currentPanel?.sendMessage({
    type: 'configSnapshot',
    hasAuthToken: !!config.authToken,
    address: config.address,
    chainId: config.chainId,
    nodeUri: config.multiaddresses?.[0]
  })
  pushMountedSnapshot()
  pushOutputBucketSnapshot()
}

function pushOutputBucketSnapshot() {
  const scope = currentMountScope()
  const bucketId = outputBucketRegistry.get(scope) ?? null
  const bucketName = outputBucketRegistry.getName(scope) ?? null
  StoragePanel.currentPanel?.sendMessage({ type: 'outputBucketSnapshot', bucketId })
  provider?.sendMessage({ type: 'outputBucketUpdate', bucketId, bucketName })
}

function pushMountedSnapshot() {
  const entries = mountRegistry.getAll(currentMountScope())
  StoragePanel.currentPanel?.sendMessage({
    type: 'mountedSnapshot',
    entries
  })
  provider?.sendMessage({
    type: 'mountedUpdate',
    entries
  })
}

vscode.window.registerUriHandler({
  handleUri(uri: vscode.Uri) {
    const urlParams = new URLSearchParams(uri.query)
    const authToken = urlParams.get('authToken')
    const multiaddresses = urlParams.get('multiaddresses')
    const isFreeCompute = urlParams.get('isFreeCompute')
    const environmentId = urlParams.get('environmentId')
    const feeToken = urlParams.get('feeToken')
    const jobDuration = urlParams.get('jobDuration')
    const resources = urlParams.get('resources')
    const address = urlParams.get('address')
    const chainId = urlParams.get('chainId')
    vscode.window.showInformationMessage('Compute job configured successfully!')
    const isFreeComputeBoolean = isFreeCompute === 'true' ? true : false
    const chainIdNumber = chainId ? Number(chainId) : undefined

    const resourcesParsed = resources
      ? SelectedConfig.parseResources(resources)
      : undefined
    config.updateFields({
      authToken,
      address,
      multiaddresses: multiaddresses ? multiaddresses.split(',') : [DEFAULT_MULTIADDR],
      isFreeCompute: isFreeComputeBoolean,
      environmentId,
      feeToken,
      jobDuration,
      resources: resourcesParsed,
      chainId: chainIdNumber
    })
    ProviderInstance.setupP2P({ bootstrapPeers: config.multiaddresses }).catch(
      (e) => {
        console.error(e)
        trackP2PError(config.address || anonymousId, e, 'setupP2P_uriHandler', {
          multiaddr_count: config.multiaddresses?.length
        })
      }
    )
    console.log({ config })

    if (address) {
      identifyUser(address)
    }
    const configCount = (globalContext!.globalState.get<number>('configCount') ?? 0) + 1
    globalContext!.globalState.update('configCount', configCount)
    trackEvent(address || anonymousId, 'ide_config_received', {
      environment_id: environmentId,
      is_free_compute: isFreeComputeBoolean,
      chain_id: chainIdNumber,
      has_auth_token: !!authToken,
      config_count: configCount
    })

    provider?.notifyConfigUpdate(config)
    pushStorageConfigSnapshot()
    pushEnvInfo()
  }
})

export async function activate(context: vscode.ExtensionContext) {
  let savedSigner: Signer | null = null
  let savedJobId: string | null = null
  let onJobLifecycleEvent: (() => Promise<void>) | undefined
  const completedJobs = new Map<
    string,
    {
      archiveIndex: number | null
      archiveSize: number
      resultsFolderPath: string
      logResults: Array<{ index: number; filename: string }>
    }
  >()

  globalContext = context

  const savedProj = context.globalState.get<{ algorithmPath: string; resultsFolderPath: string }>('ocean.selectedProject')
  if (savedProj) {
    selectedProject = savedProj
  }

  anonymousId = context.globalState.get<string>('anonymousId') ?? ''
  if (!anonymousId) {
    anonymousId = randomUUID()
    context.globalState.update('anonymousId', anonymousId)
  }

  initAnalytics()

  const hasTrackedInstall = context.globalState.get<boolean>('hasTrackedInstall')
  if (!hasTrackedInstall) {
    trackEvent(anonymousId, 'extension_installed', {
      version: context.extension.packageJSON.version,
      ide: vscode.env.appName
    })
    context.globalState.update('hasTrackedInstall', true)
  }

  ProviderInstance.setupP2P({
    bootstrapPeers: config.multiaddresses
  }).catch((e) => {
    console.error(e)
    trackP2PError(anonymousId, e, 'setupP2P_activate', {
      multiaddr_count: config.multiaddresses?.length
    })
  })

  outputChannel.show()
  outputChannel.appendLine('Ocean Orchestrator is now active!')
  console.log('Ocean Orchestrator is now active!')

  try {
    provider = new OceanProtocolViewProvider(
      (event, props) => trackEvent(anonymousId, event, props),
      () => selectedProject
    )
    console.log('Created OceanProtocolViewProvider')

    const registration = vscode.window.registerWebviewViewProvider(
      OceanProtocolViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
    console.log('Registered webview provider')

    context.subscriptions.push(registration)
    console.log('Added registration to subscriptions')

    let testCommand = vscode.commands.registerCommand('ocean-protocol.test', () => {
      console.log('Test command executed')
      if (provider?.resolveWebviewView) {
        console.log('Webview is available')
      } else {
        console.log('Webview is not available')
      }
    })
    context.subscriptions.push(testCommand)

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'ocean-protocol.stopComputeJob',
        async (jobId?: string) => {
          // Stop the requested job (selected in the sidebar); fall back to the
          // session's own job when no id is passed.
          const targetId = jobId || savedJobId
          if (!targetId) {
            vscode.window.showErrorMessage('No job to stop')
            return
          }
          // Resolve the job's node + auth from its local record (same source the
          // status poller uses), so we can stop a specific job, not just the
          // session's. Fall back to the current config for the session's job.
          const localJob = getLocalJobs(context).find((j) => j.jobId === targetId)
          const nodeUri = localJob?.nodeUri ?? config.multiaddresses?.[0]
          const stopAuth = localJob?.authToken ?? config.authToken
          if (!nodeUri) {
            vscode.window.showErrorMessage('Cannot stop this job: its node is unknown.')
            return
          }
          try {
            await stopComputeJob([nodeUri], targetId, stopAuth || savedSigner)
            trackEvent(config.address!, 'compute_job_stopped', {
              job_id: targetId
            })
            vscode.window.showInformationMessage('Job stopped successfully')
          } catch (error) {
            // Stop failed: leave the job intact so status sync keeps tracking it.
            vscode.window.showErrorMessage('Failed to stop job')
            return
          }
          // Only clear session state + stop the timer when we stopped the
          // session's own job; otherwise just refresh the list.
          if (targetId === savedJobId) {
            savedJobId = null
            provider.sendMessage({ type: 'jobStopped' })
          }
          await updateLocalJobStatus(context, targetId, 'Stopped')
          onJobLifecycleEvent?.().catch(() => {})
        }
      )
    )
    let startComputeJob = vscode.commands.registerCommand(
      'ocean-protocol.startComputeJob',
      async (
        algorithmPath: string,
        resultsFolderPath: string,
        authToken: string | undefined,
        dataset?: string,
        dockerImage?: string,
        dockerTag?: string,
        environmentId?: string
      ) => {
        console.log('1. Starting compute job...')
        console.log('Dataset:', dataset)
        console.log('Algorithm path:', algorithmPath)
        console.log('Results folder path:', resultsFolderPath)
        console.log('Auth token:', authToken)
        console.log('Docker image:', dockerImage)
        console.log('Docker tag:', dockerTag)
        console.log('Environment ID:', environmentId)
        const missingParams = []
        !algorithmPath && missingParams.push('algorithm path')

        if (missingParams.length > 0) {
          vscode.window.showErrorMessage(
            `Missing required parameters: ${missingParams.join(', ')}`
          )
          return
        }

        let signer: ethers.HDNodeWallet
        if (!authToken || authToken === '') {
          try {
            if (!savedSigner) {
              signer = ethers.Wallet.createRandom()
              savedSigner = signer
              console.log('Generated new wallet address:', signer.address)
              vscode.window.showInformationMessage(
                `Using generated wallet with address: ${signer.address}`
              )
            } else {
              signer = savedSigner as ethers.HDNodeWallet
              console.log('Reusing existing wallet address:', signer.address)
            }
            authToken = await generateAuthToken(config.multiaddresses, signer)
            config.updateFields({ address: signer.address })
          } catch (error) {
            console.log(error)
            trackP2PError(config.address || anonymousId, error, 'generateAuthToken')
            vscode.window.showErrorMessage(
              'Error generating auth token. Please make sure you selected a valid node'
            )
            return
          }
        }

        config.updateFields({ authToken, environmentId })
        pushStorageConfigSnapshot()
        outputChannel.clear()
        provider.sendMessage({ type: 'jobLoading' })

        trackEvent(config.address!, 'compute_job_started', {
          is_free_compute: config.isFreeCompute,
          environment_id: config.environmentId,
          has_dataset: !!dataset,
          has_custom_docker: !!dockerImage,
          algorithm_language: algorithmPath.split('.').pop()?.toLowerCase()
        })

        const progressOptions = {
          location: vscode.ProgressLocation.Notification,
          title: pendingJobName ? `Compute Job: ${pendingJobName}` : 'Compute Job Status',
          cancellable: false
        }
        console.log('Progress options:', progressOptions)

        let startedJobId: string | null = null
        try {
          await vscode.window.withProgress(progressOptions, async (progress) => {
            progress.report({ message: 'Starting compute job...' })

            const algorithmContent = await fs.promises.readFile(algorithmPath, 'utf8')

            const fileExtension = algorithmPath.split('.').pop()?.toLowerCase()
            const algorithmDir = path.dirname(algorithmPath)

            const dockerfile = await checkAndReadFile(algorithmDir, 'Dockerfile')

            const directoryContents = await listDirectoryContents(algorithmDir)
            let additionalDockerFiles: { [key: string]: string } = {}

            for (const file of directoryContents) {
              if (file !== 'Dockerfile') {
                additionalDockerFiles[file] = await checkAndReadFile(algorithmDir, file)
              }
            }

            const envContent = await checkAndReadFile(algorithmDir, '.env')
            const envVars: Record<string, string> = {}
            if (envContent) {
              envContent.split('\n').forEach((line) => {
                const trimmed = line.trim()
                if (trimmed && !trimmed.startsWith('#')) {
                  const idx = trimmed.indexOf('=')
                  if (idx > 0) {
                    envVars[trimmed.substring(0, idx).trim()] = trimmed
                      .substring(idx + 1)
                      .trim()
                  }
                }
              })
            }

            const persistentAssets = await resolvePersistentMountAssets(progress)
            const outputBucketId = outputBucketRegistry.get(currentMountScope())

            // Re-resolve GPU ids against live node data so back-to-back jobs don't
            // reuse a GPU the previous job just locked.
            if (!config.isFreeCompute && config.environmentId && config.multiaddresses && config.resources) {
              let live: any[] | undefined
              try {
                live = (await getComputeEnvironments(config.multiaddresses))
                  ?.find((e: any) => e.id === config.environmentId)?.resources
              } catch { /* fetch failed — submit with the saved ids */ }
              if (live) config.updateFields({ resources: resolveAvailableGpuIds(config.resources, live) })
            }

            const computeResponse = await computeStart(
              config,
              algorithmContent,
              fileExtension,
              dataset,
              dockerImage,
              dockerTag,
              dockerfile,
              additionalDockerFiles,
              envVars,
              persistentAssets,
              outputBucketId,
              pendingJobName
            )
            console.log('Compute result received:', computeResponse)
            const jobId = computeResponse.jobId
            if (outputBucketId) {
              const outputBucketName =
                outputBucketRegistry.getName(currentMountScope()) || outputBucketId
              console.log(
                `Compute job started with ID: ${jobId}. Output bucket selected - results will be saved in bucket ${outputBucketName}. Existing files will be overwritten`
              )
            }
            savedJobId = jobId
            startedJobId = jobId
            const jobConfig = nodeConfig(config.multiaddresses?.[0], config.authToken)

            if (pendingJobName) {
              const envLabel = config.environmentId ?? 'unknown'
              await addLocalJob(context, {
                jobId,
                name: pendingJobName,
                envLabel,
                cost: lastEstimatedCost,
                createdAt: Date.now(),
                status: 'Running',
                nodeUri: config.multiaddresses?.[0],
                authToken: config.authToken,
                address: config.address
              })
              if (config.address) {
                requestJobRefresh(config.address, jobId).catch(() => { /* best-effort */ })
              }
              pendingJobName = undefined
            }

            trackEvent(config.address!, 'compute_job_created', {
              is_free_compute: config.isFreeCompute,
              environment_id: config.environmentId,
              job_id: jobId
            })

            provider.sendMessage({
              type: 'jobStarted',
              jobId: jobId
            })
            invalidateEscrowBalance() // funds were just locked — read fresh
            pushEnvInfo()
            // Patch the panel's availability locally instead of a fresh fetch.
            if (config.environmentId && config.resources) {
              ConfigureJobPanel.currentPanel?.sendMessage({
                type: 'resourcesConsumed',
                envId: config.environmentId,
                consumed: config.resources.map((r) => ({ id: r.id, amount: r.amount ?? 1 }))
              })
            }

            outputChannel.show()
            outputChannel.appendLine(`Starting compute job with ID: ${jobId}`)

            let logStreamStarted = false
            let lastStatusText: string | undefined

            while (true) {
              console.log('Checking job status...')
              const status = await withRetrial(
                () => checkComputeStatus(jobConfig, jobId),
                progress
              )
              console.log('Job status:', status)
              console.log('Status text:', status.statusText)
              progress.report({ message: `${status.statusText}` })
              // Only log status transitions to the channel — repeating the same
              // line every poll would interleave with the streaming algorithm logs.
              if (status.statusText !== lastStatusText) {
                outputChannel.appendLine(`Job status: ${status.statusText}`)
                lastStatusText = status.statusText
              }

              if (status.statusText.includes('Running algorithm') && !logStreamStarted) {
                logStreamStarted = true
                getComputeLogs(jobConfig, jobId, outputChannel)
                  .catch((err) => console.log('Log stream disconnected', err))
                  .finally(() => {
                    logStreamStarted = false
                  })
              }

              if (status?.terminationDetails?.OOMKilled === true) {
                const errorMessage = `Job failed: Out of memory. Exit code: ${status?.terminationDetails?.exitCode}`
                trackEvent(config.address!, 'compute_job_failed', {
                  is_free_compute: config.isFreeCompute,
                  environment_id: config.environmentId,
                  job_id: jobId,
                  error: 'OOMKilled'
                })
                vscode.window.showErrorMessage(errorMessage)
                outputChannel.appendLine(errorMessage)
                await updateLocalJobStatus(context, jobId, 'Failed')
                if (savedJobId === jobId) {
                  savedJobId = null
                }
                provider.sendMessage({ type: 'jobStopped' })
                onJobLifecycleEvent?.().catch(() => {})

                return
              }

              if (
                status.statusText.toLowerCase().includes('error') ||
                status.statusText.toLowerCase().includes('failed')
              ) {
                try {
                  const rec = getLocalJobs(context).find((j) => j.jobId === jobId)
                  await handleFailureLogsRetrieval(
                    jobConfig,
                    jobId,
                    status,
                    resultsFolderPath,
                    outputChannel,
                    progress,
                    jobResultsFolderName(rec?.name, rec?.createdAt, jobId)
                  )
                } catch (retrievalError) {
                  console.error('Error retrieving logs on failure:', retrievalError)
                }

                trackEvent(config.address!, 'compute_job_failed', {
                  is_free_compute: config.isFreeCompute,
                  environment_id: config.environmentId,
                  job_id: jobId,
                  error: status.statusText
                })
                await updateLocalJobStatus(context, jobId, 'Failed')
                if (savedJobId === jobId) {
                  savedJobId = null
                }
                provider.sendMessage({ type: 'jobStopped' })
                throw new Error(`Job failed with status: ${status.statusText}`)
              }

              if (status.dateFinished) {
                try {
                  console.log('Generating signature for request...')
                  progress.report({ message: 'Generating signature for request...' })
                  outputChannel.appendLine('Generating signature for request...')
                  const resultsLength = status.results.length
                  const archive = status.results.find((result) =>
                    result.filename.includes('.tar')
                  )
                  const resultsWithoutArchive = status.results.filter(
                    (result) => result.index !== archive?.index
                  )

                  if (completedJobs.size >= 50) {
                    completedJobs.delete(completedJobs.keys().next().value!)
                  }
                  completedJobs.set(jobId, {
                    archiveIndex: archive ? archive.index : null,
                    archiveSize: archive?.filesize ?? 0,
                    resultsFolderPath,
                    logResults: resultsWithoutArchive.map((r) => ({
                      index: r.index,
                      filename: r.filename
                    }))
                  })
                  trackEvent(config.address!, 'compute_job_completed', {
                    is_free_compute: config.isFreeCompute,
                    environment_id: config.environmentId,
                    job_id: jobId
                  })
                  if (savedJobId === jobId) {
                    savedJobId = null
                  }
                  await updateLocalJobStatus(context, jobId, 'Completed')
                  provider.sendMessage({ type: 'jobCompleted', jobId })
                  onJobLifecycleEvent?.().catch(() => {})
                  vscode.window.showInformationMessage(
                    'Job finished. Download results from the Download Results section.'
                  )
                  outputChannel.appendLine(
                    'Job finished. Download results from the Download Results section.'
                  )

                  break
                } catch (error) {
                  console.error('Error retrieving results:', error)
                  throw error
                }
              }
              await delay(5000) // Wait 5 seconds before checking again
            }
          })
        } catch (error) {
          console.error('Error details:', error)

          trackEvent(config.address!, 'compute_job_failed', {
            is_free_compute: config.isFreeCompute,
            environment_id: config.environmentId,
            job_id: startedJobId,
            error: error instanceof Error ? error.message : String(error)
          })

          if (startedJobId) {
            await updateLocalJobStatus(context, startedJobId, 'Failed')
          }
          if (savedJobId === startedJobId) {
            savedJobId = null
          }
          provider.sendMessage({ type: 'jobStopped' })
          onJobLifecycleEvent?.().catch(() => {})

          if (error instanceof Error && error.message) {
            vscode.window.showErrorMessage(error.message)
          } else {
            vscode.window.showErrorMessage('Something went wrong. Please try again.')
          }
        }
      }
    )
    context.subscriptions.push(startComputeJob)

    async function jobProbe(
      jobId: string,
      peerId?: string
    ): Promise<{ probe: SelectedConfig; name?: string; createdAt?: number } | null> {
      const localJob = getLocalJobs(context).find((j) => j.jobId === jobId)
      let nodeUri = localJob?.nodeUri ?? config.multiaddresses?.[0]
      // No local record of which node ran this job (older/incentive-only job)
      // — resolve its peer id to a dialable multiaddr via DHT.
      if (!localJob?.nodeUri && peerId) {
        try {
          nodeUri = await ProviderInstance.getMultiaddrFromPeerId(peerId)
        } catch { /* DHT lookup failed — fall back to the current node, if any */ }
      }
      if (!nodeUri) {
        return null
      }
      const probe = nodeConfig(nodeUri, localJob?.authToken ?? config.authToken)
      return { probe, name: localJob?.name, createdAt: localJob?.createdAt }
    }

    async function downloadJobLogs(jobId: string, peerId?: string) {
      const jp = await jobProbe(jobId, peerId)
      const resultsFolderPath = selectedProject?.resultsFolderPath
      if (!jp || !resultsFolderPath) {
        vscode.window.showErrorMessage(
          jp ? 'Open a project folder to download logs into.' : 'No node address available to download logs.'
        )
        return
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Downloading Logs', cancellable: false },
        async (progress) => {
          const status = await checkComputeStatus(jp.probe, jobId)
          const hasLogs = (status?.results ?? []).some((r: any) => !r.filename?.includes('.tar'))
          const folderName = jobResultsFolderName(jp.name, jp.createdAt, jobId)
          await handleFailureLogsRetrieval(
            jp.probe, jobId, status, resultsFolderPath, outputChannel, progress, folderName
          )
          vscode.window.showInformationMessage(
            hasLogs ? 'Logs saved to results folder.' : 'No logs available for this job.'
          )
        }
      )
    }

    async function saveJobResults(
      probe: SelectedConfig,
      jobId: string,
      folderName: string,
      resultsFolderPath: string,
      archiveIndex: number | null,
      archiveSize: number,
      logResults: Array<{ index: number; filename: string }>
    ) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading Results',
          cancellable: true
        },
        async (progress, token) => {
          const abortController = new AbortController()
          token.onCancellationRequested(() => abortController.abort())

          progress.report({ message: '0%' })
          let lastIncrement = 0
          const onDownloadProgress =
            archiveSize > 0
              ? (bytesWritten: number, totalBytes: number) => {
                  const pct = Math.min(100, Math.floor((bytesWritten / totalBytes) * 100))
                  progress.report({ message: `${pct}%`, increment: pct - lastIncrement })
                  lastIncrement = pct
                }
              : undefined
          try {
            const hasArchive = archiveIndex != null
            const totalFiles = logResults.length + (hasArchive ? 1 : 0)
            let filesDone = 0

            for (const log of logResults) {
              if (abortController.signal.aborted) break
              progress.report({ message: `Logs (${++filesDone}/${totalFiles})...` })
              await getAndSaveLogs(
                probe,
                jobId,
                log.index,
                log.filename,
                resultsFolderPath,
                undefined,
                folderName
              )
            }

            if (!abortController.signal.aborted) {
              if (archiveIndex != null) {
                const filePath = await saveOutput(
                  probe,
                  jobId,
                  archiveIndex,
                  resultsFolderPath,
                  'result-output',
                  onDownloadProgress,
                  archiveSize > 0 ? archiveSize : undefined,
                  abortController.signal,
                  folderName
                )
                outputChannel.appendLine(`Results saved to: ${filePath}`)
                vscode.window.showInformationMessage('Outputs available in results folder.')
              } else {
                outputChannel.appendLine(
                  'Results were written to the output bucket. Open Persistent Storage to view them.'
                )
                vscode.window.showInformationMessage(
                  'Results are in the output bucket — open Persistent Storage to view them.'
                )
              }
            }
          } catch (error) {
            if (abortController.signal.aborted) {
              outputChannel.appendLine('Download cancelled.')
            } else {
              throw error
            }
          }
        }
      )
    }

    async function downloadJobResultsOnDemand(jobId: string, peerId?: string): Promise<boolean> {
      const jp = await jobProbe(jobId, peerId)
      const resultsFolderPath = selectedProject?.resultsFolderPath
      if (!jp || !resultsFolderPath) {
        return false
      }
      let results: any[] = []
      try {
        const status = await checkComputeStatus(jp.probe, jobId)
        results = status?.results ?? []
      } catch (e) {
        outputChannel.appendLine(`Could not fetch results for ${jobId}: ${e}`)
        return false
      }
      if (results.length === 0) {
        return false
      }
      const archive = results.find((r: any) => r.filename?.includes('.tar'))
      const logResults = results
        .filter((r: any) => !r.filename?.includes('.tar'))
        .map((r: any) => ({ index: r.index, filename: r.filename }))
      await saveJobResults(
        jp.probe,
        jobId,
        jobResultsFolderName(jp.name, jp.createdAt, jobId),
        resultsFolderPath,
        archive ? archive.index : null,
        archive?.filesize ?? 0,
        logResults
      )
      return true
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'ocean-protocol.downloadResults',
        async (jobId: string, outputsURL?: string, status?: string, peerId?: string) => {
          const job = completedJobs.get(jobId)
          if (!job) {
            if (status === 'Failed') {
              await downloadJobLogs(jobId, peerId)
              return
            }
            if (await downloadJobResultsOnDemand(jobId, peerId)) {
              return
            }
            if (outputsURL) {
              let parsed: vscode.Uri | undefined
              try {
                parsed = vscode.Uri.parse(outputsURL, true)
              } catch {
                parsed = undefined
              }
              if (parsed && (parsed.scheme === 'http' || parsed.scheme === 'https')) {
                vscode.env.openExternal(parsed)
              } else {
                vscode.window.showErrorMessage('Job results are not available for download.')
              }
            } else {
              vscode.window.showInformationMessage('Results for this job are available in the dashboard.')
            }
            return
          }
          const jp = await jobProbe(jobId, peerId)
          await saveJobResults(
            jp?.probe ?? config,
            jobId,
            jobResultsFolderName(jp?.name, jp?.createdAt, jobId),
            job.resultsFolderPath,
            job.archiveIndex,
            job.archiveSize,
            job.logResults
          )
        }
      )
    )
    async function handleStoragePanelMessage(
      data: any,
      reply: (msg: any) => void
    ) {
      const requestId = data.requestId
      try {
        switch (data.type) {
          case 'openDashboard': {
            await vscode.env.openExternal(vscode.Uri.parse(dashboardConnectUrl()))
            return
          }
          case 'listBuckets': {
            const buckets = await persistentStorage.listBuckets(config)
            reply({ type: 'bucketsLoaded', requestId, buckets })
            return
          }
          case 'createBucket': {
            const bucket = await persistentStorage.createBucket(
              config,
              data.accessLists || [],
              data.label
            )
            reply({ type: 'bucketCreated', requestId, bucket })
            return
          }
          case 'renameBucket': {
            const result = await persistentStorage.renameBucket(
              config,
              data.bucketId,
              data.label || null
            )
            reply({
              type: 'bucketRenamed',
              requestId,
              bucketId: data.bucketId,
              label: result.label
            })
            return
          }
          case 'listFiles': {
            const files = await persistentStorage.listFiles(config, data.bucketId)
            reply({
              type: 'filesLoaded',
              requestId,
              bucketId: data.bucketId,
              files
            })
            return
          }
          case 'pickAndUploadFile': {
            const picked = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              openLabel: 'Upload'
            })
            if (!picked || !picked[0]) {
              reply({ type: 'uploadCancelled', requestId })
              return
            }
            const filePath = picked[0].fsPath
            const fileName = path.basename(filePath)
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Uploading ${fileName}`,
                cancellable: true
              },
              async (_progress, token) => {
                const ac = new AbortController()
                token.onCancellationRequested(() => ac.abort())
                const stream = persistentStorage.fileToP2PStream(filePath)
                const entry = await persistentStorage.uploadFile(
                  config,
                  data.bucketId,
                  fileName,
                  stream,
                  ac.signal
                )
                reply({
                  type: 'fileUploaded',
                  requestId,
                  bucketId: data.bucketId,
                  file: entry
                })
              }
            )
            return
          }
          case 'toggleMount': {
            mountRegistry.toggle(
              currentMountScope(),
              { bucketId: data.bucketId, fileName: data.fileName },
              !!data.mounted
            )
            pushMountedSnapshot()
            reply({
              type: 'mountToggled',
              requestId,
              bucketId: data.bucketId,
              fileName: data.fileName,
              mounted: !!data.mounted
            })
            return
          }
          case 'setOutputBucket': {
            outputBucketRegistry.set(
              currentMountScope(),
              data.bucketId || null,
              data.bucketName
            )
            pushOutputBucketSnapshot()
            reply({
              type: 'outputBucketSet',
              requestId,
              bucketId: data.bucketId || null
            })
            return
          }
          case 'deleteFile': {
            const confirmed = await vscode.window.showWarningMessage(
              `Delete "${data.fileName}" from bucket?`,
              { modal: true },
              'Delete'
            )
            if (confirmed !== 'Delete') {
              reply({ type: 'deleteCancelled', requestId })
              return
            }
            await persistentStorage.deleteFile(
              config,
              data.bucketId,
              data.fileName
            )
            mountRegistry.removeMany(currentMountScope(), [
              { bucketId: data.bucketId, fileName: data.fileName }
            ])
            pushMountedSnapshot()
            reply({
              type: 'fileDeleted',
              requestId,
              bucketId: data.bucketId,
              fileName: data.fileName
            })
            return
          }
        }
      } catch (err: any) {
        let code: StorageErrorCode = 'unknown'
        if (err instanceof AuthExpiredError) code = 'auth_expired'
        else if (err instanceof MissingDashboardConfigError) code = 'missing_config'
        else if (err instanceof FileTooLargeError) code = 'too_large'
        else if (err?.name === 'AbortError') code = 'network'
        const message = err?.message ?? String(err)
        reply({
          type: 'storageError',
          requestId,
          code,
          message,
          op: data.type
        })
        if (code === 'auth_expired') {
          vscode.window.showErrorMessage(
            'Auth token expired. Reconnect via dashboard.'
          )
        } else if (code === 'missing_config') {
          vscode.window.showErrorMessage(
            'Configure node via dashboard to enable persistent storage.'
          )
        } else {
          vscode.window.showErrorMessage(`Storage error: ${message}`)
        }
      }
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.openStoragePanel', () => {
        const panel = StoragePanel.open(context, async (data) => {
          await handleStoragePanelMessage(data, (msg: any) => panel.sendMessage(msg))
        })
        pushStorageConfigSnapshot()
      })
    )

    // Re-map requested GPUs to ids free right now (by model); throws if one is taken.
    function resolveAvailableGpuIds(requested: any[], liveResources: any[]): any[] {
      const isRequestedGpu = (r: any) => isGpuResource(r) && (r.amount ?? 0) > 0
      if (!requested.some(isRequestedGpu)) return requested
      const freeByModel = new Map<string, string[]>()
      for (const r of liveResources) {
        if (!isGpuResource(r) || (r.inUse ?? 0) > 0) continue
        const key = gpuGroupKey(r)
        ;(freeByModel.get(key) ?? freeByModel.set(key, []).get(key)!).push(r.id)
      }
      return requested.map((r) => {
        if (!isRequestedGpu(r)) return r
        const id = freeByModel.get(gpuGroupKey(r))?.shift()
        if (!id) throw new Error(`No free "${gpuGroupKey(r)}" GPU right now — lower the GPU count and try again.`)
        return { id, amount: 1, description: r.description }
      })
    }

    // Apply a paid-job selection from the Configure panel (shared by saveConfig
    // and runJob): resolve the env's node addr and update the live config.
    async function applyPaidConfigFromPanel(data: any) {
      const env = await fetchEnvById(data.envId)
      if (!env) {
        throw new Error('Selected environment is no longer available')
      }
      config.updateFields({
        environmentId: data.envId,
        multiaddresses: env.multiaddrs,
        feeToken: data.feeToken,
        chainId: BASE_CHAIN_ID,
        resources: data.resources,
        isFreeCompute: false,
        jobDuration: String(data.durationSeconds || 3600),
        dataset: data.dataset || undefined
      })
      provider?.notifyConfigUpdate(config)
    }

    async function handleConfigurePanelMessage(data: any, reply: (msg: any) => void) {
      const requestId = data.requestId
      try {
        switch (data.type) {
          case 'listEnvs': {
            const query = typeof data.query === 'string' ? data.query.trim() : ''
            const initial = !!data.initial
            const envs = await fetchPaidEnvironments(query || undefined, 50)
            if (initial && config.environmentId && !envs.some((e) => e.envId === config.environmentId)) {
              const anchor = await fetchEnvById(config.environmentId)
              if (anchor) envs.unshift(anchor)
            }
            reply({ type: 'envsLoaded', requestId, envs, query, initial })
            return
          }
          case 'refreshEnvResources': {
            let resources = await liveEnvResources(data.multiaddrs, data.envId)
            if (!resources) {
              const env = await fetchEnvById(data.envId)
              resources = env?.resources ?? null
            }
            reply({ type: 'envResourcesRefreshed', requestId, envId: data.envId, resources })
            return
          }
          case 'estimateCost': {
            const env = await fetchEnvById(data.envId)
            if (!env) {
              reply({ type: 'configureJobError', requestId, message: 'Environment not found' })
              return
            }
            // When estimating the currently-configured env, use the same node
            // addr the sidebar (pushEnvInfo) uses so cost matches exactly.
            const envForEstimate =
              data.envId === config.environmentId
                ? { ...env, multiaddrs: config.multiaddresses ?? env.multiaddrs }
                : env
            const result = await estimateCost({
              env: envForEstimate,
              resources: data.resources || [],
              durationSeconds: data.durationSeconds || 3600,
              feeToken: data.feeToken
            })
            lastEstimatedCost = result.cost
            reply({
              type: 'costEstimated',
              requestId,
              cost: result.cost,
              minLockSeconds: result.minLockSeconds,
              amountWei: result.amountWei
            })
            return
          }
          case 'getEscrowBalance': {
            if (!config.address) {
              reply({ type: 'balanceResult', requestId, balance: 0, noAddress: true })
              return
            }
            const balance = await getEscrowBalance(data.feeToken, config.address)
            reply({ type: 'balanceResult', requestId, balance })
            ConfigureJobPanel.currentPanel?.sendMessage({
              type: 'balanceUpdated',
              balance,
              feeToken: data.feeToken
            })
            return
          }
          case 'saveConfig': {
            // GPU ids are re-resolved at submit time (startComputeJob), not here.
            await applyPaidConfigFromPanel(data)
            pushEnvInfo()
            reply({ type: 'configSaved', requestId })
            return
          }
          case 'openFunding': {
            vscode.env.openExternal(vscode.Uri.parse(escrowFundingUrl()))
            reply({ type: 'fundingOpened', requestId })
            return
          }
          case 'copyNodeId': {
            await vscode.env.clipboard.writeText(String(data.nodeId || ''))
            reply({ type: 'nodeIdCopied', requestId })
            return
          }
          case 'checkEnvAuth': {
            if (config.isFreeCompute || !config.address) {
              reply({ type: 'envAuthChecked', requestId, envId: data.envId, authorized: true, reason: 'ok', count: 0 })
              return
            }
            const env = await fetchEnvById(data.envId)
            if (!env) {
              reply({ type: 'envAuthChecked', requestId, envId: data.envId, authorized: false, reason: 'none', count: 0 })
              return
            }
            const res = await getNodeAuthorization(
              data.feeToken || config.feeToken,
              config.address,
              env.consumerAddress,
              data.amountWei,
              data.minLockSeconds
            )
            reply({ type: 'envAuthChecked', requestId, envId: data.envId, ...res })
            return
          }
          case 'openNodeDashboard': {
            vscode.env.openExternal(vscode.Uri.parse(nodeDashboardUrl(data.nodeId)))
            reply({ type: 'nodeDashboardOpened', requestId })
            return
          }
          case 'mountFromStorage':
          case 'openStorage': {
            vscode.commands.executeCommand('ocean-protocol.openStoragePanel')
            reply({ type: 'storageOpened', requestId })
            return
          }
        }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        reply({ type: 'configureJobError', requestId, message, op: data.type })
        vscode.window.showErrorMessage(`Configure Job error: ${message}`)
      }
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.openConfigureJob', () => {
        const panel = ConfigureJobPanel.open(context, async (data) => {
          if (data.type === '_pollBalance') {
            return
          }
          await handleConfigurePanelMessage(data, (msg: any) => panel.sendMessage(msg))
        })
        const resourceAmount = (id: string) =>
          config.resources?.find((r) => r.id === id)?.amount
        panel.sendMessage({
          type: 'configSnapshot',
          connected: !!config.authToken,
          address: config.address,
          nodeId: config.multiaddresses?.[0],
          // Pre-select the currently-configured job so the panel reflects it.
          environmentId: config.environmentId,
          feeToken: config.feeToken,
          resources: {
            cpu: resourceAmount('cpu'),
            ram: resourceAmount('ram'),
            disk: resourceAmount('disk')
          },
          // Only GPUs the user actually selected (amount > 0) are pre-checked;
          // the env may expose GPUs at amount 0 (offered but not selected).
          gpuIds: (config.resources || [])
            .filter((r) => !['cpu', 'ram', 'disk'].includes(r.id) && (r.amount ?? 0) > 0)
            .map((r) => r.id),
          durationSeconds: config.jobDuration ? Number(config.jobDuration) : undefined,
          dataset: config.dataset
        })
      })
    )

    function localJobsForAddress() {
      if (!config.address) {
        return []
      }
      return getLocalJobs(context).filter((j) => j.address === config.address)
    }

    async function loadJobs() {
      const inc = config.address ? await fetchComputeJobs(config.address).catch(() => []) : []
      const merged = mergeJobs(localJobsForAddress(), inc)
      provider?.sendMessage({
        type: 'jobsLoaded',
        jobs: merged,
        selectedJobId: getSelectedJobId(context)
      })
    }

    onJobLifecycleEvent = async () => {
      invalidateEscrowBalance() // job settled/stopped/failed — balance changed
      await loadJobs()
      await pushEnvInfo()
    }

    const TERMINAL_STATUSES = ['Completed', 'Failed', 'Stopped']
    let syncingStatuses = false
    async function syncJobStatuses() {
      if (syncingStatuses) {
        return
      }
      syncingStatuses = true
      try {
        // Free jobs can run up to 2h and paid jobs longer; keep polling
        // non-terminal jobs well past that so they don't get stuck after reload.
        const cutoff = Date.now() - 24 * 60 * 60 * 1000
        const pollable = localJobsForAddress().filter(
          (j) => j.createdAt > cutoff && !TERMINAL_STATUSES.includes(j.status ?? '')
        )
        if (pollable.length === 0) {
          return
        }
        let changed = false
        for (const job of pollable) {
          const nodeUri = job.nodeUri ?? config.multiaddresses?.[0]
          if (!nodeUri) {
            continue
          }
          try {
            const probe = nodeConfig(nodeUri, job.authToken ?? config.authToken)
            const st = await checkComputeStatus(probe, job.jobId)
            // Ocean C2D status codes: <10 = queued (0 started, 1 queued),
            // >=70 = finished, in between = actively running (pulling/building/
            // provisioning/running). Use the code, not the phrase — statusText
            // like "Building algorithm image" doesn't contain the word "running".
            const text = (st?.statusText ?? '').toLowerCase()
            const code = st?.status ?? 0
            let mapped: string
            if (text.includes('fail') || text.includes('error')) {
              mapped = 'Failed'
            } else if (st?.dateFinished || code >= 70) {
              mapped = 'Completed'
            } else if (code >= 10) {
              mapped = 'Running'
            } else {
              mapped = 'Queued'
            }
            if (mapped !== job.status) {
              await updateLocalJobStatus(context, job.jobId, mapped)
              changed = true
            }
          } catch {
          }
        }
        if (changed) {
          await loadJobs()
        }
      } finally {
        syncingStatuses = false
      }
    }
    const statusSyncTimer = setInterval(() => {
      syncJobStatuses().catch(() => { /* best-effort */ })
    }, 15000)
    context.subscriptions.push({ dispose: () => clearInterval(statusSyncTimer) })
    syncJobStatuses().catch(() => { /* best-effort */ })

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.loadJobs', async () => {
        await loadJobs()
        syncJobStatuses().catch(() => { /* best-effort */ })
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'ocean-protocol.selectJob',
        async (jobId: string) => {
          await setSelectedJobId(context, jobId)
          await loadJobs()
        }
      )
    )

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'ocean-protocol.setSelectedProject',
        (algorithmPath: string, resultsFolderPath: string) => {
          setSelectedProject({ algorithmPath, resultsFolderPath })
        }
      )
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.runFreeJob', async (opts?: {
        jobName?: string
        dockerImage?: string
        dockerTag?: string
      }) => {
        if (!selectedProject) {
          vscode.window.showErrorMessage('Select a project folder first')
          return
        }
        // Coming from a paid config: drop the paid env/resources/dataset so we
        // don't submit them to the free default node. (A previously loaded free
        // env is kept, so a re-run survives a transient env-fetch failure.)
        if (config.isFreeCompute !== true) {
          config.updateFields({ environmentId: undefined, resources: undefined, jobDuration: undefined, dataset: undefined })
        }
        config.updateFields({ isFreeCompute: true, multiaddresses: [DEFAULT_MULTIADDR], feeToken: undefined, chainId: undefined })
        if (!config.environmentId || !config.resources) {
          let envs
          try {
            envs = await getComputeEnvironments([DEFAULT_MULTIADDR])
          } catch (e) {
            trackP2PError(config.address || anonymousId, e, 'getComputeEnvironments_runFreeJob')
          }
          if (Array.isArray(envs) && envs.length > 0) {
            const env = envs.find((e: { id?: string }) => e.id === config.environmentId) ?? envs[0]
            config.updateFields({
              environmentId: env.id,
              resources: getDefaultResourcesFromFreeEnv(env),
              jobDuration: String(env?.free?.maxJobDuration ?? 7200)
            })
          }
        }
        if (!config.environmentId) {
          vscode.window.showErrorMessage('Could not load a free compute environment from the default node')
          return
        }
        pendingJobName = opts?.jobName || generateJobName()
        provider?.sendMessage({ type: 'defaultJobName', name: generateJobName(), force: true })
        await vscode.commands.executeCommand(
          'ocean-protocol.startComputeJob',
          selectedProject.algorithmPath,
          selectedProject.resultsFolderPath,
          config.authToken,
          undefined,
          opts?.dockerImage,
          opts?.dockerTag,
          config.environmentId
        )
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.runJob', async (opts?: {
        jobName?: string
        dockerImage?: string
        dockerTag?: string
      }) => {
        if (!selectedProject) {
          vscode.window.showErrorMessage('Select a project folder first')
          return
        }
        pendingJobName = opts?.jobName || pendingJobName || generateJobName()
        provider?.sendMessage({ type: 'defaultJobName', name: generateJobName(), force: true })
        await vscode.commands.executeCommand(
          'ocean-protocol.startComputeJob',
          selectedProject.algorithmPath,
          selectedProject.resultsFolderPath,
          config.authToken,
          config.dataset,
          opts?.dockerImage,
          opts?.dockerTag,
          config.environmentId
        )
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.loadDefaultEnv', async () => {
        try {
          const envs = await getComputeEnvironments([DEFAULT_MULTIADDR])
          if (!Array.isArray(envs) || envs.length === 0) {
            provider?.sendMessage({ type: 'defaultEnvLoaded', error: true })
            return
          }
          const env = envs.find((e: { id?: string }) => e.id === config.environmentId) ?? envs[0]

          if (!config.environmentId || !config.resources) {
            config.updateFields({
              environmentId: env.id,
              resources: getDefaultResourcesFromFreeEnv(env),
              jobDuration: String(env?.free?.maxJobDuration ?? 7200)
            })
          }

          const parts = DEFAULT_MULTIADDR.split('/')
          const p2pIdx = parts.indexOf('p2p')
          const parsedPeerId = p2pIdx !== -1 ? parts[p2pIdx + 1] : undefined
          const nodeId = parsedPeerId || env.id

          const freeResources = env.free?.resources ?? []
          const resources = freeResources.map((r: { id: string; max?: number; inUse?: number }) => ({
            id: r.id,
            max: r.max ?? 0,
            available: (r.max ?? 0) - (r.inUse ?? 0)
          }))

          provider?.sendMessage({
            type: 'defaultEnvLoaded',
            env: {
              nodeId,
              os: env.platform?.os,
              arch: env.platform?.architecture,
              resources,
              maxJobDuration: env.free?.maxJobDuration
            }
          })
        } catch (e) {
          trackP2PError(config.address || anonymousId, e, 'loadDefaultEnv')
          provider?.sendMessage({ type: 'defaultEnvLoaded', error: true })
        }
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.showLogs', () => {
        outputChannel.show()
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.viewJobLogs', async (jobId: string) => {
        try {
          const jp = await jobProbe(jobId)
          if (!jp) {
            outputChannel.appendLine(`Could not load logs for ${jobId}: no node address available`)
            outputChannel.show()
            return
          }
          const { probe, name } = jp
          const label = name ?? jobId
          outputChannel.clear()
          outputChannel.appendLine(`--- Logs · ${label} ---`)
          outputChannel.appendLine('Loading logs…')
          outputChannel.show()

          let logResults: any[] = []
          let statusText: string | undefined
          try {
            const status = await checkComputeStatus(probe, jobId)
            statusText = status?.statusText
            logResults = (status?.results ?? []).filter((r: any) => !r.filename?.includes('.tar'))
          } catch {
          }

          outputChannel.clear()
          outputChannel.appendLine(`--- Logs · ${label} ---`)

          let wroteAny = false
          if (logResults.length > 0) {
            for (const r of logResults) {
              try {
                const raw = await streamToString(await getComputeResult(probe, jobId, r.index))
                const text = stripControlChars(stripAnsi(raw))
                if (text && text.trim().length > 0) {
                  outputChannel.appendLine(`---- ${r.filename} ----`)
                  outputChannel.append(text.endsWith('\n') ? text : text + '\n')
                  wroteAny = true
                }
              } catch {
              }
            }
          }
          if (!wroteAny) {
            wroteAny = await getComputeLogs(probe, jobId, outputChannel)
          }
          if (!wroteAny) {
            const inProgress =
              statusText && !/finish|complet|fail|timeout|stopp|error/i.test(statusText)
            if (inProgress) {
              outputChannel.appendLine(`Waiting for logs… Job status: ${statusText}.`)
              outputChannel.appendLine(
                'Logs appear once the algorithm container starts running. Run "View logs" again to refresh.'
              )
            } else {
              outputChannel.appendLine(
                'No logs available for this job. It may have finished in a previous session — logs require the node to still hold them and a valid session.'
              )
            }
          }
          outputChannel.show()
        } catch (e) {
          outputChannel.appendLine(`Could not load logs for ${jobId}: ${e}`)
          outputChannel.show()
        }
      })
    )

    context.subscriptions.push(
      vscode.commands.registerCommand('ocean-protocol.openConnectUrl', () => {
        vscode.env.openExternal(vscode.Uri.parse(dashboardConnectUrl()))
      })
    )

  } catch (error) {
    console.error('Error during extension activation:', error)
    outputChannel.appendLine(`Error during extension activation: ${error}`)
  }
}

async function resolvePersistentMountAssets(
  progress: vscode.Progress<{ message?: string }>
): Promise<ComputeAsset[]> {
  const scope = currentMountScope()
  const mounts = mountRegistry.getAll(scope)
  if (!mounts.length) return []

  progress.report({ message: 'Verifying mounted datasets...' })

  const byBucket = new Map<string, string[]>()
  for (const m of mounts) {
    const list = byBucket.get(m.bucketId) ?? []
    list.push(m.fileName)
    byBucket.set(m.bucketId, list)
  }

  const missing: mountRegistry.MountEntry[] = []
  for (const [bucketId, wantedNames] of byBucket) {
    let existing: Set<string>
    try {
      const files = await persistentStorage.listFiles(config, bucketId)
      existing = new Set(files.map((f) => f.name))
    } catch (err: any) {
      for (const fileName of wantedNames) missing.push({ bucketId, fileName })
      console.error(`listFiles failed for bucket ${bucketId}:`, err)
      continue
    }
    for (const fileName of wantedNames) {
      if (!existing.has(fileName)) missing.push({ bucketId, fileName })
    }
  }

  if (missing.length) {
    mountRegistry.removeMany(scope, missing)
    pushMountedSnapshot()
    const summary = missing.map((m) => `${m.bucketId}/${m.fileName}`).join(', ')
    throw new Error(
      `Cannot start compute: mounted dataset(s) no longer exist and were unticked: ${summary}`
    )
  }

  return mounts.map((m) => ({
    fileObject: {
      type: 'nodePersistentStorage',
      bucketId: m.bucketId,
      fileName: m.fileName
    }
  })) as ComputeAsset[]
}

export async function deactivate() {
  console.log('Ocean Orchestrator is being deactivated')
  outputChannel.appendLine('Ocean Orchestrator is being deactivated')
  await shutdownAnalytics()
}

async function handleFailureLogsRetrieval(
  config: SelectedConfig,
  jobId: string,
  status: any,
  resultsFolderPath: string,
  computeLogsChannel: vscode.OutputChannel,
  progress: vscode.Progress<{ message?: string }>,
  folderName?: string
) {
  if (!status.results || status.results.length === 0) {
    return
  }

  computeLogsChannel.appendLine(`Job failed with status: ${status.statusText}\n`)
  const resultsWithoutArchive = status.results.filter(
    (result) => !result.filename.includes('.tar')
  )

  for (const result of resultsWithoutArchive) {
    try {
      const filePathLogs = await getAndSaveLogs(
        config,
        jobId,
        result.index,
        result.filename,
        resultsFolderPath,
        progress,
        folderName
      )

      const logContent = await fs.promises.readFile(filePathLogs, 'utf-8')
      computeLogsChannel.appendLine(`\n=== ${result.filename} ===\n${logContent}`)
    } catch (logError) {
      console.error('Could not retrieve log:', logError)
    }
  }

  computeLogsChannel.show(true)
}

async function getAndSaveLogs(
  config: SelectedConfig,
  jobId: string,
  index: number,
  fileName: string,
  resultsFolderPath: string,
  progress?: vscode.Progress<{ message?: string }>,
  folderName?: string
) {
  const result = await withRetrial(() => getComputeResult(config, jobId, index), progress)

  progress?.report({ message: `Saving ${fileName}...` })
  const content = await streamToString(result)
  const filePathLogs = await saveResults(
    content,
    path.join(resultsFolderPath, folderName || jobId),
    fileName
  )
  outputChannel.appendLine(`${fileName} saved to: ${filePathLogs}`)
  return filePathLogs
}
