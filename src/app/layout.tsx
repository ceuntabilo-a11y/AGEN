import type { Metadata, Viewport } from 'next'
import './globals.css'
import { PwaRegister } from '@/components/PwaRegister'

export const metadata: Metadata = {
  title: 'Agen — Agenda y agente inteligente',
  description: 'Cada profesional con su agenda. Todo tu negocio bajo control.',
  manifest: '/manifest.webmanifest',
  // Sin esto el navegador pide /favicon.ico en cada carga y recibe un 404. Se apunta al
  // mismo archivo que ya usa el manifest, para no tener dos copias que se desincronicen.
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }], shortcut: '/icon.svg', apple: '/icon.svg' },
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
