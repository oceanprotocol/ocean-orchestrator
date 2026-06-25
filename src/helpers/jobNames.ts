import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator'

export function generateJobName(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2
  })
}

// Folder name for a job's downloaded results: "<job name>_YYYY-MM-DD_HHmm".
// The date comes from the job's creation time so re-downloads reuse the same
// folder. Falls back to a short jobId when no friendly name exists.
export function jobResultsFolderName(
  name: string | undefined,
  createdAt: number | undefined,
  jobId: string
): string {
  // Job records store ms; incentive records may store seconds — normalize.
  const ms = createdAt ? (createdAt < 1e12 ? createdAt * 1000 : createdAt) : Date.now()
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`
  const base = name && name !== jobId ? name : jobId.slice(0, 8)
  const safe = base
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${safe || jobId.slice(0, 8)}_${stamp}`
}
