# SPHEREx Social — Backend + visor astronómico

Proyecto para **NASA Space Apps Challenge 2026**. Producto: red social de observaciones (aprox. 60% experiencia social y 40% explorador). La API social utiliza **FastAPI + SQLAlchemy + PostgreSQL + Alembic**; el visor temporal original de SPHEREx se conserva en React.

## Estado actual

- ✅ Schema de 10 tablas: `users`, `follows`, `observations`, `observation_frames`, `posts`, `post_media`, `post_likes`, `bookmarks`, `comments`, `processing_jobs`.
- ✅ Migración versionada en `server/alembic/versions/` y tests sociales básicos.
- ✅ Lecturas: `/v1/health`, `/v1/ready`, `/v1/feed`, `/v1/observations/{id}`.
- ✅ Visor original: `/api/health`, `/api/search`, `/api/frame/{search_id}/{index}`.
- ✅ Auth v1: registro, login, JWT HS256 de 30 minutos, Argon2id, perfil propio y público.
- ✅ Posts v1: crear, consultar, editar, eliminar, listados por usuario y feed cronológico con reglas de visibilidad.
- ✅ Interacciones v1: likes, comentarios (incluidas respuestas), seguidores, guardados y contadores por publicación.
- ✅ Regiones SPHEREx persistentes: guardar parámetros, búsqueda radial, mis observaciones, enlace compartible y posts vinculados.
- ✅ **Frontend AstroGram en React + Vite** basado en `INT.html`: registro/login, feed, perfiles, publicaciones, seguidores, guardados, ajustes, explorador y juego educativo sintético.
- ⏳ FITS persistentes, subida a S3, notificaciones, solicitudes de amistad, cambio de contraseña, verificación de correo, rate limiting persistente y workers de astronomía: **no implementados**.
- ✅ API conectada a `Drakeneess/spherex-social` en Railway; `/v1/ready` verificado contra PostgreSQL.

**Nota científica:** la visualización DR1/QR3 es orientativa; el detector no equivale a banda monocromática, así que todavía no permite afirmar detecciones científicas por diferencia. El modo simulado está rotulado.

## Estructura

```text
.
├── compose.yaml            # PostgreSQL local, 127.0.0.1:5432
├── .github/workflows/ci.yml
├── server/
│   ├── app.py              # API astronómica original + routers sociales
│   ├── social_api/         # Modelos, DB, configuración, endpoints
│   ├── alembic/            # Migraciones SQLAlchemy
│   ├── tests/
│   ├── Dockerfile
│   ├── railway.json
│   ├── .env.example
│   └── requirements.txt
└── web/                   # AstroGram React/Vite: autenticación, red social, explorador y juego demo
```

## Entorno local en Windows (PowerShell)

Docker Desktop requerido para PostgreSQL local.

```powershell
docker compose up -d postgres
cd server
Copy-Item .env.example .env
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app:app --reload --port 8000
```

API: http://localhost:8000/docs; chequeos `/v1/health` (proceso) y `/v1/ready` (conexión a BD). El esquema se crea **exclusivamente** mediante migraciones, no en cada inicio.

Frontend (otra consola):

```powershell
cd web
npm install
npm run dev
```

## Sprint frontend: AstroGram React

La referencia visual fue `INT.html` (variante más reciente de los diseños recibidos). El diseño se migró a componentes React: no se incrusta ni ejecuta el HTML original. La API ya existente se mantiene sin modificaciones.

```powershell
cd web
npm install
npm run dev
```

Abrir `http://127.0.0.1:5173`. En **desarrollo**, Vite utiliza un proxy para `/api` y `/v1` hacia la API de Railway ya desplegada (se utilizarán **datos reales de producción** al crear usuarios/publicaciones). No es necesario ejecutar FastAPI localmente con esta configuración. Para apuntar a tu propio backend local, cambia el `target` de `web/vite.config.ts`.

Para un dominio frontend independiente, compila con `VITE_API_BASE_URL=https://api-production-a831f79f.up.railway.app`; en Railway configura `CORS_ORIGINS` con el origen exacto de la web. No introduzcas JWT ni secretos en variables de Vite: las variables `VITE_*` se exponen al navegador.

### Estado funcional

- Registro e inicio de sesión con los endpoints existentes; el JWT se conserva en `sessionStorage` (sin refresh token).
- Feed cronológico, publicaciones, likes (HTTP 204), comentarios, guardados, perfiles y seguidores conectados a FastAPI.
- El modal crea primero la región `/v1/observations` y luego la publicación con `observation_id`, de acuerdo con el contrato del servidor.
- El explorador consulta `/api/search` y `/api/frame`; reconoce `?observation_id=<uuid>` y muestra claramente el modo demo.
- Las ilustraciones del feed y el juego son **sintéticas**, siempre rotuladas. No equivalen a fotografías SPHEREx.
- Las solicitudes de amistad y el cambio de contraseña propuestos en el diseño todavía no tienen endpoints; aparecen como pendientes, no se falsifica su funcionamiento.
- Las imágenes FITS no son persistentes entre reinicios: lo que persiste en PostgreSQL son los parámetros de la región.

