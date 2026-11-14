# SPHEREx Social — Backend + visor astronómico

Proyecto para **NASA Space Apps Challenge 2026**. Producto: red social de observaciones (aprox. 60% experiencia social y 40% explorador). La API social utiliza **FastAPI + SQLAlchemy + PostgreSQL + Alembic**; el visor temporal original de SPHEREx se conserva en React.

## Estado actual

- ✅ Schema de 10 tablas: `users`, `follows`, `observations`, `observation_frames`, `posts`, `post_media`, `post_likes`, `bookmarks`, `comments`, `processing_jobs`.
- ✅ Migración versionada en `server/alembic/versions/` y tests sociales básicos.
- ✅ Lecturas: `/v1/health`, `/v1/ready`, `/v1/feed`, `/v1/observations/{id}`.
- ✅ Visor original: `/api/health`, `/api/search`, `/api/frame/{search_id}/{index}`.
- ⏳ Autenticación, escrituras sociales, subida a S3 y workers de astronomía: **no implementados**.
- ⏳ Despliegue de API: servicio Railway creado y configurado, **sin source** hasta conectar el repositorio GitHub.

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

Proyecto existente: [`spherex-social`](https://railway.com/project/1c8bda97-096f-451b-95ed-35093a98ca5f) — entorno `production`, servicio `Postgres` online con volumen, y servicio `api` vacío. En `api`:

- `Root Directory`: `/server`
- `Dockerfile Path`: `Dockerfile`
- `Healthcheck`: `/v1/health`
- Variables: `APP_ENV=production`, `APP_NAME=SPHEREx Social API`, `DATABASE_URL=${{Postgres.DATABASE_URL}}` (referencia privada, no contraseña), `PYTHONUNBUFFERED=1`, `LOG_LEVEL=INFO`
- El Dockerfile instala dependencias y ejecuta `alembic upgrade head` **antes de** levantar Uvicorn.

**Paso pendiente:** crear un repositorio en GitHub, subir este código y vincular la rama `main` como source del servicio `api`. Railway no tendrá deploy de API hasta entonces. Tras conectar el repo, el backend deberá migrar la BD y superar `/v1/health` y `/v1/ready`.

**Credenciales:** Railway gestiona la contraseña de PostgreSQL. Nunca copiar credenciales al README o al repositorio. Habilitar un dominio público para la API solo cuando se quiera acceso externo.

## Decisiones arquitectónicas

1. **Postgres es la fuente de verdad** para perfiles, conexiones sociales y procedencia científica. El FITS y los PNG resultantes no se almacenarán directamente en filas: usar object storage con `storage_key`.
2. Una `observation` es independiente del `post`: múltiples publicaciones podrán referenciar una observación.
3. `posts.observation_id` es nullable mientras se decide si permitir publicaciones libres; una restricción posterior puede volverlo obligatorio.
4. `processing_jobs` registra tareas, pero todavía no hay worker ni cola. Agregar Redis/RQ o similar solo cuando exista procesamiento en background.
5. **No hay endpoints de creación pública** sin autenticación y autorización. El feed de momento es cronológico.

## Fuentes de SPHEREx

- [NASA/IPAC SPHEREx](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [SPHEREx Cutouts](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/)

Software independiente; NASA no respalda el producto.
