/* Exportación a Excel y a PDF.
   Las dos salen del mismo estado del sistema (análisis + decisiones), que es lo
   que garantiza que las cifras coincidan entre las tres piezas. */
var Exportar = (function () {
  "use strict";
  var E = XLSXMin.EST, col = XLSXMin.col;

  function D() { return App.datos(); }
  function ef(c) { return App.efectivo(c); }
  function L(c) { return App.LETRA[c.clasificacion]; }

  function num(n) { return App.num(n); }
  /* La base, con su color: el mismo de la pantalla. Una columna de bases en
     blanco y negro obliga a leer palabra por palabra para encontrar la que se
     busca. El nombre va escrito igual, el color no reemplaza nada. */
  function celdaBase(b) {
    var i = D().meta.bases.indexOf(b);
    return i >= 0 ? { v: b, s: E.BASE[i % E.BASE.length] } : { v: b || "" };
  }
  function hoy() { return new Date().toISOString().slice(0, 10); }
  function fechaCorta(iso) { return iso ? new Date(iso).toLocaleDateString("es-AR") : ""; }

  // =============================================================== EXCEL
  var COLS = [
    ["Nº", 6], ["ID del caso", 15], ["Origen del registro", 18], ["Clasificación", 23],
    ["Curso de acción sugerido", 30], ["Motivo de revisión", 32], ["Base", 11],
    ["Centro", 8], ["Sistema de origen", 15], ["Informe de origen", 34], ["Tipo", 14],
    ["Código en inventario físico", 16], ["Nomenclatura del inventario físico", 42],
    ["Presentación detectada", 34], ["Unidades CONTADAS en el depósito", 15],
    ["Unidades de STOCK EN SAP en esa base", 16], ["Unidades a valorizar", 14],
    ["Nº de lotes", 9], ["Código SAP · análisis", 13], ["Códigos SAP asignados", 22],
    ["¿Asignado o corregido a mano?", 12], ["Descripción en SAP", 42],
    ["Atributos verificados", 30], ["Confianza del cruce", 11],
    ["Justificación de la correspondencia", 70],
    ["Estado de valorización", 20], ["Precio de última compra · $", 14],
    ["Fecha de la última compra", 13], ["Fuente del precio", 32],
    ["Valorización · $", 15], ["VU de referencia SAP · $", 14],
    ["Valor de referencia SAP · $", 16], ["Estado de revisión", 16],
    ["Decisión registrada", 20], ["Revisor", 16], ["Fecha de la decisión", 13],
    ["Observaciones", 48],
    ["Nomenclatura unificada", 44], ["¿Agrupa varios códigos SAP?", 13],
    // Ubicación (AN–AS). El centro, col. H, es la base; el almacén es el depósito
    // dentro de ella: son dos campos distintos y se informan por separado.
    ["Almacén donde figura el stock", 18], ["Cantidad por almacén", 30],
    ["Almacén esperado · PROPUESTA a validar", 18], ["Estado de la ubicación", 28],
    ["Decisión sobre la ubicación", 40], ["Almacén propuesto por la decisión", 16],
    // Clase B · las dos alternativas de trabajo (AT–AX)
    ["Alternativa elegida (clase B)", 26],
    ["Resultado de la verificación en el maestro", 44],
    ["Código encontrado en el maestro", 16], ["Riesgo de código duplicado", 22],
    ["Ligado a la depuración del maestro", 24],
  ];

  function filaCaso(c, r) {
    var e = ef(c), d = (App.decisiones()[c.id] || {});
    return [
      { v: c.n }, { v: c.id }, { v: c.origen }, { v: c.clasificacion },
      { v: c.accion, s: E.TEXTO }, { v: c.motivo || "" }, celdaBase(c.base), { v: c.centro },
      { v: c.sistema_origen }, { v: c.informe_origen, s: E.TEXTO }, { v: c.tipo },
      { v: c.codigo_fisico || "" }, { v: c.nombre_fisico || "", s: E.TEXTO },
      { v: c.presentacion || "", s: E.TEXTO },
      { v: c.cantidad_fisica || 0, s: E.ENTERO },
      { v: (c.stock_sap !== undefined && c.stock_sap !== null) ? c.stock_sap
           : (c.stock_sap_en_base || 0), s: E.ENTERO },
      // fórmula real: la cantidad que se valoriza depende del origen del registro
      { f: 'IF(C' + r + '="Inventario físico",O' + r + ",P" + r + ")", s: E.ENTERO },
      { v: c.n_lotes || 0, s: E.ENTERO },
      { v: c.material_sap || "" }, { v: e.materiales.join(" · ") },
      { v: e.corregido ? "Sí" : "No" },
      { v: c.texto_sap || "", s: E.TEXTO },
      { v: (c.atributos_verificados || []).join(", "), s: E.TEXTO },
      { v: c.confianza || "" },
      { v: c.justificacion || "", s: E.TEXTO },
      { v: c.estado_valorizacion },
      { v: c.precio_ultima_compra === null || c.precio_ultima_compra === undefined
           ? "" : c.precio_ultima_compra, s: E.IMPORTE },
      { v: c.fecha_ultima_compra || "" },
      { v: c.fuente_precio || "", s: E.TEXTO },
      // la valorización es una fórmula: en cuanto se cargue el precio, se calcula sola
      { f: 'IF(AA' + r + '="","Pendiente",AA' + r + "*Q" + r + ")", s: E.IMPORTE },
      { v: c.vu_sap_referencia === null || c.vu_sap_referencia === undefined
           ? "" : c.vu_sap_referencia, s: E.IMPORTE },
      { f: 'IF(AE' + r + '="","",AE' + r + "*Q" + r + ")", s: E.IMPORTE },
      { v: e.estado_revision }, { v: e.aprobacion },
      { v: e.revisor || "" }, { v: fechaCorta(d.actualizado) },
      { v: e.observaciones || "", s: E.TEXTO },
      { v: e.unificada || "", s: E.TEXTO }, { v: e.agrupado ? "Sí" : "No" },
      { v: (c.almacenes || []).map(function (x) { return x.almacen; }).join(" · ") },
      { v: (c.almacenes || []).map(function (x) {
              return x.almacen + ": " + x.stock; }).join(" · "), s: E.TEXTO },
      { v: c.almacen_esperado || "" }, { v: c.almacen_estado || "" },
      { v: e.almacen_decidido || "", s: E.TEXTO }, { v: e.almacen_propuesto || "" },
      { v: e.ruta_b || "" }, { v: e.verificacion || "", s: E.TEXTO },
      { v: e.codigo_maestro || "" }, { v: e.riesgo_duplicado || "" },
      { v: e.depuracion || "" },
    ];
  }

  function hojaCasos() {
    var filas = [
      [{ v: "Conciliación de inventarios físicos contra SAP · detalle completo", s: E.TITULO }],
      [{ v: "Una fila por caso. Los ítems de los inventarios físicos más los materiales de SAP " +
            "que ningún inventario identificó. Las columnas Q, AD y AF son fórmulas. " +
            "Las columnas AN a AS son la ubicación del stock; las AT a AX, la clase B. " +
            "Exportado el " + new Date().toLocaleString("es-AR") +
            (App.revisor() ? " por " + App.revisor() : "") + ".", s: E.TENUE }],
      [],
      COLS.map(function (c) { return { v: c[0], s: E.CAB }; }),
    ];
    D().casos.forEach(function (c, i) { filas.push(filaCaso(c, i + 5)); });
    var ult = filas.length;
    var tot = new Array(COLS.length).fill(null);
    tot[0] = { v: "TOTAL", s: E.SUBTITULO };
    tot[14] = { f: "SUBTOTAL(109,O5:O" + ult + ")", s: E.ENTERO };
    tot[15] = { f: "SUBTOTAL(109,P5:P" + ult + ")", s: E.ENTERO };
    tot[16] = { f: "SUBTOTAL(109,Q5:Q" + ult + ")", s: E.ENTERO };
    tot[31] = { f: "SUBTOTAL(109,AF5:AF" + ult + ")", s: E.IMPORTE };
    filas.push(tot);
    return { nombre: "Casos", filas: filas,
             altos: { 1: 22, 2: 15, 4: 34 }, anchos: COLS.map(function (c) { return c[1]; }),
             congelar: "E5", autofiltro: "A4:" + col(COLS.length) + ult };
  }

  var COLS_OP = [["Nº", 6], ["Base", 11], ["Tipo", 14], ["Código SAP", 13],
    ["Descripción en SAP", 44], ["Código inventario físico", 15],
    ["Nomenclatura del inventario físico", 42], ["Presentación", 30],
    ["Unidades CONTADAS en el depósito", 15], ["Unidades de STOCK EN SAP", 15],
    ["Atributos verificados", 26], ["Confianza", 10], ["Justificación", 64],
    ["Nomenclatura unificada", 40],
    ["Estado de valorización", 19], ["VU de referencia SAP · $", 14],
    ["Valor de referencia SAP · $", 16], ["Estado de revisión", 16],
    ["Decisión registrada", 20], ["Revisor", 15], ["Observaciones", 44],
    ["Almacén donde figura el stock", 18], ["Almacén esperado · PROPUESTA", 18],
    ["Estado de la ubicación", 28], ["Decisión sobre la ubicación", 38],
    ["Alternativa elegida (clase B)", 26], ["Verificación en el maestro", 42],
    ["Código del maestro", 16], ["Riesgo de duplicado", 22],
    ["Ligado a la depuración", 24]];

  function hojaOperativa(nombre, titulo, nota, pred) {
    var casos = D().casos.filter(pred);
    var filas = [[{ v: titulo, s: E.TITULO }], [{ v: nota, s: E.TENUE }], [],
                 COLS_OP.map(function (c) { return { v: c[0], s: E.CAB }; })];
    casos.forEach(function (c, i) {
      var r = i + 5, e = ef(c);
      filas.push([
        { v: c.n }, { v: c.base }, { v: c.tipo }, { v: e.materiales.join(" · ") },
        { v: c.texto_sap || "", s: E.TEXTO }, { v: c.codigo_fisico || "" },
        { v: c.nombre_fisico || "", s: E.TEXTO }, { v: c.presentacion || "", s: E.TEXTO },
        { v: c.cantidad_fisica || 0, s: E.ENTERO },
        { v: (c.stock_sap !== undefined && c.stock_sap !== null) ? c.stock_sap
             : (c.stock_sap_en_base || 0), s: E.ENTERO },
        { v: (c.atributos_verificados || []).join(", "), s: E.TEXTO },
        { v: c.confianza || "" }, { v: c.justificacion || "", s: E.TEXTO },
        { v: e.unificada || "", s: E.TEXTO },
        { v: c.estado_valorizacion },
        { v: c.vu_sap_referencia === null || c.vu_sap_referencia === undefined
             ? "" : c.vu_sap_referencia, s: E.IMPORTE },
        { f: 'IF(O' + r + '="","",O' + r + "*MAX(I" + r + ",J" + r + "))", s: E.IMPORTE },
        { v: e.estado_revision }, { v: e.aprobacion }, { v: e.revisor || "" },
        { v: e.observaciones || "", s: E.TEXTO },
        { v: (c.almacenes || []).map(function (x) { return x.almacen; }).join(" · ") },
        { v: c.almacen_esperado || "" }, { v: c.almacen_estado || "" },
        { v: e.almacen_decidido || "", s: E.TEXTO },
        { v: e.ruta_b || "" }, { v: e.verificacion || "", s: E.TEXTO },
        { v: e.codigo_maestro || "" }, { v: e.riesgo_duplicado || "" },
        { v: e.depuracion || "" },
      ]);
    });
    var ult = Math.max(filas.length, 5);
    var tot = new Array(COLS_OP.length).fill(null);
    tot[0] = { v: "TOTAL", s: E.SUBTITULO };
    tot[8] = { f: "SUBTOTAL(109,I5:I" + ult + ")", s: E.ENTERO };
    tot[9] = { f: "SUBTOTAL(109,J5:J" + ult + ")", s: E.ENTERO };
    tot[15] = { f: "SUBTOTAL(109,P5:P" + ult + ")", s: E.IMPORTE };
    filas.push(tot);
    return { nombre: nombre, filas: filas,
             anchos: COLS_OP.map(function (c) { return c[1]; }),
             altos: { 1: 22, 2: 15, 4: 32 },
             congelar: "E5", autofiltro: "A4:" + col(COLS_OP.length) + ult };
  }

  /* ---- Qué hacer con cada ítem en SAP ------------------------------------
     Es la hoja que faltaba. El Excel decía en qué clase cayó cada caso y qué
     se había decidido, pero no la frase que alguien tiene que ejecutar: «crear
     el material 2000103 en el centro 1120, almacén 2021». Esa frase estaba
     repartida entre seis hojas y cuatro columnas, y había que armarla a mano.

     Una fila por caso, una columna que dice la acción y otra que dice si ya
     está decidida o falta decidirla. Ordenada por acción, así cada bloque de
     trabajo queda junto. */

  /* La acción concreta de cada caso la calcula App: es la misma cuenta que usa
     la pantalla «Aplicar en SAP» y la sección del informe. Si el criterio
     cambia, cambia en los tres lados a la vez. */
  function accionSap(c) { return App.accionSap(c); }

  /* En el detalle, lo que falta decidir va primero: es lo que hay que
     trabajar. En el resumen va al revés —primero lo ejecutable—, y ése es el
     orden de los bloques de App.ACCIONES. */
  var ORDEN_BLOQUE = { falta: 0, ejecutar: 1, nada: 2, fuera: 3 };
  function ordenAccion(verbo) {
    var m = App.ACC[verbo];
    if (!m) return 9900;
    return ORDEN_BLOQUE[m.bloque] * 100 + m.i;
  }

  function hojaAccion() {
    var casos = D().casos.map(function (c) { return { c: c, a: accionSap(c) }; });
    casos.sort(function (x, y) {
      var ix = ordenAccion(x.a.verbo), iy = ordenAccion(y.a.verbo);
      return ix - iy || x.c.base.localeCompare(y.c.base) || x.c.n - y.c.n;
    });
    var cuenta = {};
    casos.forEach(function (x) { cuenta[x.a.verbo] = (cuenta[x.a.verbo] || 0) + 1; });

    var cols = [["Qué hacer en SAP", 38], ["¿Falta decidirlo?", 15], ["Base", 11],
      ["Centro", 8], ["Almacén", 10], ["Código SAP", 13], ["Nomenclatura SAP", 42],
      ["Nomenclatura del depósito", 42], ["Unidades CONTADAS", 14],
      ["Unidades en SAP", 14], ["El detalle de la acción", 86],
      ["Importe última compra", 16], ["Impacto · $", 15],
      ["Quién lo decidió", 16], ["Cuándo", 17], ["Nº de caso", 9]];

    var f = [[{ v: "Qué hacer con cada ítem en SAP", s: E.TITULO }],
             [{ v: "El detalle de la hoja anterior: una fila por caso, con la acción " +
                   "concreta. Las que empiezan con PENDIENTE todavía no se decidieron: se " +
                   "deciden en el sistema. Nada de esto modifica SAP: es el pedido de " +
                   "trabajo. El total por acción está en la hoja «Aplicar en SAP».",
                s: E.TENUE }], [],
             cols.map(function (x) { return { v: x[0], s: E.CAB }; })];

    var pre = App.precios ? App.precios() : {};
    casos.forEach(function (x, i) {
      var c = x.c, e = ef(c), r = i + 5;
      var d = (App.decisiones && App.decisiones()[c.id]) || {};
      var mat = e.materiales[0] || c.material_sap || "";
      var p = (typeof pre[mat] === "number" && isFinite(pre[mat])) ? pre[mat] : null;
      var un = c.origen === "Inventario físico" ? (c.cantidad_fisica || 0) : (c.stock_sap || 0);
      f.push([
        { v: x.a.verbo, s: E.TEXTO },
        { v: x.a.pend ? "Sí" : "No" },
        celdaBase(c.base),
        { v: d.centro_alta || c.centro || "" },
        { v: d.almacen_alta || d.almacen_ajuste || d.almacen_propuesto ||
             (c.almacenes || []).map(function (z) { return z.almacen; }).join(" · ") || "" },
        { v: e.materiales.join(" · ") || c.material_sap || "" },
        { v: c.texto_sap || "", s: E.TEXTO },
        { v: c.nombre_fisico || "", s: E.TEXTO },
        { v: c.cantidad_fisica || 0, s: E.ENTERO },
        { v: c.origen === "Inventario físico" ? (c.stock_sap_en_base || 0) : (c.stock_sap || 0),
          s: E.ENTERO },
        { v: x.a.det, s: E.TEXTO },
        p === null ? { v: "" } : { v: p, s: E.IMPORTE },
        p === null ? { v: "" } : { v: un * p, s: E.IMPORTE },
        { v: e.revisor || "" },
        e.actualizado ? { v: new Date(e.actualizado), s: E.FECHA } : { v: "" },
        { v: c.n },
      ]);
    });
    var ult = Math.max(f.length, 5);
    var tot = new Array(cols.length).fill(null);
    tot[0] = { v: "TOTAL", s: E.SUBTITULO };
    tot[8] = { f: "SUBTOTAL(109,I5:I" + ult + ")", s: E.ENTERO };
    tot[9] = { f: "SUBTOTAL(109,J5:J" + ult + ")", s: E.ENTERO };
    tot[12] = { f: "SUBTOTAL(109,M5:M" + ult + ")", s: E.IMPORTE };
    f.push(tot);
    return { nombre: "Qué hacer en SAP", filas: f,
             anchos: cols.map(function (x) { return x[1]; }),
             altos: { 1: 22, 2: 15, 4: 32 },
             congelar: "C5", autofiltro: "A4:" + col(cols.length) + ult,
             cuenta: cuenta };
  }

  /* ---- La primera hoja: qué aplicar en SAP ------------------------------
     Es la hoja que contesta «y entonces qué hago». Una fila por acción, con
     sus cantidades: qué dar de alta, qué dar de baja, qué ajustar, qué mover,
     qué quedó sin decidir y qué está fuera del alcance. El detalle caso por
     caso está en la hoja siguiente. */
  function hojaPlan() {
    var p = App.plan(D().casos);
    var cols = [["Bloque", 30], ["Grupo", 24], ["Qué hacer en SAP", 42],
      ["Casos", 8], ["Unidades CONTADAS", 15], ["Unidades en SAP", 14],
      ["Registros del maestro", 15], ["Importe última compra · $", 18],
      ["Casos sin importe", 12], ["Qué significa exactamente", 92]];

    var f = [
      [{ v: "Qué aplicar en SAP", s: E.TITULO }],
      [{ v: "El resumen de las decisiones tomadas, agrupadas por lo que hay que hacer " +
            "con cada una. Nada de esto modifica SAP: es el pedido de trabajo. El " +
            "detalle caso por caso está en la hoja «Qué hacer en SAP».", s: E.TENUE }],
      [],
      [{ v: "Generado", s: E.SUBTITULO }, { v: new Date().toLocaleString("es-AR") }],
      [{ v: "Revisor", s: E.SUBTITULO }, { v: App.revisor() || "(sin identificar)" }],
      [{ v: "Alcance", s: E.SUBTITULO },
       { v: "Las tres bases · " + D().meta.bases.join(", "), s: E.TEXTO }],
      [{ v: "Avance", s: E.SUBTITULO },
       { v: num(p.decidibles - p.falta) + " de " + num(p.decidibles) +
            " casos decididos (" + p.pct + "%). Los " +
            num(p.casos - p.decidibles) + " restantes están fuera del alcance.",
         s: E.TEXTO }],
      [],
      /* Antes de cualquier número, qué mide cada columna. Las dos magnitudes
         dan cifras muy distintas y sumarlas no significa nada. */
      [{ v: "LAS CANTIDADES NO SE SUMAN ENTRE SÍ", s: E.SUBTITULO }],
      [{ v: "Unidades CONTADAS" }, { v: "Las del recuento en el depósito. Es la " +
        "cantidad de un alta o de un ajuste de existencia.", s: E.TEXTO }],
      [{ v: "Unidades en SAP" }, { v: "Las que SAP registra en esa base. Es la " +
        "cantidad de una baja de stock o de un movimiento de almacén.", s: E.TEXTO }],
      [{ v: "Registros del maestro" }, { v: "Materiales sin existencia: no hay " +
        "unidades, lo que se decide es qué pasa con el registro.", s: E.TEXTO }],
      [],
      cols.map(function (x) { return { v: x[0], s: E.CAB }; }),
    ];

    p.todos.forEach(function (b) {
      /* Un bloque vacío también cierra con su total: un cero escrito dice que
         se miró y no hay nada, y un renglón ausente no dice nada. */
      if (!b.n) {
        f.push([{ v: "", s: E.SUBTITULO }, { v: "" },
                { v: "TOTAL · " + b.titulo, s: E.SUBTITULO },
                { v: 0, s: E.ENTERO }, null, null, null, null, null,
                { v: "Ninguno todavía. " + b.nota, s: E.TEXTO }]);
        f.push([]);
        return;
      }
      var tc = 0, ts = 0, tr = 0, ti = 0, tn = 0, tsi = 0;
      b.fams.forEach(function (fam) {
        fam.acciones.forEach(function (a) {
          tc += a.contadas; ts += a.sap; tr += a.registros;
          ti += a.importe; tn += a.n; tsi += a.sinImporte;
          f.push([
            { v: b.titulo, s: E.TEXTO },
            { v: fam.titulo, s: E.TEXTO },
            { v: a.verbo.replace(/^PENDIENTE · /, ""), s: E.TEXTO },
            { v: a.n, s: E.ENTERO },
            a.contadas ? { v: a.contadas, s: E.ENTERO } : { v: "" },
            a.sap ? { v: a.sap, s: E.ENTERO } : { v: "" },
            a.registros ? { v: a.registros, s: E.ENTERO } : { v: "" },
            a.importe ? { v: a.importe, s: E.IMPORTE } : { v: "" },
            a.sinImporte ? { v: a.sinImporte, s: E.ENTERO_TENUE } : { v: "" },
            { v: App.EXPLICA[a.verbo] || "", s: E.TEXTO },
          ]);
        });
      });
      f.push([{ v: "", s: E.SUBTITULO }, { v: "" },
              { v: "TOTAL · " + b.titulo, s: E.SUBTITULO },
              { v: tn, s: E.ENTERO },
              tc ? { v: tc, s: E.ENTERO } : { v: "" },
              ts ? { v: ts, s: E.ENTERO } : { v: "" },
              tr ? { v: tr, s: E.ENTERO } : { v: "" },
              ti ? { v: ti, s: E.IMPORTE } : { v: "" },
              tsi ? { v: tsi, s: E.ENTERO } : { v: "" },
              { v: b.nota, s: E.TEXTO }]);
      f.push([]);
    });

    /* El que ejecuta en SAP trabaja por centro: necesita saber cuánto le toca
       a cada base. */
    f.push([{ v: "CÓMO SE REPARTE ENTRE LAS BASES", s: E.SUBTITULO }]);
    f.push([{ v: "Base", s: E.CAB }, { v: "Centro", s: E.CAB },
            { v: "Hay que hacerlo en SAP", s: E.CAB },
            { v: "Sin decidir", s: E.CAB }, { v: "Sin acción", s: E.CAB },
            { v: "Fuera del alcance", s: E.CAB }, { v: "Total de casos", s: E.CAB }]);
    var centros = {};
    D().casos.forEach(function (c) { if (c.centro) centros[c.base] = c.centro; });
    D().meta.bases.forEach(function (b) {
      var x = p.porBase[b];
      if (!x) return;
      f.push([celdaBase(b), { v: centros[b] || "" },
              { v: x.ejecutar, s: E.ENTERO }, { v: x.falta, s: E.ENTERO },
              { v: x.nada, s: E.ENTERO }, { v: x.fuera, s: E.ENTERO },
              { v: x.ejecutar + x.falta + x.nada + x.fuera, s: E.ENTERO }]);
    });
    f.push([]);
    f.push([{ v: "DÓNDE SIGUE CADA COSA", s: E.SUBTITULO }]);
    [["El detalle de cada acción, caso por caso",
      "Hoja «Qué hacer en SAP»: una fila por caso, con el código, las dos " +
      "nomenclaturas, el almacén, las cantidades y quién lo decidió. Ordenada por " +
      "acción y con autofiltro en la primera columna."],
     ["Lo que falta decidir",
      "Se decide en el sistema, pantalla «Trabajar». Esta hoja se rearma sola al " +
      "volver a exportar."],
     ["Por qué cada caso quedó donde quedó",
      "Hoja «Casos», columna «Justificación de la correspondencia»."],
     ["El importe que falta",
      "Hoja «Maestro general». Se baja desde Maestro → Maestro general, se completa " +
      "la columna del importe de última compra y se vuelve a subir el mismo archivo."],
     ["Quién decidió qué y cuándo", "Hoja «Decisiones»."]]
      .forEach(function (x) {
        f.push([{ v: x[0], s: E.TEXTO }, { v: "" }, { v: x[1], s: E.TEXTO }]);
      });

    return { nombre: "Aplicar en SAP", filas: f,
             anchos: cols.map(function (x) { return x[1]; }),
             altos: { 1: 22, 2: 15, 14: 32 },
             congelar: "A15" };
  }

  function hojaResumen() {
    var k = D().kpis, m = D().meta;
    var f = [
      [{ v: "Inventario físico vs SAP · tablero", s: E.TITULO }],
      [{ v: "Todos los indicadores son FÓRMULAS sobre la hoja «Casos»: si se corrige " +
            "un dato allí, acá se actualiza solo.", s: E.TENUE }],
      [],
      [{ v: "Generado", s: E.SUBTITULO }, { v: new Date().toLocaleString("es-AR") }],
      [{ v: "Revisor", s: E.SUBTITULO }, { v: App.revisor() || "(sin identificar)" }],
      [],
      /* Tres magnitudes distintas que dan números muy distintos. Va primero,
         antes que cualquier cifra, para que nadie lea un número sin saber de
         qué es. */
      [{ v: "QUÉ SE ESTÁ CONTANDO EN CADA COLUMNA", s: E.SUBTITULO }],
      [{ v: "Ítem" }, { v: "Un producto contado en un inventario físico: una fila del " +
                             "PDF de la base.", s: E.TEXTO }],
      [{ v: "Unidad" }, { v: "Cada unidad de ese producto. Un solo ítem puede ser 500 " +
                             "unidades.", s: E.TEXTO }],
      [{ v: "Caso" }, { v: "Una fila de este trabajo: un ítem del depósito, o un material " +
                           "de SAP con stock que ningún inventario identificó. Es lo que " +
                           "cuenta la columna «Casos».", s: E.TEXTO }],
      [{ v: "Material" }, { v: "Un código de SAP. Un mismo material aparece en varios " +
                                "casos si tiene stock en más de una base.", s: E.TEXTO }],
      [{ v: "ATENCIÓN" }, { v: "Las unidades CONTADAS en el depósito y las unidades de " +
                                "STOCK EN SAP no son la misma magnitud y no se suman. Van " +
                                "siempre en columnas separadas.", s: E.TEXTO }],
      [],
      [{ v: "UNIVERSO ANALIZADO", s: E.SUBTITULO }],
      [{ v: "Casos totales (ítems físicos + materiales de SAP sin identificar)" },
       { f: "COUNTA(Casos!B5:B100000)", s: E.ENTERO }],
      [{ v: "Ítems de los inventarios físicos" },
       { f: 'COUNTIF(Casos!C:C,"Inventario físico")', s: E.ENTERO }],
      [{ v: "Unidades físicas contadas" },
       { f: 'SUMIF(Casos!C:C,"Inventario físico",Casos!O:O)', s: E.ENTERO }],
      [{ v: "Materiales de SAP sin identificar (casos)" },
       { f: 'COUNTIF(Casos!C:C,"Stock SAP")', s: E.ENTERO }],
      [{ v: "Unidades de stock en SAP de esos materiales" },
       { f: 'SUMIF(Casos!C:C,"Stock SAP",Casos!P:P)', s: E.ENTERO }],
      [],
      [{ v: "CLASIFICACIÓN", s: E.SUBTITULO }, { v: "Casos", s: E.SUBTITULO },
       { v: "Unidades contadas", s: E.SUBTITULO },
       { v: "Unidades de stock SAP", s: E.SUBTITULO }],
    ];
    m.clases.forEach(function (cl) {
      f.push([{ v: cl },
        { f: 'COUNTIF(Casos!D:D,"' + cl + '")', s: E.ENTERO },
        { f: 'SUMIF(Casos!D:D,"' + cl + '",Casos!O:O)', s: E.ENTERO },
        { f: 'SUMIF(Casos!D:D,"' + cl + '",Casos!P:P)', s: E.ENTERO }]);
    });
    f.push([]);
    f.push([{ v: "POR BASE · casos por clasificación", s: E.SUBTITULO }].concat(
      m.clases.map(function (cl) { return { v: cl.slice(0, 1) + " (casos)", s: E.SUBTITULO }; }),
      [{ v: "Ítems físicos", s: E.SUBTITULO }, { v: "Unidades contadas", s: E.SUBTITULO }]));
    m.bases.forEach(function (b) {
      f.push([{ v: b }].concat(
        m.clases.map(function (cl) {
          return { f: 'COUNTIFS(Casos!G:G,"' + b + '",Casos!D:D,"' + cl + '")', s: E.ENTERO };
        }),
        [{ f: 'COUNTIFS(Casos!G:G,"' + b + '",Casos!C:C,"Inventario físico")', s: E.ENTERO },
         { f: 'SUMIFS(Casos!O:O,Casos!G:G,"' + b + '",Casos!C:C,"Inventario físico")', s: E.ENTERO }]));
    });
    f.push([]);
    f.push([{ v: "POR TIPO DE MATERIAL · casos por clasificación", s: E.SUBTITULO }].concat(
      m.clases.map(function (cl) { return { v: cl.slice(0, 1) + " (casos)", s: E.SUBTITULO }; })));
    m.tipos.forEach(function (t) {
      f.push([{ v: t }].concat(m.clases.map(function (cl) {
        return { f: 'COUNTIFS(Casos!K:K,"' + t + '",Casos!D:D,"' + cl + '")', s: E.ENTERO };
      })));
    });
    f.push([]);
    f.push([{ v: "ESTADO DE LA GESTIÓN · en casos", s: E.SUBTITULO }]);
    [["Pendientes de decidir", 'COUNTIF(Casos!AH:AH,"Sin decidir")'],
     ["Correspondencias confirmadas", 'COUNTIF(Casos!AH:AH,"Correspondencia confirmada")'],
     ["Propuestas aprobadas", 'COUNTIF(Casos!AH:AH,"Aprobado")'],
     ["Propuestas rechazadas", 'COUNTIF(Casos!AH:AH,"Rechazado")'],
     ["Marcados como revisados", 'COUNTIF(Casos!AG:AG,"Revisado")'],
     ["Pendientes de validación", 'COUNTIF(Casos!AG:AG,"Pendiente de validación")'],
     ["Casos con observación", 'COUNTIF(Casos!AK:AK,"?*")'],
     ["Códigos asignados o corregidos a mano", 'COUNTIF(Casos!U:U,"Sí")'],
     ["Ítems con varios códigos SAP agrupados", 'COUNTIF(Casos!AM:AM,"Sí")']
    ].forEach(function (p) { f.push([{ v: p[0] }, { f: p[1], s: E.ENTERO }]); });
    f.push([]);
    f.push([{ v: "CLASE B · LAS DOS ALTERNATIVAS · en casos", s: E.SUBTITULO }]);
    f.push([{ v: "Un ítem que no aparece entre los materiales con stock no está probado que " +
                 "no exista en SAP. Por eso la clase B se trabaja eligiendo expresamente una " +
                 "de dos alternativas.", s: E.TENUE }]);
    [["Casos de clase B", 'COUNTIF(Casos!D:D,"B · Sin correspondencia con stock")'],
     ["Sin alternativa elegida",
      'COUNTIFS(Casos!D:D,"B · Sin correspondencia con stock",Casos!AT:AT,"")'],
     ["Alternativa 1 · verificar antes de crear",
      'COUNTIF(Casos!AT:AT,"Verificar antes de crear")'],
     ["   de ésas, con la verificación ya cargada", 'COUNTIF(Casos!AU:AU,"?*")'],
     ["Alternativa 2 · crear sin verificar el maestro",
      'COUNTIF(Casos!AT:AT,"Crear sin verificar el maestro")'],
     ["Con riesgo de código duplicado asumido", 'COUNTIF(Casos!AW:AW,"?*")'],
     ["Ligados al plan de depuración del maestro", 'COUNTIF(Casos!AX:AX,"?*")']
    ].forEach(function (p) { f.push([{ v: p[0] }, { f: p[1], s: E.ENTERO }]); });
    f.push([]);
    f.push([{ v: "UBICACIÓN DEL STOCK EN LOS ALMACENES · en casos", s: E.SUBTITULO }]);
    f.push([{ v: "Una cosa es que el material esté bien identificado, otra que tenga stock, " +
                 "y otra que ese stock esté en el almacén que corresponde. El almacén " +
                 "esperado es una PROPUESTA a validar con cada base.", s: E.TENUE }]);
    ["Almacén correcto", "Almacén a cambiar", "Material en múltiples almacenes",
     "Almacén pendiente de validación", "Almacén no identificado"].forEach(function (x) {
      f.push([{ v: x }, { f: 'COUNTIF(Casos!AQ:AQ,"' + x + '")', s: E.ENTERO }]);
    });
    f.push([{ v: "Ubicaciones con una decisión registrada" },
            { f: 'COUNTIF(Casos!AR:AR,"?*")', s: E.ENTERO }]);
    f.push([]);
    f.push([{ v: "DEPURACIÓN DEL MAESTRO · en materiales", s: E.SUBTITULO }]);
    f.push([{ v: "Materiales con existencia CERO. No se dan de baja de stock: se decide qué " +
                 "pasa con el registro. La bajada no es el maestro completo, así que esto es " +
                 "la punta visible del universo a depurar.", s: E.TENUE }]);
    (function () {
      var dp = App.depuracion(), uni = App.universoDep();
      var cu = { "": 0 }, exc = 0;
      App.DP.ACCIONES.forEach(function (a) { cu[a] = 0; });
      uni.forEach(function (u) {
        var a = App.accionDep(u.codigo);
        cu[a.accion] = (cu[a.accion] || 0) + 1;
        if (a.excepcion) exc++;
      });
      f.push([{ v: "Materiales sin stock a la vista" }, { v: uni.length, s: E.ENTERO }]);
      f.push([{ v: "Política masiva vigente" },
              { v: dp.politica ? dp.politica.accion : "sin definir", s: E.TEXTO }]);
      f.push([{ v: "Sin decidir" }, { v: cu[""] || 0, s: E.ENTERO }]);
      App.DP.ACCIONES.forEach(function (a) {
        f.push([{ v: a }, { v: cu[a] || 0, s: E.ENTERO }]); });
      f.push([{ v: "Excepciones a la política masiva" }, { v: exc, s: E.ENTERO }]);
      f.push([{ v: "Maestro completo importado" },
              { v: dp.maestro ? dp.maestro.nombre : "no", s: E.TEXTO }]);
    })();
    f.push([]);
    f.push([{ v: "VALORIZACIÓN POR PRECIO DE ÚLTIMA COMPRA", s: E.SUBTITULO }]);
    f.push([{ v: "Materiales valorizados" },
            { f: 'COUNTIF(Casos!Z:Z,"Valorizado por última compra")', s: E.ENTERO }]);
    f.push([{ v: "Pendientes de valorización" },
            { f: 'COUNTIF(Casos!Z:Z,"Pendiente de valorización")', s: E.ENTERO }]);
    f.push([{ v: "Valorización total por última compra" },
            { f: "SUMIF(Casos!Z:Z,\"Valorizado por última compra\",Casos!AD:AD)", s: E.IMPORTE }]);
    f.push([{ v: "El precio de última compra no está en los archivos recibidos, así que el " +
                 "total de arriba es 0 y todos los casos figuran como pendientes. Ver la hoja " +
                 "«Metodología».", s: E.TENUE }]);
    f.push([]);
    f.push([{ v: "REFERENCIA DE SAP · NO es precio de última compra", s: E.SUBTITULO }]);
    f.push([{ v: "Valor de stock de SAP de los casos, por clasificación. Es el valor contable " +
                 "dividido por las unidades. Se informa aparte y nunca se suma a la " +
                 "valorización por última compra.", s: E.TENUE }]);
    m.clases.forEach(function (cl) {
      f.push([{ v: cl }, { f: 'SUMIF(Casos!D:D,"' + cl + '",Casos!AF:AF)', s: E.IMPORTE }]);
    });
    /* Lo que antes eran tres hojas sueltas —la propuesta de almacén, las
       equivalencias declaradas y la metodología— entra acá, junto a las cifras
       que condicionan. Reducir hojas no es perder contenido: es ponerlo donde
       se lee. */
    f.push([]);
    f.push([{ v: "ALMACÉN PROPUESTO POR BASE Y TIPO · PENDIENTE DE VALIDACIÓN", s: E.SUBTITULO }]);
    f.push([{ v: "A qué base pertenece cada almacén está OBSERVADO en la bajada: cada código " +
                 "de almacén aparece bajo un único centro, no es una suposición. Cuál " +
                 "DEBERÍA tener el stock de farmacia no está en los archivos: se propuso por " +
                 "la composición observada y hay que validarlo con cada base.", s: E.TENUE }]);
    f.push([{ v: "Base", s: E.CAB }, { v: "Tipo", s: E.CAB },
            { v: "Almacén propuesto", s: E.CAB }, { v: "Confianza", s: E.CAB },
            { v: "Qué significa esa confianza", s: E.CAB }]);
    (m.almacenes.propuesta || []).forEach(function (p2) {
      f.push([{ v: p2.base }, { v: p2.tipo }, { v: p2.almacen || "—" }, { v: p2.confianza },
              { v: p2.confianza === "Clara"
                  ? "Un solo almacén concentra el stock de este tipo en la base."
                  : "Hay más de un almacén con stock de este tipo y ninguno concentra el " +
                    "conjunto: de los datos no sale cuál debería ser. Lo ambiguo es el " +
                    "almacén, no el material.", s: E.TEXTO }]);
    });
    if ((m.almacenes.falta || []).length) {
      f.push([{ v: "Falta para cerrarlo" },
              { v: (m.almacenes.falta || []).join(" · "), s: E.TEXTO }]);
    }

    f.push([]);
    f.push([{ v: "EQUIVALENCIAS DE NOMENCLATURA DECLARADAS", s: E.SUBTITULO }]);
    f.push([{ v: "El depósito y SAP no nombran igual, y la correspondencia no es uno a uno " +
                 "en ninguno de los dos sentidos: VARIAS nomenclaturas del depósito que son " +
                 "el mismo producto, VARIOS códigos de SAP para un mismo producto, o las dos " +
                 "cosas. Los códigos agrupados dejan de ser candidatos a baja.", s: E.TENUE }]);
    var gs = App.grupos ? App.grupos() : [];
    if (!gs.length) {
      f.push([{ v: "Todavía no se declaró ninguna equivalencia.", s: E.TENUE }]);
    } else {
      f.push([{ v: "Nombre unificado", s: E.CAB }, { v: "Nomenclaturas del depósito", s: E.CAB },
              { v: "Códigos de SAP", s: E.CAB }, { v: "Sentido", s: E.CAB },
              { v: "Revisor", s: E.CAB }]);
      gs.forEach(function (g) {
        var sen = g.items.length > 1 && g.materiales.length > 1
            ? "Varias del depósito = varios de SAP"
          : g.items.length > 1 ? "Varias del depósito = un código de SAP"
          : g.materiales.length > 1 ? "Una del depósito = varios códigos de SAP"
          : "Una a una";
        f.push([{ v: g.nombre, s: E.TEXTO },
                { v: g.items.map(function (c) { return c.nombre_fisico; }).join(" · "), s: E.TEXTO },
                { v: g.materiales.join(" · "), s: E.TEXTO },
                { v: sen, s: E.TEXTO }, { v: g.revisor || "" }]);
      });
    }
    var ep = App.equivPres ? App.equivPres() : {};
    var kp = Object.keys(ep);
    if (kp.length) {
      f.push([]);
      f.push([{ v: "PRESENTACIONES DECLARADAS EQUIVALENTES", s: E.SUBTITULO }]);
      f.push([{ v: "Casos donde una presentación no informa lo que la otra sí —«comprimidos» " +
                   "y «60 comprimidos»— y una persona declaró que son la misma. El factor no " +
                   "cambia ninguna cantidad: dice por cuánto multiplicar al comparar.", s: E.TENUE }]);
      f.push([{ v: "Código SAP", s: E.CAB }, { v: "Presentación del depósito", s: E.CAB },
              { v: "Nomenclatura SAP", s: E.CAB }, { v: "Factor", s: E.CAB },
              { v: "Quién", s: E.CAB }]);
      kp.forEach(function (x) {
        var e2 = ep[x];
        f.push([{ v: e2.material }, { v: e2.presentacion || "", s: E.TEXTO },
                { v: e2.texto_sap || "", s: E.TEXTO },
                e2.factor ? { v: e2.factor } : { v: "" }, { v: e2.quien || "" }]);
      });
    }

    f.push([]);
    f.push([{ v: "CÓMO SE DECIDE UNA CORRESPONDENCIA", s: E.SUBTITULO }]);
    [["El parecido del nombre genera el candidato; las características deciden",
      "De cada material se extraen concentración, forma farmacéutica, volumen, calibre, " +
      "medidas, talle, modelo o referencia, longitud, esterilidad, población y cantidades " +
      "sin unidad."],
     ["Si los dos lados declaran lo mismo con valores distintos, no son el mismo material",
      "El candidato se descarta y queda registrado el motivo."],
     ["Si una característica se declara de un lado y no del otro, nada quedó verificado",
      "El caso va a revisión. Ahí se puede declarar que la presentación es la misma, y " +
      "esa declaración vale para todas las bases."],
     ["El maestro con el que se trabaja", "Son los " + num(App.maestroUnificado().filas.length) +
      " códigos de la bajada de SAP, con existencia y en cero, más lo que se importe. " +
      "Salió de una bajada de stock por centro: un material que nunca tuvo existencia en " +
      "ninguno de los tres podría no figurar."],
     ["Nada de esto modifica SAP",
      "Cada decisión queda como propuesta con nombre y fecha. La ejecución es posterior."],
    ].forEach(function (x) {
      f.push([{ v: x[0], s: E.TEXTO }, { v: x[1], s: E.TEXTO }]);
    });

    return { nombre: "Resumen", filas: f,
             altos: { 1: 24, 2: 15 }, anchos: [46, 30, 26, 18, 64, 15, 15, 16] };
  }

  function hojaLotes() {
    var f = [[{ v: "Trazabilidad por lote del recuento físico", s: E.TITULO }],
             [{ v: "Cada renglón de lote tal como figura en el informe original de cada base. " +
                   "Permite verificar que la cantidad del ítem es la suma de sus lotes.", s: E.TENUE }], [],
             [["Nº del caso", 8], ["Base", 11], ["Sistema de origen", 15],
              ["Código del ítem", 14], ["Nomenclatura", 42], ["Lote", 20],
              ["Vencimiento", 13], ["Stock del lote", 12], ["Código SAP vigente", 14]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];
    D().casos.forEach(function (c) {
      (c.lotes || []).forEach(function (l) {
        f.push([{ v: c.n }, { v: c.base }, { v: c.sistema_origen },
                { v: c.codigo_fisico || "" }, { v: c.nombre_fisico || "", s: E.TEXTO },
                { v: l.lote || "" }, { v: l.vencimiento || "" },
                { v: l.stock || 0, s: E.ENTERO }, { v: ef(c).material || "" }]);
      });
    });
    var ult = f.length;
    f.push([{ v: "TOTAL", s: E.SUBTITULO }, null, null, null, null, null, null,
            { f: "SUBTOTAL(109,H5:H" + ult + ")", s: E.ENTERO }]);
    return { nombre: "Lotes", filas: f,
             altos: { 1: 22, 2: 15, 4: 28 }, anchos: [8, 11, 15, 14, 42, 20, 13, 12, 14],
             congelar: "E5", autofiltro: "A4:I" + ult };
  }

  function hojaDecisiones() {
    var f = [[{ v: "Historial de decisiones", s: E.TITULO }],
             [{ v: "Cada cambio manual, con quién lo hizo y cuándo. El análisis original nunca " +
                   "se pisa: estas son las decisiones que se le aplicaron encima.", s: E.TENUE }], [],
             [["Fecha y hora", 17], ["Revisor", 18], ["Nº del caso", 8], ["ID del caso", 15],
              ["Base", 11], ["Ítem / material", 44], ["Qué se decidió", 54]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];
    var dd = App.decisiones(), n = 0;
    D().casos.forEach(function (c) {
      var d = dd[c.id];
      if (!d || !d.historial) return;
      d.historial.forEach(function (x) {
        n++;
        f.push([{ v: new Date(x.cuando).toLocaleString("es-AR") }, { v: x.quien },
                { v: c.n }, { v: c.id }, { v: c.base },
                { v: (c.nombre_fisico || c.texto_sap || ""), s: E.TEXTO },
                { v: x.que, s: E.TEXTO }]);
      });
    });
    if (!n) f.push([{ v: "Todavía no se registró ninguna decisión en el sistema.", s: E.TENUE }]);
    return { nombre: "Decisiones", filas: f,
             altos: { 1: 22, 2: 15, 4: 28 }, anchos: [17, 18, 8, 15, 11, 44, 54],
             congelar: "A5", autofiltro: "A4:G" + Math.max(f.length, 5) };
  }

  /* ---- Equivalencias de nomenclatura -------------------------------------
     La correspondencia entre el depósito y SAP no es uno a uno en ninguno de
     los dos sentidos, y la hoja tiene que mostrar los dos. */
  function hojaUnificadas() {
    var f = [[{ v: "Equivalencias de nomenclatura", s: E.TITULO }],
             [{ v: "El depósito y SAP no nombran igual. Acá están los grupos declarados: " +
                   "VARIAS nomenclaturas del depósito que son el mismo producto, VARIOS " +
                   "códigos de SAP para un mismo producto, o las dos cosas a la vez. Los " +
                   "códigos agrupados dejan de ser candidatos a baja.", s: E.TENUE }], [],
             [["Nombre unificado", 40], ["Nomenclaturas del depósito", 52],
              ["Cuántas", 8], ["Bases", 24], ["Códigos de SAP", 30], ["Cuántos", 8],
              ["Unidades contadas", 14], ["Sentido", 30], ["Revisor", 18],
              ["Observaciones", 40]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];

    // Se agrupan por el nombre unificado, que es lo que los declara el mismo
    // producto. Un caso que agrupó códigos sin ponerle nombre va igual.
    var porNombre = {}, sueltos = [], n = 0;
    D().casos.forEach(function (c) {
      var e = ef(c);
      if (e.unificada) {
        var g = porNombre[e.unificada] || (porNombre[e.unificada] = {
          nombre: e.unificada, items: [], mats: {}, bases: {}, un: 0,
          revisor: "", obs: "" });
        if (c.origen === "Inventario físico") { g.items.push(c); g.un += c.cantidad_fisica || 0; }
        e.materiales.forEach(function (m) { g.mats[m] = 1; });
        g.bases[c.base] = 1;
        if (e.revisor) g.revisor = e.revisor;
        if (e.observaciones && !g.obs) g.obs = e.observaciones;
      } else if (e.materiales.length > 1) {
        var h = { nombre: c.nombre_fisico || "(sin nombre)", items: [c], mats: {},
                  bases: {}, un: c.cantidad_fisica || 0, revisor: e.revisor || "",
                  obs: e.observaciones || "" };
        e.materiales.forEach(function (m) { h.mats[m] = 1; });
        h.bases[c.base] = 1;
        sueltos.push(h);
      }
    });

    Object.keys(porNombre).map(function (k) { return porNombre[k]; })
      .concat(sueltos)
      .sort(function (x, y) { return y.items.length - x.items.length; })
      .forEach(function (g) {
        n++;
        var mats = Object.keys(g.mats).sort();
        var sentido = g.items.length > 1 && mats.length > 1
            ? "Varias del depósito = varios de SAP"
          : g.items.length > 1 ? "Varias del depósito = un código de SAP"
          : mats.length > 1 ? "Una del depósito = varios códigos de SAP"
          : "Una a una";
        f.push([
          { v: g.nombre, s: E.TEXTO },
          { v: g.items.map(function (c) { return c.nombre_fisico; }).join(" · "), s: E.TEXTO },
          { v: g.items.length, s: E.ENTERO },
          { v: Object.keys(g.bases).sort().join(" · ") },
          { v: mats.join(" · "), s: E.TEXTO },
          { v: mats.length, s: E.ENTERO },
          { v: g.un, s: E.ENTERO },
          { v: sentido, s: E.TEXTO },
          { v: g.revisor }, { v: g.obs, s: E.TEXTO },
        ]);
      });
    if (!n) f.push([{ v: "Todavía no se declaró ninguna equivalencia.", s: E.TENUE }]);
    return { nombre: "Equivalencias", filas: f,
             anchos: [40, 52, 8, 24, 30, 8, 14, 30, 18, 40],
             congelar: "B5", autofiltro: "A4:J" + Math.max(f.length, 5) };
  }

  /* ---- Almacenes -------------------------------------------------------
     Dos cosas distintas en la misma hoja, cada una rotulada como lo que es:
     lo que está OBSERVADO en la bajada y lo que es una PROPUESTA a validar. */
  function hojaAlmacenes() {
    var m = D().meta.almacenes, k = D().kpis.almacen || {};
    var f = [[{ v: "Ubicación del stock · centros y almacenes", s: E.TITULO }],
             [{ v: "El CENTRO es la base; el ALMACÉN es el depósito dentro de esa base. Son " +
                   "dos campos distintos de SAP. Una cosa es que el material esté bien " +
                   "identificado, otra que tenga stock, y otra que ese stock esté en el " +
                   "almacén que corresponde.", s: E.TENUE }], []];
    f.push([{ v: "QUÉ ESTÁ OBSERVADO Y QUÉ ES UNA PROPUESTA", s: E.SUBTITULO }]);
    f.push([{ v: "Observado en la bajada", s: E.TEXTO },
            { v: "Cada código de almacén aparece bajo un único centro. Saber a qué base " +
                 "pertenece un almacén NO es una suposición: está en el archivo.", s: E.TEXTO }]);
    f.push([{ v: "Propuesta a validar", s: E.TEXTO },
            { v: "Qué almacén DEBERÍA contener el stock de Farmacia en cada base no está en " +
                 "ningún archivo. Se propone a partir de la composición observada de cada " +
                 "almacén y hay que validarlo con cada base.", s: E.TEXTO }]);
    f.push([{ v: "No se supuso por el nombre", s: E.TEXTO },
            { v: "Ninguna correspondencia se dedujo por parecido de nombres o de códigos: " +
                 "sale de qué materiales y cuántas unidades tiene cada almacén.", s: E.TEXTO }]);
    f.push([]);
    f.push([{ v: "ALMACÉN ESPERADO POR BASE Y TIPO · propuesta", s: E.SUBTITULO }]);
    f.push([["Base", 14], ["Tipo de material", 16], ["Almacén propuesto", 15],
            ["Confianza", 12], ["Por qué / reparo", 54],
            ["Otros almacenes de la base con stock de ese tipo", 52],
            ["¿Validado por la base?", 18]]
           .map(function (c) { return { v: c[0], s: E.CAB }; }));
    (m.propuesta || []).forEach(function (p) {
      var otros = (p.alternativas || []).filter(function (a) { return a.almacen !== p.almacen; });
      f.push([{ v: p.base }, { v: p.tipo }, { v: p.almacen || "" }, { v: p.confianza },
              { v: p.nota || (p.confianza === "Clara"
                   ? "Concentra la mayor parte de las unidades y de los materiales de ese tipo."
                   : ""), s: E.TEXTO },
              { v: otros.map(function (a) {
                     return a.almacen + " (" + a.unidades + " un., " + a.materiales + " mat.)";
                   }).join(" · ") || "—", s: E.TEXTO },
              { v: "PENDIENTE" }]);
    });
    f.push([]);
    f.push([{ v: "ALMACENES OBSERVADOS POR BASE", s: E.SUBTITULO }]);
    f.push([["Base", 14], ["Almacenes que aparecen en la bajada", 70]]
           .map(function (c) { return { v: c[0], s: E.CAB }; }));
    Object.keys(m.por_base || {}).forEach(function (b) {
      f.push([{ v: b }, { v: (m.por_base[b] || []).join(" · "), s: E.TEXTO }]);
    });
    f.push([]);
    f.push([{ v: "ESTADO DE LA UBICACIÓN · recuento", s: E.SUBTITULO }]);
    f.push([["Estado", 34], ["Casos", 10], ["Qué significa", 72]]
           .map(function (c) { return { v: c[0], s: E.CAB }; }));
    [["Almacén correcto", "El stock está en el almacén propuesto para esa base y tipo."],
     ["Almacén a cambiar", "El stock figura en un almacén distinto del propuesto. Es un " +
      "problema de ubicación, no de identificación: el material está bien, el lugar no."],
     ["Material en múltiples almacenes", "El mismo material tiene stock en más de un " +
      "almacén de la misma base. No se consolidó nada: se conservan las cantidades de cada uno."],
     ["Almacén pendiente de validación", "No hay propuesta de almacén para esa base y tipo, " +
      "así que no se puede concluir si está bien ubicado."],
     ["Almacén no identificado", "La bajada no trae código de almacén para ese stock."],
     ["Sin stock, sin almacén", "No hay stock, así que no hay ubicación que controlar."]]
    .forEach(function (x) {
      f.push([{ v: x[0] }, { v: k[x[0]] || 0, s: E.ENTERO }, { v: x[1], s: E.TEXTO }]);
    });
    f.push([]);
    f.push([{ v: "QUÉ FALTA PARA CERRAR ESTA PARTE", s: E.SUBTITULO }]);
    (m.falta || []).forEach(function (x) { f.push([{ v: "•" }, { v: x, s: E.TEXTO }]); });
    f.push([]);
    f.push([{ v: "El detalle material por material está en la hoja «Casos», columnas AN a AS.",
             s: E.TENUE }]);
    return { nombre: "Almacenes", filas: f, anchos: [20, 18, 16, 13, 54, 52, 18] };
  }

  /* ---- Depuración del maestro ------------------------------------------- */
  function hojaDepuracion() {
    var dp = App.depuracion(), uni = App.universoDep(), lig = App.ligadosDep();
    var DP = App.DP;
    var f = [[{ v: "Depuración del maestro de materiales", s: E.TITULO }],
             [{ v: "Materiales que figuran en SAP con EXISTENCIA CERO. No son candidatos a " +
                   "baja de stock —no hay stock que dar de baja— sino registros del maestro " +
                   "sobre los que hay que decidir: mantener, bloquear o dar de baja. Todo es " +
                   "propuesta: no ejecuta nada en SAP.", s: E.TENUE }], []];

    f.push([{ v: "ALCANCE REAL DE ESTA DEPURACIÓN", s: E.SUBTITULO }]);
    f.push([{ v: "Lo que se ve acá", s: E.TEXTO },
            { v: uni.length + " materiales. Es la punta visible.", s: E.TEXTO }]);
    f.push([{ v: "Lo que no se puede saber", s: E.TEXTO },
            { v: "Cuántos materiales tiene el maestro completo con existencia cero. La " +
                 "bajada recibida trae los materiales CON stock; éstos aparecieron igual en " +
                 "cero. El maestro completo no está entre los archivos recibidos.", s: E.TEXTO }]);
    f.push([{ v: "Maestro importado", s: E.TEXTO },
            { v: dp.maestro ? dp.maestro.nombre + " · " + dp.maestro.filas.length +
                 " materiales sin stock · " + fechaCorta(dp.maestro.cuando)
                 : "No se importó ningún maestro completo.", s: E.TEXTO }]);
    f.push([]);

    f.push([{ v: "DECISIÓN MASIVA", s: E.SUBTITULO }]);
    if (!dp.politica) {
      f.push([{ v: "No hay política masiva definida: cada material se decide de a uno.",
                s: E.TEXTO }]);
    } else {
      [["Acción", dp.politica.accion], ["Alcance", dp.politica.alcance],
       ["Criterio", dp.politica.criterio], ["Quién la definió", dp.politica.quien],
       ["Cuándo", new Date(dp.politica.cuando).toLocaleString("es-AR")]]
      .forEach(function (x) { f.push([{ v: x[0] }, { v: x[1], s: E.TEXTO }]); });
    }
    f.push([]);

    f.push([{ v: "MATERIAL POR MATERIAL", s: E.SUBTITULO }]);
    f.push([["Código de material", 16], ["Descripción", 48], ["Tipo", 15], ["Base", 12],
            ["De dónde sale", 36], ["Acción decidida", 24], ["De dónde viene la decisión", 18],
            ["¿Es excepción a la masiva?", 14], ["Motivo de la excepción", 48],
            ["Quién", 18], ["Cuándo", 17]]
           .map(function (c) { return { v: c[0], s: E.CAB }; }));
    var cab = f.length;
    uni.forEach(function (u) {
      var a = App.accionDep(u.codigo);
      f.push([{ v: u.codigo }, { v: u.texto || "", s: E.TEXTO }, { v: u.tipo || "" },
              { v: u.base || "" }, { v: u.origen, s: E.TEXTO },
              { v: a.accion || "Sin decidir" },
              { v: a.fuente === "individual" ? "Decisión individual"
                   : a.fuente === "masiva" ? "Política masiva" : "—" },
              { v: a.excepcion ? "Sí" : "No" }, { v: a.excepcion ? a.motivo : "", s: E.TEXTO },
              { v: a.quien || "" },
              { v: a.cuando ? new Date(a.cuando).toLocaleString("es-AR") : "" }]);
    });
    if (!uni.length) f.push([{ v: "No hay materiales sin stock en el universo visible.", s: E.TENUE }]);
    var ult = f.length;
    f.push([]);
    f.push([{ v: "RECUENTO POR ACCIÓN", s: E.SUBTITULO }]);
    ["Sin decidir"].concat(DP.ACCIONES).forEach(function (ac) {
      f.push([{ v: ac }, { f: 'COUNTIF(F' + (cab + 1) + ":F" + ult + ',"' + ac + '")',
                           s: E.ENTERO }]);
    });
    f.push([{ v: "Excepciones a la política masiva" },
            { f: 'COUNTIF(H' + (cab + 1) + ":H" + ult + ',"Sí")', s: E.ENTERO }]);
    f.push([]);

    f.push([{ v: "LIGADO A LAS DECISIONES DE ALTA", s: E.SUBTITULO }]);
    f.push([{ v: "Crear un código nuevo sin haber verificado el maestro puede dejar un " +
                 "duplicado, y ese duplicado es exactamente lo que hay que depurar. Son las " +
                 "dos caras de la misma decisión.", s: E.TENUE }]);
    f.push([["Nº del caso", 9], ["Ítem del depósito", 48], ["Base", 12], ["Tipo", 14],
            ["Qué se decidió", 40], ["Código a buscar en el maestro", 18],
            ["Riesgo asumido", 22], ["Revisor", 18]]
           .map(function (c) { return { v: c[0], s: E.CAB }; }));
    lig.forEach(function (c) {
      var e = ef(c);
      f.push([{ v: c.n }, { v: c.nombre_fisico || c.texto_sap || "", s: E.TEXTO },
              { v: c.base }, { v: c.tipo },
              { v: e.verificacion || e.ruta_b || "", s: E.TEXTO },
              { v: e.codigo_maestro || "" }, { v: e.riesgo_duplicado || "" },
              { v: e.revisor || "" }]);
    });
    if (!lig.length) f.push([{ v: "Todavía no hay ninguna decisión de alta ligada a la depuración.",
                               s: E.TENUE }]);
    f.push([]);

    f.push([{ v: "QUÉ FALTA PARA PODER EJECUTAR ESTO", s: E.SUBTITULO }]);
    (D().meta.depuracion.falta || []).forEach(function (x) {
      f.push([{ v: "•" }, { v: x, s: E.TEXTO }]); });
    f.push([]);
    if (dp.historial && dp.historial.length) {
      f.push([{ v: "HISTORIAL DE LA DEPURACIÓN", s: E.SUBTITULO }]);
      f.push([["Fecha y hora", 17], ["Quién", 18], ["Qué se decidió", 90]]
             .map(function (c) { return { v: c[0], s: E.CAB }; }));
      dp.historial.forEach(function (x) {
        f.push([{ v: new Date(x.cuando).toLocaleString("es-AR") }, { v: x.quien },
                { v: x.que, s: E.TEXTO }]);
      });
    }
    return { nombre: "Depuración del maestro", filas: f,
             anchos: [18, 48, 16, 13, 36, 24, 20, 15, 48, 18, 17] };
  }

  function hojaControl() {
    var f = [[{ v: "Control de integridad contra las fuentes originales", s: E.TITULO }],
             [{ v: "La columna «En el sistema» se recalcula con fórmulas sobre la hoja «Casos». " +
                   "Si algo deja de cerrar, el estado cambia solo.", s: E.TENUE }], [],
             [["Control", 56], ["En la fuente original", 15], ["En el sistema", 15],
              ["Diferencia", 12], ["Estado", 14], ["Detalle", 60]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];
    var r = 5;
    D().meta.fuentes.forEach(function (fu) {
      f.push([{ v: "Ítems del inventario físico · " + fu.base }, { v: fu.items, s: E.ENTERO },
              { f: 'COUNTIFS(Casos!G:G,"' + fu.base + '",Casos!C:C,"Inventario físico")', s: E.ENTERO },
              { f: "C" + r + "-B" + r, s: E.ENTERO },
              { f: 'IF(D' + r + '=0,"Coincide","A REVISAR")' },
              { v: fu.sistema + " · " + fu.informe, s: E.TEXTO }]); r++;
      f.push([{ v: "Unidades físicas · " + fu.base }, { v: fu.unidades, s: E.ENTERO },
              { f: 'SUMIFS(Casos!O:O,Casos!G:G,"' + fu.base + '",Casos!C:C,"Inventario físico")', s: E.ENTERO },
              { f: "C" + r + "-B" + r, s: E.ENTERO },
              { f: 'IF(ABS(D' + r + ')<0.005,"Coincide","A REVISAR")' },
              { v: "Suma del recuento informado en el PDF original", s: E.TEXTO }]); r++;
    });
    D().control.filter(function (c) { return c.estado === "Informativo"; }).forEach(function (c) {
      f.push([{ v: c.control, s: E.TEXTO }, { v: c.fuente, s: E.ENTERO },
              { v: c.sistema, s: E.ENTERO }, { v: 0, s: E.ENTERO }, { v: "Informativo" },
              { v: c.detalle || "", s: E.TEXTO }]); r++;
    });
    // Controles sobre las dimensiones nuevas: ubicación y clase B.
    [["Casos de clase B con alternativa 2 y sin riesgo registrado", 0,
      'COUNTIFS(Casos!AT:AT,"Crear sin verificar el maestro",Casos!AW:AW,"")',
      "La alternativa 2 siempre registra el riesgo asumido. Si no da 0, hay una decisión " +
      "incompleta."],
     ["Decisiones de ubicación sin almacén destino ni validación pendiente", 0,
      'COUNTIFS(Casos!AR:AR,"?*",Casos!AS:AS,"")-COUNTIF(Casos!AR:AR,"Lo valida el responsable de la base")',
      "Toda decisión de ubicación define un almacén destino, salvo la que deja la " +
      "validación en manos de la base."],
     ["Casos con stock en SAP y sin estado de ubicación", 0,
      'COUNTIFS(Casos!P:P,">0",Casos!AQ:AQ,"")',
      "Todo stock de SAP tiene que tener un estado de ubicación, aunque sea «no identificado»."]
    ].forEach(function (x) {
      f.push([{ v: x[0], s: E.TEXTO }, { v: x[1], s: E.ENTERO },
              { f: x[2], s: E.ENTERO }, { f: "C" + r + "-B" + r, s: E.ENTERO },
              { f: 'IF(D' + r + '=0,"Coincide","A REVISAR")' },
              { v: x[3], s: E.TEXTO }]); r++;
    });
    return { nombre: "Control", filas: f,
             altos: { 1: 22, 2: 15, 4: 28 }, anchos: [56, 15, 15, 12, 14, 60] };
  }

  function hojaMetodologia() {
    var m = D().meta, f = [];
    function t(x) { f.push([{ v: x, s: E.SUBTITULO }]); }
    function p(x) { f.push([{ v: x, s: E.TEXTO }]); }
    f.push([{ v: "Metodología y alcance", s: E.TITULO }]);
    f.push([]);
    t("Criterio del análisis"); p(m.criterio); f.push([]);
    t("Fuentes de inventario físico");
    m.fuentes.forEach(function (x) {
      p(x.base + " · sistema " + x.sistema + " · " + x.informe + " · archivo " + x.archivo +
        " · " + x.items + " ítems, " + x.unidades.toLocaleString("es-AR") + " unidades, " +
        x.renglones_lote + " renglones de lote.");
    });
    f.push([]);
    t("Contraparte SAP · qué es y qué no es");
    p("Archivo " + m.sap.archivo + ", corte al " + m.sap.corte + ". " +
      m.sap.codigos_unicos + " códigos únicos y " + m.sap.pares_material_base +
      " combinaciones material-base. Los archivos originales no se modificaron.");
    p("ATENCIÓN: " + m.sap.que_contiene + " " + m.sap.limitacion);
    p("FUERA DE ALCANCE: " + m.sap.fuera_de_alcance);
    f.push([]);
    t("Cómo se valida una correspondencia");
    p("El parecido del nombre genera el candidato; las características deciden. De cada " +
      "material se extraen concentración, forma farmacéutica, volumen, calibre, medidas, " +
      "talle, modelo o referencia, longitud, esterilidad, población y cantidades sin " +
      "unidad.");
    p("Si los dos lados declaran la misma característica con valores distintos, no son el " +
      "mismo material: el candidato se descarta y queda registrado el motivo.");
    p("Si se declara una característica de un lado y no del otro, nada quedó verificado y el " +
      "caso va a revisión. Sólo se identifica por el nombre un material que no declara " +
      "ninguna característica de ningún lado, como un otoscopio o un glucómetro.");
    p("Cuanta más característica queda verificada, menos tiene que cargar el nombre. Sin " +
      "ninguna verificada, la denominación tiene que coincidir casi por completo en los dos sentidos.");
    f.push([]);
    t("Clasificaciones");
    [["A · Identificado en SAP", "Existe físicamente y se encontró un código cuya nomenclatura y presentación se corresponden. No se propone alta."],
     ["B · Sin correspondencia con stock", "Existe físicamente y no se encontró correspondencia ENTRE LOS MATERIALES CON STOCK en SAP. No está probado que no exista: la bajada no es el maestro completo. Hay que verificarlo antes de proponer el alta."],
     ["C · Candidato a baja", "Material con stock en SAP que ningún inventario físico identificó en esa base. Se propone la baja del stock de esa base."],
     ["D · Requiere revisión", "Coincidencia parcial, diferencia de presentación, varios códigos posibles o nomenclatura insuficiente. No se resuelve automáticamente."],
     ["E · Fuera del alcance", "Indumentaria, equipamiento y repuestos. El inventario es de Farmacia: nunca iban a aparecer, así que su ausencia no prueba nada y no se propone baja."]
    ].forEach(function (x) { f.push([{ v: x[0] }, { v: x[1], s: E.TEXTO }]); });
    f.push([]);
    t("Valorización");
    p("Criterio pedido: precio de última compra.");
    p("Estado: NO disponible en los archivos recibidos.");
    m.valorizacion.explicacion.split("\n\n").forEach(function (x) { p(x.replace(/\n/g, " ")); });
    f.push([]);
    t("Para cargar el precio de última compra cuando esté disponible");
    m.valorizacion.layout_esperado.forEach(function (x) {
      f.push([{ v: x.campo }, { v: x.descripcion, s: E.TEXTO }]);
    });
    f.push([]);
    t("Advertencias");
    p("Las altas y las bajas son PROPUESTAS sujetas a revisión y aprobación. Nada de este " +
      "trabajo ejecuta ninguna modificación sobre SAP.");
    p("La lista de candidatos a baja es provisional mientras queden casos en revisión: si un " +
      "caso se resuelve identificando un material, ese material deja de ser candidato a baja.");
    p("La clasificación B NO afirma que el material no exista en SAP. Afirma que no está entre " +
      "los materiales con stock. Verificarlo contra el maestro completo es el paso previo " +
      "obligatorio al alta, y queda fuera del alcance de este trabajo.");
    p("Un material compartido por varias bases se identifica en común pero conserva su " +
      "trazabilidad por base: coincidir en el material no es coincidir en el stock.");
    return { nombre: "Metodología", filas: f, anchos: [40, 104] };
  }

  /* Las fórmulas se escriben apuntando a la columna entera de «Casos» porque se lee
     mejor, pero una columna entera incluye el encabezado y la fila de TOTAL, y las dos
     son celdas que ensucian los COUNTIF: el encabezado es texto (cuenta como "?*") y
     el TOTAL tiene números. Antes de armar el libro se acotan a las filas de datos. */
  function acotar(hojas) {
    var ult = 4 + D().casos.length;
    var rx = /Casos!([A-Z]+):\1(?![0-9])/g;
    hojas.forEach(function (h) {
      h.filas.forEach(function (fila) {
        (fila || []).forEach(function (c) {
          if (c && c.f) c.f = c.f.replace(rx, function (_, col) {
            return "Casos!" + col + "5:" + col + ult; });
        });
      });
    });
    return hojas;
  }

  function excel() {
    /* Ocho hojas, no quince, y en el orden en que se leen: primero qué hacer,
       después el detalle, y al final de dónde salió cada cifra. Las seis hojas
       por clasificación eran el mismo detalle partido por una categoría
       interna, y obligaban a recorrerlas todas para saber qué hacer: ahora eso
       lo dicen las dos primeras. La propuesta de almacén y la metodología
       entran en el Resumen, donde se leen junto a las cifras que condicionan. */
    var hojas = [
      hojaPlan(),
      hojaAccion(),
      hojaResumen(),
      hojaCasos(),
      hojaMaestro(),
      hojaLotes(),
      hojaDecisiones(),
      hojaControl(),
    ];
    var blob = XLSXMin.construir(acotar(hojas), { titulo: "Inventario físico vs SAP" });
    descargar(blob, "Inventario fisico vs SAP - analisis " + hoy() + ".xlsx");
  }

  /* El maestro general con los importes, dentro del análisis: es la misma
     lista que se baja para completar, y tenerla acá evita exportar dos veces
     para saber qué códigos hay. */
  function hojaMaestro() {
    var u = App.maestroUnificado();
    var cols = [["Código SAP", 14], ["Nomenclatura SAP", 52], ["Importe última compra", 20],
      ["Nomenclatura del depósito", 46], ["Bases donde aparece", 24],
      ["Almacenes donde figura", 22], ["De dónde sale", 40]];
    var f = [[{ v: "Maestro general de materiales", s: E.TITULO }],
             [{ v: "Una fila por código de SAP: sin duplicar por base ni por almacén, " +
                   "con los que tienen existencia y con los que están en cero. Para cargar " +
                   "los importes, bajá la planilla desde Maestro → Maestro general.",
                s: E.TENUE }], [],
             cols.map(function (x) { return { v: x[0], s: E.CAB }; })];
    u.filas.forEach(function (x) {
      f.push([
        { v: x.codigo }, { v: x.texto || "", s: E.TEXTO },
        x.precio != null ? { v: x.precio, s: E.IMPORTE } : { v: "" },
        { v: x.fisicos.join(" · "), s: E.TEXTO },
        { v: x.bases.join(" · ") }, { v: x.almacenes.join(" · ") },
        { v: x.fuente, s: E.TEXTO },
      ]);
    });
    return { nombre: "Maestro general", filas: f,
             anchos: cols.map(function (x) { return x[1]; }),
             altos: { 1: 22, 2: 15, 4: 30 },
             congelar: "B5", autofiltro: "A4:G" + Math.max(f.length, 5) };
  }

  function descargar(blob, nombre) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---- La planilla del maestro general ----------------------------------
     Es la que se baja, se completa afuera con el importe de última compra y
     se vuelve a subir. Por eso las tres columnas obligatorias van primero y
     con el nombre exacto que busca la importación: lo que se baja tiene que
     poder volver a entrar sin que nadie toque nada. */
  function maestroGeneral(u) {
    var f = [[{ v: "Maestro general de materiales", s: E.TITULO }],
             [{ v: "Una fila por código de SAP. No se duplica por base ni por almacén. " +
                   "Completá la columna «Importe última compra» y volvé a importar este " +
                   "mismo archivo desde Maestro → Maestro general. Las columnas que vienen " +
                   "después del importe son de contexto: la importación las ignora.",
                s: E.TENUE }], [],
             [["Código SAP", 14], ["Nomenclatura SAP", 52], ["Importe última compra", 20],
              ["Nomenclatura del depósito", 46], ["Bases donde aparece", 24],
              ["Almacenes donde figura", 22], ["De dónde sale", 40]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];
    u.filas.forEach(function (x) {
      f.push([
        { v: x.codigo }, { v: x.texto || "", s: E.TEXTO },
        x.precio != null ? { v: x.precio, s: E.IMPORTE } : { v: "" },
        { v: x.fisicos.join(" · "), s: E.TEXTO },
        { v: x.bases.join(" · ") }, { v: x.almacenes.join(" · ") },
        { v: x.fuente, s: E.TEXTO },
      ]);
    });
    var hojas = [{ nombre: "Maestro general", filas: f,
                   anchos: [14, 52, 20, 46, 24, 22, 40],
                   congelar: "A5", autofiltro: "A4:G" + Math.max(f.length, 5) }];

    // Los ítems del depósito que todavía no tienen código van en su propia
    // hoja: todavía no son un material de SAP y mezclarlos sería inventar uno.
    var g = [[{ v: "Ítems del depósito sin código de SAP asignado", s: E.TITULO }],
             [{ v: "Están contados en un inventario físico y todavía no tienen una " +
                   "correspondencia confirmada con SAP. No son materiales del maestro: " +
                   "se resuelven en Inicio y recién entonces entran en la hoja anterior.",
                s: E.TENUE }], [],
             [["Nomenclatura del depósito", 52], ["Base", 14], ["Tipo", 16],
              ["Unidades contadas", 18], ["Estado del análisis", 30]]
             .map(function (c) { return { v: c[0], s: E.CAB }; })];
    u.sinCodigo.forEach(function (c) {
      g.push([{ v: c.nombre_fisico || "", s: E.TEXTO }, { v: c.base }, { v: c.tipo || "" },
              { v: c.cantidad_fisica || 0, s: E.ENTERO }, { v: c.clasificacion, s: E.TEXTO }]);
    });
    hojas.push({ nombre: "Sin código asignado", filas: g, anchos: [52, 14, 16, 18, 30],
                 congelar: "A5", autofiltro: "A4:E" + Math.max(g.length, 5) });

    descargar(XLSXMin.construir(hojas, { titulo: "Maestro general de materiales" }),
              "Inventario fisico vs SAP - maestro general " + hoy() + ".xlsx");
  }

  return { excel: excel, maestroGeneral: maestroGeneral,
           informeHtml: function () { return Informe.html(); } };
})();
