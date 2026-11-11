/* Informe integral en HTML paginado (A4).
   Se arman páginas explícitas para que la numeración sea exacta y para que
   imprimir a PDF dé el mismo resultado en cualquier navegador. */
var Informe = (function () {
  "use strict";
  function D() { return App.datos(); }
  function ef(c) { return App.efectivo(c); }
  function L(c) { return App.LETRA[c.clasificacion]; }
  var esc = function (s) { return App.esc(s); };
  var num = function (n, d) { return App.num(n, d); };
  var pesos = function (n) { return App.pesos(n); };

  var paginas = [], indice = [], anclaPendiente = null, nAncla = 0;

  /* marcar() deja un ancla pendiente que toma el siguiente bloque. Así el índice
     apunta a la hoja real donde empieza cada sección, cualquiera sea la cantidad
     de hojas que termine ocupando. */
  function pagina(titulo, cuerpo, seccion) {
    paginas.push({ titulo: titulo, cuerpo: cuerpo, seccion: seccion || "",
                   ancla: anclaPendiente });
    anclaPendiente = null;
    return paginas.length;
  }
  function marcar(texto, nivel) {
    var id = "a" + (++nAncla);
    indice.push({ texto: texto, nivel: nivel || 1, id: id });
    if ((nivel || 1) > 0) anclaPendiente = id;
  }

  // ---------------------------------------------------------- bloques
  function tabla(cabeceras, filas, clases) {
    return '<table class="t"><thead><tr>' + cabeceras.map(function (c, i) {
      return '<th' + (clases && clases[i] ? ' class="' + clases[i] + '"' : "") + ">" +
             esc(c) + "</th>";
    }).join("") + "</tr></thead><tbody>" + filas.map(function (f) {
      return "<tr>" + f.map(function (c, i) {
        return "<td" + (clases && clases[i] ? ' class="' + clases[i] + '"' : "") + ">" +
               (c === null || c === undefined ? "" : c) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody></table>";
  }
  function et(l) {
    return '<span class="eti ' + l + '">' + l + "</span>";
  }
  function alt(n) {
    return '<span class="eti alt' + n + '">' + n + "</span>";
  }

  // ---------------------------------------------------------- construcción
  /* El informe tiene dos lectores a la vez: el que no sabe nada del tema y el
     que tiene que ejecutar en SAP. Antes resolvía al segundo en veintidós
     páginas y al primero no lo resolvía nunca. Ahora las dos primeras páginas
     contestan de cero —qué es esto, qué es SAP, por qué no coinciden los
     nombres— y la parte 4 dice exactamente qué hay que hacer, con cantidades.
     Nada se perdió: lo que era una página de tablas operativas se resumió y
     quedó apuntado a dónde vive el detalle, que es el Excel y el sistema. */
  function construir() {
    paginas = []; indice = []; anclaPendiente = null; nAncla = 0;
    var d = D(), k = d.kpis, m = d.meta;
    var t = App.conteos(d.casos);
    var pl = App.plan(d.casos);
    var dec = d.casos.filter(function (c) {
      return ef(c).aprobacion !== "Sin decidir";
    }).length;
    var al = k.almacen || {}, am = m.almacenes;

    function faq(pares) {
      return '<div class="faq">' + pares.map(function (x) {
        return '<div class="q"><b>' + x[0] + "</b><span>" + x[1] + "</span></div>";
      }).join("") + "</div>";
    }
    /* Una fila por acción del plan, con la cantidad en la columna de su
       magnitud y nunca en otra. */
    function filasPlan(bloque) {
      var fs = [];
      bloque.fams.forEach(function (f) {
        f.acciones.forEach(function (a) {
          fs.push([esc(f.titulo), esc(a.verbo.replace(/^PENDIENTE · /, "")),
                   num(a.n), a.contadas ? num(a.contadas) : "—",
                   a.sap ? num(a.sap) : "—", a.registros ? num(a.registros) : "—"]);
        });
      });
      var tc = 0, ts = 0, tr = 0;
      bloque.fams.forEach(function (f) {
        tc += f.contadas; ts += f.sap; tr += f.registros; });
      fs.push(["<b>Total</b>", "", "<b>" + num(bloque.n) + "</b>",
               tc ? "<b>" + num(tc) + "</b>" : "—", ts ? "<b>" + num(ts) + "</b>" : "—",
               tr ? "<b>" + num(tr) + "</b>" : "—"]);
      /* La tabla del plan puede llegar a diez renglones: va más apretada que
         las demás para que la hoja la aguante entera. */
      return tabla(["Grupo", "Qué hacer en SAP", "Casos", "Unidades contadas",
                    "Unidades en SAP", "Registros"], fs, ["", "", "n", "n", "n", "n"])
        .replace('<table class="t">', '<table class="t cp">');
    }

    // ====================================================== PARTE 1
    marcar("Parte 1 · Para entender de qué se trata", 0);
    marcar("Esto, en una página", 1);
    pagina("1 · Esto, en una página", `
      <h4>Qué se buscó resolver</h4>
      <p>Las tres bases contaron lo que hay en el depósito de Farmacia. SAP, por su lado,
      tiene registrado lo que debería haber. Los dos listados nombran los mismos productos
      de maneras distintas, así que no se pueden comparar de frente: hay que establecer,
      producto por producto, cuál material de SAP es cuál ítem del depósito. Mientras esa
      correspondencia no esté hecha, no se puede saber qué stock está bien registrado, qué
      falta crear, qué sobra, ni valorizar nada.</p>
      <h4>Qué se hizo</h4>
      <ul>
        <li>Se leyeron los tres inventarios físicos: <b>` + num(k.items_fisicos) + ` ítems</b>
        y <b>` + num(k.unidades_fisicas) + ` unidades</b> contadas.</li>
        <li>Se los cruzó contra el stock de SAP al ` + esc(m.sap.corte) + `, con un criterio
        que <b>no acepta una correspondencia por parecido de nombre</b>: tienen que coincidir
        las características del material.</li>
        <li>De ahí salieron <b>` + num(k.total_casos) + ` casos</b> para resolver, cada uno
        con su clasificación, su curso de acción propuesto y la justificación de por qué
        quedó así.</li>
      </ul>
      <h4>Qué hay que hacer ahora</h4>
      <p>Resolver, en el sistema de gestión, los casos que requieren una decisión humana, y
      después aplicar en SAP lo decidido. <b>La sección 7 de este informe dice exactamente
      qué:</b> qué crear, qué dar de baja, qué ajustar y qué mover, con las cantidades de
      cada cosa. Hoy hay <b>` + num(pl.ejecutar) + ` casos listos para aplicar</b> y
      <b>` + num(pl.falta) + ` esperando una decisión</b>.</p>
      <p class="aviso"><b>Nada de esto modifica SAP, y nada lo modificó nunca.</b> Ni este
      informe ni el sistema escriben en SAP. Lo que producen es el pedido de trabajo, con el
      nombre de quien decidió cada cosa y la fecha. La ejecución es un paso posterior.</p>
      <h4>Las tres advertencias que cambian cómo se leen los números</h4>
      <ol>
        <li><b>La bajada de SAP son los materiales con stock, no el maestro completo.</b>
        Que un ítem del depósito no haya encontrado correspondencia <b>no prueba que no
        exista en SAP</b>: puede existir con existencia cero.</li>
        <li><b>Las unidades contadas y las unidades de SAP no se suman.</b> Son dos recuentos
        de universos distintos: lo que había en el estante y lo que el sistema dice que
        debería haber. Compararlos es el objeto del trabajo; sumarlos no significa nada.</li>
        <li><b>No hay valorización.</b> El precio de última compra no está en ninguno de los
        archivos recibidos, así que ` + num(k.pendientes_valorizacion) + ` casos figuran como
        pendientes de valorizar. <b>No se estimó ningún precio.</b></li>
      </ol>`, "Parte 1");

    marcar("Las preguntas de siempre", 1);
    pagina("2 · Las preguntas de siempre", `
      <p class="cont">Para quien no viene trabajando el tema. Cada respuesta se amplía más
      adelante, en la sección que corresponde.</p>` +
      faq([
        ["¿Qué es SAP, acá?",
         "El sistema donde la organización registra sus materiales y su stock. Un " +
         "<b>material</b> es un código con una descripción —por ejemplo " +
         "<i>2001555 · SONDA T/K-27</i>—; el stock dice cuántas unidades hay registradas " +
         "en cada base."],
        ["¿Y el inventario físico?",
         "El recuento hecho en el depósito: alguien contó lo que hay en el estante y lo " +
         "informó desde el sistema del depósito. San Juan y Salta informan desde AVAIN; " +
         "Neuquén, desde otro sistema."],
        ["¿Por qué no coinciden los nombres?",
         "Porque los cargaron personas distintas, en sistemas distintos, con años de " +
         "diferencia. «Abbocath Nº 14» en el depósito y «CATETER INTRAVENOSO 14G " +
         "T/ABBOCATH» en SAP son el mismo producto."],
        ["¿Por qué no se resuelve por parecido de nombre?",
         "Porque dos productos que no son el mismo tienen nombres casi iguales: lo que " +
         "los distingue es la concentración, el volumen o el calibre. Asignar por " +
         "parecido es justamente el error que este trabajo evita."],
        ["¿Qué es un «caso»?",
         "Una fila de este trabajo: un ítem contado en un depósito, o un material de SAP " +
         "con stock que ningún inventario reconoció en esa base. Es la unidad en la que " +
         "se decide."],
        ["¿Qué diferencia hay entre centro y almacén?",
         "El <b>centro</b> es la base: 1120 San Juan, 1060 Neuquén, 1130 Salta. El " +
         "<b>almacén</b> es el depósito dentro de esa base. Un material puede estar bien " +
         "identificado y figurar en el almacén equivocado: eso no lo convierte en alta ni " +
         "en baja."],
        ["¿Esto cambia algo en SAP?",
         "No. Ni el informe ni el sistema escriben en SAP. Producen el pedido de trabajo " +
         "para quien lo ejecute, con quién decidió cada cosa."],
        ["¿Quién decide?",
         "Una persona, caso por caso, en el sistema de gestión. Cada decisión queda " +
         "registrada con nombre y fecha, y se puede volver atrás."],
        ["¿Por qué hay tantos casos «en revisión»?",
         "Porque el criterio es exigente a propósito. Cada uno trae el candidato más " +
         "probable y el motivo exacto por el que no se dio por confirmado, así que la " +
         "revisión es rápida."],
        ["¿Cómo puede ser que algo que está en el depósito no exista en SAP?",
         "Lo más probable es que exista <b>sin stock</b>. La bajada recibida sólo trae los " +
         "materiales con existencia. Por eso, antes de crear nada, hay que consultar el " +
         "maestro completo."],
        ["¿Cuánta plata representa todo esto?",
         "Todavía no se puede decir: falta el precio de última compra, que no está en " +
         "ningún archivo recibido. No se inventó ningún valor ni se puso cero donde falta " +
         "el dato."],
        ["¿Qué pasa si me equivoco?",
         "Cualquier decisión se puede reabrir y volver a decidir. Queda el historial de " +
         "quién decidió qué y cuándo, así que siempre se ve qué cambió."],
        ["¿Hay que terminarlo de una vez?",
         "No. Se puede trabajar por base y de a grupos; el sistema guarda dónde quedó cada " +
         "uno y lo devuelve ahí la próxima vez."],
        ["¿Dónde se trabaja esto?",
         "En el <b>sistema de gestión</b>, que es una página web donde se decide caso por " +
         "caso. El <b>Excel</b> es la foto para compartir y revisar fuera del sistema. Este " +
         "<b>PDF</b> explica el criterio y el estado."],
      ]), "Parte 1");

    marcar("De dónde salen los números", 1);
    pagina("3 · De dónde salen los números", `
      <h4>Los inventarios físicos · el universo del análisis</h4>` +
      tabla(["Base", "Sistema", "Informe", "Ítems", "Unidades", "Renglones de lote"],
        m.fuentes.map(function (f) {
          return [esc(f.base), "<b>" + esc(f.sistema) + "</b>", esc(f.informe),
                  num(f.items), num(f.unidades), num(f.renglones_lote)];
        }).concat([["<b>Total</b>", "", "",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.items; }, 0)) + "</b>",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.unidades; }, 0)) + "</b>",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.renglones_lote; }, 0)) + "</b>"]]),
        ["", "", "", "n", "n", "n"]) + `
      <p class="nota">Los formatos de los dos sistemas son distintos y se procesaron por
      separado, conservando en los tres casos el detalle por lote y su vencimiento. Los
      archivos originales no se modificaron, y cada registro conserva de qué base, de qué
      sistema y de qué informe proviene.</p>
      <h4>La contraparte · SAP</h4>
      <p>Archivo <b>` + esc(m.sap.archivo) + `</b>, con corte al ` + esc(m.sap.corte) + `:
      ` + num(m.sap.codigos_unicos) + ` códigos de material distintos y
      ` + num(m.sap.pares_material_base) + ` combinaciones de material y base.</p>
      <p class="aviso"><b>Qué es y qué no es esta bajada.</b> Son <b>los materiales que hoy
      tienen stock</b>. <b>No es el maestro completo:</b> un material dado de alta con
      existencia cero no figura. Por eso que un ítem no encuentre correspondencia no prueba
      que no exista en SAP, y verificarlo contra el maestro completo <b>queda fuera del
      alcance de este trabajo</b>: es el paso previo obligatorio antes de cualquier alta.</p>
      <h4>Tres maneras de contar lo mismo</h4>
      <p>A lo largo del informe aparecen cifras que miden cosas distintas. Confundirlas
      cambia por completo la lectura.</p>` +
      tabla(["", "Qué es", "Cuántos hay"], [
        ["<b>ítem</b>", "Un producto contado en un inventario físico: una fila del PDF de la base.",
         "<b>" + num(k.items_fisicos) + "</b>"],
        ["<b>unidad</b>", "Cada unidad de ese producto. Un solo ítem puede ser 500 unidades, " +
         "así que las dos cifras no se parecen.", "<b>" + num(k.unidades_fisicas) + "</b>"],
        ["<b>caso</b>", "Una fila de este trabajo: un ítem del depósito, o un material de SAP " +
         "con stock que ningún inventario identificó. Es lo que cuentan las clasificaciones.",
         "<b>" + num(k.total_casos) + "</b>"],
        ["<b>material</b>", "Un código de SAP. Un mismo material aparece en varios casos si " +
         "tiene stock en más de una base.", "—"],
      ], ["eti-col"]) + `
      <p>Los ` + num(k.items_fisicos) + ` ítems contados generan ` + num(k.items_fisicos) + `
      casos. A eso se suman ` + num(k.total_casos - k.items_fisicos) + ` casos que no salen de
      ningún recuento: materiales que SAP registra con stock en una base y que ningún
      inventario identificó ahí. Como el ajuste se registra por centro, un mismo material con
      stock en dos bases son dos casos.</p>`, "Parte 1");

    // ====================================================== PARTE 2
    marcar("Parte 2 · Cómo se decidió cada caso", 0);
    marcar("Cómo se valida una correspondencia", 1);
    pagina("4 · Cómo se decide que dos nombres son el mismo producto", `
      <p>La regla de fondo: <b>el parecido del nombre genera el candidato, las
      características deciden.</b></p>` +
      tabla(["Característica", "Ejemplo de diferencia que impide la coincidencia"], [
        ["Concentración", "Ibuprofeno 600 mg frente a Ibuprofeno 400 mg"],
        ["Forma farmacéutica", "Diclofenac ampolla frente a Diclofenac comprimidos"],
        ["Volumen o presentación", "Agua oxigenada 500 ml frente a 100 ml"],
        ["Calibre", "Abbocath Nº 14 frente a Nº 22"],
        ["Medidas", "Gasa 10×10 frente a apósito 10×20"],
        ["Talle", "Guantes talle M frente a talle S"],
        ["Modelo o referencia", "Sonda K-30 frente a sonda K-10"],
        ["Longitud", "Pinza de 20 cm frente a una de 14 cm"],
        ["Población", "Pinza Magill pediátrica frente a la de adulto"],
        ["Esterilidad", "Apósito estéril frente a apósito no estéril"],
        ["Cantidad sin unidad", "«Claritromicina 500» no se puede interpretar sin más datos"],
      ]) + `
      <h4>Las tres reglas de decisión</h4>
      <ol>
        <li><b>Si los dos lados declaran la misma característica con valores distintos, no son
        el mismo material.</b> El candidato se descarta y queda registrado el motivo.</li>
        <li><b>Si una característica se declara de un lado y no del otro, nada quedó
        verificado</b> y el caso va a revisión. Sólo puede identificarse por el nombre un
        material que no declara ninguna característica de ningún lado, como un otoscopio.</li>
        <li><b>Cuanta más característica queda verificada, menos tiene que cargar el
        nombre.</b> Sin ninguna verificada, la denominación tiene que coincidir casi por
        completo en los dos sentidos.</li>
      </ol>
      <h4>Cuando una nomenclatura no corresponde a una sola</h4>
      <p>La correspondencia <b>no es uno a uno en ninguno de los dos sentidos</b>. SAP puede
      tener el mismo producto abierto en varios códigos, y cada base escribe el nombre a su
      manera. El sistema permite declarar los dos casos: <b>una del depósito = varios de
      SAP</b>, que se agrupan bajo un nombre unificado y dejan de ser candidatos a baja; y
      <b>varias del depósito = uno de SAP</b>, que se deciden juntas.</p>
      <p>La sugerencia de equivalencia <b>no sale del parecido del nombre</b>: dos ítems se
      proponen sólo si comparten un candidato en SAP, ninguna característica declarada por los
      dos está en conflicto, y coinciden en alguna verificable. Una sugerencia falsa es peor
      que ninguna.</p>
      <p class="nota">Caso aparte: cuando un lado informa la presentación y el otro no
      —«comprimidos» contra «60 comprimidos»—, no hay conflicto sino falta de dato. Esas
      presentaciones se pueden <b>declarar equivalentes</b> de una vez para todo el material.
      Cada caso guarda qué candidatos se evaluaron, en qué coincidían y en qué se
      contradecían, así que cualquier identificación puede auditarse sin rehacer el análisis:
      esa justificación está en la ficha del sistema y en el Excel.</p>`, "Parte 2");

    marcar("Las seis clasificaciones", 1);
    pagina("5 · Las seis clasificaciones y qué se hace con cada una", `
      <p>Cada caso recibe una clasificación, un curso de acción y un estado de revisión.</p>` +
      tabla(["", "Clasificación", "Qué significa", "Curso de acción"], [
        [et("A"), "Identificado en SAP", "Existe físicamente y se encontró un código cuya nomenclatura y presentación se corresponden.", "Mantener la identificación. No se propone alta."],
        [et("B"), "Sin correspondencia con stock", "Existe físicamente y no se encontró correspondencia entre los materiales que HOY tienen stock en SAP.", "Verificar primero en el maestro completo si ya existe sin stock. Recién después, proponer el alta."],
        [et("C"), "Candidato a baja", "Material con stock en SAP que ningún inventario físico identificó en esa base.", "Proponer la baja del stock de esa base."],
        [et("D"), "Requiere revisión", "Coincidencia parcial, diferencia de presentación, varios códigos posibles o nomenclatura insuficiente.", "Revisar y decidir. No se resuelve automáticamente."],
        [et("E"), "Fuera del alcance", "Indumentaria, equipamiento y repuestos.", "No concluir nada."],
        [et("F"), "En SAP sin stock", "Material de Farmacia que figura en la bajada con existencia CERO.", "No hay stock que dar de baja: decidir qué pasa con el registro en el maestro."],
      ], ["eti-col"]) + `
      <h4>Por qué existen la E y la F</h4>
      <p>Las dos salen de la misma pregunta: ¿qué significa que un material de SAP no aparezca
      en el inventario? Hay dos casos donde proponer una baja sería una conclusión falsa.
      <b>E:</b> indumentaria, equipamiento y repuestos nunca iban a figurar en un inventario
      <b>de Farmacia</b>, así que se apartan con la acción explícita de no concluir nada.
      <b>F:</b> materiales con <b>existencia cero</b>, donde no hay stock que dar de baja; lo
      que corresponde decidir es qué pasa con el <b>registro</b> en el maestro.</p>
      <h4>Las propuestas no son acciones ejecutadas</h4>
      <p>Crear lo no encontrado y dar de baja lo restante se interpreta acá como <b>criterio de
      clasificación, no como autorización</b>. Nada de este trabajo modifica SAP: las altas y
      las bajas son propuestas sujetas a revisión, y el sistema registra quién decide cada
      una.</p>
      <p class="aviso"><b>Dependencia a tener presente.</b> La lista de candidatos a baja es
      provisional mientras queden casos en revisión: si un caso se resuelve identificando un
      material, ese material deja de ser candidato a baja. Hoy hay
      <b>` + num(k.bajas_bloqueadas) + ` candidatos a baja</b> que figuran como posible
      equivalencia de un ítem todavía sin resolver. <b>Aprobar las bajas primero es el error
      más caro</b>, y por eso van últimas en el orden de trabajo.</p>`, "Parte 2");

    // ====================================================== PARTE 3
    marcar("Parte 3 · Cómo quedó el análisis", 0);
    marcar("Resumen ejecutivo", 1);
    var pctId = t.A / k.items_fisicos * 100;
    pagina("6 · Cómo quedó el análisis", `
      <p class="cont">` + num(k.items_fisicos) + ` ítems y ` + num(k.unidades_fisicas) + `
      unidades contadas, más los materiales de SAP que ningún inventario identificó:
      ` + num(k.total_casos) + ` casos de gestión.</p>` +
      '<div class="kpifila">' +
      [["A", t.A, "Identificados en SAP", "casos · de " + num(k.items_fisicos) + " ítems"],
       ["B", t.B, "Sin correspondencia", "casos · posible alta"],
       ["C", t.C, "Candidatos a baja", "casos · material SAP"],
       ["D", t.D, "En revisión", "casos · no se resuelven solos"],
       ["E", t.E, "Fuera del alcance", "casos · no son de Farmacia"],
       ["F", t.F, "En SAP sin stock", "casos · se depura el maestro"]]
      .map(function (x) {
        return '<div class="kpi ' + x[0] + '"><div class="n">' + num(x[1]) +
          '</div><div class="t">' + x[2] + '</div><div class="d">' + x[3] + "</div></div>";
      }).join("") + "</div>" + `
      <ul>
        <li>De los ` + num(k.items_fisicos) + ` ítems contados, <b>` + num(t.A) + ` quedaron
        identificados</b> con un código verificado por presentación (` + pctId.toFixed(0) + `%),
        <b>` + num(t.B) + ` no encontraron correspondencia</b> entre los materiales con stock
        y <b>` + num(t.D) + ` requieren una decisión humana</b>. La proporción en revisión es
        alta a propósito: el criterio no admite resolver por parecido de nombre. De las
        identificaciones, ` + num(k.confianza.Alta || 0) + ` son de confianza alta y
        ` + num(k.confianza.Media || 0) + ` de confianza media, que conviene repasar
        primero.</li>
        <li><b>Los ` + num(t.B) + ` no son altas confirmadas</b>: podrían estar ya dados de
        alta con stock cero, y eso se verifica contra el maestro completo.</li>
        <li><b>` + num(k.sin_stock_en_base) + ` ítems están identificados y SAP no registra
        stock de ese material en su base.</b> Hay existencia física y el código existe: no son
        altas, hay que registrar la existencia o revisar en qué centro está cargada.</li>
        <li><b>La ubicación es un problema aparte.</b>
        <b>` + num(al["Almacén a cambiar"] || 0) + `</b> materiales figuran en un almacén
        distinto del propuesto y <b>` + num(al["Material en múltiples almacenes"] || 0) + `</b>
        en varios a la vez: están bien identificados, lo que no coincide es el lugar.</li>
      </ul>
      <h4>Por base</h4>` +
      tabla(["Base", "Sistema", "Ítems físicos", "Unidades", "A", "B", "C", "D", "E", "Casos"],
        m.bases.map(function (b) {
          var g = k.por_base[b], fu = m.fuentes.filter(function (x) { return x.base === b; })[0];
          return [esc(b), esc(fu.sistema), num(g.items_fisicos), num(g.unidades_fisicas),
                  num(g[m.clases[0]]), num(g[m.clases[1]]), num(g[m.clases[2]]),
                  num(g[m.clases[3]]), num(g[m.clases[4]]), num(g.casos)];
        }).concat([["<b>Total</b>", "", "<b>" + num(k.items_fisicos) + "</b>",
          "<b>" + num(k.unidades_fisicas) + "</b>", "<b>" + num(t.A) + "</b>",
          "<b>" + num(t.B) + "</b>", "<b>" + num(t.C) + "</b>", "<b>" + num(t.D) + "</b>",
          "<b>" + num(t.E) + "</b>", "<b>" + num(k.total_casos) + "</b>"]]),
        ["", "", "n", "n", "n", "n", "n", "n", "n", "n"]) + `
      <h4>Por qué cada caso quedó en revisión</h4>` +
      tabla(["Motivo", "Casos", "Qué hay que hacer"],
        Object.keys(k.motivos).sort(function (a, b) { return k.motivos[b] - k.motivos[a]; })
        .map(function (mo) {
          var q = {
            "Coincidencia parcial de denominación": "Confirmar si el candidato es el material o no lo es.",
            "Falta un atributo para confirmar la presentación": "Completar la presentación, o declararlas equivalentes.",
            "Varios códigos SAP posibles": "Elegir cuál de los candidatos corresponde.",
            "Conflicto de presentación": "Verificar si existe en SAP el material con la presentación correcta.",
            "Nomenclatura insuficiente para decidir": "Precisar la nomenclatura antes de decidir.",
          }[mo] || "Revisar el caso.";
          return [esc(mo), num(k.motivos[mo]), esc(q)];
        }), ["", "n", ""]), "Parte 3");

    // ====================================================== PARTE 4
    marcar("Parte 4 · Qué hay que aplicar en SAP", 0);
    marcar("Qué hay que hacer, y con qué cantidades", 1);
    var bEj = pl.todos[0], bFa = pl.todos[1], bNa = pl.todos[2], bFu = pl.todos[3];
    pagina("7 · Qué hay que aplicar en SAP", `
      <p>El resultado de las decisiones registradas al generar el informe:
      <b>` + num(dec) + ` casos decididos</b> de los ` + num(pl.decidibles) + ` que requieren
      decisión, cada uno con la cantidad que le corresponde.</p>
      <p class="aviso"><b>Cómo leer las cantidades.</b> Las <b>unidades contadas</b> son las
      del recuento en el depósito: la cantidad de un alta o de un ajuste. Las <b>unidades en
      SAP</b> son las que el sistema registra: la cantidad de una baja o de un movimiento de
      almacén. Los <b>registros</b> son materiales del maestro, sin unidades. <b>Las tres
      columnas miden cosas distintas y no se suman entre sí.</b></p>
      <h4>Hay que hacerlo en SAP · ` + num(bEj.n) + ` casos</h4>` +
      (bEj.n ? filasPlan(bEj)
        : '<p class="vacio">Todavía no hay ninguna decisión tomada que haya que aplicar en ' +
          "SAP. Las decisiones se toman en el sistema y esta sección se rearma sola.</p>") + `
      <h4>Decidido, y no hay nada que hacer · ` + num(bNa.n) + ` casos</h4>
      <p class="cont">Se revisaron y se cerraron sin trabajo en SAP. Están contados para que
      se vea que se los miró.` + (bNa.n ? " " + bNa.fams.map(function (f) {
        return f.acciones.map(function (a) {
          return esc(a.verbo.replace(/^Ninguna · /, "")) + " " + num(a.n);
        }).join(" · ");
      }).join(" · ") + "." : " Todavía no hay ninguno.") + `</p>
      <h4>Cómo se reparte entre las bases</h4>
      <p class="cont">Cada base se ejecuta en su centro de SAP.</p>` +
      tabla(["Base", "Centro", "Hay que hacerlo en SAP", "Sin decidir", "Sin acción",
             "Fuera del alcance"],
        m.bases.filter(function (b) { return pl.porBase[b]; }).map(function (b) {
          var x = pl.porBase[b];
          var ce = (d.casos.filter(function (c) { return c.base === b && c.centro; })[0] || {}).centro;
          return [esc(b), esc(ce || ""), num(x.ejecutar), num(x.falta), num(x.nada),
                  num(x.fuera)];
        }), ["", "", "n", "n", "n", "n"]) + `
      <p class="nota">El detalle caso por caso —código, nomenclatura de los dos lados,
      almacén, cantidades y quién lo decidió— está en el Excel, hoja <b>«Qué hacer en SAP»</b>.
      Este mismo resumen es la hoja <b>«Aplicar en SAP»</b> y la pantalla del mismo nombre en
      el sistema.</p>`, "Parte 4");

    marcar("Lo que falta decidir y lo que queda afuera", 1);
    pagina("8 · Lo que no se pudo decidir, y lo que está fuera del alcance", `
      <h4>Todavía no se pudo decidir · ` + num(bFa.n) + ` casos</h4>
      <p>Nada de esto se ejecuta hasta que alguien lo decida, en el sistema, caso por caso o
      en lote. El orden importa: cada grupo destraba al siguiente.</p>` +
      (bFa.n ? filasPlan(bFa) : '<p class="vacio">No queda nada sin decidir.</p>') +
      tabla(["En qué orden conviene trabajarlos", "Por qué"], [
        ["<b>1 · Identificación</b>", "Sin código no se puede saber si falta existencia, si el almacén está mal ni si algo sobra."],
        ["<b>2 · Altas de material</b>", "Consultar el maestro completo antes de crear, o crear asumiendo el riesgo de duplicado."],
        ["<b>3 · Ajustes de existencia</b>", "Requiere el código ya decidido."],
        ["<b>4 · Movimientos de almacén</b>", "Requiere el código decidido y el almacén validado por la base."],
        ["<b>· Maestro de materiales</b>", "Independiente del resto: se puede resolver en cualquier momento."],
        ["<b>5 · Bajas de stock</b>", "Van últimas: la lista se achica sola al resolver los códigos."],
      ]) + `
      <h4>Fuera del alcance · ` + num(bFu.n) + ` casos</h4>
      <p>Indumentaria, equipamiento y repuestos: nunca iban a figurar en un inventario <b>de
      Farmacia</b>. <b>De su ausencia no se concluye nada</b>, ni alta ni baja. Están contados
      aparte para que se vea que se los miró y se decidió no concluir, que no es lo mismo que
      haberlos pasado por alto.</p>
      <p class="aviso"><b>Qué hay que confirmar:</b> que quedan definitivamente fuera del
      alcance y por qué otra vía se controlan. Es una decisión de la organización.</p>`,
      "Parte 4");

    // ====================================================== PARTE 5
    marcar("Parte 5 · Lo que falta y quién decide", 0);
    marcar("Centros y almacenes", 1);
    pagina("9 · Dónde está el stock: centros y almacenes", `
      <p>El <b>centro</b> es la base; el <b>almacén</b> es el depósito dentro de esa base. Son
      dos campos distintos de SAP y hasta acá sólo se había mirado el centro. Hay tres
      cuestiones independientes y conviene no mezclarlas: si el material está bien
      <b>identificado</b>, si tiene <b>stock</b>, y si ese stock está en el <b>almacén que
      corresponde</b>.</p>` +
      tabla(["Estado de la ubicación", "Casos", "Qué significa"], [
        ["Almacén correcto", num(al["Almacén correcto"] || 0), "El stock está en el almacén propuesto para esa base y tipo."],
        ["Almacén a cambiar", num(al["Almacén a cambiar"] || 0), "Figura en un almacén distinto del propuesto. Hay que evaluar el cambio con la base."],
        ["En varios almacenes", num(al["Material en múltiples almacenes"] || 0), "El mismo material tiene stock en más de un almacén de la misma base. No se consolidó nada."],
        ["Pendiente de validar", num((al["Almacén pendiente de validación"] || 0) + (al["Almacén no identificado"] || 0)), "No hay propuesta de almacén para esa base y tipo, o la bajada no trae el código."],
      ], ["", "n", ""]) + `
      <h4>Almacén esperado por base y tipo · propuesta a validar</h4>` +
      tabla(["Base", "Tipo", "Almacén", "Confianza", "Otros almacenes de la base con stock de ese tipo"],
        (am.propuesta || []).map(function (p) {
          var otros = (p.alternativas || []).filter(function (x) { return x.almacen !== p.almacen; });
          return [esc(p.base), esc(p.tipo), "<b>" + esc(p.almacen || "—") + "</b>",
                  esc(p.confianza),
                  otros.length ? otros.map(function (x) {
                    return esc(x.almacen) + " (" + num(x.unidades) + " un.)"; }).join(" · ") : "—"];
        }), ["", "", "", "", ""]) + `
      <p class="nota"><b>Clara</b> significa que el almacén propuesto concentra el grueso del
      stock de ese tipo. <b>Ambigua</b> significa que un segundo almacén también concentra
      volumen y la propuesta <b>no es concluyente</b>: ahí hace falta preguntarle a la base.</p>
      <h4>Qué está observado y qué es una propuesta</h4>
      <p><b>Observado:</b> a qué base pertenece cada almacén. En la bajada, cada uno de los
      ` + (am.observados || []).length + ` códigos de almacén aparece bajo un único centro, así
      que eso <b>no es una suposición</b>: está en el archivo. El listado por base está en el
      Excel.</p>
      <p class="aviso"><b>Propuesta a validar:</b> qué almacén <i>debería</i> contener el stock
      de Farmacia en cada base <b>no está en ningún archivo recibido</b>. Se propone a partir
      de la composición observada de cada almacén —qué materiales y cuántas unidades
      concentra—, <b>nunca por parecido de nombres ni de códigos</b>. Hay que validarla con
      cada base antes de concluir nada. <b>Nada de esto mueve stock:</b> una decisión de
      ubicación es una propuesta de traslado, y la ejecución en SAP es un paso posterior.</p>`,
      "Parte 5");

    marcar("El maestro completo y la depuración", 1);
    var rb = { ruta: 0, verif: 0, crear: 0, cerrado: 0, no: 0 };
    d.casos.forEach(function (c) {
      if (L(c) !== "B") return;
      var e = ef(c);
      if (e.aprobacion === "Rechazado") { rb.no++; return; }
      if (!e.ruta_b) { rb.ruta++; return; }
      if (e.ruta_b === App.RB.CREAR) { rb.crear++; return; }
      if (!e.verificacion) { rb.verif++; return; }
      rb.cerrado++;
    });
    var uni = App.universoDep();
    var cu = { "": 0 }, exc = 0;
    App.DP.ACCIONES.forEach(function (x) { cu[x] = 0; });
    uni.forEach(function (u) {
      var acc = App.accionDep(u.codigo);
      cu[acc.accion] = (cu[acc.accion] || 0) + 1;
      if (acc.excepcion) exc++;
    });
    var pol = App.depuracion().politica;
    pagina("10 · Lo que falta para cerrar: el maestro completo", `
      <h4>Los ` + num(t.B) + ` ítems sin correspondencia: dos alternativas, no una</h4>
      <p>Existen en el depósito y no aparecieron entre los materiales que <b>hoy tienen
      stock</b> en SAP. Eso <b>no prueba que no existan</b>. Por eso el trabajo no es «dar de
      alta»: es elegir expresamente cómo se trabaja cada caso.</p>` +
      tabla(["", "Alternativa", "Qué riesgo tiene"], [
        [alt(1), "<b>Consultar en SAP antes de crear.</b> Si aparece y sirve, se le asigna ese código y no se crea nada.", "Ninguno sobre los datos. El costo es de tiempo: el caso queda abierto hasta que se cargue el resultado."],
        [alt(2), "<b>Crear igual, sin verificar.</b> El sistema no lo impide: lo pregunta, exige confirmar que se entiende el riesgo y registra quién lo decidió.", "<b>Código duplicado.</b> Si el material ya existía con stock cero, queda el mismo producto abierto dos veces, con el stock, los consumos y el histórico partidos."],
      ], ["eti-col"]) + `
      <p class="cont">Cómo están hoy: ` + num(rb.ruta) + ` sin alternativa elegida ·
      ` + num(rb.verif) + ` esperando el resultado de la consulta · ` + num(rb.cerrado) + `
      con la verificación cargada · ` + num(rb.crear) + ` crear sin verificar, con el riesgo
      asumido · ` + num(rb.no) + ` se decidió no darlos de alta.</p>
      <h4>La depuración del maestro · ` + num(t.F) + ` materiales con existencia cero</h4>
      <p>No hay stock que dar de baja. Lo que corresponde decidir es qué pasa con el
      <b>registro</b>: <b>mantener</b> —lo más conservador, el maestro sigue creciendo—,
      <b>bloquear</b> —no se puede usar en documentos nuevos, se conserva el histórico, y es
      reversible— o <b>dar de baja del maestro</b> —el más drástico y el más difícil de volver
      atrás—.</p>
      <p class="cont">Hoy: ` + num(uni.length) + ` materiales sin stock a la vista ·
      política masiva ` + (pol ? "<b>" + esc(pol.accion) + "</b>" : "<b>sin definir</b>") + ` ·
      ` + num(cu[""] || 0) + ` sin decidir · ` + num(cu[App.DP.MANT] || 0) + ` mantener ·
      ` + num(cu[App.DP.BLOQ] || 0) + ` bloquear · ` + num(cu[App.DP.BAJA] || 0) + ` dar de
      baja · ` + num(exc) + ` excepciones registradas a la política masiva.</p>
      <p>Se puede decidir material por material o fijar una <b>política masiva</b>. La decisión
      individual <b>manda sobre la masiva</b>: cuando difiere, el material queda anotado como
      <b>excepción</b>, con su motivo escrito, así una limpieza masiva no borra los casos que
      había que mirar de cerca.</p>
      <p class="aviso"><b>Lo que se ve no es todo el universo a depurar.</b> La bajada trae los
      materiales <b>con stock</b>; estos ` + num(t.F) + ` aparecieron igual con existencia cero
      y son la <b>punta visible</b>. Cuántos materiales tiene el maestro completo en cero
      <b>no se puede saber con los archivos recibidos</b>. El sistema permite importar el
      maestro completo en CSV: con eso el universo se completa solo. <b>Crear sin verificar y
      depurar el maestro son las dos caras de lo mismo</b>, y por eso cada caso que toma la
      alternativa 2 queda anotado en el plan de depuración.</p>`, "Parte 5");

    marcar("Valorización y controles", 1);
    pagina("11 · Valorización y controles de integridad", `
      <h4>Valorización · el criterio pedido fue precio de última compra</h4>
      <p class="aviso"><b>Ese dato no está disponible en ninguno de los archivos recibidos.</b>
      La bajada de SAP tiene el valor contable del stock y un valor unitario que resulta de
      dividirlo por las unidades, pero <b>no precio de compra, ni fecha, ni proveedor, ni
      documento</b>. El archivo de homologación declara que los campos de costo quedan fuera
      de ese trabajo, y los tres PDF de inventario no mencionan precios. En consecuencia,
      <b>` + num(k.pendientes_valorizacion) + ` casos figuran como pendientes de
      valorización</b> y no se informa ningún total. <b>No se estimó ningún precio.</b></p>
      <p>Para no perder la información económica que existe, se expone en paralelo la
      valorización de stock de SAP, <b>siempre rotulada como lo que es</b> y nunca sumada ni
      presentada como precio de compra: es el valor contable dividido por las unidades, un
      promedio ponderado de lo que está valorizado, no lo que costó la última reposición.
      Por clasificación: ` + m.clases.filter(function (cl) { return k.referencia_sap[cl]; })
        .map(function (cl) {
          return esc(cl.split(" ")[0]) + " " + pesos(k.referencia_sap[cl]); }).join(" · ") + `.
      Las clasificaciones sin cifra todavía no tienen un código de SAP confirmado, o no
      tienen stock.</p>
      <p class="nota">Cuando el dato esté, se carga solo: en el sistema, <b>Maestro → Maestro
      general</b> se baja una planilla con un renglón por código de SAP, se completa la columna
      del importe de última compra y se vuelve a subir el mismo archivo. Lo que quede sin
      importe se informa como pendiente, <b>nunca como cero</b>.</p>
      <h4>Controles de integridad contra las fuentes</h4>` +
      tabla(["Control", "En la fuente", "En el sistema", "Estado"],
        d.control.map(function (c) {
          return [esc(c.control), num(c.fuente), num(c.sistema),
                  '<b class="' + (c.estado === "Coincide" ? "ok" : "") + '">' + esc(c.estado) + "</b>"];
        }), ["", "n", "n", ""]) + `
      <p class="aviso"><b>Qué prueban y qué no.</b> Que los ítems y las unidades coincidan con
      los PDF originales prueba que <b>no se perdió ni se duplicó nada al leerlos</b>. No
      prueba que el recuento físico sea correcto: eso depende de cómo se hizo el inventario en
      cada base, y queda fuera de este trabajo.</p>`, "Parte 5");

    marcar("Próximos pasos", 1);
    pagina("12 · Próximos pasos, en orden", `
      <p>El orden importa: cada paso cambia los números del siguiente.</p>
      <ol>
        <li><b>Resolver los ` + num(t.D) + ` casos en revisión.</b> Es el trabajo principal y
        el que destraba el resto. Conviene empezar por los
        ` + num(k.motivos["Varios códigos SAP posibles"] || 0) + ` de «varios códigos
        posibles», que se deciden eligiendo entre candidatos ya identificados.</li>
        <li><b>Elegir la alternativa de los ` + num(t.B) + ` ítems sin correspondencia:</b>
        verificar primero el maestro completo, o crear asumiendo el riesgo de duplicado.</li>
        <li><b>Pedir el maestro completo de materiales de SAP.</b> Es lo único que permite
        cerrar la alternativa 1 y dimensionar de verdad la depuración.</li>
        <li><b>Validar la propuesta de almacén esperado con cada base.</b> Recién con eso
        validado tienen sentido las ` + num(al["Almacén a cambiar"] || 0) + ` ubicaciones a
        cambiar.</li>
        <li><b>Resolver los ` + num(k.sin_stock_en_base) + ` ítems con existencia física y sin
        stock en SAP en su base.</b> No son altas: el código existe.</li>
        <li><b>Revisar las ` + num(k.bajas_bloqueadas) + ` bajas que dependen de un caso en
        revisión</b> antes que el resto, porque pueden dejar de ser bajas.</li>
        <li><b>Definir la política de depuración</b> sobre los ` + num(t.F) + ` materiales sin
        stock a la vista, con sus excepciones.</li>
        <li><b>Conseguir el precio de última compra</b> y cargarlo en el maestro.</li>
        <li><b>Recién después, aprobar las ` + num(t.C) + ` bajas restantes</b> y elevar el
        paquete para su ejecución en SAP.</li>
      </ol>
      <h4>Dónde está cada cosa</h4>` +
      tabla(["Si hace falta…", "Dónde está"], [
        ["<b>Saber qué hay que hacer en SAP</b>", "Sistema, pantalla <b>«Aplicar en SAP»</b>, y Excel, hoja <b>«Aplicar en SAP»</b>: el resumen por acción con sus cantidades. El detalle caso por caso, en la hoja «Qué hacer en SAP»."],
        ["Tomar las decisiones", "Sistema, pantalla <b>«Trabajar»</b>: cada caso aparece como una pregunta concreta, con lo que dice el depósito de un lado y lo que dice SAP del otro. Se puede acotar a una base, filtrar y decidir en lote."],
        ["Ver un material puntual con su justificación", "Sistema, pantalla «Buscar», o Excel, hoja «Casos»: una fila por caso, con la comparación característica por característica."],
        ["Cargar el importe de última compra", "Sistema, <b>Maestro → Maestro general</b>: se baja la planilla, se completa la columna del importe y se vuelve a subir el mismo archivo."],
        ["La ubicación de cada material", "Excel, hoja «Casos», columnas AN a AS; la propuesta de almacén por base y tipo, en el «Resumen»."],
        ["Quién decidió qué y cuándo", "Excel, hoja «Decisiones»: el historial completo, con nombre y fecha."],
        ["Verificar que las cifras cierran", "Excel, hoja «Control»: cada control se recalcula solo sobre la hoja «Casos»."],
      ]) + `
      <p class="nota"><b>Los tres salen del mismo dato:</b> el sistema, el Excel y este
      informe se arman del mismo conjunto de casos y de las mismas decisiones registradas.</p>`,
      "Parte 5");

    marcar("Límites y decisiones que requieren validación", 1);
    pagina("13 · Los límites del análisis y las decisiones que no le corresponden", `
      <h4>Lo que este trabajo puede afirmar, y lo que no</h4>
      <ul>
        <li>Cubre los tres inventarios recibidos y el stock de SAP al ` + esc(m.sap.corte) + `.
        <b>No cubre movimientos posteriores.</b></li>
        <li>La contraparte son los materiales <b>con stock</b>, no el maestro completo: la
        clasificación B no afirma que el material no exista en SAP.</li>
        <li>La identificación se valida sobre la <b>denominación y la presentación declaradas
        en los textos</b>. Si un texto de SAP no declara la presentación, el caso va a revisión
        en lugar de resolverse por aproximación.</li>
        <li>Las cantidades físicas son las informadas en cada reporte. El informe de Neuquén
        declara él mismo una diferencia entre el stock actual y el saldo de movimientos en dos
        medicamentos; se conservó el stock actual, que es el total declarado.</li>
      </ul>
      <h4>Las decisiones que dependen de un criterio de la organización</h4>
      <p>Ninguna de éstas la puede tomar el análisis. Están listadas acá para que se definan
      antes de ejecutar nada.</p>` +
      tabla(["Decisión", "Por qué requiere validación"], [
        ["Alcance del recuento", "Confirmar que los " + num(t.E) + " materiales de indumentaria, equipamiento y repuestos quedan definitivamente fuera, y por qué vía se controlan."],
        ["Criterio de baja", "Afecta a " + num(t.C) + " combinaciones de material y base. Hay que validar si la ausencia en el recuento es motivo suficiente, o si se exige una verificación previa en depósito."],
        ["Crear sin verificar, o esperar el maestro", "Para los " + num(t.B) + " ítems sin correspondencia: si se admite crear sin verificar el maestro completo —asumiendo el riesgo de código duplicado— o si se espera. La herramienta permite las dos y registra cuál se eligió."],
        ["Qué hacer con un código que ya existe", "Si se le asigna ese código, o se da de baja y se crea uno nuevo. Afecta la trazabilidad histórica del material."],
        ["Almacén esperado por base y tipo", "Cada base tiene que confirmar cuál es el almacén de Farmacia, y si medicamentos y descartables van separados."],
        ["Qué hacer con el maestro sin stock", "Mantener, bloquear o dar de baja. Puede ser una política masiva con excepciones, pero el criterio y quién lo autoriza son de la organización."],
        ["Unidad de la baja", "Un material identificado en una base y no en otra: se da de baja el stock de esa base, no el material. Confirmar que ése es el criterio."],
        ["Fuente del precio", "Definir de qué reporte sale el precio de última compra y con qué corte, para que la valorización sea reproducible."],
        ["Responsable de la validación por base", "Las decisiones quedan registradas con nombre. Hay que definir quién valida cada base y quién cierra con Farmacia."],
      ]), "Parte 5");

    return { paginas: paginas, indice: indice };
  }

  // ---------------------------------------------------------- render
  var A4 = 297 * 96 / 25.4;        // alto de una A4 en px CSS
  var RESERVA = 104;               // pie + relleno inferior, con holgura

  /* Una hoja que se pasa de alto no avisa: al imprimir larga una página extra y
     la numeración del índice deja de cerrar. Esto lo detecta antes de generar el
     PDF, midiendo el contenido real ya renderizado. */
  function verificar() {
    var malas = [];
    document.querySelectorAll("#v-informe .hoja").forEach(function (h, i) {
      var cu = h.querySelector(".cu");
      if (!cu) return;
      var alto = cu.getBoundingClientRect().bottom - h.getBoundingClientRect().top;
      if (alto > A4 - RESERVA) {
        var t = h.querySelector("h2");
        malas.push({ hoja: i + 1, titulo: t ? t.textContent : "(sin título)",
                     alto: Math.round(alto), tope: Math.round(A4 - RESERVA) });
      }
    });
    return malas;
  }

  function html() {
    var r = construir();
    var total = r.paginas.length + 2;   // portada + índice
    var fechaTxt = new Date().toLocaleDateString("es-AR",
      { day: "2-digit", month: "long", year: "numeric" });
    var d = D(), k = d.kpis, t = App.conteos(d.casos);

    var portada = '<section class="hoja portada"><div class="pcont">' +
      '<div class="pmarca">Informe integral</div>' +
      "<h1>Inventario físico vs SAP</h1>" +
      '<p class="plead">Identificación de materiales, cursos de acción propuestos y estado de ' +
      "la valorización. San Juan, Neuquén y Salta.</p>" +
      '<div class="pdatos">' +
      [["Universo analizado", num(k.items_fisicos) + " ítems de inventario físico"],
       ["Unidades contadas", num(k.unidades_fisicas)],
       ["Casos de gestión", num(k.total_casos)],
       ["Identificados en SAP", num(t.A)],
       ["Propuestas de alta", num(t.B)],
       ["Propuestas de baja", num(t.C)],
       ["Casos en revisión", num(t.D)],
       ["Valorización", "pendiente · falta el precio de última compra"],
       ["Fecha del informe", fechaTxt],
       ["Generado por", App.revisor() || "(sin identificar)"]]
      .map(function (x) {
        return '<div class="pd"><div class="k">' + esc(x[0]) + '</div><div class="v">' +
               esc(x[1]) + "</div></div>";
      }).join("") + "</div>" +
      '<p class="pnota">Las altas y las bajas que figuran en este informe son <b>propuestas ' +
      "sujetas a revisión y aprobación</b>. Este trabajo no ejecuta ninguna modificación sobre " +
      "SAP.</p></div>" + pie(1, total) + "</section>";

    var idx = '<section class="hoja"><div class="hcab"><span>Inventario físico vs SAP</span>' +
      "<span>Índice</span></div><h2>Índice</h2><div class=\"indice\">" +
      r.indice.map(function (i) {
        return '<div class="i' + i.nivel + '"><span>' + esc(i.texto) +
               '</span><span class="pp">' + (i.pagina + 2) + "</span></div>";
      }).join("") + "</div>" + pie(2, total) + "</section>";

    // Se arma en el DOM para poder medir; recién al final se numeran las hojas,
    // de modo que el número impreso coincida siempre con la página real.
    var cont = document.createElement("div");
    cont.className = "informe";
    cont.innerHTML = ESTILO;
    var medidor = document.createElement("div");
    medidor.style.cssText = "position:absolute;left:-10000px;top:0;width:260mm";
    medidor.appendChild(cont);
    document.body.appendChild(medidor);

    var hojas = [];
    function crearHoja(titulo, seccion) {
      var el = document.createElement("section");
      el.className = "hoja";
      el.innerHTML = '<div class="hcab"><span>Inventario físico vs SAP</span><span>' +
        esc(seccion || "") + "</span></div><h2>" + esc(titulo) + '</h2><div class="cu"></div>';
      cont.appendChild(el);
      return { el: el, cuerpo: el.querySelector(".cu") };
    }

    r.paginas.forEach(function (p) {
      var antes = hojas.length;
      var h = crearHoja(p.titulo, p.seccion);
      h.cuerpo.innerHTML = p.cuerpo;
      hojas.push(h);
      if (p.ancla && hojas[antes]) hojas[antes].ancla = p.ancla;
    });

    var totalReal = hojas.length + 2;
    hojas.forEach(function (h, i) {
      h.el.insertAdjacentHTML("beforeend", pie(i + 3, totalReal));
    });

    var htmlHojas = cont.innerHTML.replace(ESTILO, "");
    medidor.remove();

    var idx2 = '<section class="hoja"><div class="hcab"><span>Inventario físico vs SAP</span>' +
      "<span>Índice</span></div><h2>Índice</h2><div class=\"indice\">" +
      indiceDe(hojas, r.indice) + "</div>" + pie(2, totalReal) + "</section>";
    var portada2 = portada.replace("Página 1 de " + total, "Página 1 de " + totalReal);

    return ESTILO + '<div class="informe">' + portada2 + idx2 + htmlHojas + "</div>";
  }

  /* El índice se arma contra las hojas realmente producidas, por ancla. */
  function indiceDe(hojas, entradas) {
    var dondeEsta = {};
    hojas.forEach(function (h, i) { if (h.ancla) dondeEsta[h.ancla] = i + 3; });
    // una entrada de nivel 0 (una parte) apunta a donde empieza su primera sección
    for (var i = entradas.length - 1; i >= 0; i--) {
      if (entradas[i].nivel === 0) {
        for (var j = i + 1; j < entradas.length; j++) {
          if (entradas[j].nivel === 0) break;
          if (dondeEsta[entradas[j].id]) { dondeEsta[entradas[i].id] = dondeEsta[entradas[j].id]; break; }
        }
      }
    }
    return entradas.map(function (e) {
      var p = dondeEsta[e.id];
      return '<div class="i' + e.nivel + '"><span>' + esc(e.texto) +
             '</span><span class="pp">' + (p || "") + "</span></div>";
    }).join("");
  }
  function pie(n, total) {
    return '<div class="hpie"><span>Informe integral · inventario físico vs SAP</span>' +
      "<span>Página " + n + " de " + total + "</span></div>";
  }

  var ESTILO = `<style>
  .informe{--ia:#1F4E78;--itx:#111;--itx2:#444;--itx3:#6f6f6f;--ilin:#d8d7d2;
    --iA:#0f7f58;--iB:#1d5fae;--iC:#b8431f;--iD:#4a3bb5;--iE:#6b6b6b;--iF:#0e6b73;
    background:#e9e9e6;padding:16px 0;color:var(--itx)}
  .informe *{box-sizing:border-box}
  .hoja{width:210mm;min-height:297mm;background:#fff;margin:0 auto 14px;padding:18mm 16mm 16mm;
    position:relative;font:10.5pt/1.5 "Segoe UI",Helvetica,Arial,sans-serif;color:var(--itx)}
  .hcab{display:flex;justify-content:space-between;font-size:8pt;color:var(--itx3);
    border-bottom:1px solid var(--ilin);padding-bottom:5px;margin-bottom:12px;
    letter-spacing:.04em;text-transform:uppercase}
  .hpie{position:absolute;left:16mm;right:16mm;bottom:10mm;display:flex;
    justify-content:space-between;font-size:8pt;color:var(--itx3);
    border-top:1px solid var(--ilin);padding-top:5px}
  .hoja h2{font-size:15pt;color:var(--ia);margin:0 0 12px;letter-spacing:-.01em;
    padding-bottom:6px;border-bottom:2px solid var(--ia)}
  .hoja h4{font-size:10.5pt;color:var(--ia);margin:15px 0 5px}
  .hoja p{margin:0 0 8px;text-align:justify}
  .hoja ul,.hoja ol{margin:0 0 9px;padding-left:18px}
  .hoja li{margin-bottom:4px;text-align:justify}
  .nota{font-size:9pt;color:var(--itx2);background:#f6f6f3;border-left:3px solid var(--ilin);
    padding:7px 10px;margin:9px 0 !important;text-align:left !important}
  .aviso{font-size:9.5pt;background:#fdf3ee;border-left:3px solid var(--iC);
    padding:8px 11px;margin:10px 0 !important;text-align:left !important}
  .vacio{color:var(--itx3);font-style:italic}
  .cont{font-size:8.5pt;color:var(--itx3);margin-bottom:7px !important}
  table.t{border-collapse:collapse;width:100%;font-size:8.6pt;margin:7px 0 10px}
  table.t th{background:var(--ia);color:#fff;text-align:left;padding:5px 6px;
    font-size:7.6pt;letter-spacing:.03em;text-transform:uppercase;font-weight:600}
  table.t td{padding:4px 6px;border-bottom:1px solid var(--ilin);vertical-align:top}
  table.t td.n,table.t th.n{text-align:right;white-space:nowrap}
  table.t th.eti-col,table.t td.eti-col{width:22px}
  table.t tr:nth-child(even) td{background:#fafaf8}
  table.t.cp td{padding:2.5px 6px}
  .sub2{font-size:7.6pt;color:var(--itx3)}
  /* Las preguntas de entrada, a dos columnas: entran doce en una página y se
     leen salteadas, que es como se lee una lista de preguntas. */
  .faq{column-count:2;column-gap:8mm;margin-top:4px}
  .faq .q{break-inside:avoid;page-break-inside:avoid;margin-bottom:9px}
  .faq .q>b:first-child{display:block;color:var(--ia);font-size:9.4pt;margin-bottom:1px}
  .faq .q span b{color:var(--itx)}
  .faq .q span{display:block;font-size:8.8pt;color:var(--itx2);line-height:1.45;
    text-align:justify}
  .glosa{font-size:8.4pt;color:var(--itx2);background:#f6f6f3;border-radius:4px;
    padding:7px 10px;margin:0 0 11px;line-height:1.55}
  .glosa b{color:var(--itx)}
  .ok{color:var(--iA)}
  .eti{display:inline-block;width:17px;height:17px;line-height:17px;text-align:center;
    border-radius:50%;color:#fff;font-weight:700;font-size:8.5pt}
  .eti.A{background:var(--iA)} .eti.B{background:var(--iB)} .eti.C{background:var(--iC)}
  .eti.D{background:var(--iD)} .eti.E{background:var(--iE)} .eti.F{background:var(--iF)}
  /* Las dos alternativas de la clase B llevan el mismo verde y naranja que en el
     sistema, y además el número escrito: nunca se distinguen sólo por el color. */
  .eti.alt1{background:var(--iA)} .eti.alt2{background:var(--iC)}
  .kpifila{display:flex;gap:7px;margin:12px 0 14px}
  .kpifila .kpi{flex:1;border:1px solid var(--ilin);border-top:3px solid var(--ia);
    border-radius:5px;padding:9px 8px;text-align:center}
  .kpifila .kpi.A{border-top-color:var(--iA)} .kpifila .kpi.B{border-top-color:var(--iB)}
  .kpifila .kpi.C{border-top-color:var(--iC)} .kpifila .kpi.D{border-top-color:var(--iD)}
  .kpifila .kpi.E{border-top-color:var(--iE)} .kpifila .kpi.F{border-top-color:var(--iF)}
  .kpifila .n{font-size:19pt;font-weight:700;line-height:1.1}
  .kpifila .t{font-size:8.4pt;font-weight:600;margin-top:2px}
  .kpifila .d{font-size:7.4pt;color:var(--itx3);margin-top:1px}
  .portada{display:flex;flex-direction:column;justify-content:center}
  .portada .pcont{padding:0 4mm}
  .pmarca{font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--ia);
    font-weight:700;margin-bottom:8px}
  .portada h1{font-size:30pt;margin:0 0 10px;color:var(--itx);letter-spacing:-.02em;line-height:1.1}
  .plead{font-size:12pt;color:var(--itx2);margin-bottom:26px !important;max-width:150mm}
  .pdatos{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;
    border-top:2px solid var(--ia);padding-top:16px}
  .pd .k{font-size:8pt;color:var(--itx3);text-transform:uppercase;letter-spacing:.05em}
  .pd .v{font-size:12pt;font-weight:600}
  .pnota{margin-top:28px !important;font-size:9.5pt;color:var(--itx2);
    border-left:3px solid var(--iC);padding-left:11px;text-align:left !important}
  .indice{margin-top:10px}
  .indice>div{display:flex;justify-content:space-between;gap:9px;padding:5px 0;
    border-bottom:1px dotted var(--ilin)}
  .indice .i0{font-weight:700;color:var(--ia);margin-top:11px;border-bottom:1px solid var(--ia)}
  .indice .i1{padding-left:13px}
  .indice .pp{color:var(--itx3);font-variant-numeric:tabular-nums}
  @media print{
    @page{size:A4;margin:0}
    body{background:#fff !important}
    body>*{display:none !important}
    /* El relleno inferior de main empuja una página en blanco al final. */
    body>main{display:block !important;padding:0 !important;margin:0 !important;
      max-width:none !important}
    main>section{display:none !important}
    main>section#v-informe{display:block !important}
    .informe{background:#fff;padding:0}
    /* 296 mm y no 297: una hoja de exactamente el alto del papel, con salto
       después, hace que el navegador emita una página en blanco extra y corra
       toda la numeración. El contenido termina muy por encima, así que recortar
       el milímetro sobrante no pierde nada. */
    .hoja{margin:0;box-shadow:none;page-break-after:always;break-after:page;
      height:296mm;min-height:296mm;overflow:hidden}
    .hoja:last-child{page-break-after:auto;break-after:auto}
  }
  </style>`;

  return { html: html, verificar: verificar };
})();
