'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './AgenSplash.module.css'

const SRC = '/brand/agen-intro.mp4'
const FADE_SECONDS = 0.7

export default function AgenSplash({ onFinish }: { onFinish?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [fading, setFading] = useState(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    const finish = () => {
      if (finishedRef.current) return
      finishedRef.current = true
      onFinish?.()
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(finish, 50)
      return () => window.clearTimeout(timer)
    }

    const video = videoRef.current
    if (!video) return
    let fadeStarted = false
    let rafId = 0

    // Se disipa suave en vez de cortar en seco: baja el volumen mientras se desvanece la pantalla.
    const startFade = () => {
      if (fadeStarted) return
      fadeStarted = true
      setFading(true)
      const startVolume = video.volume
      const startedAt = performance.now()
      const rampDown = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / 1000 / FADE_SECONDS)
        video.volume = startVolume * (1 - progress)
        if (progress < 1) rafId = requestAnimationFrame(rampDown)
      }
      rafId = requestAnimationFrame(rampDown)
      window.setTimeout(finish, FADE_SECONDS * 1000)
    }

    const onTimeUpdate = () => {
      if (Number.isFinite(video.duration) && video.currentTime >= video.duration - FADE_SECONDS) startFade()
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', startFade)

    // Los navegadores bloquean el audio si no hubo un clic real antes. Si el primer intento
    // falla, se reintenta solo con el próximo clic o tecla del usuario, sin pedirle nada aparte.
    const retryPlay = () => { video.play().catch(() => {}) }
    video.play().catch(() => {
      window.addEventListener('pointerdown', retryPlay, { once: true })
      window.addEventListener('keydown', retryPlay, { once: true })
      window.addEventListener('touchstart', retryPlay, { once: true })
    })

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', startFade)
      window.removeEventListener('pointerdown', retryPlay)
      window.removeEventListener('keydown', retryPlay)
      window.removeEventListener('touchstart', retryPlay)
      cancelAnimationFrame(rafId)
    }
  }, [onFinish])

  return (
    <div className={`${styles.splash} ${fading ? styles.fading : ''}`} role="status" aria-label="Iniciando Agen">
      <video ref={videoRef} className={styles.video} src={SRC} autoPlay playsInline preload="auto" />
    </div>
  )
}
