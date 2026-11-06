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
> ordenar y actualizar. La sección 17 del informe dice exactamente dónde buscar cada cosa.

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

El sistema está armado como un **proceso guiado**, no como un listado. No hay que decidir
por dónde empezar: la pantalla de inicio lo dice.

1. Entrá con tu cuenta de Emergencias. Tu nombre queda en cada decisión que tomes: no hay
   campo que completar, y por eso el registro es confiable.
2. **Inicio es el panel de gestión.** Arriba, la **hoja de ruta**: seis etapas, en qué
   etapa está el proceso, cuánto avanzó cada una y cuál es el próximo paso concreto.
3. Elegí el **alcance**: las tres bases o una sola. Todo lo que está abajo lo respeta —los
   indicadores, los pendientes y las decisiones en lote—.
4. Elegí una **solapa**. Son los siete grupos de siempre, en el mismo orden de prioridad,
   ahora como solapas de una única bandeja en vez de siete tarjetas apiladas.
5. Abajo aparece **cada caso como una pregunta**, con lo que dice el depósito de un lado,
   lo que dice SAP del otro, por qué el sistema lo levantó, y las respuestas posibles como
   botones. **Se contesta con un clic**, sin entrar a ninguna pantalla.
6. Para resolver muchos juntos: tildá los que quieras —o «elegir los N del filtro»— y usá
   la barra de arriba. Antes de aplicar, el sistema muestra **a cuántos materiales, bases y
   almacenes alcanza** y cuáles de los elegidos no cumplen las condiciones.
7. Al terminar, **Descargar Excel**.

### Qué hace cada solapa de arriba

| | |
|---|---|
| **Inicio** | Donde se gestiona: estado, filtros, decisiones de a una o en lote, por base o integral. Es el panel central. |
| **Revisar** | El modo de a uno: un caso por pantalla, con el teclado. Para avanzar rápido sobre un grupo entero y para los casos que necesitan elegir entre varios códigos. |
| **Buscar** | Encontrar un material puntual y ver su ficha. No es otro panel de gestión. |
| **Maestro** | La administración del catálogo: el maestro general con los importes de última compra, las equivalencias declaradas, el almacén propuesto de cada base y los materiales sin stock. **No se deciden casos acá.** |
| **Informe** | El informe ejecutivo con el estado actualizado. |
| **Cómo se usa** | Esto mismo, dentro del sistema. |

### La hoja de ruta

Seis etapas, en el orden en que conviene hacerlas. **El avance se calcula del estado real
del sistema**: no hay ningún porcentaje puesto a mano.

| | Etapa | Qué mide |
|---|---|---|
| 1 | Carga y validación | Los tres inventarios físicos y la bajada de SAP, con los controles que tienen que cuadrar contra las fuentes. |
| 2 | Maestro y trazabilidad | Cuántas nomenclaturas del depósito ya tienen resuelto su código de SAP. |
| 3 | Cruce de inventarios | Cada inventario contra los almacenes de SAP de su base. |
| 4 | Toma de decisiones | Cuántos casos del alcance ya se decidieron. |
| 5 | Evaluación económica | Cuántos materiales tienen importe de última compra cargado. |
| 6 | Informe final | Se cierra cuando no queda nada pendiente. |

**Ninguna etapa bloquea a la siguiente.** El maestro general se puede completar mientras el
análisis avanza con lo que ya hay: esperar a tenerlo todo sería no empezar nunca.

### El orden importa: trazabilidad antes del cruce definitivo

La etapa 2 va antes de la 3 por una razón de fondo. Cruzar el inventario de una base contra
los almacenes de SAP usando una correspondencia dudosa **arrastra la duda a todo lo que
sigue**: una baja propuesta sobre un código que en realidad era otro producto es una baja
mal propuesta, y nadie la va a poder distinguir después.

Por eso los casos sin trazabilidad resuelta quedan identificados y se gestionan aparte, sin
bloquear al resto del análisis. Y **una equivalencia confirmada vale para todas las bases**:
no hay que resolverla tres veces.

