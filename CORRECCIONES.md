# Correcciones aplicadas sobre la versión revisada

**Archivo:** `Stock SAP vs Inventario Fisico Avain - cruce.xlsx`
**Base:** la bajada original de SAP (`Stock Centro SJ NQN y Salta 02.10.xlsx`). No se rehízo nada desde cero: se conservaron filas, formato y fórmulas, y se corrigió sólo lo señalado.

---

## 1. Los comentarios del archivo y qué se hizo con cada uno

Los cinco comentarios estaban en la hoja `Resumen del cruce`, filas 10 a 12.

| Celda | Comentario | Resolución |
|---|---|---|
| C10 | *«dejar»* (Stock SAP Libre utilización) | Se conserva como primer indicador. |
| D10 | *«debería contabilizar TODO EL INVENTARIO, no sólo lo que tiene SAP»* | El indicador ahora es `=SUMIFS(...)` sobre **todas** las filas de la base, incluidos los 196 ítems sin código SAP. Total 87.363 unidades. |
| E10 | *«DEJAR: contabilizando todo»* | La diferencia se calcula sobre el inventario físico completo. |
| E11 | *«desde este: que describa cuanto dar de baja, cuanto agregar, y cuanto no está en sap»* | Las columnas siguientes son: cantidad a dar de baja, cantidad a dar de alta, ítems sin correspondencia y cantidad sin correspondencia. |
| E12 | *«Agregar una columna más con la diferencia económica. El resto eliminar»* | Se agregó **Diferencia económica** (más la porción con alerta y la neta sin alertas). Se retiró del tablero el resto de columnas; el desglose por certeza no se borró, quedó documentado en un bloque aparte de la misma hoja. |

### Ajustes estructurales que venían marcados en las hojas `(2)`
Las hojas `1120 SJ (2)`, `1130 Salta (2)` y `1060 NQN (2)` traían tres cambios, todos incorporados:

1. **Bloque de datos contiguo:** se quitaron la fila de totales, la fila en blanco y la fila de rótulo que cortaban los datos.
2. **Columna O sin depender de la fila de totales:** `=M2/SUM($M$2:$M$679)`.
3. **Las filas del inventario físico identificadas.** En la revisión se resolvió escribiendo el rótulo en la columna *Material*; acá se hizo con una columna propia, **Origen del registro**, para no ocupar la columna de código SAP (que debe quedar vacía) y para que el filtro sirva.

> **La causa de fondo del problema de filtros:** el autofiltro terminaba en la última fila de SAP (`A1:AI679`), así que las 52/93/51 filas del inventario físico **quedaban fuera del filtro**. Ahora cubre todo el bloque (`A1:AO731`, `A1:AO2074`, `A1:AO578`).

---

## 2. Correcciones funcionales

### Estructura unificada y filtrable
Se agregó la hoja **`Conciliación`**: **una fila por material**, 1.678 registros, con base, centro, origen, clasificación, alcance, código y nomenclatura SAP, código y nombre Avain, cantidad SAP, cantidad física, diferencia, VU, valores, diferencia económica, nivel, estado de homologación, acción y observaciones. Con filtro y encabezado congelado. Es la hoja para tomar un material y seguirlo de punta a punta.

Las cantidades se traen por `SUMIF` desde las hojas de detalle, así que **cualquier corrección en el detalle se refleja sola**.

### Todo el inventario SAP, no sólo medicamentos y descartables
Clasificaciones presentes: **Medicamentos (ZMED) 616, Descartables (ZDES) 456, Uniformes (ZUNI) 403, Equipos (ZEQI) 5, Repuestos (ZERS) 2.**

Los inventarios de Avain son de Farmacia: cubren medicamentos y descartables. **Uniformes, equipos y repuestos tienen 0 % de cobertura en las tres bases**, así que ya no se leen como falta de coincidencia. La lógica ahora distingue cuatro situaciones:

