# Sistema de gestión · Inventario físico vs SAP

Esto es una **aplicación**, no un archivo. Se entra con la cuenta de Emergencias
y las decisiones van a una base compartida.

| Pieza | Qué es | Para qué |
|---|---|---|
| **La aplicación** | Se instala y se sirve (ver [`servidor/README.md`](servidor/README.md)) | **Revisar, decidir y registrar.** Es la herramienta de trabajo. |
| **Excel** | `Inventario fisico vs SAP - analisis.xlsx` | Analizar y seguir trabajando sobre los datos. Con fórmulas vivas. |
| **PDF** | `Inventario fisico vs SAP - informe integral.pdf` | Explicar el caso y los resultados a quien no vio nada de esto. 20 páginas. |
| **Copia de consulta** | `Inventario fisico vs SAP - consulta.html` | Mirar el análisis sin levantar nada. **No se puede decidir ahí.** |

Los tres primeros salen del **mismo análisis y las mismas decisiones**, por eso
las cifras coinciden entre ellos.

> El PDF **no trae el listado de los 1.991 materiales**: es un informe ejecutivo. El
> detalle individual está en el Excel y en el sistema, que es donde se puede filtrar,
> ordenar y actualizar. La sección 15 del informe dice exactamente dónde buscar cada cosa.

---

## Por qué dejó de ser un archivo que se manda por mail

Porque cada copia que circulaba era **un lugar donde alguien decidía sin que
nadie se enterara**. Esas decisiones no entraban en ningún lado: no había forma
de juntarlas, ni de saber quién había decidido qué, ni de evitar que dos
personas resolvieran lo mismo de maneras distintas. Y el campo «Revisor» era
texto libre, así que el registro de autoría no valía nada.

En la aplicación:

- se entra con la cuenta **@emergencias.com.ar**, así que quién decidió qué
  **no depende de lo que cada uno escriba**;
- las decisiones van a una **base SQLite compartida**, con historial completo;
- lo que decide una persona **lo ven las demás solas**, sin apretar nada;
- si dos deciden el mismo caso, el sistema **avisa** en vez de pisar en silencio.

La copia `Inventario fisico vs SAP - consulta.html` sigue existiendo para mirar
el análisis sin levantar nada —mostrarlo en una reunión, mandárselo a alguien
que sólo quiere verlo— pero **no deja decidir**, y dice por qué.

> **Por qué la copia no puede pedir usuario y contraseña.** Microsoft no admite
> `file://` como dirección de retorno del login: exige `http://localhost` o
> `https://`. No es una limitación del sistema, es de cómo funciona OAuth. Por
> eso el login va de la mano de servir la aplicación.

## Cómo se instala

Está todo en **[`servidor/README.md`](servidor/README.md)**: qué completar en el
registro de Azure, las variables de configuración, el servicio de systemd, la
imagen de Docker y el script de instalación.

Lo corto, en una máquina Linux:

```bash
sudo ./servidor/instalar/instalar.sh     # crea el servicio
sudo nano /etc/inventario.env            # completar con los datos de Azure
sudo systemctl start inventario
```

Para probar en tu propia máquina sin tener todavía el registro de Azure:

```bash
INVSAP_AUTH=off node servidor/servidor.js
```

**No tiene dependencias**: usa sólo lo que viene con Node, así que no hay
`npm install`. Requiere Node 22.5 o superior.

## Cómo trabajar

El sistema está armado como un **flujo de trabajo**, no como un listado. No hay que
decidir por dónde empezar: la pantalla de inicio lo dice.

1. Entrá con tu cuenta de Emergencias. Tu nombre queda en cada decisión que
   tomes: no hay campo que completar, y por eso el registro es confiable.
2. **Inicio** muestra el trabajo en siete grupos, numerados por prioridad, cada uno con
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
| 2 | Verificar los que no aparecieron en SAP | 58 | Pocos y de alto impacto; se elige una de dos alternativas |
| 3 | Registrar existencias que SAP no tiene | 48 | Hay stock físico sin respaldo en el sistema |
| 4 | Confirmar las identificaciones | 179 | Rápido: ya están verificadas |
| 5 | Corregir la ubicación en los almacenes | 363 | Problema de ubicación, no de identificación |
| 6 | Depurar el maestro · materiales sin stock | 30 | Decisión sobre el registro, no sobre el stock |
| 7 | Aprobar las bajas propuestas | 864 | Último, porque 153 dependen del grupo 1 |

Las 153 bajas que dependen de un caso en revisión **quedan fuera del lote automáticamente**
y el sistema avisa si intentás aprobarlas de a una.

### El grupo 2: dos alternativas, no una

