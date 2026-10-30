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

El sistema está armado como un **flujo de trabajo**, no como un listado. No hay que
decidir por dónde empezar: la pantalla de inicio lo dice.

1. Escribí tu nombre arriba, en **Revisor**. Queda registrado en cada decisión.
2. **Inicio** muestra el trabajo en cinco grupos, numerados por prioridad, cada uno con
   cuántos quedan pendientes y su barra de avance. Arriba a la derecha, el avance general.
3. En cada grupo hay dos formas de trabajar:
   - **Revisar de a uno** → modo revisión: un caso por pantalla, con los candidatos
     listados y los botones de decisión al lado. Se decide con el teclado y pasa solo al
     siguiente.
   - **Decidir en lote** → para los grupos grandes: elegís las bases y resolvés cientos
     de casos de una vez, con una observación común.
4. **Buscar** es para encontrar algo puntual. También tiene casillas de selección y
   acciones en lote sobre lo seleccionado.
5. Al terminar, **Descargar Excel**.

### El modo revisión

Es donde se hace el trabajo de verdad. Muestra un caso por pantalla con todo lo necesario
para decidir: la cantidad contada, la presentación detectada, por qué el caso llegó ahí, y
los candidatos de SAP con **en qué coincide cada uno**. Debajo, los descartados con el
motivo.

Atajos: <kbd>1</kbd>…<kbd>9</kbd> marcar un código · <kbd>Enter</kbd> confirmar lo marcado ·
<kbd>A</kbd> aprobar · <kbd>R</kbd> rechazar · <kbd>N</kbd> ninguno corresponde ·
<kbd>X</kbd> no puedo decidirlo ahora · <kbd>→</kbd> saltear · <kbd>F</kbd> ver la ficha
completa.

Después de cada decisión pasa solo al siguiente. Una tanda de 50 casos lleva pocos minutos.

### Varios códigos SAP para un mismo producto

Pasa seguido: el depósito tiene **una** nomenclatura y SAP tiene el mismo producto abierto
en **varios** códigos —marcas distintas, un código viejo y otro nuevo, uno discontinuado—.

Para eso, en el modo revisión **se puede marcar más de un candidato**. Al marcar el
segundo, aparece un campo con la **nomenclatura unificada**, precargado con el nombre que
usa el depósito, y el botón pasa a decir «Agrupar los N códigos».

Qué pasa cuando agrupás:

- El ítem queda identificado con **todos** esos códigos, no con uno solo.
- Los códigos agrupados **dejan de ser candidatos a baja en esa base**, porque alguien los
  identificó. El contador del grupo 5 baja solo.
- La agrupación queda listada en Inicio, en el Excel (hoja «Nomenclaturas unificadas» y dos
  columnas en «Casos») y en el PDF.

Importante: la liberación es **por base**. Si agrupás un código en San Juan, su stock en
Salta sigue siendo candidato a baja — identificar un material no es haber contado su stock
en otro centro.

### El orden de los grupos

| | Grupo | Pendientes | Por qué va ahí |
|---|---|---|---|
| 1 | Resolver los casos en revisión | 402 | Es el trabajo real, y de él dependen otros grupos |
| 2 | Verificar los que no aparecieron en SAP | 58 | Pocos y de alto impacto; requieren el maestro completo |
| 3 | Registrar existencias que SAP no tiene | 48 | Hay stock físico sin respaldo en el sistema |
| 4 | Confirmar las identificaciones | 179 | Rápido: ya están verificadas |
| 5 | Aprobar las bajas propuestas | 894 | Último, porque 153 dependen del grupo 1 |

Las 153 bajas que dependen de un caso en revisión **quedan fuera del lote automáticamente**
y el sistema avisa si intentás aprobarlas de a una.

### Dónde quedan las decisiones

En el almacenamiento local del navegador, **en esa computadora**. No se sincronizan.
Dos consecuencias prácticas:

- Si trabajás desde otra máquina, no vas a ver las decisiones de la primera.
- Si limpiás los datos del navegador, se borran.

**Por eso conviene exportar el Excel al terminar cada sesión de trabajo**: es el
respaldo y también la forma de compartir lo decidido. El Excel trae una hoja
«Decisiones» con el historial completo: qué se cambió, quién y cuándo.

---

## Una aclaración que condiciona todo

**La bajada de SAP son los materiales que HOY tienen stock, no el maestro completo.**
Un material dado de alta en SAP con existencia cero no figura en el archivo.

Consecuencia directa sobre lo que se puede afirmar: cuando un ítem del depósito no
encuentra correspondencia, **no está probado que no exista en SAP**. Puede existir sin
stock. Por eso el grupo 2 del sistema no dice «dar de alta» sino **«verificar en el
maestro»**.

Esa verificación —y, si el material ya existe sin stock, la decisión de reutilizar el
código o darlo de baja y crearlo de nuevo— **está fuera del alcance de este trabajo**.
Es el paso previo obligatorio antes de proponer cualquier alta.

Lo que sí se sostiene sin esa verificación: las identificaciones (grupo 4), las
existencias sin stock en su base (grupo 3) y los candidatos a baja (grupo 5), porque esos
materiales **sí** están en el archivo con stock.

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
| **B** Sin correspondencia | 58 | Existe físicamente, no está entre los materiales **con stock** | Verificar en el maestro |
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
