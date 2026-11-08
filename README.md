# Lector

Lectura en voz alta con subrayados y notas para investigación. HTML + JavaScript, sin instalación ni compilación.
Libros, notas y subrayados se guardan solo en el navegador de cada aparato: nada sale de él.

## Cómo abrirlo
- **En línea / Android:** https://oestranog.github.io/lector/ — en Chrome, menú ⋮ → «Agregar a pantalla principal».
  Queda como app y funciona sin conexión; se actualiza sola cuando hay versión nueva.
- **PC sin internet:** doble clic en `index.html` (Chrome o Edge).
- **Teléfono servido desde el PC (pruebas, misma Wi-Fi):** doble clic en `servir.bat`; en el teléfono,
  Chrome → `http://IP-DEL-PC:8765` (la IP que muestra la ventana).
  Para que funcione todo (compartir, pantalla encendida, instalar): en el teléfono,
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → escribir esa dirección → Enabled → Relaunch.

Cada forma de abrirlo (archivo, dirección local, dirección en línea) tiene su propia biblioteca en el navegador.

## Qué hace
1. **Voz:** lee frase por frase con la voz del sistema y el texto en pantalla sigue a la voz. Botón 🔊/🔇.
2. **Desde aquí / Hasta aquí:** copia el fragmento con fecha, hora, páginas y la cita APA.
   Un solo archivo por libro: `Titulo_notas.txt` (ficha arriba, notas debajo, acumulado entre sesiones).
   - PC: el botón **+** pide la **carpeta del libro**; el .txt se guarda ahí mismo, junto al libro, tras cada nota.
     (Libros cargados antes sin carpeta: se pide la carpeta al guardar la primera nota.)
   - Android (navegador): no se puede escribir junto al libro; 📑 Notas → «Guardar .txt» lo comparte o descarga.
   - También se puede **seleccionar texto** en pausa (ratón o dedo) y tocar «✎ Subrayar selección».
3. **Subrayados (📑 Notas, abajo; y panel izquierdo en PC):** «Ir» salta al sitio, «Copiar con cita».
4. **Encabezados y pies:** al cargar un PDF se agrupan por patrón (los números cuentan como uno solo)
   y se premarcan los que se repiten con regularidad. El número de página impreso se deduce del pie.
5. **Partes:** al cargar, el libro se procesa una vez y se guarda dividido por capítulos o cada N páginas/palabras.
   Solo la parte en curso se carga en memoria.

## Archivos
| | |
|---|---|
| `js/parser.js` | PDF / EPUB / TXT → páginas y líneas |
| `js/importar.js` | detección de encabezados, filtro, páginas impresas y partes |
| `js/lector.js` | motor de lectura (silencioso y con voz) |
| `js/notas.js` | ficha, cita APA y archivo .txt |
| `js/db.js` | almacenamiento en el navegador (IndexedDB) |
| `js/app.js` | interfaz |
| `sw.js` | copia sin conexión; **subir `VERSION` al cambiar archivos** |

## Límites conocidos
- PDF escaneado (imagen, sin texto seleccionable): no se puede leer; necesitaría OCR.
- En EPUB no hay páginas: la cita sale sin número de página.
- En Chrome para Android la voz no informa palabra por palabra: la sincronía dentro de cada frase es estimada.
- Los datos viven en el navegador donde se cargó el libro; PC y teléfono no se sincronizan entre sí.
