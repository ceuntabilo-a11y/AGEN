import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedAgent(request: Request) {
  const expected = process.env.N8N_WEBHOOK_SECRET
  const received = request.headers.get('x-agen-secret')
  if (!expected || !received) return false

  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}
