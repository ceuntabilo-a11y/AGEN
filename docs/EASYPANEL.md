# Despliegue de Agen en EasyPanel sin Docker

## Aplicación web

Crear una aplicación desde GitHub con el constructor Node/Nixpacks de EasyPanel:

- Rama: la rama de producción seleccionada.
- Directorio raíz: `/`.
- Build: `npm ci && npm run build`.
- Start: `npm start`.
- Puerto: `3000`.
- Health check: `/api/health`.

Configurar las variables indicadas en `.env.example` desde el panel. No subir archivos `.env` al repositorio.

## n8n

n8n se administra como servicio independiente. Importar los JSON versionados en `n8n-workflows` y configurar credenciales desde n8n. Agen y n8n se comunican por HTTPS con el encabezado privado `x-agen-secret`.

## Migración a otro servidor

1. Conectar el mismo repositorio GitHub en el nuevo panel.
2. Copiar las variables de entorno de forma segura.
3. Restaurar o volver a conectar Supabase.
4. Importar los workflows n8n y sus credenciales.
5. Cambiar DNS y comprobar `/api/health`.

El código no depende de rutas locales ni de características exclusivas de Hostinger.