| Situación | Filas |
|---|---:|
| Fuera del alcance del inventario físico (uniformes, equipos, repuestos) | 410 |
| Sin recuento físico, estando dentro del alcance | 639 |
| Con recuento y diferencia (baja / alta / sin diferencia) | 433 |
| Sin correspondencia en SAP (ítem físico sin código) | 196 |

### Diferencia económica a valor promedio ponderado
- **VU promedio ponderado** del material = `suma de Valor libre util. / suma de Libre utilización`. Control: reconstruir el valor como cantidad × VU reproduce **exactamente** el valor informado por SAP en las tres hojas.
- **Diferencia económica** = diferencia de cantidades × VU, sólo donde hay recuento y la diferencia es real.
- **Se corrigió la columna S.** Se llamaba *Diferencia economica* pero calculaba `VU × cantidad física`, que es el valor del recuento, no una diferencia. Ahora es `VU × Diferencia Q`. El cálculo anterior se conserva en la columna *Valor del recuento físico*.
- **Se eliminaron 160 `#DIV/0!`** de la columna P (VU), que aparecían donde la cantidad es 0. Se envolvió en `IFERROR`; en todas esas filas el valor en SAP también es 0, así que no se perdió información.
- Los ítems sin código SAP **no tienen VU**: su diferencia económica no se calcula y figura como dato faltante. No se estimó ningún valor.

### Signo de las diferencias
`Diferencia = Libre utilización (SAP) − Cantidad física`, la fórmula que ya traía SAP.
**Positiva → dar de baja** (SAP informa más que lo contado). **Negativa → dar de alta** (lo contado supera a SAP).

### Hojas operativas
- **`Dar de baja en SAP`**: 319 materiales, 404.494 u, $ 137.514.564,42
- **`Dar de alta en SAP`**: 105 materiales, 17.179 u, $ 348.117.317,53
- **`Sin correspondencia SAP`**: 196 ítems, 7.466 u, sin valorización posible

### Control de cantidades
Hoja nueva que compara cada fuente original con lo usado. **Todo coincide** salvo una diferencia propia del informe de Avain, que queda marcada *A revisar*:

| Fuente | Original | Usado | Dif. |
|---|---:|---:|---:|
| PDF San Juan (suma de Stock) | 21.732 | 21.732 | 0 |
| PDF Salta (suma de Stock) | 32.524 | 32.524 | 0 |
| PDF Neuquén (Conciliación) | 33.107 | 33.107 | 0 |
| PDF Neuquén (TOTAL MEDICAMENTO) | 33.107 | 33.107 | 0 |
| PDF Neuquén (suma de saldos por lote) | 33.072 | 33.107 | **−35** |
| SAP 1120 / 1060 / 1130 (cantidad y valor) | — | — | 0 |

Aclaración: el rótulo `TOTAL: 202` / `TOTAL: 650` de los PDF de San Juan y Salta es la **cantidad de renglones**, no la suma de stock. Ambas cosas se verificaron por separado.

---

## 3. Indicadores del Resumen

| Base | Stock SAP | Inv. físico (todo) | Diferencia | SAP contado | Dif. contado | A dar de baja | A dar de alta | Ítems s/corresp. | Cant. s/corresp. | Diferencia económica |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| San Juan | 87.123 | 21.732 | 65.391 | 57.722 | 37.087 | 39.454 | 2.367 | 52 | 1.097 | 21.477.853 |
| Neuquén | 671.967 | 33.107 | 638.860 | 381.618 | 351.255 | 354.178 | 2.923 | 51 | 2.744 | −215.089.952 |
| Salta | 37.614 | 32.524 | 5.090 | 27.872 | −1.027 | 10.862 | 11.889 | 93 | 3.625 | −16.990.654 |
| **TOTAL** | **796.704** | **87.363** | **709.341** | **467.212** | **387.315** | **404.494** | **17.179** | **196** | **7.466** | **−210.602.753** |

