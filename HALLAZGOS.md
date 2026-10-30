# Cruce Stock SAP + Inventario físico Avain — hallazgos y avance

**Archivo generado:** `Stock SAP vs Inventario Fisico Avain - cruce.xlsx`
**Fecha del cruce:** 02/10/2026 · **Stock SAP:** base al 02/10 · **Homologación:** cruce SAP al 25/09/2026

---

## 1. Qué se hizo

La base del archivo es el **stock de SAP**, con su formato intacto, porque lo usará Contabilidad.
Sobre esa base se cruzó el inventario físico informado por Avain. La homologación se usó
**sólo como vínculo de nomenclatura** entre SAP y los nombres de Avain: cubre 284 ítems del
Master, o sea información parcial, y no se tomó como base del inventario.

En las tres hojas SAP (`1120 SJ`, `1060 NQN`, `1130 Salta`) se conservan las columnas A:T, las
filas, las fórmulas y la fila de totales original. Se completó:

| Columna | Contenido |
|---|---|
| **Q** `Cantidad fisica(recuento)` | inventario físico de Avain |
| **R** `Diferencia Q` | fórmula original `= Libre utilización − Cantidad física` |
| **T** `Comentarios` | nota del cruce cuando corresponde |
| **U…AI** (nuevas) | información complementaria: nivel de certeza, código y nombre Avain, método de cruce, posibles duplicidades, presencia en el Master, totales a nivel material y observaciones |

Se agregaron además 4 hojas: **Resumen del cruce**, **Sin coincidencia**,
**Posibles duplicidades**, **Fuera del Master** y **Metodología**.

---

## 2. Resultado del cruce

| Base | Stock SAP | Inventario físico Avain | Diferencia | De la cual: a dar de baja | a incorporar |
|---|---:|---:|---:|---:|---:|
| San Juan (1120) | 87.123 | 21.732 | 65.391 | 39.454 | 2.367 |
| Neuquén (1060) | 671.967 | 33.107 | 638.860 | 354.178 | 2.923 |
| Salta (1130) | 37.614 | 32.524 | 5.090 | 10.862 | 11.889 |
| **Total** | **796.704** | **87.363** | **709.341** | **404.494** | **17.179** |

> **Importante para leer la diferencia.** De los 796.704 de SAP, **329.492 corresponden a
> materiales que el inventario físico no recontó** (los inventarios de Avain son de Farmacia;
> SAP incluye además uniformes, equipos y otros rubros). Esa porción **no es comparable**.
> La diferencia sobre lo efectivamente recontado es de **467.212 SAP contra 79.897 físico**.
> La columna *Stock SAP sin recuento físico* del Resumen separa ambos universos.

**Confirmado el caso de los uniformes de San Juan:** aparecen diferencias positivas
(físico > SAP) por 17.179 unidades en total, con **Salta mostrando saldo negativo neto
(−1.027)**, es decir más inventario físico que stock SAP.

### Niveles de certeza (687 ítems de Avain)

| Nivel | Ítems | Tratamiento |
|---|---:|---|
| 🟢 Alta | 200 | se cruza y se descuenta |
| 🟡 Media | 142 | se cruza y se descuenta, queda identificado |
| 🟠 Baja | 149 | se cruza para no perder el recuento, requiere validación |
| 🔴 Sin coincidencia | 196 | se agregó como línea nueva, sin código SAP |

El **91,4 % de las unidades físicas** (79.897 de 87.363) quedó imputado a un código SAP.
Las 7.466 unidades restantes se incorporaron como 196 líneas nuevas sin código de material.

---

## 3. Hallazgos a validar

### 3.1 Códigos de Avain que no coinciden con el producto (29 casos, todos en Neuquén)
La homologación vincula ciertos códigos de la base de Neuquén a un ítem del Master, pero en el
inventario físico **ese mismo código corresponde a otro producto**. Ejemplos:

| Código | En la homologación | En el inventario físico |
|---|---|---|
| 345 | Máscara p/nebulizar | ELECTRODOS |
| 274 | Guantes de examen | Guantes Estériles N° 7 |
| 536 | (ítem del Master) | MARTILLO |
| 505 | (ítem del Master) | PILAS A76 / SALBUTAMOL AEROSOL |

Es un bloque de códigos altos (500–536) más 341/345/412/481. **El cruce por código se
descartó en esos casos** y se resolvió por nomenclatura, dejando la observación. Conviene
revisar con los responsables de la base si esos códigos se reasignaron.

### 3.2 El código no es clave única en Neuquén
**17 códigos identifican dos productos distintos cada uno** en el propio inventario de Avain:

- `529` = Tijera punta roma (22) **y** Cloruro de potasio (0)
- `532` = Mango de bisturí N° 4 (13) **y** Clonazepam 2 mg (0)

El cruce se hizo por **código + denominación**, no por código solo.