### El modo de a uno

Es donde se resuelve lo que no se puede contestar con un clic: elegir entre varios códigos
de SAP, declarar equivalencias, cargar el resultado de una verificación en el maestro.
Muestra un caso por pantalla con todo lo necesario para decidir: la cantidad contada, la
presentación detectada, por qué el caso llegó ahí, y los candidatos de SAP con **en qué
coincide cada uno** y **en qué almacén tienen el stock**. Debajo, los descartados con el
motivo.

Atajos: <kbd>1</kbd>…<kbd>9</kbd> marcar un código · <kbd>Enter</kbd> confirmar lo marcado ·
<kbd>A</kbd> aprobar · <kbd>R</kbd> rechazar · <kbd>N</kbd> ninguno corresponde ·
<kbd>X</kbd> no puedo decidirlo ahora · <kbd>→</kbd> saltear · <kbd>F</kbd> ver la ficha
completa.

Después de cada decisión pasa solo al siguiente. Una tanda de 50 casos lleva pocos minutos.

### Análisis por base e integral

La misma decisión vale en los dos lados, porque es el mismo registro: lo que cambia es qué
se ve, nunca dónde se guarda. Si trabajás con el alcance en Neuquén y aprobás 300 casos,
esos 300 aparecen en el análisis integral sin hacer nada.

Lo que **no** hace el sistema es aplicar una decisión global cuando las bases tienen
situaciones distintas. Un mismo material puede estar bien ubicado en una base y mal en
otra, y cada caso es la combinación de un material con una base: por eso se deciden por
separado y el resumen del lote dice siempre a qué bases y almacenes alcanza.

### Decisiones en lote: qué se muestra antes de aplicar

| | |
|---|---|
| **Cuántos casos** | Los que cumplen las condiciones de esa decisión. |
| **Cuántos materiales de SAP** | Sin duplicar por base ni por almacén. |
| **Qué bases y qué almacenes** | Listados, no contados nada más. |
| **Qué queda registrado** | La frase exacta que va al historial. |
| **Qué queda afuera** | Los elegidos que no cumplen, **con el motivo de cada uno**. |

Las decisiones que pueden dejar algo difícil de revertir —dar de baja un registro del
maestro, crear un material sin verificar, ajustar stock, aprobar bajas— piden además una
confirmación expresa. Las demás, no: avisar de todo es no avisar de nada.

### Una nomenclatura no corresponde a una sola: los dos sentidos

El depósito y SAP no nombran igual, y la correspondencia **no es uno a uno en ninguno de
los dos sentidos**. Tratarla como si lo fuera obliga a contestar la misma pregunta varias
veces, y a veces a contestarla distinto. El sistema deja declarar los dos sentidos, y las
dos cosas a la vez.

**Una del depósito = varios códigos de SAP.** Pasa seguido: el depósito tiene **una**
nomenclatura y SAP tiene el mismo producto abierto en **varios** códigos —marcas distintas,
un código viejo y otro nuevo, uno discontinuado—. En el modo revisión **se puede marcar más
de un candidato** con <kbd>1</kbd>…<kbd>9</kbd>. Al marcar el segundo aparece un campo con
la **nomenclatura unificada**, precargado con el nombre que usa el depósito, y el botón
pasa a decir «Agrupar los N códigos».

**Varias del depósito = un código de SAP.** Cada base escribe el nombre a su manera, y a
veces la misma base tiene dos renglones del mismo producto. Cuando otro ítem del depósito
podría ser el mismo producto, aparece arriba de los candidatos un panel plegable que dice
cuántos son y, en cada uno, la base, las unidades contadas y **por qué se propone**
(«coincide en concentración, forma»). Se marcan con el mouse y se deciden juntos: una sola
respuesta resuelve los dos renglones, y queda registrado que son equivalentes.