Todos los indicadores son `SUMIFS` / `COUNTIFS` sobre `Conciliación`. No hay valores fijos.

---

## 4. Datos pendientes de validación

1. **Alerta de valorización — posible diferencia de unidad de medida (29 materiales).** Se marcan cuando el VU supera 20 veces la mediana de la base con diferencia mayor a 10 unidades, o cuando la relación de cantidades SAP/recuento supera 50 a 1.
   **El caso decisivo:** `2001077 ELECTRODOS C/CONECTOR PARA DESFIBRILADOR` (Neuquén): 5 unidades en SAP por $1.047.361 (VU $209.472) contra 1.465 contadas. **Por sí solo mueve la diferencia económica de Neuquén de +$89,9 M a −$215 M.** Casi seguro SAP cuenta cajas y el recuento cuenta unidades. Hasta que se confirme, la diferencia económica global no debe tomarse como definitiva: el Resumen la muestra con y sin las filas marcadas.
2. **196 ítems sin correspondencia en SAP: sin valor unitario.** La diferencia económica de 7.466 unidades no puede calcularse.
3. **29 códigos de Neuquén** cuya homologación no coincide con el producto del inventario (p. ej. `345` = Máscara p/nebulizar en la homologación, *ELECTRODOS* en el inventario). El vínculo por código se descartó y se cruzó por nomenclatura.
4. **17 códigos de Neuquén que identifican dos productos distintos cada uno** (`529` = Tijera punta roma y Cloruro de potasio; `532` = Mango de bisturí y Clonazepam). El cruce se hace por código + denominación.
5. **−35 unidades en el informe de Neuquén**, entre stock actual y saldo de movimientos: Adrenalina 1mg/mL (15) y Metronidazol 500mg (20). Se conservó el stock actual, que es el total declarado.
6. **50 posibles duplicidades de código SAP** y materiales que reciben varias denominaciones de Avain.
7. **106 materiales con recuento que no estaban en el Master de Seba.**
8. **639 materiales de medicamentos y descartables sin recuento físico.** Falta definir si no se contaron o no están en el depósito: son 329.492 unidades de stock SAP que hoy no son comparables.
9. **Homologación incompleta:** 89 ítems del Master con más de un código SAP candidato y 17 sin candidato.

---

# Segunda ronda de correcciones

## 1. `Cantidad fisica(recuento)` e `Inventario físico Avain del material` ahora coinciden

Tenías razón: no daban lo mismo. `Q` se completaba **una vez por material** (en su primera fila) y `Inventario físico Avain del material` **se repetía en todas las filas** del material, así que al totalizar daba de más.

Ahora las columnas de nivel material que son **sumables** se completan una sola vez, en la primera fila del material, igual que `Q`. Y la columna se calcula con la fórmula `=Q` de su propia fila, así que son idénticas por construcción.

Verificado sobre el archivo recalculado:

| Hoja | Suma `Q` | Suma `Inventario físico del material` | Suma `I` | Suma `Cantidad SAP del material` |
|---|---:|---:|---:|---:|
| 1120 SJ | 21.732 | 21.732 ✔ | 87.123 | 87.123 ✔ |
| 1060 NQN | 33.107 | 33.107 ✔ | 671.967 | 671.967 ✔ |
| 1130 Salta | 32.524 | 32.524 ✔ | 37.614 | 37.614 ✔ |

El `VU promedio ponderado` sí sigue en todas las filas, porque es un **precio por unidad**, no una cantidad: repetirlo no altera ningún total y la columna S lo necesita fila por fila.

## 2. `Diferencia económica` ahora da el total de la columna S

El indicador del Resumen pasó a ser `=SUM('1120 SJ'!S2:S731)` y sus equivalentes. Para que esa igualdad se cumpla de verdad hubo que unificar un criterio: **la columna S ahora valoriza al VU promedio ponderado del material**, no al VU de cada fila. Si no, la suma de S difería de la valorización a nivel material cuando un material tiene varias filas con precios distintos.