Un ítem que no aparece entre los materiales con stock **no está probado que no exista en
SAP**. Por eso el sistema no decide solo: pregunta expresamente cuál de los dos caminos
se toma.

| | Alternativa | Qué implica | Qué riesgo tiene |
|---|---|---|---|
| **1** | Verificar antes de crear | Se consulta el maestro completo antes de crear nada. Si ya existe con stock cero, se decide si se reutiliza el código o se da de baja y se crea de nuevo. | Ninguno sobre los datos. El costo es de tiempo: hace falta el maestro completo, que no tenemos. |
| **2** | Crear igual, sin verificar | Se avanza con el alta aunque no se haya verificado el maestro. **El sistema no lo impide.** | **Código duplicado:** el mismo producto abierto dos veces, con el stock, los consumos y el histórico partidos. El código viejo sigue vivo hasta que alguien lo depure. |

La alternativa 2 abre una pregunta expresa que explica el riesgo, **exige marcar que se
entiende** antes de habilitar el botón, y registra quién lo decidió y por qué. Además liga
el caso al plan de depuración del maestro, que es la contracara de esa decisión.

El resultado de la alternativa 1 se carga después, cuando se tenga la respuesta del
maestro: *no existe* (se propone el alta), *existe sin stock y se reutiliza el código*, o
*existe sin stock, se da de baja y se crea de nuevo*.

### La solapa «Maestro»: depuración de los materiales sin stock

Los materiales que figuran en SAP con **existencia cero** no son candidatos a baja de
stock —no hay stock que dar de baja— sino **registros del maestro** sobre los que hay que
decidir: se **mantienen**, se **bloquean** o se **dan de baja**.

- Se puede decidir **de a uno** o fijar una **política masiva** para todo el conjunto.
- La decisión individual **manda sobre la masiva**: cuando difiere, el material queda
  anotado como **excepción**, con su motivo escrito. Una limpieza masiva no borra los
  casos que había que mirar de cerca.
- **Lo que se ve no es todo el universo.** La bajada trae los materiales con stock; estos
  30 aparecieron igual en cero y son la punta visible. Cuántos materiales tiene el maestro
  completo en cero no se puede saber con los archivos recibidos.
- Si se consigue el maestro completo, se puede **importar en CSV** desde esa misma
  pantalla y el universo se completa solo. El archivo se lee en la computadora: no se
  sube a ningún lado.

### El grupo 5: ubicación, que no es identificación

El **centro** es la base; el **almacén** es el depósito dentro de esa base. Son dos campos
distintos de SAP. Hay tres cuestiones independientes y conviene no mezclarlas: si el
material está bien **identificado**, si tiene **stock**, y si ese stock está en el
**almacén que corresponde**.

Un material perfectamente identificado puede figurar en el almacén equivocado. **Eso no lo
convierte en candidato a alta ni a baja.**

| Estado | Casos | Qué significa |
|---|---|---|
| Almacén correcto | 765 | El stock está en el almacén propuesto para esa base y tipo |
| Almacén a cambiar | 137 | Figura en un almacén distinto del propuesto |
| En varios almacenes | 226 | El mismo material repartido en más de un almacén de la base |
| Pendiente de validar | 322 | No hay propuesta de almacén para esa base y tipo |

**Qué está observado y qué es una propuesta.** A qué base pertenece cada almacén **está
observado**: en la bajada, cada código de almacén aparece bajo un único centro. Qué almacén
*debería* tener el stock de Farmacia **no está en ningún archivo**: se propone a partir de
la composición observada de cada almacén —qué materiales y cuántas unidades concentra—,
**nunca por parecido de nombres ni de códigos**, y hay que validarlo con cada base.

| Base | Tipo | Almacén propuesto | Confianza |
|---|---|---|---|
| San Juan | Medicamento | 2021 | Clara |
| San Juan | Descartable | 2021 | Clara |
| Neuquén | Medicamento | 6021 | Clara |
| Neuquén | Descartable | 6022 | **Ambigua** |
| Salta | Medicamento | 3013 | Clara |
| Salta | Descartable | 3014 | Clara |

La de Neuquén · Descartables salió **ambigua** porque un segundo almacén también concentra
volumen: ahí hace falta preguntarle a la base antes de concluir nada. Tampoco viene la
descripción de los almacenes, sólo el código.

### Dónde quedan las decisiones

En una **base SQLite compartida**, firmadas con la cuenta con la que entraste,
con el historial completo de cada caso.

- Lo que decide otro **aparece solo**, cada 20 segundos. El botón **↻** fuerza
  la actualización.
- Si estás en el modo revisión, no te cambia el caso de abajo de las manos:
  avisa y actualiza cuando salís.
- Si una escritura falla, el indicador lo dice y se reintenta sola. **Nunca se
  da por guardado algo que no se guardó.**
