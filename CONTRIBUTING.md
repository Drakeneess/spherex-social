# Contribuir a AstroGram

Gracias por querer mejorar AstroGram. El objetivo es mantener una experiencia agradable **sin sacrificar la trazabilidad de los datos astronómicos**.

[← Portada](README.md) · [Desarrollo](docs/DEVELOPMENT.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Criterios científicos](docs/SCIENCE.md)

## Antes de escribir código

1. Revisa el comportamiento en `main`, los tests relacionados y la [arquitectura](docs/ARCHITECTURE.md).
2. Separa un cambio por rama y un objetivo por pull request.
3. Documenta el efecto visible, la compatibilidad y los riesgos sobre datos existentes.
4. Nunca uses cuentas, publicaciones, identificadores privados ni credenciales de producción como datos de prueba.
5. Comprueba el funcionamiento en escritorio y móvil cuando modifiques interfaces.

## Convenciones

| Área | Recomendación |
|---|---|
| Frontend | React + TypeScript; componentes claros y accesibles |
| Backend | FastAPI + modelos Pydantic + SQLAlchemy |
| Datos | Migraciones Alembic versionadas; sin cambios manuales de esquema |
| Astronomía | Conservar FITS y metadatos; identificar siempre simulaciones/revelados |
| Persistencia | Respetar trabajos archivados y las claves privadas S3 |
| Interfaz | Navegación por teclado, tamaño táctil cómodo y movimiento reducido |
| Comunicación | Explicar errores de IRSA con precisión, sin presentar fallos como ausencia de observaciones |

## Comprobar el cambio

```bash
cd web
npm ci
npm run build
npm test
cd ../server
python -m pytest -q
```

Antes de unir una PR verifica además las pruebas y la migración en PostgreSQL cuando afecte a persistencia.

## Qué incluir en una pull request

- Contexto y problema observado.
- Solución y rutas/componentes modificados.
- Pruebas ejecutadas y resultados.
- Capturas **sin datos personales** para cambios visuales.
- Notas sobre ciencia, privacidad, compatibilidad y despliegue.

## Política de datos y seguridad

No subas archivos `.env`, claves, tokens, volcados de base de datos, capturas que contengan información personal ni observaciones privadas. No borres ni reescribas objetos del bucket sin inventariar sus referencias y contar con una copia verificable.

Si identificas una vulnerabilidad con impacto real, comunícala **de forma privada a los responsables del repositorio**, sin publicar pasos de explotación ni secretos en una incidencia pública.

---

El criterio de aceptación básico es que **una mejora estética no rompa las búsquedas reales ni el contenido existente**, y que un experimento científico no se presente como un descubrimiento confirmado.
