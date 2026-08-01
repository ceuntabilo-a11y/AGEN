import { NextResponse } from 'next/server'
export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'INTERNAL'
  if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (message === 'FORBIDDEN') return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  console.error(error)
  return NextResponse.json({ error: 'Error interno' }, { status: 500 })
}
