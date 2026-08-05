const buckets = new Map<string, number[]>()

export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter(timestamp => now - timestamp < windowMs)
  if (hits.length >= max) { buckets.set(key, hits); return true }
  hits.push(now)
  buckets.set(key, hits)
  return false
}