Las rutas del visor temporal se mantienen bajo `/api`.

## Autenticación (Auth v1)

- `POST /v1/auth/register` recibe JSON con `username`, `display_name`, `email`, `password` (mínimo 10 caracteres); devuelve perfil privado, sin hash.
- `POST /v1/auth/login` recibe JSON con `email`, `password`; devuelve `access_token`, `token_type=bearer`, `expires_in=1800`.
- `GET /v1/users/me` y `PATCH /v1/users/me` requieren `Authorization: Bearer <token>`.
- `GET /v1/users/{username}` es público y no revela correo.
- El token se firma con HS256, incluye `sub`, `aud`, `iss`, `iat`, `nbf`, `exp` y `jti`; expira en 30 minutos de forma predeterminada. No existe refresh ni revocación en esta fase.
- Swagger: `/docs` → primero registra una cuenta, haz login, copia `access_token`, pulsa **Authorize** y pega solamente el token.
- Para un lanzamiento público deben agregarse **rate limiting distribuido**, verificación de correo y flujo de recuperación de contraseña. No guardar tokens en logs ni en Git.

## Publicaciones (Sprint 2)

- `POST /v1/posts` exige Bearer: `{"caption":"...","visibility":"public","observation_id":null}`; devuelve HTTP 201.
- `GET /v1/posts/{id}`: público y `unlisted` accesibles por ID; `private` solamente para autor autenticado (404 para terceros).
- `PATCH /v1/posts/{id}` admite cambio de `caption`, `visibility`, y `observation_id`; solo autor.
- `DELETE /v1/posts/{id}`: HTTP 204, solo autor.
- `GET /v1/users/{username}/posts`: listados públicos; con token propio incluye también privadas y no listadas.
- `GET /v1/feed?limit=20&offset=0`: exclusivamente publicaciones públicas, orden cronológico descendente.
- `visibility` admite `public`, `unlisted`, `private`. `caption` contiene entre 1 y 3000 caracteres tras quitar espacios laterales.
- `observation_id` opcional, pero cuando se proporciona debe existir. Se puede limpiar pasando `null` en PATCH.
- Publicaciones textuales permitidas; la subida de medios se implementará en un sprint posterior.
- Sin cambios en modelos: se reutilizan las tablas PostgreSQL existentes.
- El autor se deriva del JWT, jamás de un `author_id` enviado por el cliente.

## Interacciones (Sprint 3)

- `POST/DELETE /v1/posts/{id}/like`: activar o quitar like con JWT; son **idempotentes** (204).
- `POST/DELETE /v1/posts/{id}/bookmark`: guardar o quitar un post con JWT (204).
- `GET /v1/users/me/bookmarks`: guardados de la cuenta actual (JWT; no muestra posts ajenos que pasaron a privados).
- `GET /v1/posts/{id}/comments?limit=20&offset=0`: comentarios públicos, orden cronológico ascendente.
- `POST /v1/posts/{id}/comments`: JWT; cuerpo `{"body":"Texto", "parent_id":null}`, máximo 2000 caracteres.
- `DELETE /v1/posts/{id}/comments/{comment_id}`: JWT; permite borrar al autor del comentario y al dueño del post (también borra respuestas dependientes por la FK).
- `POST/DELETE /v1/users/{username}/follow`: JWT; idempotente (204); rechazamos seguirse a sí mismo (400).
- `GET /v1/users/{username}/stats`: `followers_count`, `following_count`, `is_following` (último campo basado en Bearer opcional).
- El feed, las publicaciones y las listas por perfil incluyen `likes_count` y `comments_count`; se calculan por lote sin N+1.
- Las publicaciones `private` no muestran sus interacciones a terceros (404). Las `unlisted` se pueden consultar mediante URL.
- Se reutilizan las tablas del Sprint 1: **no requiere una migración nueva**.

## Observaciones persistentes (Sprint 4)

- `POST /v1/observations` requiere JWT; ejemplo `{"ra_deg":133.795129,"dec_deg":-7.245147,"fov_arcmin":6,"detector":2}` y devuelve `id` y `viewer_path` (`/?observation_id=<id>`).
- `GET /v1/observations/{id}` recupera parámetros públicos y estables.
- `GET /v1/observations?ra_deg=133.795129&dec_deg=-7.245147&radius_arcmin=30&detector=2` busca regiones guardadas por separación angular (no consulta IRSA), con paginación.
- `GET /v1/users/me/observations` lista solo las regiones creadas por la cuenta autenticada.
- `GET /v1/observations/{id}/posts` lista posts públicos vinculados; con JWT del autor incluye también sus publicaciones privadas/no listadas.
- Los posts ya admiten `observation_id` en `POST /v1/posts`. Cada región es pública: no guardar datos personales sensibles en sus coordenadas o metadatos.
- El frontend carga `?observation_id=<id>`, consulta parámetros persistidos y realiza una búsqueda IRSA fresca (modo real). Las imágenes no se guardan en BD y el resultado no representa una detección científica confirmada.
- Para el prototipo React local, `vite` envía `/v1` y `/api` al servidor FastAPI local. Si se despliega la web por separado, configurar `VITE_API_BASE_URL` con la URL pública de FastAPI en tiempo de build y `CORS_ORIGINS` en Railway con el origen web.
- **No hay migración nueva**: se reutiliza `observations`, `posts.observation_id` y las restricciones existentes.

