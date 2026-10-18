# Despliegue de 3dprintnow

El repositorio mantiene API, frontend, paquetes compartidos y migraciones juntos. Se despliegan dos servicios independientes desde el mismo commit. Estas instrucciones preparan el código; importar el repo en los proveedores y configurar las variables sigue siendo necesario.

## API en Render con Docker

- Runtime: Docker.
- Root Directory: raíz del repositorio, sin restringirlo a `apps/api`.
- Dockerfile Path: `./Dockerfile`.
- Docker Build Context: `.`.
- Health Check Path: `/api/v1/health`.
- Docker Command: dejar vacío para utilizar el `CMD` de la imagen.
- Instancia: web service de pago.

El contenedor instala con `npm ci` únicamente las dependencias de producción de la API y sus workspaces. Ejecuta Node con el cargador TypeScript `tsx`, sin watcher. Los paquetes compartidos siguen exportando TypeScript; por eso `tsx` es una dependencia de ejecución, no una herramienta exclusiva de desarrollo. La imagen incluye las migraciones y no contiene archivos `.env`, respaldos ni dependencias del frontend. Corre como usuario `node` y atiende `SIGTERM`/`SIGINT` cerrando HTTP y el pool PostgreSQL.

Variables de Render: `NODE_ENV=production`, `DATABASE_URL`, `AUTH_DRIVER=supabase`, `JWT_SECRET` de al menos 32 caracteres, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `CORS_ORIGIN` con el origen real del frontend. Configurar `PLATFORM_ADMIN_EMAILS` si corresponde. Render asigna `PORT`; no copiar el puerto local de `.env`.

La API verifica el esquema al iniciar; **el contenedor no aplica migraciones automáticamente**. La preparación de la base y el pre-deploy `npm run db:migrate` corresponden al paso de migraciones. Desde la raíz, con la imagen construida, el comando equivalente es `docker run --rm --env-file /ruta/privada/produccion.env 3dprintnow-api npm run db:migrate`; el archivo privado debe definir `MIGRATION_DATABASE_URL` de esa base.

Comprobación local de la imagen, una vez configurada la base:

```sh
docker build -t 3dprintnow-api .
docker run --rm -p 3001:3000 --env-file /ruta/privada/produccion.env -e PORT=3000 3dprintnow-api
```

El healthcheck actual comprueba HTTP; todavía no consulta la disponibilidad de PostgreSQL.

## Frontend en Vercel

Importar el mismo repositorio y usar **Root Directory en la raíz**, Framework Preset **Other**. `vercel.json` establece la instalación y la compilación. Dejar Output Directory sin override: el build genera `.vercel/output` mediante la Build Output API de Vercel.

Configurar estas variables en Vercel para el ambiente que se despliega:

- `API_ORIGIN`: origen HTTPS real de la API de Render, sin `/api/v1` ni otras rutas. Por ejemplo, `https://mi-api.onrender.com` es una ilustración; usar la dirección asignada al servicio.
- `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`: las variables públicas que ya consume el frontend.

No configurar en Vercel credenciales de PostgreSQL, `JWT_SECRET` ni `SUPABASE_SECRET_KEY`. Las variables anteriores deben corresponder al ambiente Production o Preview; no dirigir previews a la base productiva.

`npm run build:vercel` valida `API_ORIGIN`, compila el frontend y genera:

- Archivos estáticos en `.vercel/output/static`.
- Proxy de todas las solicitudes `/api/*` hacia Render, conservando `/api` y sin caché de respuestas de negocio.
- Fallback a `index.html` para rutas de React, incluyendo `/app/pedidos/...` y `/auth/callback`.

El navegador sigue utilizando `/api/v1/...`; no necesita una URL de API incrustada en el JavaScript. Un error de API no se convierte en HTML por el fallback. Los archivos estáticos existentes tienen prioridad sobre las rutas de React.

Para probar la compilación sin publicar nada:

```sh
API_ORIGIN=https://api.example.test npm run build:vercel
npm run test:deploy
```

La dirección `.test` solo sirve para comprobar el empaquetado. Para un despliegue funcional se requiere la dirección real de Render y la configuración de autenticación/dominios del ambiente.

Referencias: [Docker en Render](https://render.com/docs/docker), [Build Output API](https://vercel.com/docs/build-output-api), [rutas de Vercel](https://vercel.com/docs/build-output-api/configuration).
