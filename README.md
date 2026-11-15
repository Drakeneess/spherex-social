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
python -m venv .venv
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


## Observabilidad de búsquedas IRSA — rama `feat/irsa-search-progress`

Durante una búsqueda, el explorador muestra un panel **Estado de la consulta**:

- Catálogo (`GET /api/search`): tiempo transcurrido y duración real observada por el navegador. Mientras la API consulta IRSA/TAP, **no inventamos porcentajes**.
- Fotogramas (`GET /api/frame/{search_id}/{index}`): cantidad en cola, en curso, recibida o fallida, y duración de cada solicitud; el avance `X/Y` representa **respuestas finalizadas**, no progreso interno de Astropy/FITS.
- Visor: número de imágenes ya recibidas que pueden seleccionarse; una falla parcial no borra las otras épocas.
- **Cancelar búsqueda** interrumpe las peticiones del navegador mediante `AbortController`. Un procesamiento ya iniciado puede seguir brevemente en Railway porque FastAPI trabaja de forma síncrona.
- No se exponen secretos, URL internas de FITS ni tokens en el panel. La tabla de tiempos se puede desplegar para diagnosticar demoras.
- El modo demo continúa siendo explícito; los errores de IRSA no se sustituyen silenciosamente por imágenes sintéticas.

**Consulta TAP asíncrona (corrección del timeout):** el explorador utiliza `POST /api/search/jobs` para iniciar un trabajo de IRSA TAP `/async`, luego `GET /api/search/jobs/{job_id}` cada 2,5 segundos para conocer `QUEUED`, `EXECUTING` o `COMPLETED`. Solo después descarga los fotogramas. La llamada síncrona `GET /api/search` se mantiene por compatibilidad, pero IRSA impone un límite oficial de 5 minutos a TAP `/sync`.

**Cancelación:** `DELETE /api/search/jobs/{job_id}` intenta abortar y eliminar el trabajo remoto; libera también su identificador local. Las búsquedas completadas crean una sesión separada para visualizar sus fotogramas.

**Limitación actual:** los identificadores de trabajos y las sesiones de imagen están en memoria del proceso Railway, **no** en una cola persistente/Redis/PostgreSQL. Un reinicio, múltiples réplicas o una expiración (30 min) pueden perder el estado local. Tampoco hay WebSocket/SSE que exponga los subpasos internos de descarga y reproyección de un FITS. Para lanzamiento público se necesita persistencia de trabajos, rate limiting y limpieza robusta de trabajos remotos.

**Pruebas:** `server/tests/test_async_tap.py` usa un TAP simulado sin tráfico de red. La CI comprueba el contrato de inicio, polling, completado, fallo y cancelación, pero la disponibilidad real de IRSA debe verificarse manualmente.

**Flujo de ramas:** desarrollar la mejora en `feat/irsa-search-progress`, ejecutar CI y revisarla mediante un PR contra `main` antes del merge. El servicio de Railway sigue `main`, no la rama de trabajo.

### Probar el PR #8 sin desplegar a producción

La rama de progreso TAP requiere ejecutar **el backend de la misma rama**. El proxy Vite de esta rama envía `/api` a `http://127.0.0.1:8000` y conserva `/v1` en Railway (cuentas/publicaciones de producción). Esto evita el 404 del endpoint `POST /api/search/jobs` cuando la API pública sigue desplegando `main`.

En PowerShell, desde la raíz del repositorio:

