import {
  ComputeResourceRequest,
  PersistentStorageAccessList,
  PersistentStorageBucket,
  PersistentStorageFileEntry
} from '@oceanprotocol/lib'

export class SelectedConfig {
  authToken?: string
  address?: string
  multiaddresses?: string[]
  isFreeCompute?: boolean
  environmentId?: string
  feeToken?: string
  jobDuration?: string
  resources?: ComputeResourceRequest[]
  chainId?: number

  constructor(params: Partial<SelectedConfig>) {
    Object.assign(this, params)
  }

  static parseResources(resources: string): ComputeResourceRequest[] {
    const resourcesRequestJson = JSON.parse(resources)
    return resourcesRequestJson.map((resource: any) => ({
      id: resource.id,
      amount: resource.amount
    }))
  }

  updateFields(params: Partial<SelectedConfig>): void {
    Object.assign(this, params)
  }
}

export type GatewayResponse = { httpStatus?: number; error?: string }

export type StorageAccessEntry = { chainId: string; contract: string }

export type StorageErrorCode =
  | 'auth_expired'
  | 'missing_config'
  | 'too_large'
  | 'network'
  | 'unknown'

export type PanelRequest =
  | { type: 'listBuckets'; requestId: string }
  | {
      type: 'createBucket'
      requestId: string
      accessLists: PersistentStorageAccessList[]
      label?: string
    }
  | {
      type: 'renameBucket'
      requestId: string
      bucketId: string
      label: string
    }
  | { type: 'listFiles'; requestId: string; bucketId: string }
  | { type: 'pickAndUploadFile'; requestId: string; bucketId: string }
  | {
      type: 'toggleMount'
      requestId: string
      bucketId: string
      fileName: string
      mounted: boolean
    }
  | {
      type: 'deleteFile'
      requestId: string
      bucketId: string
      fileName: string
    }

export type PanelResponse =
  | {
      type: 'configSnapshot'
      hasAuthToken: boolean
      address?: string
      chainId?: number
      nodeUri?: string
    }
  | {
      type: 'bucketsLoaded'
      requestId: string
      buckets: PersistentStorageBucket[]
    }
  | {
      type: 'bucketCreated'
      requestId: string
      bucket: {
        bucketId: string
        owner: string
        accessList: PersistentStorageAccessList[]
        label?: string | null
      }
    }
  | {
      type: 'bucketRenamed'
      requestId: string
      bucketId: string
      label: string | null
    }
  | {
      type: 'filesLoaded'
      requestId: string
      bucketId: string
      files: PersistentStorageFileEntry[]
    }
  | {
      type: 'fileUploaded'
      requestId: string
      bucketId: string
      file: PersistentStorageFileEntry
    }
  | {
      type: 'mountToggled'
      requestId: string
      bucketId: string
      fileName: string
      mounted: boolean
    }
  | {
      type: 'mountedSnapshot'
      entries: { bucketId: string; fileName: string }[]
    }
  | {
      type: 'fileDeleted'
      requestId: string
      bucketId: string
      fileName: string
    }
  | { type: 'uploadCancelled'; requestId: string }
  | { type: 'deleteCancelled'; requestId: string }
  | {
      type: 'storageError'
      requestId: string
      code: StorageErrorCode
      message: string
      op: string
    }
