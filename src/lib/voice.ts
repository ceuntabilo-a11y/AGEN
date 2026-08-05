const QWEN_VOICES = [
  { id: 'Cherry', gender: 'female', style: 'warm' },
  { id: 'Serena', gender: 'female', style: 'professional' },
  { id: 'Sunny', gender: 'female', style: 'energetic' },
  { id: 'Ethan', gender: 'male', style: 'warm' },
  { id: 'Ryan', gender: 'male', style: 'professional' },
  { id: 'Marcus', gender: 'male', style: 'energetic' },
]

type VoiceConfig = { gender?: string; style?: string; speed?: number; accent?: string; emotion?: string; language?: string }

function pickVoice(cfg: VoiceConfig) {
  const gender = cfg.gender === 'male' ? 'male' : 'female'
  const style = String(cfg.style || 'warm').toLowerCase()
  return (QWEN_VOICES.find(v => v.gender === gender && v.style === style) ?? QWEN_VOICES.find(v => v.gender === gender) ?? QWEN_VOICES[0]).id
}

function languageType(cfg: VoiceConfig) {
  const language = String(cfg.language || 'es').toLowerCase()
  if (language.startsWith('en')) return 'English'
  if (language.startsWith('pt')) return 'Portuguese'
  return 'Spanish'
}

function buildInstruction(cfg: VoiceConfig) {
  const parts: string[] = []
  const emotion = String(cfg.emotion || 'neutral').toLowerCase()
  if (emotion === 'calm') parts.push('Habla con un tono calmado y sereno')
  else if (emotion === 'energetic') parts.push('Habla con energía y entusiasmo')
  else parts.push('Habla con un tono equilibrado y agradable')
  const accent = String(cfg.accent || '').toLowerCase()
  if (accent && accent !== 'neutral') parts.push(`con acento ${accent}`)
  return `${parts.join(', ')}.`
}

function fixWavHeader(buffer: Buffer): Buffer {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return buffer
  const fixed = Buffer.from(buffer)
  fixed.writeUInt32LE(fixed.length - 8, 4)
  let offset = 12
  while (offset + 8 <= fixed.length) {
    const id = fixed.toString('ascii', offset, offset + 4)
    const declared = fixed.readUInt32LE(offset + 4)
    if (id === 'data') {
      fixed.writeUInt32LE(fixed.length - offset - 8, offset + 4)
      break
    }
    const advance = 8 + declared + (declared % 2)
    if (!Number.isFinite(advance) || advance <= 0 || offset + advance > fixed.length) break
    offset += advance
  }
  return fixed
}

export async function generateSpeech(text: string, cfg: VoiceConfig, apiKey: string, endpoint?: string | null) {
  const clean = text.trim()
  if (!clean) throw new Error('Sin texto para convertir a voz')
  const speed = Math.max(0.5, Math.min(1.5, Number(cfg.speed) || 1))
  const body = {
    model: process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash',
    input: { text: clean.slice(0, 2000), voice: pickVoice(cfg), language_type: languageType(cfg) },
    parameters: { rate: speed, instruction: buildInstruction(cfg) },
  }
  const custom = String(endpoint || process.env.QWEN_TTS_ENDPOINT || '').trim().replace(/\/+$/, '')
  const endpoints = custom
    ? [custom.endsWith('/generation') ? custom : `${custom}/services/aigc/multimodal-generation/generation`]
    : ['https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation']

  let response: Response | undefined
  let lastErrorText = ''
  for (let i = 0; i < endpoints.length; i++) {
    response = await fetch(endpoints[i], { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    if (response.ok) break
    lastErrorText = await response.text()
    const wrongRegion = response.status === 401 && /InvalidApiKey/i.test(lastErrorText)
    if (!wrongRegion || i === endpoints.length - 1) break
  }
  if (!response?.ok) throw new Error(`qwen_tts_${response?.status ?? 0} ${lastErrorText.slice(0, 200)}`)
  const data = await response.json() as { output?: { audio?: { data?: string; mime?: string; url?: string }; audio_base64?: string; audio_url?: string } }
  const out = data.output ?? {}
  const audio = out.audio ?? {}
  let audioBase64 = audio.data ?? out.audio_base64 ?? null
  let mime = audio.mime ?? 'audio/wav'
  const url = audio.url ?? out.audio_url ?? null
  if (!audioBase64 && url) {
    const download = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!download.ok) throw new Error(`qwen_audio_download_${download.status}`)
    const buffer = Buffer.from(await download.arrayBuffer())
    audioBase64 = buffer.toString('base64')
    const contentType = download.headers.get('content-type')
    if (contentType?.startsWith('audio/')) mime = contentType
  }
  if (!audioBase64) throw new Error('qwen_sin_audio')
  const fixed = fixWavHeader(Buffer.from(audioBase64, 'base64'))
  if (fixed.toString('ascii', 0, 4) === 'RIFF') mime = 'audio/wav'
  return { audioBase64: fixed.toString('base64'), mime, chars: clean.length }
}