Verificado:

| Base | Resumen · Diferencia económica | Suma de la columna S | Conciliación |
|---|---:|---:|---:|
| San Juan | $ 123.634.045,23 | $ 123.634.045,23 ✔ | |
| Neuquén | $ 23.871.499,06 | $ 23.871.499,06 ✔ | |
| Salta | $ 28.834.110,72 | $ 28.834.110,72 ✔ | |
| **TOTAL** | **$ 176.339.655,02** | **$ 176.339.655,02** ✔ | **$ 176.339.655,02** ✔ |

> **Atención al cambio de significado.** La columna S valoriza la diferencia de **todas** las filas, incluidas las de materiales que el inventario no contó (donde la "diferencia" es todo el stock de SAP). Por eso el total es +$176,3 M y no los −$210,6 M de antes, que sólo consideraban materiales contados.
> Las dos cifras están en el Resumen, separadas y rotuladas: **columna 10** es el total de S (lo que pediste) y **columna 11** es la diferencia económica de los materiales contados, que es el importe del ajuste operativo.

## 3. Unidades e importes, siempre explícitos

- Cada encabezado termina en **`· UNIDADES`**, **`· IMPORTE $`** o **`· CANTIDAD DE ÍTEMS`**.
- Todos los importes se muestran con el signo **`$`** en el formato de celda. Si no tiene `$`, son unidades.
- Las columnas del Resumen están numeradas de 1 a 13 y las fórmulas se citan por ese número.

## 4. Se renombró la columna que no se entendía

`Diferencia sobre lo contado` → **`5. Diferencia neta de esos materiales contados (= 6 − 7) · UNIDADES`**, con comentario en la celda.

Es el ajuste **neto** en unidades de los materiales que sí se contaron: lo que sobra menos lo que falta. Verificado que es exactamente la columna 6 menos la 7:

| Base | Col. 5 | Col. 6 − Col. 7 |
|---|---:|---:|
| San Juan | 37.087 | 39.454 − 2.367 = 37.087 ✔ |
| Neuquén | 351.255 | 354.178 − 2.923 = 351.255 ✔ |
| Salta | **−1.027** | 10.862 − 11.889 = −1.027 ✔ |

En Salta es negativo porque se contó **más** de lo que SAP informa.

## 5. Hoja nueva: `Guía paso a paso`

Primera hoja del libro, escrita sin dar nada por sabido. Nueve secciones:

1. **¿Qué hace este archivo?** — las dos listas que compara y por qué hay que homologar nombres.
2. **Dos reglas para no confundirse** — unidades vs. pesos, y qué significa el signo de la diferencia.
3. **Qué hay en cada hoja** — una línea por hoja, con cuándo usarla.
4. **Paso a paso: revisar UN material** — 7 pasos sobre un caso real del archivo (`2000028 JERINGA 10 ML` de San Juan: SAP 2.367, contado 918, diferencia 1.449, VU $94,90, importe $137.512,84). Los números de la guía se verificaron contra el archivo.
5. **Paso a paso: qué ajustar en SAP** — 5 pasos por las tres hojas operativas.
6. **Los seis estados posibles** — qué significa cada valor de `Acción en SAP` y qué hacer, aclarando que *Sin recuento físico* y *Fuera del alcance* no son faltantes.
7. **Las cuentas** — las tres fórmulas con el ejemplo numérico, y por qué el promedio es ponderado.
8. **Cuándo NO confiar en el importe** — el caso de los electrodos y cómo leer las tres columnas de importe.
9. **Glosario** — 11 términos: SAP, Avain, libre utilización, homologar, Master de Seba, VU, lote, almacén, ZMED/ZDES/ZUNI, BUSCARV.

## Validación de esta ronda

Libro recalculado con LibreOffice: **cero errores** (`#REF!`, `#VALUE!`, `#N/A`, `#DIV/0!`). Las dos igualdades pedidas se cumplen exactamente, el ejemplo de la guía coincide con el archivo y los totales siguen cerrando contra las fuentes originales.