**Las dos cosas a la vez.** Se pueden marcar varios ítems del depósito y varios códigos de
SAP en la misma pantalla. La barra de abajo dice siempre, antes de confirmar, cuántas
nomenclaturas del depósito y cuántos códigos de SAP quedan declarados el mismo producto, y
los muestra como etiquetas para releerlos.

Qué pasa cuando confirmás:

- El ítem —y cada ítem equivalente que marcaste— queda identificado con **todos** esos
  códigos, no con uno solo, y con el mismo nombre unificado.
- Los códigos agrupados **dejan de ser candidatos a baja en esa base**, porque alguien los
  identificó. El contador del grupo 5 baja solo.
- Los ítems declarados equivalentes **salen de la cola**: no se vuelven a preguntar.
- El grupo queda listado en la pantalla de trabajo, en el Excel (hoja «Resumen», con los dos lados y
  el sentido de cada grupo, y dos columnas en «Casos») y en el PDF.

Importante: la liberación es **por base**. Si agrupás un código en San Juan, su stock en
Salta sigue siendo candidato a baja — identificar un material no es haber contado su stock
en otro centro.

#### De dónde sale la sugerencia (y de dónde no)

**No del parecido del nombre.** Dos ítems se proponen como equivalentes sólo si comparten
un candidato en SAP **y además** ninguna característica declarada por los dos está en
conflicto, y coinciden en alguna característica verificable —concentración, forma
farmacéutica fuerte, volumen, calibre, medidas—. Cuando ninguno declara características, se
exige que las denominaciones sean casi iguales.

La exigencia no es gratuita. Una primera versión proponía equivalencias por «comparten un
candidato», y eso juntaba «Ácido acetilsalicílico 100 mg» con «N-acetilcisteína 600»: el
candidato lo genera el parecido del nombre, no el producto. **Una sugerencia falsa es peor
que ninguna**, porque invita justamente al error que este trabajo viene evitando. La
propuesta sigue siendo una propuesta: la confirma una persona.

#### El almacén, en la misma pantalla

Cada candidato muestra **en qué almacén tiene el stock** y cuántas unidades, y si ese
almacén es el propuesto para la base del ítem: en verde cuando coincide, en naranja cuando
el stock está en otro almacén, y en gris cuando ese código **no tiene stock en esa base**.
No hace falta ir a buscarlo a otra pantalla: parte de la decisión es si el código que estás
por asignar tiene el stock donde debería.

Recordá que la correspondencia base ↔ almacén es una **propuesta pendiente de validación**
(ver el grupo 5): el color dice si coincide con esa propuesta, no que la propuesta esté
confirmada.

### El orden de los grupos

| | Grupo | Pendientes | Por qué va ahí |
|---|---|---|---|
| 1 | Resolver los casos en revisión | 401 | Es el trabajo real, y de él dependen otros grupos |
| 2 | Verificar los que no aparecieron en SAP | 59 | Pocos y de alto impacto; se elige una de dos alternativas |
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

### La solapa «Maestro»: la administración del catálogo

Maestro tiene cuatro apartados y ninguno decide casos: eso es Inicio. Acá se administra
**lo que es cada material**, no qué se hace con cada diferencia.

**Maestro general.** Una fila por **código de SAP**, reuniendo todo lo que se sabe de él:
la bajada de SAP, los candidatos del análisis, lo que quedó identificado en los
inventarios y el maestro que se importe. **No se duplica** por aparecer en varias bases ni
en varios almacenes. Los ítems del depósito que todavía no tienen código van aparte,
porque todavía no son un material de SAP.

La planilla se **baja en Excel** con tres columnas obligatorias —Código SAP, Nomenclatura
SAP e Importe última compra—, se completa el importe afuera y **se vuelve a subir el mismo
archivo**. También acepta CSV. La importación:

- busca las columnas por nombre, así que no importa si alguien agregó o movió alguna;
- informa cuántos importes entraron nuevos, cuántos se actualizaron, cuántas filas venían
  vacías y **cuáles se rechazaron, con el motivo**;