```powershell
git fetch origin
git switch feat/irsa-search-progress
cd server
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

En una **segunda terminal**:

```powershell
cd web
npm install
npm run dev
```

Comprobar que la ruta existe antes de buscar:

```powershell
(Invoke-RestMethod http://127.0.0.1:8000/openapi.json).paths.PSObject.Properties.Name -contains '/api/search/jobs'
```

Debe mostrar `True`. En Vite, abrir `http://127.0.0.1:5173/#/explore`. Si el proceso FastAPI no está iniciado, la petición fallará por conexión. Se puede cambiar la dirección de `/api` sin modificar el código mediante `ASTRO_API_TARGET`, y la de `/v1` con `SOCIAL_API_TARGET`. Reiniciar Vite para aplicar variables o cambios en su configuración.

> La búsqueda real utiliza internet desde tu backend local hacia IRSA. No hay garantía de que un trabajo TAP termine rápidamente; el panel ahora muestra el estado remoto sin sujetar una conexión HTTP abierta durante cinco minutos.


### Recuperación ante errores de proxy de IRSA (14/11/2026)

La creación del trabajo TAP puede responder `202 Accepted` y las primeras consultas de estado devolver `200`, pero IRSA puede responder ocasionalmente `502 Proxy Error` al recuperar la fase (p. ej. `/TAP/async/{job}`). Esto **no prueba** que el trabajo científico haya fallado.

- El backend reconoce `429`, `500`, `502`, `503`, `504` y errores transitorios de conexión/timeout al consultar la fase o descargar el resultado.
- Ante esos errores responde **`200 {"phase":"RETRYING", "warning":"...", "retry_after_seconds":N, "attempt":N}`** sin borrar el ticket ni cancelar el trabajo remoto.
- El frontend respeta el intervalo de reintento y muestra la advertencia en `Estado de la consulta`. El backoff empieza en 3 s, crece hasta 30 s y, si hay más de 8 errores consecutivos, termina en `503` con un mensaje explícito.
- Un estado `ERROR`/`ABORTED` real, o una respuesta HTTP no reintentable (p. ej. 404 del trabajo remoto), no se transforma en una falsa recuperación.
- El resultado de la consulta TAP y sus recortes siguen sin persistirse; los trabajos están en memoria local por proceso.
- Las pruebas unitarias usan `pyvo.dal.DALServiceError(code=502)` y verifican recuperación, límite de errores y fallos no reintentables. **No garantizan la disponibilidad de IRSA**.


### IRSA devuelve HTTP 502 al crear el trabajo (TAP /async)

Si `POST /api/search/jobs` responde `503` con `IRSA no está aceptando la creación de trabajos TAP`, la causa original puede ser un `502 Proxy Error` del endpoint remoto `https://irsa.ipac.caltech.edu/TAP/async`. **Este caso es distinto de un fallo de polling de un trabajo ya creado.**

- `Irsa.tap.submit_job(...)` crea un trabajo mediante **POST no idempotente**; un 502 no garantiza que el servidor no lo haya creado. El backend **no hace reintentos automáticos** de esa petición.
- El servidor registra el traceback y devuelve `503 Service Unavailable` con `Retry-After: 30` y una descripción sin datos privados de IRSA. Los errores no transitorios conservan un 502 explícito.
- La interfaz ofrece reintento **manual**, con pausa orientativa de 30 segundos para evitar solicitudes rápidas en bucle. El reintento sigue sin garantizar la disponibilidad remota.
- Si crear el trabajo funciona, pero `remote.run()` falla, el backend intenta eliminar el trabajo que ya conoce; esta limpieza es best-effort.
- Si el trabajo **ya fue creado**, se conserva el comportamiento de recuperación existente: polling con backoff ante errores temporales. Nunca confundir ambos tipos de error.
- Los tests simulan fallos de creación 502 y 400 y un fallo de inicio RUN; no envían peticiones reales a IRSA.

Para determinar si la caída está afectando al servicio remoto, consultar su [documentación oficial TAP](https://irsa.ipac.caltech.edu/docs/program_interface/TAP.html) y esperar a que vuelva a responder. No ampliar el timeout de Vite ni sustituir silenciosamente el resultado por datos sintéticos.


## Diagnóstico de rendimiento TAP y FITS — misma rama

Una consulta real ahora entrega el campo `timing` en `POST /api/search/jobs` y
`GET /api/search/jobs/{ticket}`:

- `submit_ms`: tiempo local que tardó el POST de creación del trabajo remoto (no incluye el proceso científico).
- `run_ms`: duración del POST `PHASE=RUN` hasta obtener respuesta.
- `phase_events`: cambios de fase **observados** por el sondeo con desplazamiento en milisegundos desde la confirmación de RUN. Se asume `QUEUED` al recibir la confirmación inicial.
- `phase_observed_ms`: intervalos entre observaciones de fases; **no** representan la hora exacta del cambio en IRSA ni su tiempo de CPU. Sumados dan `remote_observed_ms`. La incertidumbre de transición depende de la frecuencia de sondeo.
- `phase_http_ms`: tiempo acumulado gastado en solicitudes HTTP de estado, *incluido dentro* de los intervalos de fase. **No sumarlo** a las duraciones de fase.
- `poll_count`, `poll_errors`: número de consultas de fase al servicio remoto y las que fallaron.
- `result_fetch_ms` y `result_parse_ms`: tiempo de descarga de tabla y tiempo de normalización/registro de observaciones, respectivamente.
- `remote_observed_ms` comienza después de confirmar RUN; el total visible en el navegador también incluye las solicitudes frontend y esperas de polling.

Los fotogramas reales en `GET /api/frame/{id}/{index}` incluyen `timing_ms`: `apertura_fits`,
`lectura_pixeles`, `reproyeccion`, `metadatos`, `png` y `total`. Las lecturas pueden
ocurrir de manera diferida dentro de Astropy: la división entre apertura y lectura
es una observación local, no un desglose de procesamiento del servidor IRSA.
Cuando falle un fotograma, el error público indica la etapa y el tipo de excepción,
sin incluir URL FITS ni la descripción completa potencialmente sensible.

En **Explorar → Estado de la consulta → Desglose TAP** se ven los tiempos y
transiciones. **Detalles por época** incluye las etapas FITS por imagen y los fallos;
al terminar, **Copiar diagnóstico JSON** permite compartir medidas sin imágenes base64,
identificadores de trabajos, tokens ni URLs de descarga.

El diagnóstico es de observabilidad: **no modifica la consulta ADQL, no acelera
IRSA y no cambia el comportamiento de las imágenes**. Para pruebas locales, iniciar
FastAPI y Vite desde la misma rama; las métricas de TAP no aparecen en el modo demo.
Los tests simulan fases y errores sin enviar trabajos a IRSA.

## Diagnóstico TAP /phase y reintentos FITS (14/11/2026)

**Seguimiento TAP:** GET /api/search/jobs/{ticket} consulta el recurso ligero
UWS GET {remote-job-url}/phase (texto), usando la sesión HTTP de PyVO cuando
está disponible. Si el servidor no soporta /phase (303/404/405/406/501
o una respuesta inesperada), recurre a la propiedad remota job.phase.
Los errores transitorios 429/500/502/503/504 conservan el backoff del GET,
sin crear nuevos trabajos remotos.

Al finalizar el catálogo se consulta una vez el documento completo del job UWS
para extraer startTime y endTime. Las métricas remote_start_time, remote_end_time,
remote_execution_ms, job_info_status, job_info_ms y phase_method quedan
disponibles en el campo timing. Si IRSA no envía esas fechas o la lectura falla,
la búsqueda continúa; las horas no se inventan. Los intervalos QUEUED y
EXECUTING siguen siendo estimaciones de sondeos, no tiempos precisos de CPU.

**FITS:** los errores incluyen el código HTTP remoto cuando está disponible
(p. ej. HTTP 404 frente a HTTP 502), nunca la URL de descarga completa.
Los GET de apertura FITS se reintentan solo ante 429/500/502/503/504 o
fallos de transporte claramente transitorios, con máximo 3 intentos y pausas
de 1 y 2 segundos. No reintentar HTTP 400/401/403/404 ni errores WCS/PNG.
Las imágenes válidas exponen timing_ms.attempts y timing_ms.total_with_retries.

Los tests usan dobles UWS/FITS sin acceso externo, e incluyen fallback,
tiempos UWS, errores HTTP y reintentos con límites. El flujo ADQL es idéntico.

## Comparador SIA2 vs TAP (diagnóstico experimental)

Tras completar una búsqueda **real** del explorador, el botón
**Medir SIA2 y comparar** consulta una sola vez el endpoint de diagnóstico
`GET /api/diagnostics/sia2/{search_id}`. No lanza otro trabajo TAP,
no sustituye el buscador principal y no descarga archivos FITS.

El backend conserva en RAM el catálogo TAP completo asociado a esa sesión
(no solo las épocas elegidas) y lo compara con una consulta de metadatos SIA2:

- URL: https://irsa.ipac.caltech.edu/SIA
- `POS=CIRCLE <ra> <dec> 0.0002777777777777778` (radio de 1 arcsec)
- Colecciones: `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep`
- `MAXREC=5000`, formato VOTable. El backend detecta `QUERY_STATUS=ERROR`
  incluso cuando HTTP sea 200, y marca `OVERFLOW` como incompleto.
- Filtra por el valor exacto `energy_bandpassname=SPHEREx-D<n>` y compara
  los productos por ruta FITS on-premises (`access_url` vs URI TAP),
  no por fechas redondeadas.
- Mide tiempo HTTP, parseo, número de filas, compatibilidad **sintáctica**
  de URLs de recorte, DR1/QR3, primera/última observación, coincidencias
  y ejemplos limitados de productos exclusivos de cada método.

Las diferencias de conteo NO indican automáticamente que SIA2 esté mal:
TAP compara un punto exacto mediante `CONTAINS(POINT, p.poly)`, mientras
que SIA2 usa una circunferencia de 1 arcsec; SIA2 puede ir ~1 día por detrás
de TAP durante la ingestión y TAP puede devolver una selección distinta.
Si SIA2 devuelve `OVERFLOW`, no deben interpretarse sus cifras como totales.
Una URL de recorte compatible en sintaxis no garantiza que el servidor FITS
la entregue en ese momento.

El resultado es privado a la sesión temporal en memoria y se almacena
en caché para evitar repetir solicitudes SIA2 idénticas al reabrir el panel.
El JSON mostrado al navegador excluye URLs FITS y los identificadores de
trabajos TAP; las sesiones desaparecen al reiniciar el proceso.

Pruebas: `server/tests/test_sia2_comparison.py` utiliza respuestas VOTable
simuladas sin consumir IRSA. Un resultado real (latencia/cobertura) solo
puede verificarse al ejecutar la comparación desde el equipo del usuario.

## Recuperación SIA2 ante ConnectTimeout

El comparador SIA2 realiza GET de metadatos. Como TAP y SIA pueden presentar
demoras variables de conexión, el comparador usa un tiempo máximo de conexión
de **12 s** y lectura de **40 s** por intento, con un máximo de **3 GET**
y esperas de **1 y 3 s** entre fallos transitorios. Un GET de metadatos es
idempotente: los reintentos no generan trabajos TAP ni descargan FITS.

Solo se reintentan ConnectTimeout, ReadTimeout, ConnectionError y HTTP
429/500/502/503/504. Un error de certificado (SSLError), HTTP 400/403/404
o QUERY_STATUS=ERROR dentro del VOTable falla inmediatamente.

En una comparación exitosa se incluyen las métricas `sia2.attempts` y
`sia2.retry_events` (tipo de fallo y tiempo de cada solicitud). Si los
tres intentos fallan, el cliente recibe un error explicativo sin direcciones
de archivos FITS. Una comparación ya exitosa se conserva en caché en la
sesión del catálogo TAP. Estos cambios **no garantizan** que IRSA esté
disponible, y no demuestran ventaja de SIA2 hasta obtener resultados reales.


## SIA2 como búsqueda principal; TAP como respaldo

En el explorador, el método seleccionado por defecto es **SIA2 (rápido)**.
La búsqueda de imágenes reales llama primero a `POST /api/search/sia2`:
- Valida parámetros con el contrato `SearchStart` existente.
- Ejecuta `query_sia2` (metadatos VOTable) sin crear trabajo TAP.
- Acepta únicamente `QUERY_STATUS=OK`; un catálogo `OVERFLOW` no se
  representa como completo.
- Filtra el detector `SPHEREx-Dn`, construye enlaces de recorte FITS
  válidos para IRSA y selecciona épocas equiespaciadas con fechas MJD.
- Crea una sesión temporal `source=sia2` compatible con el mismo endpoint
  `/api/frame/{search_id}/{index}` para obtener los PNG reales.
- Devuelve `discovery` con latencia, intentos, filas válidas y estado SIA2.

Si la solicitud SIA2 falla con error de servicio 502/503/504, React activa
**exactamente un** trabajo TAP asíncrono como respaldo, conserva su
telemetría y muestra el motivo de la sustitución. Si TAP no acepta ese
trabajo, la interfaz explica los dos fallos; no repite automáticamente
el POST TAP, que no es idempotente. Una respuesta SIA2 completa de cero
épocas es válida: **no crea TAP para forzar resultados**.

Existe además un selector para usar **TAP asíncrono (comparación manual)**
desde el inicio; el botón «Medir SIA2 y comparar» sigue disponible
únicamente para sesiones TAP completas. El modo demo no cambia.

La coincidencia de 48 resultados del detector 2 entre SIA2 y TAP para
WISE 0855 es solo una coincidencia de recuentos, **no prueba identidad
de archivos**. No se promete cobertura idéntica para otras coordenadas
ni que un enlace FITS válido sea descargable; IRSA continúa siendo una
dependencia externa sujeta a retrasos, errores y cadencias de ingestión.

Las sesiones de búsqueda y frames siguen siendo efímeras en RAM, sin
escrituras en PostgreSQL ni cambios en la lógica de imagen.


## Búsquedas astronómicas persistentes (PostgreSQL + S3)

El explorador ahora usa `/api/sky/jobs` en lugar del catálogo y los
fotogramas orquestados por el navegador. El servidor procesa el trabajo
independientemente de la pestaña que lo inició:

- `POST /api/sky/jobs`: crea de forma idempotente una búsqueda con un
  `job_id` UUIDv4 generado por el navegador. Repetir el POST desde otra
  pestaña con idénticos parámetros devuelve el mismo trabajo.
- `GET /api/sky/jobs/{id}`: consulta la fase y el progreso real desde
  PostgreSQL (sin expiración de una hora).
- `GET /api/sky/jobs/{id}/frames/{index}`: recupera un PNG privado de
  almacenamiento S3; los archivos no se almacenan como BYTEA en PostgreSQL.
- `DELETE /api/sky/jobs/{id}`: cancela explícitamente el trabajo activo;
  no elimina resultados ya persistidos.

Una cola limitada admite hasta 12 trabajos activos, 2 búsquedas ejecutándose
en paralelo y hasta 3 fotogramas concurrentes por búsqueda. El despachador
recupera trabajos interrumpidos después de reiniciar el servidor; un lease
de base de datos evita que dos procesos reclamen simultáneamente el mismo
trabajo. Los fotogramas ya terminados no se vuelven a descargar al reanudar.

El navegador guarda solamente UUID y parámetros públicos en `localStorage`.
Todas las pestañas del mismo origen se sincronizan mediante el evento
`storage`; cerrar/reabrir la pestaña no aborta el trabajo servidor. El
resultado no tiene caducidad programada. **Esto no implica que el login
sea indefinido**: el token JWT de acceso sigue durando 30 minutos, y su
persistencia/renovación es un asunto de seguridad independiente.

Para producción, aprovisionar un bucket S3 privado y configurar variables
de Railway por referencia al recurso bucket:

```
SKY_S3_ENDPOINT
SKY_S3_BUCKET
SKY_S3_REGION
SKY_S3_ACCESS_KEY
SKY_S3_SECRET_KEY
```

En desarrollo, si APP_ENV no es production y faltan esas variables, se usan
archivos locales bajo `server/.sky-frames/`. La consulta real utiliza SIA2
idempotente: si falla, marca error recuperable manualmente en vez de crear
automáticamente un TAP remoto cuyo POST no sea seguro repetir después de una
caída de proceso. Los endpoints TAP históricos siguen disponibles para otros
consumidores, pero ya no rigen el flujo persistente.

Los IDs son capacidades difíciles de adivinar. En este prototipo, quien
posea el enlace/ID puede consultar los datos astronómicos públicos y
cancelar ese trabajo; no guardar datos privados o secretos de cuenta allí.
Guardar datos sin vencimiento implica costes crecientes de almacenamiento:
vigilar el uso de PostgreSQL y S3. No se borran búsquedas automáticamente.
