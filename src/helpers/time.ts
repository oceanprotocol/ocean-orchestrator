export function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}