- Si dos personas deciden el mismo caso, el sistema avisa a la segunda y le
  muestra quién había decidido antes. **Nada se pierde:** el historial guarda
  las dos, con nombre y hora.

La base se respalda sola todos los días y se conservan los últimos 14.

**Conviene exportar el Excel al terminar cada sesión igual**: es la forma de
compartir lo decidido con quien no entra a la aplicación. Trae una hoja
«Decisiones» con el historial completo.

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

Ahora bien: que esté fuera de alcance **no bloquea la decisión**. El sistema contempla las
dos alternativas y pregunta cuál se toma: verificar primero, o crear igual asumiendo el
riesgo de código duplicado. Lo que no hace es decidirlo solo ni esconder la consecuencia.

Lo que sí se sostiene sin esa verificación: las identificaciones (grupo 4), las
existencias sin stock en su base (grupo 3) y los candidatos a baja (grupo 7), porque esos
materiales **sí** están en el archivo con stock.

La misma limitación explica el alcance de la depuración del maestro: los 30 materiales con
existencia cero que están a la vista son los que la bajada dejó ver, **no todos los que el
maestro tiene en cero**.

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

### Las seis clasificaciones

| | Casos | Qué significa | Acción |
|---|---|---|---|
| **A** Identificado en SAP | 227 | Código verificado por nomenclatura y presentación | Mantener |
| **B** Sin correspondencia | 58 | Existe físicamente, no está entre los materiales **con stock** | Elegir alternativa 1 o 2 |
| **C** Candidato a baja | 864 | Stock en SAP que ningún inventario identificó en esa base | Proponer baja |
| **D** Requiere revisión | 402 | No se resuelve solo | Revisar y decidir |
| **E** Fuera del alcance | 410 | Indumentaria, equipos y repuestos | **No concluir nada** |
| **F** En SAP sin stock | 30 | Material de Farmacia con existencia **cero** | Depurar el maestro |

**Por qué existen la E y la F:** las dos salen de la misma pregunta —¿qué significa que un
material de SAP no aparezca en el inventario?— y en las dos proponer una baja sería una
conclusión falsa.

- **E.** El inventario relevado es de Farmacia. Los materiales que no son medicamentos ni
  descartables nunca iban a figurar en él, así que su ausencia no prueba nada.
- **F.** Figuran con existencia cero: **no hay stock que dar de baja**. Lo que corresponde
  decidir es qué pasa con el *registro* en el maestro. Salieron de la clase C, donde
  proponer una baja no tenía sentido.

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

Quince hojas: `Resumen` (indicadores, todos fórmulas sobre `Casos`), `Casos` (el detalle
completo, **50 columnas**), las seis hojas operativas `A` a `F`, `Almacenes` (la propuesta
por base y tipo, con lo observado y lo que hay que validar), `Depuración del maestro`
(política, excepciones y decisiones individuales), `Lotes` (trazabilidad al lote original),
`Nomenclaturas unificadas`, `Decisiones` (historial), `Control` (integridad contra las
fuentes, con fórmulas vivas) y `Metodología`.

En la hoja `Casos`, las columnas **AN a AS** son la ubicación del stock y las **AT a AX**,
la alternativa elegida en la clase B. Se agregaron al final a propósito, para no mover
ninguna letra de las fórmulas que ya estaban.

Tiene fórmulas reales —`COUNTIFS`, `SUMIFS`, `SUBTOTAL`—, formatos numéricos y de fecha,
filtros, panel fijo y anchos de columna. Los totales usan `SUBTOTAL`, así que **respetan
el filtro aplicado**.

## Verificación hecha

- Los filtros, la búsqueda, la ficha, las decisiones y la persistencia se probaron en un
  navegador real, sin errores de JavaScript.
- El Excel exportado se abrió y recalculó: los 1.991 casos y todos los cortes por base y
  por tipo coinciden con el sistema.
- El PDF tiene 20 páginas; cada número de página impreso coincide con la página real y
  cada entrada del índice cae en su sección. Ninguna hoja se pasa de alto, lo que se
  comprueba midiendo el contenido renderizado antes de imprimir.
- Los controles de integridad comparan los totales del sistema contra los de los archivos
  originales: los 10 cierran.
- Hay una auditoría reproducible en `scripts/v3/auditar.py`: compara el dataset contra lo
  que efectivamente quedó escrito en el Excel recalculado, en el texto del PDF y en el
  HTML del sistema. Son 87 comprobaciones y pasan todas.

## Los archivos originales no se tocaron

Se conservan tal como se recibieron. El Excel del trabajo anterior
(`Stock SAP vs Inventario Fisico Avain - cruce.xlsx`) también se mantiene sin cambios.