---

# Corrección del archivo dañado que reportaba Excel

## El problema

Excel mostraba *«Hemos encontrado un problema con contenido de …»* y ofrecía reparar el libro. LibreOffice lo abría sin quejarse, por eso no lo había detectado antes.

**Causa:** 33.759 celdas quedaban escritas así:

```xml
<c r="X2" s="39" t="inlineStr"/>
```

La celda declara ser de tipo texto (`t="inlineStr"`) pero no trae el elemento `<is>` con el contenido, que ese tipo exige. Es XML inválido. Lo genera `openpyxl` cuando se le asigna a una celda la cadena vacía `""`: la marca como texto y después no escribe nada.

Aparecía donde el cruce no tenía dato (sin código Avain, sin ID de Master, sin códigos equivalentes) y también en campos que venían vacíos de la propia bajada de SAP, como la columna *Lote*.

**Alcance:** afectaba a 8 de las 13 hojas, y **ya estaba presente en las dos entregas anteriores**. El archivo original de SAP está limpio: el defecto lo introduje yo al generar.

## La corrección

Antes de guardar, el generador normaliza toda cadena vacía a celda realmente vacía. Se normalizaron las 33.759 celdas, sin tocar ningún dato: los totales, las fórmulas y las dos igualdades siguen dando exactamente lo mismo.

## Control permanente

Se agregó `scripts/validar_ooxml.py`, que revisa el paquete `.xlsx` con ocho controles pensados para lo que Excel valida y LibreOffice ignora:

1. Todas las partes XML parsean.
2. **Celdas de texto declaradas sin contenido** (el defecto de este caso).
3. Celdas numéricas con valor no numérico.
4. Content-types y relaciones completos y con destino existente.
5. Identificadores de relación sin duplicar.
6. `definedName` con `localSheetId` coherente con el orden de hojas.
7. Alto de fila, ancho de columna y largo de texto dentro de los límites de Excel.
8. Referencias de comentario válidas.

**El generador ejecuta este control automáticamente y falla si encuentra algo**, así que este tipo de defecto no puede volver sin que se note. También lo corre `scripts/verificar.py`.

Resultado sobre el archivo entregado: **sin problemas** en los ocho controles.

## Segunda causa del archivo dañado: valores en caché vacíos

La corrección anterior eliminó las celdas de texto sin contenido, pero **quedaba un segundo defecto**, que es el que hacía que Excel siguiera reparando el libro y, al reparar, borrara celdas enteras (por ejemplo las columnas A a E de la fila 3 de `1120 SJ`, que debían decir `2000158 · GUANTES DE EXAMINACIÓN TALLE M · 033 · ZDES`).

Dos construcciones que `openpyxl` escribe y Excel considera defectuosas:

| Construcción | Qué está mal |
|---|---|
| `<c r="N3"><f>IFERROR(...)</f><v/></c>` | la celda declara un valor numérico en caché, pero vacío: Excel no puede leer `""` como número |
| `<c r="C3" s="5" t="n"/>` | celda vacía declarada de tipo numérico |

Había **31.201** del primer tipo y **46.556** del segundo. El archivo original de SAP, que Excel abre sin quejarse, **no tiene ninguna de las dos**.

La corrección reescribe el paquete al guardar y deja el XML con la misma forma que escribe Excel. Los datos no se tocan: la fila 3 conserva su material, su texto, su cantidad SAP (3.090), su recuento (2.000) y su diferencia (1.090).

Comparación tras la corrección:

| | `<v/>` vacíos | celdas `t="n"` vacías | texto sin contenido |
|---|---:|---:|---:|
| Original de SAP | 0 | 0 | 0 |
| Archivo generado | **0** | **0** | **0** |

El validador pasó a tener **diez controles** (se agregaron los dos nuevos) y el generador lo ejecuta en cada corrida, fallando si encuentra algo.
