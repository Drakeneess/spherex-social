# Desarrollo y despliegue

[← AstroGram](../README.md) · [Arquitectura](ARCHITECTURE.md) · [Alcance científico](SCIENCE.md)

Esta guía permite ejecutar **web y API localmente**, sin enviar de forma accidental registros o publicaciones a producción.

## Requisitos

- Python **3.12** y `pip`.
- Node.js **22** con npm.
- Docker y Docker Compose, para PostgreSQL.
- Acceso a Internet solo si se quieren consultar productos astronómicos reales en IRSA.

## 1. Preparar PostgreSQL

Desde la raíz:

```bash
docker compose up -d postgres
```

La instancia de `compose.yaml` escucha en **127.0.0.1:5432** y utiliza credenciales **exclusivas de desarrollo**. No reutilices esa contraseña en Railway.

## 2. Ejecutar FastAPI

Desde `server/`:

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Para Windows PowerShell:

```powershell
cd server
Copy-Item .env.example .env
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Verificación:

- http://127.0.0.1:8000/v1/health — proceso activo.
- http://127.0.0.1:8000/v1/ready — PostgreSQL conectado.
- http://127.0.0.1:8000/docs — documentación OpenAPI.

La base de datos se mantiene mediante migraciones Alembic. Al añadir o modificar modelos, crea una migración y ejecuta las pruebas antes del merge.

## 3. Ejecutar la web

En otra terminal, desde `web/`:

```bash
npm ci
npm run dev
```

Abre **http://127.0.0.1:5173**.

La configuración por defecto del proxy de Vite utiliza **http://127.0.0.1:8000** para ambas rutas:

| Ruta de la web | Destino de desarrollo |
|---|---|
| `/api/*` | API astronómica local |
| `/v1/*` | API social local |

Si necesitas servidores distintos, usa variables **solo del proceso de Vite**:

```dotenv
ASTRO_API_TARGET=http://127.0.0.1:8000
SOCIAL_API_TARGET=http://127.0.0.1:8000
```

No apuntes `SOCIAL_API_TARGET` a producción para hacer pruebas con cuentas o publicaciones. En una web compilada, las variables con prefijo `VITE_` son visibles en el navegador y **no deben incluir secretos**.

## Variables principales del backend

| Variable | Función |
|---|---|
| `APP_ENV` | `development` o `production` |
| `DATABASE_URL` | URL SQLAlchemy de PostgreSQL |
| `AUTH_JWT_SECRET` | Secreto de firma; mínimo 32 caracteres en producción |
| `JWT_ACCESS_MINUTES` | Duración del JWT de acceso (por defecto: 30) |
| `CORS_ORIGINS` | Orígenes HTTP autorizados, separados por comas |
| `SKY_S3_ENDPOINT` | Endpoint HTTPS del bucket privado |
| `SKY_S3_BUCKET` | Nombre del bucket |
| `SKY_S3_REGION` | Región de S3 |
| `SKY_S3_ACCESS_KEY` | Credencial de acceso |
| `SKY_S3_SECRET_KEY` | Credencial privada |
| `SKY_S3_ADDRESSING_STYLE` | Estilo de dirección S3, si corresponde |

**Producción necesita** `DATABASE_URL`, `AUTH_JWT_SECRET` válido y almacenamiento S3 configurado. En desarrollo, los archivos astronómicos se guardan localmente en `server/.sky-frames/`.

Los archivos `.env` y los artefactos locales se excluyen de Git. No copies claves, tokens, datos de usuarios ni volcados de PostgreSQL al repositorio.

## Pruebas

```bash
# Web
cd web
npm ci
npm run build
npm test

# Backend
cd ../server
python -m pytest -q

# Base de datos (desde server con DATABASE_URL configurado)
python -m alembic upgrade head
```

El workflow [.github/workflows/ci.yml](../.github/workflows/ci.yml) valida web, API y las pruebas de eventos en PostgreSQL. Un cambio funcional debe ir acompañado de una prueba apropiada.

## Despliegue en Railway

La infraestructura actual utiliza tres servicios:

| Servicio | Código y propósito |
|---|---|
| `web` | Dockerfile raíz: Vite compilado + Nginx |
| `api` | `server/Dockerfile`: FastAPI + migraciones Alembic |
| `Postgres` | Base de datos persistente |

También requiere un **bucket privado compatible con S3** para vistas PNG, FITS y NPZ y medios del usuario. Las credenciales se referencian como variables protegidas de Railway.

**Importante:** `web/nginx.railway.conf` está configurado con el dominio de la API del despliegue actual. Si despliegas una copia en otra infraestructura, actualiza el `proxy_pass` y el host SSL antes de compilar la imagen web. No copies configuraciones de producción de otros proyectos.

El backend aplica migraciones en el arranque de su contenedor. Antes de ejecutar cambios destructivos de esquema o limpieza de objetos, prepara copias verificadas de la base de datos y del bucket.

## Problemas habituales

**`/v1/ready` devuelve 503.** Verifica que PostgreSQL esté ejecutándose, que `DATABASE_URL` sea correcta y que `alembic upgrade head` haya finalizado.

**La web recibe error de proxy.** Comprueba que FastAPI esté en el puerto 8000 y los targets de Vite apunten al servidor esperado.

**SIA2 o TAP devuelve 502.** Un servidor propio online no implica que IRSA esté disponible. AstroGram puede reabrir imágenes archivadas; para observaciones nuevas necesita que alguno de los servicios de catálogo responda.

**El bucket parece demasiado grande.** Cada época puede tener PNG, FITS y NPZ. Consulta los límites y el diseño de [almacenamiento](ARCHITECTURE.md). No elimines objetos sin verificar primero las referencias de trabajos y publicaciones.

---

Para decisiones de diseño, pruebas y reportes de cambios, consulta [CONTRIBUTING.md](../CONTRIBUTING.md).
