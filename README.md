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
- ⏳ Subida a S3, notificaciones, verificación de correo, rate limiting persistente y workers de astronomía: **no implementados**.
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
└── web/                   # Visor original React/Vite (aún sin feed social)
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

Las rutas del visor original se mantienen en `/api`. El frontend Vite sigue siendo el prototipo astronómico inicial; la UI social será el siguiente módulo.

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