### 3.3 Posibles duplicidades SAP (65 casos)
Dos o más códigos SAP pueden corresponder al mismo ítem de Avain. No se asumió que sean
iguales: se imputó al **primer** código (lógica BUSCARV/BUSCARX) y se dejó la observación de
que el cruce los identificó como posibles equivalentes. Caso de la aspirineta: el Master
`M01-001` lista 3 códigos (`1001237`, `1000802`, `1000136`). Ver hoja *Posibles duplicidades*.

### 3.4 Varias denominaciones de Avain para un mismo código SAP (39 casos)
San Juan 5, Neuquén 18, Salta 16. En esos casos **se sumaron las cantidades físicas** sobre el
material y se dejó constancia. Algunos requieren decisión de fondo, por ejemplo
`PILAS 9V` + `PILAS A76` + `PILAS LR41` → un único `PILA C 2`, o
`Guantes estériles 6.5 / 7.5 / 8` → un único `GUANTE ESTERIL Nº 7`.

### 3.5 Productos fuera del Master de Seba (119 con stock físico y código SAP)
Tienen recuento físico y código SAP pero **no estaban informados en el Master**. Ver hoja
*Fuera del Master*. La homologación cubre 284 ítems; el universo real del cruce es mayor.

### 3.6 Diferencias internas del propio informe de Avain (Neuquén)
Dos ítems no cierran dentro del informe IHSA, entre *stock actual* y *saldo de movimientos*:
**Adrenalina 1mg/mL (15 unidades)** y **Metronidazol 500mg (20 unidades)**. Quedan marcados en
las observaciones.

### 3.7 Pendientes de la homologación
89 ítems del Master con más de un código SAP candidato y 17 sin candidato. Resolverlos reduce
directamente el universo de niveles Media y Baja.

---

## 4. Trazabilidad y controles

**Extracción de los PDF de Avain, con control contra los totales declarados:**

| Base | Formato | Renglones | Control |
|---|---|---|---|
| San Juan | Stock en Almacén, una fila por lote | 202 | `TOTAL: 202` ✔ |
| Salta | Stock en Almacén, una fila por lote | 650 | `TOTAL: 650` ✔ |
| Neuquén | Informe IHSA | 243 ítems, 201 con stock | encabezado *«Con stock: 201 medicamentos»* ✔ |

En Neuquén se tomó la sección de **Conciliación** y se verificó contra las filas
*TOTAL MEDICAMENTO* de la sección de detalle: ambas suman **33.107**.

**Calibración del criterio automático.** El cruce por nomenclatura se contrastó contra las 267
filas del Master que ya tienen candidato SAP revisado por el equipo: reproduce el nivel exacto
en el **56 %** de los casos y queda dentro de un nivel en el **79 %**. **No produjo ninguna
coincidencia Alta donde la revisión había dicho Baja o Sin coincidencia**, que es el error que
importa evitar. Las diferencias restantes son nombre comercial contra genérico
(Meloxicam/FLEXIDOL, Dimenhidrinato/DRAMAMINE), que no se deducen del texto y sólo los
resuelve la homologación.

**Verificación del archivo generado** (`scripts/verificar.py`, más recálculo con LibreOffice):
base SAP intacta, fórmulas originales conservadas, la fila de totales original sin mover,
una sola imputación de cantidad física por material, y los totales de cada hoja conciliando
contra las fuentes.

### Nota de método: materiales con varias filas en SAP
Un material puede tener varias filas (lote/almacén). La cantidad física se imputa en la
**primera fila del material** y las demás quedan en blanco, de modo que el total de la columna
sea el inventario físico real y no se duplique. El detalle a nivel material está en las
columnas complementarias *Stock SAP del material*, *Inventario físico Avain del material* y
*Diferencia a nivel material*.

---

## 5. Próximos pasos sugeridos

1. Validar los **29 códigos de Neuquén que no coinciden con el producto** (punto 3.1).
2. Resolver las **65 posibles duplicidades SAP** y los **39 materiales que reciben varias
   denominaciones** (3.3 y 3.4).
3. Revisar las **196 líneas sin coincidencia**: definir si corresponde alta de material en SAP
   o si existe un código que el cruce no detectó.
4. Completar la homologación de los 89 ítems con varios candidatos y los 17 sin candidato.
5. Confirmar el universo comparable por base: acordar qué rubros de SAP debe cubrir el
   inventario físico, para que la diferencia global sea interpretable.

## 6. Cómo reproducir el cruce

```
pip install openpyxl pdfplumber
cd scripts
python3 parse_avain.py     # San Juan y Salta desde PDF
python3 parse_nqn.py       # Neuquén (informe IHSA)
python3 cruce.py           # cruce con niveles de certeza
python3 generar.py         # archivo final
python3 verificar.py       # controles de integridad
python3 validar_ooxml.py   # control estructural del .xlsx (lo que valida Excel)
python3 calibrar.py        # calibración contra la homologación
```

---

# Segunda etapa · universo = inventarios físicos (2026-10-30)

## Hallazgo bloqueante: no existe el precio de última compra