- avisa si hay códigos que no figuran en el análisis, sin descartarlos;
- **no toca ninguna decisión ni ninguna equivalencia.**

**Equivalencias de nomenclatura.** Los grupos ya declarados, con los dos lados y el
sentido de cada uno. Se declaran al resolver un caso, en Inicio; una vez confirmada, la
equivalencia vale para todas las bases.

**Almacenes por base.** Lo observado y lo propuesto, separados, con la confianza de cada
propuesta explicada: cuando dice «Ambigua» dice también **qué es lo ambiguo** —que hay más
de un almacén con stock de ese tipo en la base y de los datos no sale cuál debería ser;
lo ambiguo es el almacén, no el material ni su código—.

### Materiales sin stock: depuración del maestro

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
esterilidad, población y cantidades sin unidad.

> **La esterilidad se agregó a esa lista.** Estaba tratada como palabra de relleno, y por eso «Apósitos estériles» del depósito traía «APOSITO NO ESTERIL» como primer candidato: las dos denominaciones quedaban en «apósito». Un apósito estéril y uno no estéril son dos productos con código propio. Ahora contradecirse en la esterilidad descarta el candidato. Sirve para descartar, no para confirmar: que dos cosas sean estériles no las hace el mismo producto.

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
| **B** Sin correspondencia | 59 | Existe físicamente, no está entre los materiales **con stock** | Elegir alternativa 1 o 2 |
| **C** Candidato a baja | 864 | Stock en SAP que ningún inventario identificó en esa base | Proponer baja |
| **D** Requiere revisión | 401 | No se resuelve solo | Revisar y decidir |
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

**Ya hay por dónde cargarlo.** En **Maestro → Maestro general** se baja la planilla con
los 1.038 códigos, se completa la columna «Importe última compra» y se vuelve a subir. En
cuanto entra, el sistema calcula el impacto económico de las decisiones tomadas:

- **Cómo se calcula:** unidades del caso × importe de última compra del material decidido.
  Las unidades son las **contadas en el depósito** para los ítems físicos y las de **stock
  en SAP** para los materiales que ningún inventario identificó.
- **Sólo lo ya decidido** suma: una decisión que todavía no se tomó no vale plata.
- Un caso sin importe **no suma cero**: queda contado aparte como pendiente de valorizar.
  Un cero sería una afirmación falsa sobre su valor.

Para que el dato sea auditable conviene que la bajada traiga además moneda, fecha de la
compra, documento de respaldo y proveedor.

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

**Siete hojas**, no quince. Las seis que partían el detalle por clasificación decían en
qué categoría cayó cada caso, pero no la frase que alguien tiene que ejecutar: esa frase
estaba repartida entre hojas y columnas y había que armarla a mano. Ahora la dice una
columna.

| Hoja | Para qué |
|---|---|
| `Qué hacer en SAP` | **La hoja operativa.** Una fila por caso con la acción concreta —crear el material en el centro X almacén Y, ajustar N unidades, mover de almacén, dar de baja— y una columna que dice si todavía falta decidirla. Ordenada por acción, así cada bloque de trabajo queda junto. |
| `Resumen` | Indicadores (fórmulas vivas sobre `Casos`), el glosario de magnitudes, la propuesta de almacén por base y tipo, las equivalencias declaradas y cómo se decide una correspondencia. |
| `Casos` | El detalle completo, **50 columnas**, con autofiltro. |
| `Maestro general` | Una fila por código de SAP, sin duplicar por base ni por almacén, con el importe de última compra. |
| `Lotes` | Trazabilidad al renglón de lote del informe original. |
| `Decisiones` | El historial: quién decidió qué y cuándo. |
| `Control` | Integridad contra las fuentes, con fórmulas vivas. |

**El formato está corregido.** Antes una nota larga en una columna angosta se envolvía en
veinte renglones y estiraba la fila a media pantalla. Ahora sólo el encabezado envuelve
texto, y el alto del título, la nota y el encabezado está fijado en todas las hojas.

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
