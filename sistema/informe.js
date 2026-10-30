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

  /* Una tabla larga se registra como bloque y se reparte más tarde midiendo el
     alto real de cada fila: las filas no miden todas lo mismo (unas llevan una
     segunda línea, otras no), así que un número fijo por página desbordaría. */
  function tablaPaginada(titulo, seccion, intro, cabeceras, filas, clases) {
    paginas.push({ tabla: true, titulo: titulo, seccion: seccion, intro: intro,
                   cabeceras: cabeceras, filas: filas, clases: clases,
                   ancla: anclaPendiente });
    anclaPendiente = null;
  }

  // ---------------------------------------------------------- construcción
  function construir() {
    paginas = []; indice = []; anclaPendiente = null; nAncla = 0;
    var d = D(), k = d.kpis, m = d.meta;
    var t = App.conteos(d.casos);
    var dec = d.casos.filter(function (c) {
      return ef(c).aprobacion !== "Sin decidir";
    }).length;

    // ---- PARTE 1 · explicación del caso
    marcar("Parte 1 · El caso", 0);
    marcar("Objetivo y situación", 1);
    pagina("1 · Objetivo y situación que se busca resolver", `
      <h4>Objetivo</h4>
      <p>Determinar, para cada producto que existe físicamente en los depósitos de Farmacia de
      las tres bases, si está correctamente identificado con un código de SAP, si hace falta
      crear uno nuevo, o si en SAP hay materiales que ya no corresponden. Y, sobre esa base,
      dejar ordenada la gestión de las decisiones.</p>
      <h4>La situación</h4>
      <p>SAP y los sistemas de los depósitos nombran los mismos productos de maneras distintas.
      Un mismo ítem puede llamarse «Abbocath Nº 14» en el depósito y «CATETER INTRAVENOSO 14G
      T/ABBOCATH» en SAP. A la inversa, dos productos que no son el mismo pueden tener nombres
      casi iguales y diferir en la concentración, el volumen o el calibre, que es justamente lo
      que los distingue.</p>
      <p>Mientras esa correspondencia no esté establecida material por material, no se puede
      saber qué stock está bien registrado, qué falta crear ni qué sobra en el sistema. Tampoco
      se puede valorizar nada con precisión.</p>
      <h4>Qué cambió respecto del análisis anterior</h4>
      <p>El trabajo previo partía del stock de SAP y le cruzaba el recuento. Acá se invierte el
      punto de partida: <b>el universo son los inventarios físicos</b>. Lo que existe
      físicamente es lo que hay que identificar; SAP pasa a ser la contraparte contra la cual se
      verifica, y aporta además los materiales con stock que ningún inventario reconoció.</p>
      <p>El segundo cambio es el criterio de coincidencia. Antes alcanzaba un parecido alto de
      nombre. Ahora <b>una coincidencia sólo se acepta si está justificada por las
      características del material</b>.</p>`, "Parte 1");

    marcar("Fuentes de información", 1);
    pagina("2 · Fuentes de información utilizadas", `
      <h4>Inventarios físicos · el universo del análisis</h4>` +
      tabla(["Base", "Sistema", "Informe", "Ítems", "Unidades", "Renglones de lote"],
        m.fuentes.map(function (f) {
          return [esc(f.base), "<b>" + esc(f.sistema) + "</b>", esc(f.informe),
                  num(f.items), num(f.unidades), num(f.renglones_lote)];
        }).concat([["<b>Total</b>", "", "",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.items; }, 0)) + "</b>",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.unidades; }, 0)) + "</b>",
          "<b>" + num(m.fuentes.reduce(function (a, f) { return a + f.renglones_lote; }, 0)) + "</b>"]]),
        ["", "", "", "n", "n", "n"]) + `
      <p class="nota">San Juan y Salta informan desde AVAIN, con el reporte «Stock en Almacén».
      Neuquén informa desde un sistema distinto —el que en la operación se conoce como Sistema
      Nico—, cuyo reporte es el «Inventario completo de Farmacia» de IHSA. Los formatos son
      diferentes y se procesaron por separado, conservando en los tres casos el detalle por
      lote y su vencimiento.</p>
      <h4>Contraparte · SAP</h4>
      <p>Archivo <b>` + esc(m.sap.archivo) + `</b>, con corte al ` + esc(m.sap.corte) + `.
      Contiene ` + num(m.sap.codigos_unicos) + ` códigos de material distintos y
      ` + num(m.sap.pares_material_base) + ` combinaciones de material y base.</p>
      <p class="aviso"><b>Qué es y qué no es esta bajada.</b> Son <b>únicamente los materiales
      que hoy tienen stock</b> en SAP. <b>No es el maestro completo de materiales:</b> un
      material dado de alta con existencia cero no figura en el archivo.</p>
      <p>Esto tiene una consecuencia directa sobre lo que el análisis puede afirmar: que un ítem
      del inventario físico no encuentre correspondencia <b>no prueba que no exista en SAP</b>.
      Puede existir sin stock. Verificarlo contra el maestro completo <b>queda fuera del alcance
      de este trabajo</b> y es el paso previo obligatorio antes de proponer cualquier alta.</p>
      <h4>Integridad de las fuentes</h4>
      <p>Los archivos originales no se modificaron. Cada registro conserva de qué base, de qué
      sistema y de qué informe proviene. El sistema incluye controles que comparan sus propios
      totales contra los de las fuentes; se detallan en la parte 2.</p>`, "Parte 1");

    marcar("Criterio de cruce y metodología", 1);
    pagina("3 · Cómo se valida una correspondencia", `
      <p>La regla de fondo: <b>el parecido del nombre genera el candidato, las características
      deciden</b>. No se asigna un código por similitud textual.</p>
      <h4>Características que se extraen de cada material</h4>` +
      tabla(["Característica", "Qué distingue", "Ejemplo de diferencia que impide la coincidencia"], [
        ["Concentración", "La dosis o proporción del principio activo", "Ibuprofeno 600 mg frente a Ibuprofeno 400 mg"],
        ["Forma farmacéutica", "Comprimido, ampolla, crema, jarabe, gotas, aerosol, sobre…", "Diclofenac ampolla frente a Diclofenac comprimidos"],
        ["Volumen o presentación", "El contenido del envase", "Agua oxigenada 500 ml frente a 100 ml"],
        ["Calibre", "El gauge o número de agujas y catéteres", "Abbocath Nº 14 frente a Nº 22"],
        ["Medidas", "Las dimensiones de gasas, apósitos y similares", "Gasa 10×10 frente a apósito 10×20"],
        ["Talle", "El talle de guantes y descartables", "Guantes talle M frente a talle S"],
        ["Modelo o referencia", "Designadores propios del rubro", "Sonda K-30 frente a sonda K-10"],
        ["Longitud", "Medida simple en cm o mm", "Pinza de 20 cm frente a una de 14 cm"],
        ["Población", "Adulto, pediátrico, neonatal", "Pinza Magill pediátrica frente a la de adulto"],
        ["Cantidad sin unidad", "Números que pueden ser dosis o envase", "«Claritromicina 500» no se puede interpretar sin más datos"],
      ]) + `
      <h4>Las tres reglas de decisión</h4>
      <ol>
        <li><b>Si los dos lados declaran la misma característica con valores distintos, no son el
        mismo material.</b> El candidato se descarta y queda registrado el motivo.</li>
        <li><b>Si una característica se declara de un lado y no del otro, nada quedó verificado</b>
        y el caso va a revisión. Sólo puede identificarse por el nombre un material que no declara
        ninguna característica de ningún lado, como un otoscopio o un glucómetro.</li>
        <li><b>Cuanta más característica queda verificada, menos tiene que cargar el nombre.</b>
        Sin ninguna verificada, la denominación tiene que coincidir casi por completo en los dos
        sentidos.</li>
      </ol>
      <p class="nota">Cada caso guarda qué candidatos se evaluaron, en qué coincidían y en qué se
      contradecían. Esa justificación figura en la ficha del sistema y en el Excel, de modo que
      cualquier identificación puede auditarse sin rehacer el análisis.</p>`, "Parte 1");

    marcar("Clasificación y cursos de acción", 1);
    pagina("4 · Clasificación de los casos y cursos de acción", `
      <p>Cada caso recibe una clasificación, un curso de acción sugerido y un estado de
      revisión.</p>` +
      tabla(["", "Clasificación", "Qué significa", "Curso de acción"], [
        [et("A"), "Identificado en SAP", "Existe físicamente y se encontró un código cuya nomenclatura y presentación se corresponden.", "Mantener la identificación. No se propone alta."],
        [et("B"), "Sin correspondencia con stock", "Existe físicamente y no se encontró correspondencia entre los materiales que HOY tienen stock en SAP.", "Verificar primero en el maestro completo si ya existe sin stock. Recién después, proponer el alta."],
        [et("C"), "Candidato a baja", "Material con stock en SAP que ningún inventario físico identificó en esa base.", "Proponer la baja del stock de esa base."],
        [et("D"), "Requiere revisión", "Coincidencia parcial, diferencia de presentación, varios códigos posibles o nomenclatura insuficiente.", "Revisar y decidir. No se resuelve automáticamente."],
        [et("E"), "Fuera del alcance", "Indumentaria, equipamiento y repuestos.", "No concluir nada."],
      ], ["eti-col"]) + `
      <h4>Por qué existe la clasificación E</h4>
      <p>De los materiales con stock en SAP, una parte no son medicamentos ni descartables: son
      indumentaria, equipamiento y repuestos. El inventario relevado es <b>de Farmacia</b>, así
      que esos materiales nunca iban a figurar en él. Tratar su ausencia como motivo de baja
      sería una conclusión falsa, y por eso se apartan en una clase propia con la acción
      explícita de no concluir nada.</p>
      <h4>Las propuestas no son acciones ejecutadas</h4>
      <p>La propuesta de trabajo conversada —crear lo no encontrado y dar de baja lo restante—
      se interpreta aquí como <b>criterio de clasificación, no como autorización</b>. Nada de
      este trabajo modifica SAP. Las altas y las bajas figuran como propuestas sujetas a
      revisión y aprobación, y el sistema registra quién aprueba o rechaza cada una.</p>
      <p class="aviso"><b>Dependencia a tener presente.</b> La lista de candidatos a baja es
      provisional mientras queden casos en revisión: si un caso se resuelve identificando un
      material, ese material deja de ser candidato a baja. Hoy hay
      <b>` + num(k.bajas_bloqueadas) + ` candidatos a baja</b> que figuran como posible
      equivalencia de un ítem todavía sin resolver.</p>`, "Parte 1");

    marcar("Criterio de valorización", 1);
    pagina("5 · Criterio de valorización y alcance del análisis", `
      <h4>Criterio pedido: precio de última compra</h4>
      <p class="aviso"><b>Ese dato no está disponible en ninguno de los archivos recibidos.</b>
      Se revisaron campo por campo:</p>
      <ul>
        <li>La bajada de stock de SAP tiene «Valor libre util.» (la valorización contable del
        stock) y un valor unitario que resulta de dividirla por las unidades. <b>No tiene precio
        de compra, ni fecha, ni proveedor, ni documento.</b></li>
        <li>El archivo de homologación declara explícitamente que los campos de costo quedan
        fuera de ese trabajo.</li>
        <li>Los tres PDF de inventario físico no contienen ninguna mención de precio ni de
        compra.</li>
      </ul>
      <p>En consecuencia, <b>los ` + num(k.pendientes_valorizacion) + ` casos figuran como
      pendientes de valorización</b> y no se informa ningún total por última compra. No se
      estimó ningún precio.</p>
      <h4>Lo que sí se informa, y cómo</h4>
      <p>Para no perder la información económica que existe, se expone en paralelo la
      valorización de stock de SAP, <b>siempre rotulada como lo que es</b> y nunca sumada ni
      presentada como precio de compra. Es el valor contable dividido por las unidades: un
      promedio ponderado de lo que está valorizado, no lo que costó la última reposición.</p>
      <h4>Cómo se completa cuando el dato esté</h4>
      <p>El sistema admite cargar el precio de última compra por material y recalcula solo. El
      archivo tiene que traer:</p>` +
      tabla(["Campo", "Contenido"], m.valorizacion.layout_esperado.map(function (x) {
        return ["<b>" + esc(x.campo) + "</b>", esc(x.descripcion)];
      })) + `
      `, "Parte 1");

    marcar("Alcance y limitaciones", 1);
    pagina("6 · Alcance y limitaciones del análisis", `
      <p>Lo que este trabajo puede afirmar, y lo que no.</p>
      <ul>
        <li>El análisis cubre los tres inventarios físicos recibidos y el stock de SAP de las
        tres bases al ` + esc(m.sap.corte) + `. No cubre movimientos posteriores.</li>
        <li><b>La contraparte de SAP son los materiales con stock, no el maestro completo.</b>
        Por eso la clasificación B no afirma que el material no exista en SAP, sino que no está
        entre los que hoy tienen existencia. Confirmarlo contra el maestro —y, si ya existe sin
        stock, decidir si se reutiliza el código o se da de baja y se crea de nuevo— está fuera
        del alcance de este trabajo.</li>
        <li>La identificación se valida sobre la <b>denominación y la presentación declaradas en
        los textos</b>. Si un texto de SAP no declara la presentación, el caso va a revisión en
        lugar de resolverse por aproximación.</li>
        <li>Las cantidades físicas son las informadas en cada reporte. El informe de Neuquén
        declara él mismo una diferencia entre el stock actual y el saldo de movimientos en dos
        medicamentos; se conservó el stock actual, que es el total declarado.</li>
        <li>No se valorizó nada por falta del dato de compra.</li>
      </ul>`, "Parte 1");

    // ---- PARTE 2 · resultados
    marcar("Parte 2 · Resultados", 0);
    marcar("Resumen ejecutivo", 1);
    var pctId = t.A / k.items_fisicos * 100;
    pagina("7 · Resumen ejecutivo", `
      <p>Se analizaron <b>` + num(k.items_fisicos) + ` ítems</b> relevados en los inventarios
      físicos de las tres bases, que suman <b>` + num(k.unidades_fisicas) + ` unidades</b>
      contadas. Cruzados contra SAP, y sumando los materiales de SAP que ningún inventario
      identificó, el universo de gestión es de <b>` + num(k.total_casos) + ` casos</b>.</p>` +
      '<div class="kpifila">' +
      [["A", t.A, "Identificados en SAP", "de " + num(k.items_fisicos) + " ítems físicos"],
       ["B", t.B, "Pendientes de alta", "físicos sin correspondencia"],
       ["C", t.C, "Candidatos a baja", "material SAP sin identificar"],
       ["D", t.D, "En revisión", "no se resuelven solos"],
       ["E", t.E, "Fuera del alcance", "no son de Farmacia"]]
      .map(function (x) {
        return '<div class="kpi ' + x[0] + '"><div class="n">' + num(x[1]) +
          '</div><div class="t">' + x[2] + '</div><div class="d">' + x[3] + "</div></div>";
      }).join("") + "</div>" + `
      <h4>Lectura</h4>
      <ul>
        <li>De los ` + num(k.items_fisicos) + ` ítems contados, <b>` + num(t.A) + ` quedaron
        identificados</b> con un código verificado por presentación (` + pctId.toFixed(0) + `%),
        <b>` + num(t.B) + ` no encontraron correspondencia</b> entre los materiales con stock en
        SAP y <b>` + num(t.D) + ` requieren una decisión humana</b>.</li>
        <li><b>Los ` + num(t.B) + ` no son altas confirmadas.</b> La bajada de SAP trae sólo los
        materiales con existencia, así que esos ítems podrían estar ya dados de alta con stock
        cero. Verificarlo contra el maestro completo está fuera del alcance de este trabajo.</li>
        <li>La proporción en revisión es alta a propósito: el criterio no admite resolver por
        parecido de nombre. Cada uno de esos casos trae el candidato más probable y el motivo
        exacto por el que no se dio por confirmado, así que la revisión es rápida.</li>
        <li><b>` + num(t.C) + ` materiales con stock en SAP</b> no fueron identificados por
        ningún inventario en su base y quedan como candidatos a baja, de los cuales
        <b>` + num(k.bajas_bloqueadas) + ` dependen</b> de que se resuelva antes un caso en
        revisión.</li>
        <li><b>` + num(k.sin_stock_en_base) + ` ítems están identificados pero SAP no registra
        stock de ese material en su base.</b> Hay existencia física y el código existe: no son
        altas, hay que registrar la existencia o revisar en qué centro está cargada.</li>
        <li><b>No hay valorización</b>: el precio de última compra no está en los archivos
        recibidos. Los ` + num(k.pendientes_valorizacion) + ` casos están pendientes.</li>
      </ul>
      <p class="aviso">Nada de lo informado modifica SAP. Las altas y bajas son propuestas
      sujetas a revisión y aprobación.</p>`, "Parte 2");

    marcar("Resultados por base y por tipo", 1);
    pagina("8 · Resultados por base y por tipo de material", `
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
      <h4>Por tipo de material</h4>` +
      tabla(["Tipo", "Casos", "A", "B", "C", "D", "E"],
        Object.keys(k.por_tipo).map(function (tp) {
          var g = k.por_tipo[tp];
          return [esc(tp), num(g.casos), num(g[m.clases[0]]), num(g[m.clases[1]]),
                  num(g[m.clases[2]]), num(g[m.clases[3]]), num(g[m.clases[4]])];
        }), ["", "n", "n", "n", "n", "n", "n"]) + `
      <h4>Motivos de los casos en revisión</h4>` +
      tabla(["Motivo", "Casos", "Qué hay que hacer"],
        Object.keys(k.motivos).sort(function (a, b) { return k.motivos[b] - k.motivos[a]; })
        .map(function (mo) {
          var q = {
            "Coincidencia parcial de denominación": "Confirmar si el candidato es el material o no lo es.",
            "Falta un atributo para confirmar la presentación": "Completar la presentación en el texto de SAP o en el inventario.",
            "Varios códigos SAP posibles": "Elegir cuál de los candidatos corresponde.",
            "Conflicto de presentación": "Verificar si existe en SAP el material con la presentación correcta.",
            "Nomenclatura insuficiente para decidir": "Precisar la nomenclatura antes de decidir.",
          }[mo] || "Revisar el caso.";
          return [esc(mo), num(k.motivos[mo]), esc(q)];
        }), ["", "n", ""]) + `
      <h4>Confianza de las identificaciones</h4>
      <p>De las ` + num(t.A) + ` identificaciones, <b>` + num(k.confianza.Alta || 0) + ` son de
      confianza alta</b> (varias características verificadas y denominación muy coincidente) y
      <b>` + num(k.confianza.Media || 0) + ` de confianza media</b>, que conviene repasar
      primero. El sistema permite filtrarlas.</p>`, "Parte 2");

    marcar("Valorización y controles", 1);
    pagina("9 · Resultados de la valorización y controles de integridad", `
      <h4>Valorización por precio de última compra</h4>` +
      tabla(["Concepto", "Resultado"], [
        ["Criterio aplicado", "<b>Precio de última compra</b>"],
        ["Materiales valorizados", "<b>0</b>"],
        ["Pendientes de valorización", "<b>" + num(k.pendientes_valorizacion) + "</b>"],
        ["Valorización total", "<b>No se puede calcular</b>"],
        ["Motivo", "El dato no está en ninguno de los archivos recibidos"],
      ]) + `
      <h4>Referencia de SAP · no es precio de última compra</h4>
      <p>A título informativo, el valor contable del stock de SAP asociado a cada grupo. Es el
      valor de stock dividido por las unidades, <b>no lo que costó la última compra</b>. No debe
      informarse como valorización ni sumarse a ella.</p>` +
      tabla(["Clasificación", "Valor de stock de SAP"],
        m.clases.map(function (cl) {
          return [esc(cl), pesos(k.referencia_sap[cl])];
        }), ["", "n"]) + `
      <p class="nota">La clasificación B no tiene referencia porque esos ítems no tienen código
      de SAP, y la D tampoco porque su material todavía no está confirmado.</p>
      <h4>Controles de integridad contra las fuentes</h4>` +
      tabla(["Control", "En la fuente", "En el sistema", "Estado"],
        d.control.map(function (c) {
          return [esc(c.control), num(c.fuente), num(c.sistema),
                  '<b class="' + (c.estado === "Coincide" ? "ok" : "") + '">' + esc(c.estado) + "</b>"];
        }), ["", "n", "n", ""]) + `
      <p class="nota">Los controles comparan lo que informa el sistema contra los totales de los
      archivos originales. En el Excel exportado son fórmulas vivas: si alguien corrige un dato
      y deja de cerrar, el estado cambia solo.</p>`, "Parte 2");

    marcar("Estado de la gestión", 1);
    pagina("10 · Estado de la gestión de decisiones", `
      <p>El sistema registra qué se decidió, quién lo decidió y cuándo. Este informe refleja el
      estado al momento de generarlo.</p>` +
      tabla(["Estado", "Casos"], [
        ["Decisiones registradas", "<b>" + num(dec) + "</b>"],
        ["Pendientes de decidir", "<b>" + num(d.casos.length - dec) + "</b>"],
        ["Correspondencias confirmadas", num(d.casos.filter(function (c) {
          return ef(c).aprobacion === "Correspondencia confirmada"; }).length)],
        ["Propuestas aprobadas", num(d.casos.filter(function (c) {
          return ef(c).aprobacion === "Aprobado"; }).length)],
        ["Propuestas rechazadas", num(d.casos.filter(function (c) {
          return ef(c).aprobacion === "Rechazado"; }).length)],
        ["Marcados como pendientes de validación", num(d.casos.filter(function (c) {
          return ef(c).estado_revision === "Pendiente de validación"; }).length)],
        ["Casos con observación registrada", num(d.casos.filter(function (c) {
          return !!ef(c).observaciones; }).length)],
        ["Códigos SAP corregidos a mano", num(d.casos.filter(function (c) {
          return ef(c).corregido; }).length)],
      ], ["", "n"]) +
      (dec === 0 ? '<p class="nota">Todavía no se registró ninguna decisión: lo que figura en el ' +
        'detalle es el resultado del análisis automático, pendiente de revisión humana.</p>' : "") + `
      <h4>Nomenclaturas unificadas</h4>
      <p>Cuando un mismo producto del inventario físico corresponde a varios códigos de SAP
      —porque el depósito usa una nomenclatura unificada y SAP lo tiene abierto en más de un
      código— se agrupan bajo el nombre del depósito. Los códigos agrupados dejan de ser
      candidatos a baja en esa base.</p>` +
      (function () {
        var gs = d.casos.filter(function (c) { return ef(c).materiales.length > 1; });
        if (!gs.length) return '<p class="nota">Todavía no se agrupó ningún caso.</p>';
        return tabla(["Nomenclatura unificada", "Base", "Códigos SAP", "Revisor"],
          gs.slice(0, 20).map(function (c) {
            var e = ef(c);
            return [esc(e.unificada || c.nombre_fisico), esc(c.base),
                    esc(e.materiales.join(" · ")), esc(e.revisor)];
          }));
      })() + `
      <h4>Observaciones registradas</h4>` +
      (function () {
        var con = d.casos.filter(function (c) { return !!ef(c).observaciones; });
        if (!con.length) return '<p class="nota">No hay observaciones registradas.</p>';
        return tabla(["Caso", "Base", "Ítem / material", "Observación", "Revisor"],
          con.slice(0, 22).map(function (c) {
            var e = ef(c);
            return [num(c.n), esc(c.base), esc(c.nombre_fisico || c.texto_sap),
                    esc(e.observaciones), esc(e.revisor)];
          }));
      })(), "Parte 2");

    // ---- PARTE 3 · detalle
    marcar("Parte 3 · Detalle y próximos pasos", 0);
    var CAB = ["Nº", "Base", "Código SAP", "Ítem del inventario físico / material SAP",
               "Cant.", "Estado", "Decisión"];
    var CLS = ["n", "", "", "", "n", "", ""];
    function filasDe(pred, mostrarSap) {
      return d.casos.filter(pred).map(function (c) {
        var e = ef(c);
        var nom = esc(c.nombre_fisico || c.texto_sap);
        if (mostrarSap && c.nombre_fisico && c.texto_sap)
          nom += '<div class="sub2">SAP: ' + esc(c.texto_sap) + "</div>";
        if (c.motivo) nom += '<div class="sub2">' + esc(c.motivo) + "</div>";
        return [num(c.n), esc(c.base), esc(e.material || c.material_sugerido || "—"), nom,
                num(c.origen === "Inventario físico" ? c.cantidad_fisica : c.stock_sap),
                esc(e.estado_revision), esc(e.aprobacion)];
      });
    }
    marcar("Detalle · identificados", 1);
    tablaPaginada("11 · Detalle de los materiales identificados en SAP", "Parte 3",
      "Ítems del inventario físico con un código de SAP verificado por nomenclatura y " +
      "presentación. No requieren alta. La justificación completa de cada uno está en el " +
      "sistema y en el Excel.",
      CAB, filasDe(function (c) { return L(c) === "A"; }, true), CLS, 30);

    marcar("Detalle · propuestas de alta", 1);
    tablaPaginada("12 · Detalle de los ítems sin correspondencia con stock", "Parte 3",
      "Ítems que existen físicamente y para los que no se encontró en SAP ningún material " +
      "cuya nomenclatura y presentación se correspondan. Son PROPUESTAS de alta, sujetas a " +
      "revisión y aprobación.",
      CAB, filasDe(function (c) { return L(c) === "B"; }, false), CLS, 30);

    marcar("Detalle · casos a revisar", 1);
    tablaPaginada("13 · Detalle de los casos que requieren revisión", "Parte 3",
      "No se resuelven automáticamente porque el criterio no admite asignar un código sin que " +
      "la correspondencia esté justificada por las características. Cada fila indica el motivo " +
      "y, cuando existe, el código candidato sin confirmar.",
      CAB, filasDe(function (c) { return L(c) === "D"; }, true), CLS, 30);

    marcar("Detalle · propuestas de baja", 1);
    tablaPaginada("14 · Detalle de los materiales propuestos para baja", "Parte 3",
      "Materiales con stock en SAP que ningún inventario físico identificó en esa base. Son " +
      "PROPUESTAS de baja, sujetas a revisión y aprobación, y provisionales mientras queden " +
      "casos en revisión.",
      CAB, filasDe(function (c) { return L(c) === "C"; }, false), CLS, 32);

    marcar("Próximos pasos", 1);
    pagina("15 · Próximos pasos y decisiones que requieren validación", `
      <h4>Próximos pasos recomendados, en orden</h4>
      <ol>
        <li><b>Conseguir el precio de última compra.</b> Es lo único que impide valorizar. Hace
        falta una bajada por material con precio unitario, fecha y documento de respaldo. Con
        eso, el sistema valoriza los ` + num(k.pendientes_valorizacion) + ` casos sin más
        trabajo.</li>
        <li><b>Resolver los ` + num(t.D) + ` casos en revisión.</b> Conviene empezar por los
        ` + num(k.motivos["Varios códigos SAP posibles"] || 0) + ` de «varios códigos posibles»,
        que se deciden eligiendo entre candidatos ya identificados, y seguir por los
        ` + num(k.motivos["Conflicto de presentación"] || 0) + ` de «conflicto de presentación»,
        que suelen revelar que falta el material con la presentación correcta en SAP.</li>
        <li><b>Pedir el maestro completo de materiales de SAP</b> y cruzar contra él los
        ` + num(t.B) + ` ítems sin correspondencia. Es el paso que hoy no se puede dar con los
        archivos disponibles, y sin él no se puede afirmar que haya que crear ningún material.
        Para los que ya existan sin stock habrá que decidir si se reutiliza el código o se da de
        baja y se crea de nuevo.</li>
        <li><b>Revisar las ` + num(k.bajas_bloqueadas) + ` bajas que dependen de un caso en
        revisión</b> antes que el resto, porque pueden dejar de ser bajas.</li>
        <li><b>Resolver los ` + num(k.sin_stock_en_base) + ` ítems con existencia física y sin
        stock en SAP en su base.</b> No son altas: hay que registrar la existencia o ubicar en
        qué centro está cargada.</li>
        <li><b>Repasar las ` + num(k.confianza.Media || 0) + ` identificaciones de confianza
        media</b>, que son las que se apoyan en menos características verificadas.</li>
        <li><b>Recién después, aprobar las ` + num(t.C) + ` bajas restantes</b> y elevar el
        paquete de altas y bajas para su ejecución en SAP.</li>
      </ol>
      <h4>Decisiones que requieren validación antes de avanzar</h4>` +
      tabla(["Decisión", "Por qué requiere validación"], [
        ["Alcance del recuento", "El inventario cubrió Farmacia. Hay que confirmar que los " + num(t.E) + " materiales de indumentaria, equipamiento y repuestos quedan definitivamente fuera y cómo se controlan."],
        ["Criterio de baja", "La propuesta de dar de baja todo lo no identificado afecta a " + num(t.C) + " combinaciones de material y base. Conviene validar que la ausencia en el recuento es motivo suficiente, o si se exige una verificación previa en depósito."],
        ["Reutilizar o recrear un código", "Para los ítems que resulten existir en el maestro de SAP sin stock, hay que definir el criterio: se reutiliza el código existente, o se da de baja y se crea uno nuevo. La decisión afecta la trazabilidad histórica del material."],
        ["Unidad de la baja", "Un material identificado en una base y no en otra: se da de baja sólo el stock de la base, no el material. Hay que confirmar que ese es el criterio."],
        ["Fuente del precio", "Definir de qué reporte sale el precio de última compra y con qué corte, para que la valorización sea reproducible."],
        ["Responsable de la validación por base", "Las decisiones quedan registradas con nombre. Hay que definir quién valida cada base y quién cierra con Farmacia."],
      ]) + `
      <p class="aviso"><b>Recordatorio.</b> Ninguna de las propuestas de este informe modifica
      SAP. La ejecución es un paso posterior, externo a esta herramienta, y requiere la
      aprobación registrada de cada caso.</p>`, "Parte 3");

    return { paginas: paginas, indice: indice };
  }

  // ---------------------------------------------------------- render
  var A4 = 297 * 96 / 25.4;        // alto de una A4 en px CSS
  var RESERVA = 104;               // pie + relleno inferior + margen de la tabla, con holgura

  /* Reparte las filas de un bloque de tabla en hojas, agregándolas de a una y
     midiendo: cuando la última no entra, se saca y empieza una hoja nueva. */
  function repartirTabla(bloque, destino, crearHoja) {
    var filas = bloque.filas;
    if (!filas.length) {
      var h0 = crearHoja(bloque.titulo, bloque.seccion);
      h0.cuerpo.innerHTML = (bloque.intro ? "<p>" + bloque.intro + "</p>" : "") +
        '<p class="vacio">No hay casos en este grupo.</p>';
      destino.push(h0);
      return;
    }
    var i = 0, parte = 0, hojas = [];
    while (i < filas.length) {
      parte++;
      var h = crearHoja(parte === 1 ? bloque.titulo : bloque.titulo + " (cont.)", bloque.seccion);
      var marcaIni = i;
      h.cuerpo.innerHTML =
        (parte === 1 && bloque.intro ? "<p>" + bloque.intro + "</p>" : "") +
        '<p class="cont" data-cont></p>' +
        '<table class="t"><thead><tr>' + bloque.cabeceras.map(function (c, j) {
          return "<th" + (bloque.clases && bloque.clases[j] ? ' class="' + bloque.clases[j] + '"' : "") +
                 ">" + esc(c) + "</th>";
        }).join("") + "</tr></thead><tbody></tbody></table>";
      destino.push(h);
      hojas.push({ h: h, desde: i });
      var tb = h.cuerpo.querySelector("tbody");
      var tope = h.el.getBoundingClientRect().top;
      while (i < filas.length) {
        var tr = document.createElement("tr");
        tr.innerHTML = filas[i].map(function (c, j) {
          return "<td" + (bloque.clases && bloque.clases[j] ? ' class="' + bloque.clases[j] + '"' : "") +
                 ">" + (c === null || c === undefined ? "" : c) + "</td>";
        }).join("");
        tb.appendChild(tr);
        var alto = tr.getBoundingClientRect().bottom - tope;
        if (alto > A4 - RESERVA && tb.children.length > 1) { tb.removeChild(tr); break; }
        i++;
      }
      hojas[hojas.length - 1].hasta = i;
      if (i === marcaIni) { i++; }      // salvaguarda: nunca quedarse en el lugar
    }
    hojas.forEach(function (x, j) {
      var c = x.h.cuerpo.querySelector("[data-cont]");
      if (!c) return;
      if (hojas.length === 1) { c.remove(); return; }
      c.textContent = bloque.titulo + " · parte " + (j + 1) + " de " + hojas.length +
        " · casos " + (x.desde + 1) + " a " + x.hasta + " de " + filas.length;
    });
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
      if (p.tabla) { repartirTabla(p, hojas, crearHoja); }
      else {
        var h = crearHoja(p.titulo, p.seccion);
        h.cuerpo.innerHTML = p.cuerpo;
        hojas.push(h);
      }
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
  .informe{--ia:#1F4E78;--itx:#111;--itx2:#444;--itx3:#777;--ilin:#d8d7d2;
    --iA:#0f7f58;--iB:#1d5fae;--iC:#b8431f;--iD:#4a3bb5;--iE:#777;
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
  .sub2{font-size:7.6pt;color:var(--itx3)}
  .ok{color:var(--iA)}
  .eti{display:inline-block;width:17px;height:17px;line-height:17px;text-align:center;
    border-radius:50%;color:#fff;font-weight:700;font-size:8.5pt}
  .eti.A{background:var(--iA)} .eti.B{background:var(--iB)} .eti.C{background:var(--iC)}
  .eti.D{background:var(--iD)} .eti.E{background:var(--iE)}
  .kpifila{display:flex;gap:7px;margin:12px 0 14px}
  .kpifila .kpi{flex:1;border:1px solid var(--ilin);border-top:3px solid var(--ia);
    border-radius:5px;padding:9px 8px;text-align:center}
  .kpifila .kpi.A{border-top-color:var(--iA)} .kpifila .kpi.B{border-top-color:var(--iB)}
  .kpifila .kpi.C{border-top-color:var(--iC)} .kpifila .kpi.D{border-top-color:var(--iD)}
  .kpifila .kpi.E{border-top-color:var(--iE)}
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

  return { html: html };
})();