El criterio de valorización pedido es **precio de última compra**. Ese dato **no está en
ningún archivo recibido**. Verificado campo por campo:

| Archivo | Qué tiene | Qué no tiene |
|---|---|---|
| `Stock Centro SJ NQN y Salta 02.10.xlsx` | 20 columnas: `Valor libre util.` (valorización contable) y `VU` (ese valor ÷ unidades) | precio de compra, fecha, proveedor, documento |
| `Homologacion_Farmacia_AVAIN_con_SAP.xlsx` | homologación de nomenclaturas | declara literalmente que «los campos de costo quedan fuera de este trabajo» |
| Los 3 PDF de inventario físico | stock por lote y vencimiento | **0 menciones** de precio o compra (búsqueda sobre las 104 páginas) |

Consecuencia: los 1.991 casos quedan **pendientes de valorización**. No se estimó ningún
precio. Se expone en paralelo la valorización de stock de SAP, siempre rotulada, y queda
definido el formato para cargar el dato cuando exista.

## Corrección de procedencia: Neuquén no es AVAIN

El trabajo anterior etiquetaba las tres bases como AVAIN. Los encabezados de los PDF
muestran que son dos sistemas distintos:

- **San Juan y Salta** → AVAIN, informe «Stock en Almacén».
- **Neuquén** → informe «Inventario completo de Farmacia» de IHSA, documento
  `IHSA-REP-2026-834809`, usuario `grupoihsa`. Es el que en la operación se llama
  **Sistema Nico**.

Los formatos son distintos y se procesan por separado. El etiquetado quedó corregido en
las tres piezas.

## 410 materiales de SAP que nunca iban a aparecer en el recuento

De los 1.038 códigos de SAP, 311 no son de Farmacia: `ZUNI` indumentaria (304), `ZEQI`
equipamiento (5), `ZERS` repuestos y seguridad (2). Suman 410 combinaciones
material-base.

Tratarlos como candidatos a baja por no figurar en un inventario **de Farmacia** sería
una conclusión falsa. Se apartaron en una clasificación propia (**E · Fuera del
alcance**) cuya acción explícita es *no concluir nada*.

## 48 ítems con existencia física y sin stock en SAP en su base

Están correctamente identificados —el código existe y la presentación coincide— pero SAP
no registra stock de ese material en el centro donde se contó. Reparto: San Juan 16,
Neuquén 9, Salta 23.

**No son altas.** El código ya existe. Lo que falta es registrar la existencia en ese
centro, o ubicar en qué centro está cargada. Es una categoría de trabajo que el análisis
anterior no distinguía.

## 156 candidatos a baja dependen de un caso todavía en revisión

Figuran como posible equivalencia de un ítem físico sin resolver. Si el caso se resuelve
a favor, dejan de ser candidatos a baja. **La lista de bajas es provisional mientras
queden casos en revisión**, y el sistema pide confirmación antes de dejar aprobar una.

## Falsos positivos que el criterio estricto evitó

Casos que un cruce por similitud de nombre habría resuelto mal, y que acá quedaron
correctamente separados:

| Ítem físico | Lo que un cruce por nombre elegía | Por qué está mal | Resultado |
|---|---|---|---|
| `Sonda nasogástrica K 30` | `SONDA NASOGASTRICA K-10` | K30 ≠ K10 | va a `SONDA NASOGASTRICA K-30 KOLLER` |
| `Agujas 16/5` | `JERINGA DE 1ML C AGUJA 25G` | es una jeringa, no una aguja | va a `AGUJA HIPODERMICA 25G x ⅝ - 16/5` |
| `Succinilcolina Amp x 2 ml` | `SUCCINILCOLINA 100 mg` | uno declara volumen, el otro masa: nada verificado | a revisión |
| `Pinza de Magill 20cm` | `PINZA MAGILL PEDIATRICA` | adulto vs pediátrico sin confirmar | a revisión |
| `CLARITROMICINA` | `CLARITROMICINA 500 COMPRIMIDOS` | «500» puede ser mg o envase | a revisión |
| `Aciclovir crema 5,0% x10gr` | `ACICLOVIR 400 MG COMPRIMIDOS` | crema vs comprimido y 5% vs 400 mg | sin correspondencia |

## Por qué el 59% queda en revisión

402 de 687 ítems requieren decisión humana. No es una falla del cruce: es la
consecuencia directa del criterio pedido. Los motivos:

| Motivo | Casos | Qué hay que hacer |
|---|---|---|
| Coincidencia parcial de denominación | 160 | confirmar si el candidato es el material |
| Falta un atributo para confirmar la presentación | 146 | completar la presentación en SAP o en el inventario |
| Varios códigos SAP posibles | 68 | elegir entre candidatos concretos |
| Conflicto de presentación | 19 | verificar si falta en SAP el material con la presentación correcta |
| Nomenclatura insuficiente | 8 | precisar la nomenclatura |

Cada caso llega con el candidato más probable y el motivo exacto, así que la revisión es
de confirmar o descartar, no de investigar desde cero.
