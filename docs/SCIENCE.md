# Procedencia y límites científicos

[← AstroGram](../README.md) · [Arquitectura](ARCHITECTURE.md)

AstroGram permite **explorar y comunicar observaciones astronómicas**; no sustituye los análisis, pipelines, publicaciones ni validaciones científicas de la misión SPHEREx.

## Tres clases de contenido que no deben confundirse

| Contenido | Fuente | Interpretación correcta |
|---|---|---|
| Épocas reales | Imágenes disponibles en NASA/IPAC IRSA | Datos astronómicos auténticos, con fecha y procedencia |
| Revelado | Transformación visual de los FITS anteriores | *Falso color* y contraste artístico; no modifica el dato original |
| Demostración y minijuego | Datos sintéticos identificados | Material educativo/interactivo, **no** observaciones SPHEREx |

Las ilustraciones de cartas zodiacales son mapas de referencia y sus líneas representan asterismos ilustrativos, **no** límites oficiales de la UAI.

## Descubrimiento de observaciones

La búsqueda parte de una región del cielo (ascensión recta, declinación, campo angular), un detector y un número deseado de épocas:

1. **SIA2** consulta productos de imagen disponibles en IRSA.
2. Si SIA2 no responde correctamente, **TAP** permite localizar registros mediante una consulta de catálogo asíncrona.
3. Si ambos métodos fallan, AstroGram puede ofrecer imágenes previamente archivadas, pero **solo si coinciden exactamente todos los parámetros**. Esas imágenes no se describen como observaciones nuevas.
4. Si no existe una coincidencia, se muestra el problema de disponibilidad; no se fabrican resultados.

Los metadatos del catálogo y la disponibilidad de un archivo pueden cambiar con el tiempo. Un error HTTP de IRSA **no demuestra** que una región carezca de observaciones.

## Visualización de épocas y revelado

- Los productos FITS preservan valores y cabeceras de origen cuando se archivan.
- Las imágenes rápidas PNG son visualizaciones, no mediciones fotométricas.
- Las paletas cian/violeta/ámbar, la normalización, gamma y otras herramientas cambian **solo la representación visual**.
- Las épocas pueden diferir en sensibilidad, orientación, detector, calidad y cobertura.
- Comparar un detector SPHEREx no significa seleccionar una única banda espectral monocromática.
- No asumas que dos imágenes alineadas y visualmente distintas representan una fuente en movimiento real.

## Candidatos de movimiento: señal ≠ descubrimiento

La búsqueda experimental de movimiento ofrece **señales para inspección manual**. No identifica de forma concluyente asteroides conocidos, artefactos instrumentales ni objetos inéditos; tampoco proporciona por sí sola evidencia de Planet X.

Para formular una conclusión científica se necesitarían, entre otros elementos, identificación de las observaciones, astrometría y calibración controladas, comprobación de artefactos, comparación multiepoca y revisión independiente. **La ausencia de un candidato tampoco descarta que exista movimiento.**

## Buenas prácticas al compartir un hallazgo

- Conserva región, detector, fechas, imágenes y, cuando corresponda, origen del archivo.
- Indica si es una vista rápida, un revelado o una demostración.
- Prefiere expresiones como «posible cambio» o «candidato para inspección».
- No atribuyas confirmaciones a NASA/IPAC, a la misión SPHEREx ni a AstroGram sin una validación explícita.
- No presentes falsos colores ni mapas ilustrativos como una reproducción espectral literal.

## Referencias

- [NASA/IPAC Infrared Science Archive](https://irsa.ipac.caltech.edu/)
- [Misión SPHEREx](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [Acceso a datos SPHEREx en IRSA](https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/)
- [Interfaz TAP de IRSA](https://irsa.ipac.caltech.edu/docs/program_interface/TAP.html)
- [Unión Astronómica Internacional](https://www.iau.org/)

**Atribución:** AstroGram es una iniciativa independiente. El uso de datos públicos de IRSA no implica patrocinio, certificación científica ni aprobación institucional de la plataforma.
