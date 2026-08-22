import type { Metadata, Viewport } from 'next'
import './globals.css'
import { PwaRegister } from '@/components/PwaRegister'

export const metadata: Metadata = {
  title: 'Agen — Agenda y agente inteligente',
  description: 'Cada profesional con su agenda. Todo tu negocio bajo control.',
  manifest: '/manifest.webmanifest',
  // Sin esto el navegador pide /favicon.ico en cada carga y recibe un 404. apple-touch-icon
  // lleva fondo blanco a propósito: iOS pinta de negro lo transparente en sus íconos.
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#5b3df5',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body><PwaRegister />{children}</body>
    </html>
  )
}
