# Sistema de gestión · Inventario físico vs SAP

Tres piezas que salen del **mismo análisis**, por eso las cifras coinciden entre ellas:

| Pieza | Archivo | Para qué |
|---|---|---|
| **Sistema interactivo** | `Sistema - Inventario fisico vs SAP.html` | Revisar, decidir y registrar. Es la herramienta de trabajo. **Un solo archivo.** |
| **Excel** | `Inventario fisico vs SAP - analisis.xlsx` | Analizar y seguir trabajando sobre los datos. Con fórmulas vivas. |
| **PDF** | `Inventario fisico vs SAP - informe integral.pdf` | Explicar el caso y los resultados a quien no vio nada de esto. 85 páginas. |

---

## Cómo abrir el sistema

**Doble clic en `Sistema - Inventario fisico vs SAP.html`.**

Es **un único archivo autocontenido**: los datos, el código y los estilos están adentro.
No necesita internet, ni instalación, ni servidor, ni ningún otro archivo al lado. Se
puede guardar en el escritorio, mandar por correo o dejar en una carpeta compartida, y
funciona igual. No envía datos a ningún lado.

Si al hacer doble clic se abre un editor en vez del navegador: clic derecho →
*Abrir con* → Chrome o Edge.

> **Para desarrollo**, el mismo sistema está separado en archivos dentro de la carpeta
> `sistema/` (`index.html`, `app.js`, `informe.js`, `exportar.js`, `xlsxmin.js`,
> `estilos.css`, `datos.js`). El archivo único se regenera con
> `python3 scripts/v3/empaquetar.py`. Para usarlo día a día alcanza con el archivo único.

## Cómo trabajar

1. Escribí tu nombre arriba a la derecha, en **Revisor**. Queda registrado en cada decisión.
2. En el **Panel**, hacé clic en el indicador que quieras trabajar: se abre su listado.
3. En **Casos**, filtrá por base, tipo, clasificación, motivo, estado o buscá por texto,
   código SAP o nomenclatura. Hacé clic en una fila para abrir la ficha.
4. En la ficha vas a ver de dónde sale el dato, qué candidatos se evaluaron, en qué
   coincidían y en qué se contradecían, y por qué el análisis decidió lo que decidió.
   Ahí confirmás, corregís el código, aprobás, rechazás o dejás una observación.
5. Al terminar, **Descargar Excel** y **Descargar PDF** exportan todo con tus decisiones.

### Dónde quedan las decisiones

En el almacenamiento local del navegador, **en esa computadora**. No se sincronizan.
Dos consecuencias prácticas:

- Si trabajás desde otra máquina, no vas a ver las decisiones de la primera.
- Si limpiás los datos del navegador, se borran.

**Por eso conviene exportar el Excel al terminar cada sesión de trabajo**: es el
respaldo y también la forma de compartir lo decidido. El Excel trae una hoja
«Decisiones» con el historial completo: qué se cambió, quién y cuándo.

---

## Qué hace el análisis

El universo son **los inventarios físicos**, no SAP:

| Base | Sistema | Ítems | Unidades |
|---|---|---|---|
| San Juan | AVAIN | 163 | 21.732 |
| Neuquén | Sistema Nico (informe IHSA) | 243 | 33.107 |
| Salta | AVAIN | 281 | 32.524 |
| **Total** | | **687** | **87.363** |

Cada ítem se cruza contra el maestro de SAP (1.038 códigos, 1.482 combinaciones
material-base). **Una coincidencia sólo se acepta si está justificada por las
características del material**, nunca por el parecido del nombre: concentración,
forma farmacéutica, volumen, calibre, medidas, talle, modelo o referencia, longitud,
población y cantidades sin unidad.

Tres reglas:

1. Si los dos lados declaran la misma característica con valores distintos, **no son el
   mismo material**: el candidato se descarta y queda el motivo registrado.
2. Si una característica se declara de un lado y no del otro, **nada quedó verificado**
   y el caso va a revisión.
3. Sólo se identifica por el nombre un material que no declara ninguna característica
   de ningún lado (un otoscopio, un glucómetro, una llave de 3 vías).

### Las cinco clasificaciones

