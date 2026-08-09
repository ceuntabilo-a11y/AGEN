'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './AgenSplash.module.css'

const SRC = '/brand/agen-intro.mp4'
const FADE_SECONDS = 0.7

/** El volumen de un <video> solo acepta valores entre 0 y 1: fuera de rango lanza excepción. */
const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Si el navegador bloqueó el autoplay, no se espera al video: se sigue de largo. */
const BLOCKED_PLAY_MS = 1200
/** Tope absoluto de la portada. Ningún fallo del video puede dejar el panel tapado. */
const MAX_SPLASH_MS = 8000

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
    const timers: number[] = []

    // Se disipa suave en vez de cortar en seco: baja el volumen mientras se desvanece la pantalla.
    const startFade = () => {
      if (fadeStarted) return
      fadeStarted = true
      setFading(true)
      const startVolume = video.volume
      const startedAt = performance.now()
      const rampDown = (now: number) => {
        // El timestamp de requestAnimationFrame es el del inicio del cuadro y puede ser
        // anterior a performance.now(): sin el tope inferior, progress sale negativo y
        // el volumen se pasa de 1, lo que lanza una excepción y corta el desvanecido.
        const progress = clamp((now - startedAt) / 1000 / FADE_SECONDS)
        video.volume = clamp(startVolume * (1 - progress))
        if (progress < 1) rafId = requestAnimationFrame(rampDown)
      }
      rafId = requestAnimationFrame(rampDown)
      timers.push(window.setTimeout(finish, FADE_SECONDS * 1000))
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
      // Si el navegador bloquea el autoplay con sonido no llegan 'timeupdate' ni 'ended', así
      // que sin esto la portada se quedaría fija tapando el panel entero.
      timers.push(window.setTimeout(() => { if (video.paused) finish() }, BLOCKED_PLAY_MS))
    })

    // Red de seguridad: pase lo que pase con el video, la portada nunca bloquea la app.
    timers.push(window.setTimeout(finish, MAX_SPLASH_MS))

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', startFade)
      window.removeEventListener('pointerdown', retryPlay)
      window.removeEventListener('keydown', retryPlay)
      window.removeEventListener('touchstart', retryPlay)
      timers.forEach((timer) => window.clearTimeout(timer))
      cancelAnimationFrame(rafId)
    }
  }, [onFinish])

  return (
    <div className={`${styles.splash} ${fading ? styles.fading : ''}`} role="status" aria-label="Iniciando Agen">
      <video ref={videoRef} className={styles.video} src={SRC} autoPlay playsInline preload="auto" />
    </div>
  )
}
