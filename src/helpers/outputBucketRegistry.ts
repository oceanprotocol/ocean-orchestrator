import { MountScope } from './persistentMountRegistry'

function scopeKey(scope: MountScope): string {
  return `${scope.nodeUri ?? ''}|${scope.chainId ?? ''}`
}

function isScopeReady(scope: MountScope): boolean {
  return !!scope.nodeUri && typeof scope.chainId === 'number'
}

export type OutputBucket = { id: string; name: string }

// one output bucket per node/chain scope; a job mounts exactly one output bucket
const store = new Map<string, OutputBucket>()

export function set(scope: MountScope, bucketId: string | null, name?: string): void {
  if (!isScopeReady(scope)) return
  const key = scopeKey(scope)
  if (bucketId) store.set(key, { id: bucketId, name: name || bucketId })
  else store.delete(key)
}

export function get(scope: MountScope): string | undefined {
  if (!isScopeReady(scope)) return undefined
  return store.get(scopeKey(scope))?.id
}

export function getName(scope: MountScope): string | undefined {
  if (!isScopeReady(scope)) return undefined
  return store.get(scopeKey(scope))?.name
}
