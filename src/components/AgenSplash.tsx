'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './AgenSplash.module.css'

type AgenSplashProps = {
  duration?: number
  onFinish?: () => void
  playSound?: boolean
}

function playAgenStartupSound() {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  try {
    const ctx = new AudioContextClass()
    const start = () => {
      const now = ctx.currentTime
      const master = ctx.createGain()
      master.gain.setValueAtTime(0.0001, now)
      master.gain.exponentialRampToValueAtTime(0.18, now + 0.035)
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.25)
      master.connect(ctx.destination)

      const notes = [220, 329.63, 493.88]
      notes.forEach((frequency, index) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const noteStart = now + index * 0.11
        osc.type = index === 2 ? 'sine' : 'triangle'
        osc.frequency.setValueAtTime(frequency, noteStart)
        osc.frequency.exponentialRampToValueAtTime(frequency * 1.08, noteStart + 0.28)
        gain.gain.setValueAtTime(0.0001, noteStart)
        gain.gain.exponentialRampToValueAtTime(index === 2 ? 0.1 : 0.06, noteStart + 0.025)
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.7)
        osc.connect(gain)
        gain.connect(master)
        osc.start(noteStart)
        osc.stop(noteStart + 0.75)
      })
      window.setTimeout(() => void ctx.close().catch(() => {}), 1500)
    }
    if (ctx.state === 'suspended') ctx.resume().then(start).catch(() => {})
    else start()
  } catch { /* el navegador bloqueó el audio — la animación sigue igual */ }
}

export default function AgenSplash({ duration = 2600, onFinish, playSound = true }: AgenSplashProps) {
  const [visible, setVisible] = useState(true)
  const hasPlayed = useRef(false)

  useEffect(() => {
    if (playSound && !hasPlayed.current) {
      hasPlayed.current = true
      playAgenStartupSound()
    }
    const fadeTimer = window.setTimeout(() => setVisible(false), duration - 450)
    const finishTimer = window.setTimeout(() => onFinish?.(), duration)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(finishTimer)
    }
  }, [duration, onFinish, playSound])

  return (
    <div className={`${styles.splash} ${!visible ? styles.exit : ''}`} aria-label="Iniciando Agen" role="status">
      <div className={styles.brandWrap}>
        <div className={styles.logoWrap}>
          <img src="/brand/agen-logo.png" alt="Agen" className={styles.logo} draggable={false} />
          <span className={styles.orbitDot} aria-hidden="true" />
        </div>
        <div className={styles.wordmark}>Agen</div>
      </div>
    </div>
  )
}