| | Casos | Qué significa | Acción |
|---|---|---|---|
| **A** Identificado en SAP | 227 | Código verificado por nomenclatura y presentación | Mantener |
| **B** Candidato a alta | 58 | Existe físicamente, no hay material que corresponda | Proponer alta |
| **C** Candidato a baja | 894 | Stock en SAP que ningún inventario identificó en esa base | Proponer baja |
| **D** Requiere revisión | 402 | No se resuelve solo | Revisar y decidir |
| **E** Fuera del alcance | 410 | Indumentaria, equipos y repuestos | **No concluir nada** |

**Por qué existe la E:** el inventario relevado es de Farmacia. Los materiales que no son
medicamentos ni descartables nunca iban a figurar en él, así que su ausencia no prueba
nada. Tratarlos como candidatos a baja sería una conclusión falsa.

---

## Dos advertencias importantes

### 1. No hay precio de última compra

El criterio de valorización pedido es **precio de última compra**, y ese dato **no está
en ninguno de los archivos recibidos**. Se revisaron campo por campo:

- La bajada de SAP tiene «Valor libre util.» (valorización contable del stock) y un
  valor unitario derivado. No tiene precio de compra, ni fecha, ni proveedor, ni documento.
- El archivo de homologación declara que los campos de costo quedan fuera de ese trabajo.
- Los tres PDF de inventario no contienen ninguna mención de precio ni de compra.

Por eso **los 1.991 casos figuran como pendientes de valorización** y no se informa
ningún total. No se estimó ningún precio.

Lo que sí se muestra, siempre rotulado como tal, es la valorización de stock de SAP.
**No es lo mismo** y no debe presentarse como precio de compra.

**Para completarla**, hace falta una bajada por material con: código SAP, precio
unitario, moneda, fecha de la compra, documento de respaldo y proveedor. El sistema la
admite y recalcula solo; las fórmulas del Excel ya están puestas para eso.

### 2. Las altas y las bajas son propuestas, no acciones

Nada de este trabajo modifica SAP. La propuesta conversada —crear lo no encontrado y dar
de baja lo restante— se interpretó como **criterio de clasificación, no como
autorización**.

Además, la lista de candidatos a baja es **provisional mientras queden casos en
revisión**: hoy hay **156 candidatos a baja** que figuran como posible equivalencia de un
ítem todavía sin resolver. Si esos casos se resuelven a favor, dejan de ser bajas. El
sistema avisa antes de dejar aprobar una de ellas.

---

## Un hallazgo que conviene mirar

**48 ítems están identificados pero SAP no registra stock de ese material en su base.**
Hay existencia física y el código existe. No son altas: lo que corresponde es registrar
la existencia en ese centro o revisar dónde está cargado el stock. Se filtran en el
sistema y están marcados en el Excel.

---

## El Excel

Once hojas: `Resumen` (indicadores, todos fórmulas sobre `Casos`), `Casos` (el detalle
completo, 37 columnas), las cinco hojas operativas `A` a `E`, `Lotes` (trazabilidad al
lote original), `Decisiones` (historial), `Control` (integridad contra las fuentes, con
fórmulas vivas) y `Metodología`.

Tiene fórmulas reales —`COUNTIFS`, `SUMIFS`, `SUBTOTAL`—, formatos numéricos y de fecha,
filtros, panel fijo y anchos de columna. Los totales usan `SUBTOTAL`, así que **respetan
el filtro aplicado**.

## Verificación hecha

- Los filtros, la búsqueda, la ficha, las decisiones y la persistencia se probaron en un
  navegador real, sin errores de JavaScript.
- El Excel exportado se abrió y recalculó: los 1.991 casos y todos los cortes por base y
  por tipo coinciden con el sistema.
- El PDF tiene 85 páginas; cada número de página impreso coincide con la página real y
  cada entrada del índice cae en su sección.
- Los controles de integridad comparan los totales del sistema contra los de los archivos
  originales: los 7 cierran.

## Los archivos originales no se tocaron

Se conservan tal como se recibieron. El Excel del trabajo anterior
(`Stock SAP vs Inventario Fisico Avain - cruce.xlsx`) también se mantiene sin cambios.