## Tests y migraciones

```powershell
cd server
python -m pytest -q
alembic check
# cambios posteriores en modelos:
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

`alembic revision` es para desarrollo: revisar siempre la migración generada antes de aplicarla a una BD real. Nunca almacenes `.env` ni claves en Git. Las pruebas SQLite no reemplazan las pruebas integradas en PostgreSQL.

## Railway

Proyecto existente: [`spherex-social`](https://railway.com/project/1c8bda97-096f-451b-95ed-35093a98ca5f) — entorno `production`, servicio `Postgres` online con volumen, y servicio `api` desplegado. En `api`:

- `Root Directory`: `/server`
- `Dockerfile Path`: `Dockerfile`
- `Healthcheck`: `/v1/health`
- Variables: `APP_ENV=production`, `APP_NAME=SPHEREx Social API`, `DATABASE_URL=${{Postgres.DATABASE_URL}}` (referencia privada, no contraseña), `PYTHONUNBUFFERED=1`, `LOG_LEVEL=INFO`
- El Dockerfile instala dependencias y ejecuta `alembic upgrade head` **antes de** levantar Uvicorn.

**GitHub:** [Drakeneess/spherex-social](https://github.com/Drakeneess/spherex-social), rama `main`, auto deploy a Railway.

**Auth v1:** antes de desplegar, configurar en el servicio `api` un `AUTH_JWT_SECRET` aleatorio de al menos 32 caracteres. No ponerlo en Git. El inicio en producción falla intencionalmente si falta. `JWT_ACCESS_MINUTES` es opcional (30 por defecto).

**Credenciales:** Railway gestiona la contraseña de PostgreSQL. Nunca copiar credenciales al README o al repositorio. Habilitar un dominio público para la API solo cuando se quiera acceso externo.

## Decisiones arquitectónicas

1. **Postgres es la fuente de verdad** para perfiles, conexiones sociales y procedencia científica. El FITS y los PNG resultantes no se almacenarán directamente en filas: usar object storage con `storage_key`.
2. Una `observation` es independiente del `post`: múltiples publicaciones podrán referenciar una observación.
3. `posts.observation_id` es nullable mientras se decide si permitir publicaciones libres; una restricción posterior puede volverlo obligatorio.
4. `processing_jobs` registra tareas, pero todavía no hay worker ni cola. Agregar Redis/RQ o similar solo cuando exista procesamiento en background.
5. **No hay creación o modificación anónima de publicaciones**; el feed es público, cronológico, sin personalización algorítmica.

## Fuentes de SPHEREx

- [NASA/IPAC SPHEREx](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [SPHEREx Cutouts](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/)

Software independiente; NASA no respalda el producto.

## Sprint de visualización — explorador de épocas (React)

La vista **Explorar** está adaptada a la composición de `INT.html`, con un visor cuadrado y el panel de búsqueda a la derecha:

- Parámetros: RA, Dec, campo de visión 1–12′, detector 1–6 y **2–16 épocas** (se envía `max_frames` a FastAPI).
- Presets WISE 0855, Barnard's Star y Luhman 16. Al seleccionarlos se ejecuta la búsqueda con las coordenadas elegidas.
- Búsqueda real de IRSA por defecto, **sin fallback silencioso a datos sintéticos**. El modo demo es una casilla explícita.
- Carga progresiva de fotogramas desde `/api/frame/{search_id}/{index}` con concurrencia limitada a tres solicitudes; los fallos parciales no impiden consultar otras épocas.
- Reproductor 1, 3 o 6 fps; pausa, navegación manual con slider, opción para superponer la época anterior.
- Clic sobre el fotograma para marcar un punto en esa época; una marca por época, trayectoria y botón **Borrar marcas**. Las marcas se mantienen solo en memoria de la página, **no se persisten ni se adjuntan a publicaciones**.
- Metadatos desplegables con fechas MJD, releases, longitud de onda estimada y proporción de píxeles marcados cuando están disponibles. Las imágenes embebidas en base64 no se incluyen en el panel técnico.
- `Guardar región` conserva coordenadas y detector en PostgreSQL; `Publicar este hallazgo` vincula esos parámetros a un post, pero **no publica las marcas**.
- La búsqueda y los recortes SPHEREx son **quicklooks orientativos**, no fotometría calibrada ni una detección confirmada.

Para comprobarlo: `cd web; npm run dev` y abrir `http://127.0.0.1:5173/#/explore`. Primero probar `Modo demo API`, después desactivarlo para consultar IRSA si el servicio dispone de imágenes para esas coordenadas.
