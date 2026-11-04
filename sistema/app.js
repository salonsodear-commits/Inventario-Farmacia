/* Sistema de gestión · Inventario físico vs SAP
   Está pensado como un flujo de trabajo, no como un listado: la pantalla de
   inicio dice qué hay que hacer y en qué orden, el modo revisión resuelve los
   casos de a uno con el teclado, y los grupos grandes se deciden en lote.
   Los datos del análisis (datos.js) son de sólo lectura; las decisiones viven
   en una capa aparte, con historial. */
var App = (function () {
  "use strict";

  var D = window.DATOS;
  var CLAVE = "invsap.decisiones.v1";
  var CLAVE_DEP = "invsap.depuracion.v1";
  var CLAVE_REV = "invsap.revisor";
  var LETRA = { "A · Identificado en SAP": "A", "B · Sin correspondencia con stock": "B",
                "C · Candidato a baja": "C", "D · Requiere revisión": "D",
                "E · Fuera del alcance": "E", "F · En SAP sin stock": "F" };
  var CORTO = { A: "Identificados", B: "Sin correspondencia", C: "Candidatos a baja",
                D: "En revisión", E: "Fuera del alcance", F: "En SAP sin stock" };

  /* Clase B · las dos alternativas de trabajo. La bajada de SAP son los materiales
     CON stock: que un ítem no aparezca no prueba que no exista en el maestro. Por eso
     el sistema no decide solo, pregunta expresamente por cuál de las dos se avanza. */
  var RB_VERIF = "Verificar antes de crear";
  var RB_CREAR = "Crear sin verificar el maestro";
  var VER_NO    = "Verificado · no existe en el maestro";
  var VER_REUSA = "Verificado · existe sin stock · se reutiliza el código";
  var VER_NUEVO = "Verificado · existe sin stock · se da de baja y se crea de nuevo";
  /* Depuración del maestro · las tres acciones posibles sobre un material sin stock. */
  var DP_MANT = "Mantener", DP_BLOQ = "Bloquear", DP_BAJA = "Dar de baja del maestro";
  var DP_ACCIONES = [DP_MANT, DP_BLOQ, DP_BAJA];
  /* Ubicación. El centro es la base; el almacén, el depósito dentro de esa base. */
  var AL_OK = "Almacén correcto", AL_CAMB = "Almacén a cambiar",
      AL_VAL = "Almacén pendiente de validación", AL_MULT = "Material en múltiples almacenes",
      AL_NOID = "Almacén no identificado", AL_SINS = "Sin stock, sin almacén";
  function almacenPendiente(c) {
    if (efectivo(c).almacen_decidido) return false;
    return c.almacen_estado === AL_CAMB || c.almacen_estado === AL_MULT;
  }

  function L(c) { return LETRA[c.clasificacion]; }
  function sinStock(c) { return !!c.material_sin_stock_en_base; }

  /* Las colas son el corazón de la herramienta: ordenan el trabajo por
     prioridad y cada una tiene su propia forma de decidirse. */
  var COLAS = [
    { id: "revision", titulo: "Resolver los casos en revisión",
      desc: "Es el trabajo principal. Cada caso llega con el candidato más probable y el " +
            "motivo exacto por el que no se dio por confirmado, así que se decide rápido.",
      pred: function (c) { return L(c) === "D"; },
      porMotivo: true, lote: false, color: "D" },
    { id: "altas", titulo: "Verificar los que no aparecieron en SAP",
      desc: "Existen físicamente y no se encontró correspondencia entre los materiales que " +
            "HOY tienen stock en SAP. Ojo: la bajada que tenemos no es el maestro completo, " +
            "así que el material puede existir en SAP con existencia cero. Antes de proponer " +
            "un alta hay que verificarlo contra el maestro.",
      pred: function (c) { return L(c) === "B"; }, lote: true, color: "B" },
    { id: "existencias", titulo: "Registrar existencias que SAP no tiene",
      desc: "Están identificados y el código existe, pero SAP no registra stock de ese " +
            "material en esa base. No son altas: falta registrar la existencia.",
      pred: function (c) { return L(c) === "A" && sinStock(c); }, lote: true, color: "A" },
    { id: "identificados", titulo: "Confirmar las identificaciones",
      desc: "Ya tienen un código verificado por nomenclatura y presentación. Sólo hay que " +
            "confirmarlas o corregir las que no correspondan.",
      pred: function (c) { return L(c) === "A" && !sinStock(c); }, lote: true, color: "A" },
    { id: "almacenes", titulo: "Corregir la ubicación en los almacenes",
      desc: "Materiales identificados cuyo stock está en un almacén distinto del propuesto, " +
            "o repartido en varios. Son errores de ubicación, no de identificación: el " +
            "material está bien, el lugar donde figura no.",
      pred: function (c) { return c.almacen_estado === AL_CAMB || c.almacen_estado === AL_MULT; },
      lote: false, color: "D", esAlmacen: true },
    { id: "depurar", titulo: "Depurar el maestro · materiales sin stock",
      desc: "Figuran en la bajada de SAP con existencia CERO. No hay stock que dar de baja: " +
            "lo que corresponde es decidir si el material se mantiene, se bloquea o se da de " +
            "baja del maestro. Son la punta visible del universo de depuración.",
      pred: function (c) { return L(c) === "F"; }, lote: true, color: "E" },
    { id: "bajas", titulo: "Aprobar las bajas propuestas",
      desc: "Material con stock en SAP que ningún inventario físico identificó en esa base. " +
            "Aprobar significa proponer la baja, no ejecutarla.",
      pred: function (c) { return L(c) === "C" && !resueltoPorAgrupacion(c); },
      lote: true, color: "C" },
  ];

  var estado = {
    vista: "inicio",
    filtros: { base: "", tipo: "", clase: "", revision: "", aprobacion: "",
               motivo: "", valorizacion: "", obs: "", texto: "", grupo: "",
               almacen: "", almacen_estado: "" },
    orden: { campo: "n", desc: false },
    pagina: 1, porPagina: 50,
    fichaId: null, volverA: "casos",
    cola: null, motivo: null, triage: [], tIdx: 0, selCand: {}, unif: "",
    sel: {}, depFiltro: "",
  };
  var decisiones = {}, revisor = "";
  /* La depuración del maestro es una decisión de otra naturaleza: no es sobre un ítem
     contado, es sobre el maestro de materiales. Por eso vive en su propio registro. */
  var depu = { politica: null, materiales: {}, maestro: null, historial: [] };

  // ------------------------------------------------------------- persistencia
  function cargar() {
    try { decisiones = JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; }
    catch (e) { decisiones = {}; }
    try { revisor = localStorage.getItem(CLAVE_REV) || ""; } catch (e) { revisor = ""; }
    try {
      var dd = JSON.parse(localStorage.getItem(CLAVE_DEP) || "null");
      if (dd) depu = { politica: dd.politica || null, materiales: dd.materiales || {},
                       maestro: dd.maestro || null, historial: dd.historial || [] };
    } catch (e) {}
  }
  function guardarDep() {
    try { localStorage.setItem(CLAVE_DEP, JSON.stringify(depu)); }
    catch (e) { aviso("No se pudo guardar: el navegador bloqueó el almacenamiento."); }
  }
  function anotarDep(que) {
    depu.historial = depu.historial || [];
    depu.historial.push({ cuando: new Date().toISOString(),
                          quien: revisor || "(sin identificar)", que: que });
  }
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(decisiones)); }
    catch (e) { aviso("No se pudo guardar: el navegador bloqueó el almacenamiento."); }
  }
  function dec(id) { return decisiones[id] || null; }

  /* Una decisión nunca pisa el dato original: se guarda aparte, con quién y cuándo. */
  function decidir(id, cambios, descripcion) {
    var d = decisiones[id] || { historial: [] };
    var antes = {};
    Object.keys(cambios).forEach(function (k) { antes[k] = d[k] === undefined ? null : d[k]; });
    Object.keys(cambios).forEach(function (k) { d[k] = cambios[k]; });
    d.historial = d.historial || [];
    d.historial.push({ cuando: new Date().toISOString(), quien: revisor || "(sin identificar)",
                       que: descripcion, antes: antes, despues: cambios });
    d.revisor = revisor || "(sin identificar)";
    d.actualizado = new Date().toISOString();
    decisiones[id] = d; guardar(); invalidar();
  }

  // ------------------------------------------------------------- derivados
  function caso(id) {
    for (var i = 0; i < D.casos.length; i++) if (D.casos[i].id === id) return D.casos[i];
    return null;
  }
  /* Un ítem físico puede corresponder a VARIOS códigos de SAP: el depósito usa una
     nomenclatura unificada y SAP tiene el mismo producto abierto en varios códigos.
     Por eso la decisión guarda una lista, no un código suelto. */
  function efectivo(c) {
    var d = dec(c.id) || {};
    var mats = d.materiales ||
               (d.material_corregido ? [d.material_corregido] : null) ||
               (c.material_sap ? [c.material_sap] : []);
    return {
      estado_revision: d.estado_revision || c.estado_revision,
      aprobacion: d.aprobacion || c.aprobacion,
      materiales: mats,
      material: mats[0] || null,
      agrupado: mats.length > 1,
      unificada: d.nomenclatura_unificada || "",
      corregido: !!(d.materiales || d.material_corregido),
      almacen_decidido: d.almacen_decision || null,
      almacen_propuesto: d.almacen_propuesto || null,
      ruta_b: d.ruta_b || null,
      verificacion: d.verificacion || null,
      codigo_maestro: d.codigo_maestro || "",
      riesgo_duplicado: d.riesgo_duplicado || null,
      depuracion: d.depuracion || null,
      observaciones: d.observaciones || c.observaciones || "",
      revisor: d.revisor || "", actualizado: d.actualizado || "",
      historial: d.historial || [],
    };
  }

  /* Códigos que quedaron asignados a algún ítem físico, por base. Un material que
     fue agrupado deja de ser candidato a baja: alguien lo identificó. */
  var CACHE_ASIG = null;
  function invalidar() { CACHE_ASIG = null; }
  function asignados() {
    if (CACHE_ASIG) return CACHE_ASIG;
    var m = {};
    D.casos.forEach(function (c) {
      if (c.origen !== "Inventario físico") return;
      var e = efectivo(c);
      if (e.aprobacion === "Sin decidir" || e.aprobacion === "Rechazado") return;
      e.materiales.forEach(function (x) { (m[c.base] = m[c.base] || {})[x] = c.id; });
    });
    CACHE_ASIG = m;
    return m;
  }
  /* Un candidato a baja que quedó identificado por una agrupación posterior. */
  function resueltoPorAgrupacion(c) {
    if (L(c) !== "C" || !c.material_sap) return null;
    var a = asignados()[c.base];
    return a && a[c.material_sap] ? a[c.material_sap] : null;
  }
  function grupos() {
    var g = [];
    D.casos.forEach(function (c) {
      var e = efectivo(c);
      if (e.materiales.length > 1) {
        g.push({ caso: c, nombre: e.unificada || c.nombre_fisico,
                 materiales: e.materiales, base: c.base, revisor: e.revisor });
      }
    });
    return g;
  }
  function pendiente(c) { return efectivo(c).aprobacion === "Sin decidir"; }
  /* La clase B se cierra en dos tiempos: primero se elige la alternativa, y si se eligió
     verificar el maestro, después se registra el resultado de esa verificación. Mientras
     falte cualquiera de los dos pasos el caso sigue pendiente. */
  function pendienteAlta(c) {
    var e = efectivo(c);
    if (e.aprobacion === "Rechazado") return false;
    if (!e.ruta_b) return true;
    if (e.ruta_b === RB_VERIF && !e.verificacion) return true;
    return false;
  }
  function etapaB(c) {
    var e = efectivo(c);
    if (!e.ruta_b) return "ruta";
    if (e.ruta_b === RB_VERIF && !e.verificacion) return "verificacion";
    return "cerrado";
  }
  /* Cada cola decide a su manera qué cuenta como pendiente. */
  function pendienteCola(c, q) {
    if (q && q.esAlmacen) return almacenPendiente(c);
    if (q && q.id === "altas") return pendienteAlta(c);
    return pendiente(c);
  }
  function deCola(id) {
    var q = COLAS.filter(function (x) { return x.id === id; })[0];
    return D.casos.filter(q.pred);
  }
  function colaPor(id) { return COLAS.filter(function (x) { return x.id === id; })[0]; }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function num(n, d0) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toLocaleString("es-AR",
      { minimumFractionDigits: d0 || 0, maximumFractionDigits: d0 || 0 });
  }
  function pesos(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "$ " + Number(n).toLocaleString("es-AR",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fecha(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("es-AR") + " " +
           d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }
  function conteos(lista) {
    var r = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    lista.forEach(function (c) { r[L(c)]++; });
    return r;
  }
  /* Tarjeta de indicador. Es un botón: filtra el listado por ese estado. */
  function kpi(color, titulo, n, det, accion) {
    return '<button class="kpi ' + color + '" data-alm="' + esc(accion) + '">' +
      '<div class="t"><i class="pt" style="background:var(--c' + color + ')"></i>' +
      esc(titulo) + '</div><div class="n">' + num(n) + '</div><div class="d">' +
      esc(det) + "</div></button>";
  }
  function barraProgreso(hechos, total, color) {
    var p = total ? Math.round(hechos / total * 100) : 100;
    return '<div class="prog"><div class="pbar"><i style="width:' + p + "%;background:var(--c" +
      (color || "A") + ')"></i></div><span>' + num(hechos) + " de " + num(total) +
      " · " + p + "%</span></div>";
  }

  // ------------------------------------------------------------- navegación
  var VISTAS = ["inicio", "revisar", "casos", "ficha", "depurar", "informe", "ayuda"];
  function ir(vista, arg) {
    estado.vista = vista;
    VISTAS.forEach(function (v) {
      document.getElementById("v-" + v).classList.toggle("oculto", v !== vista);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      if (b.dataset.vista === vista) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (vista === "inicio") pintarInicio();
    if (vista === "revisar") pintarTriage();
    if (vista === "casos") pintarCasos();
    if (vista === "ficha") { if (arg) estado.fichaId = arg; pintarFicha(); }
    if (vista === "depurar") pintarDepurar();
    if (vista === "informe") document.getElementById("v-informe").innerHTML = Exportar.informeHtml();
    if (vista === "ayuda") pintarAyuda();
    window.scrollTo(0, 0);
  }

  function abrirCola(id, motivo) {
    var q = colaPor(id);
    estado.cola = id; estado.motivo = motivo || null;
    estado.triage = deCola(id).filter(function (c) {
      return pendienteCola(c, q) && (!motivo || c.motivo === motivo);
    });
    estado.tIdx = 0; estado.selCand = {}; estado.unif = "";
    if (!estado.triage.length) { aviso("No quedan casos pendientes en este grupo."); return; }
    ir("revisar");
  }
  function verListado(id, motivo) {
    limpiarFiltros(); estado.sel = {};
    var q = colaPor(id);
    estado.filtros.clase = { revision: "D", altas: "B", identificados: "A",
                             existencias: "A", bajas: "C" }[id];
    if (motivo) estado.filtros.motivo = motivo;
    if (id === "existencias") estado.filtros.grupo = "existencias";
    if (id === "identificados") estado.filtros.grupo = "identificados";
    estado.pagina = 1; ir("casos");
  }
  function limpiarFiltros() {
    estado.filtros = { base: "", tipo: "", clase: "", revision: "", aprobacion: "",
                       motivo: "", valorizacion: "", obs: "", texto: "", grupo: "",
                       almacen: "", almacen_estado: "" };
  }

  // ------------------------------------------------------------- INICIO
  function pintarInicio() {
    var decidibles = D.casos.filter(function (c) { return L(c) !== "E"; });
    var hechos = decidibles.filter(function (c) { return !pendiente(c); }).length;
    var k = D.kpis;

    var h = '<div class="cabi"><div><h1>¿Por dónde empezar?</h1>' +
      '<p class="sub">' + num(k.items_fisicos) + ' ítems contados en las tres bases, cruzados ' +
      'contra SAP. Abajo está el trabajo ordenado por prioridad: empezá por el grupo 1.</p></div>' +
      '<div class="globo">' + '<div class="k">Avance general</div><div class="n">' +
      (decidibles.length ? Math.round(hechos / decidibles.length * 100) : 0) + "%</div>" +
      '<div class="d">' + num(hechos) + " de " + num(decidibles.length) + " resueltos</div>" +
      '<div class="pbar grande"><i style="width:' +
      (decidibles.length ? hechos / decidibles.length * 100 : 0) + '%"></i></div></div></div>';

    h += '<div class="colas">';
    COLAS.forEach(function (q, i) {
      var todos = deCola(q.id);
      var pend = todos.filter(function (c) { return pendienteCola(c, q); });
      var listo = pend.length === 0;
      h += '<div class="cola' + (listo ? " listo" : "") + '" style="--cc:var(--c' + q.color + ')">' +
        '<div class="cnum">' + (listo ? "✓" : i + 1) + "</div>" +
        '<div class="ccuerpo"><div class="ctit">' + esc(q.titulo) +
        (listo ? ' <span class="chip-ok">terminado</span>' : "") + "</div>" +
        '<div class="cdesc">' + esc(q.desc) + "</div>";

      if (q.porMotivo && !listo) {
        var porM = {};
        pend.forEach(function (c) { porM[c.motivo] = (porM[c.motivo] || 0) + 1; });
        h += '<div class="submotivos">' + Object.keys(porM).sort(function (a, b) {
          return porM[a] - porM[b];      // primero los grupos chicos: se cierran rápido
        }).map(function (mo) {
          return '<button class="submot" data-cola="' + q.id + '" data-motivo="' + esc(mo) +
            '"><b>' + num(porM[mo]) + "</b> " + esc(mo) + "</button>";
        }).join("") + "</div>";
      }

      if (q.id === "altas") {
        var et = { ruta: 0, verificacion: 0, cerrado: 0 }, rb = { v: 0, c: 0, no: 0 };
        todos.forEach(function (c) {
          et[etapaB(c)]++;
          var ee = efectivo(c);
          if (ee.aprobacion === "Rechazado") rb.no++;
          else if (ee.ruta_b === RB_CREAR) rb.c++;
          else if (ee.ruta_b === RB_VERIF) rb.v++;
        });
        h += '<div class="paso2">' +
          '<span class="p2 a">Sin alternativa elegida <b>' + num(et.ruta) + "</b></span>" +
          '<span class="p2 b">Alternativa 1 · esperando el maestro <b>' + num(et.verificacion) + "</b></span>" +
          '<span class="p2 c">Alternativa 2 · crear sin verificar <b>' + num(rb.c) + "</b></span>" +
          '<span class="p2 d">Verificados y cerrados <b>' +
          num(Math.max(0, et.cerrado - rb.c - rb.no)) + "</b></span>" +
          '<span class="p2 e">No se dan de alta <b>' + num(rb.no) + "</b></span></div>";
        if (rb.c) h += '<div class="cnota">⚠ ' + num(rb.c) + (rb.c === 1
          ? " material se crea sin verificar el maestro: hay riesgo de código duplicado."
          : " materiales se crean sin verificar el maestro: hay riesgo de código duplicado.") +
          " Quedan ligados al plan de depuración.</div>";
      }

      if (q.id === "bajas" && !listo) {
        var bloq = pend.filter(function (c) { return c.bloqueado_por_revision; }).length;
        if (bloq) h += '<div class="cnota">⚠ ' + num(bloq) + " de estas bajas dependen de un " +
          "caso del grupo 1. Conviene resolver esos primero: pueden dejar de ser bajas.</div>";
      }
      h += "</div>";

      h += '<div class="cacc">' + (listo
        ? '<div class="cpend ok">' + num(todos.length) + "<small>resueltos</small></div>"
        : '<div class="cpend">' + num(pend.length) + "<small>pendientes</small></div>") +
        (q.id === "depurar"
          ? '<button class="btn pri" data-dep="1">Abrir la depuración</button>'
          : listo ? "" :
            '<button class="btn pri" data-rev="' + q.id + '">Revisar de a uno</button>' +
            (q.lote ? '<button class="btn" data-lote="' + q.id + '">' +
             (q.id === "altas" ? "Elegir alternativa en lote" : "Decidir en lote") +
             "</button>" : "")) +
        '<button class="btn chico" data-lista="' + q.id + '">Ver listado</button></div>';
      h += barraProgreso(todos.length - pend.length, todos.length, q.color);
      h += "</div>";
    });
    h += "</div>";

    h += '<div class="cola apagada"><div class="cnum">—</div><div class="ccuerpo">' +
      '<div class="ctit">Sin acción: ' + num(k.fuera_alcance) + ' materiales fuera del alcance</div>' +
      '<div class="cdesc">Indumentaria, equipamiento y repuestos. El inventario relevado es de ' +
      'Farmacia, así que nunca iban a aparecer: su ausencia no prueba nada y no se propone ' +
      'ninguna baja.</div></div><div class="cacc">' +
      '<button class="btn chico" data-lista="fuera">Ver listado</button></div></div>';

    var gs = grupos();
    var liberadas = D.casos.filter(function (c) { return resueltoPorAgrupacion(c); }).length;
    if (gs.length || liberadas) {
      h += '<h2>Nomenclaturas unificadas</h2><div class="panelito">';
      h += '<p class="pnota">Cuando un mismo producto está abierto en varios códigos de SAP, ' +
        "se los agrupa bajo la nomenclatura del inventario físico. Los códigos agrupados " +
        "dejan de ser candidatos a baja.</p>";
      if (liberadas) h += '<div class="cnota ok">✓ ' + num(liberadas) +
        (liberadas === 1 ? " candidato a baja quedó resuelto" : " candidatos a baja quedaron resueltos") +
        " por una agrupación.</div>";
      if (gs.length) {
        h += '<table class="listalotes"><thead><tr><th>Nomenclatura unificada</th>' +
          "<th>Base</th><th>Códigos SAP</th><th>Quién</th></tr></thead><tbody>" +
          gs.map(function (g) {
            return "<tr><td><b>" + esc(g.nombre) + "</b></td><td>" + esc(g.base) + "</td><td>" +
              g.materiales.map(esc).join(" · ") + "</td><td>" + esc(g.revisor) + "</td></tr>";
          }).join("") + "</tbody></table>";
      }
      h += "</div>";
    }

    // ---- ubicación del stock
    var al = D.kpis.almacen || {};
    h += '<h2>Ubicación del stock en los almacenes</h2>';
    h += '<p class="pnota" style="max-width:90ch">Una cosa es que el material esté bien ' +
      '<b>identificado</b>, otra que tenga <b>stock</b>, y otra que ese stock esté en el ' +
      '<b>almacén que corresponde</b>. Son tres cuestiones independientes: un material puede ' +
      'estar perfectamente identificado y aun así figurar en el almacén equivocado. Eso no lo ' +
      'convierte en candidato a alta ni a baja.</p>';
    h += '<div class="kpis">' +
      kpi("A", "Ubicación correcta", al[AL_OK] || 0, "en el almacén propuesto", AL_OK) +
      kpi("C", "Ubicación a cambiar", al[AL_CAMB] || 0, "figuran en otro almacén", AL_CAMB) +
      kpi("D", "En varios almacenes", al[AL_MULT] || 0, "mismo material repartido", AL_MULT) +
      kpi("E", "Pendiente de validar", (al[AL_VAL] || 0) + (al[AL_NOID] || 0),
          "falta definir el almacén esperado", AL_VAL) +
      "</div>";
    h += '<div class="aviso info" style="margin-top:12px"><b>La correspondencia almacén→base ' +
      'está observada; el almacén esperado es una propuesta.</b>' +
      'En la bajada, cada código de almacén aparece bajo un único centro: saber a qué base ' +
      'pertenece cada almacén <b>no es una suposición</b>. Lo que no está en los archivos es ' +
      'qué almacén <i>debería</i> tener el stock de farmacia. Eso se propuso a partir de la ' +
      'composición observada de cada almacén y <b>hay que validarlo</b>. Tampoco viene la ' +
      'descripción de los almacenes, sólo el código.</div>';
    h += '<div class="panelito" style="margin-top:12px"><table><thead><tr>' +
      '<th>Base</th><th>Tipo</th><th>Almacén propuesto</th><th>Confianza</th>' +
      '<th>Otros almacenes de la base con stock de ese tipo</th></tr></thead><tbody>' +
      (D.meta.almacenes.propuesta || []).map(function (p) {
        var otros = (p.alternativas || []).filter(function (a) { return a.almacen !== p.almacen; });
        return "<tr><td>" + esc(p.base) + "</td><td>" + esc(p.tipo) + "</td>" +
          "<td><b>" + esc(p.almacen || "—") + "</b></td>" +
          '<td><span class="estado ' + (p.confianza === "Clara" ? "ap" : "re") + '">' +
          esc(p.confianza) + "</span>" +
          (p.nota ? '<div class="mini">' + esc(p.nota) + "</div>" : "") + "</td>" +
          '<td class="mini">' + (otros.length
            ? otros.map(function (a) { return esc(a.almacen) + " (" + num(a.unidades) + " un.)"; }).join(" · ")
            : "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<p class="pnota" style="margin:12px 0 0"><b>Falta para cerrar esta parte:</b> ' +
      (D.meta.almacenes.falta || []).map(esc).join(" · ") + ".</p></div>";

    h += '<h2>Antes de cerrar, dos cosas</h2>';
    h += '<div class="aviso"><b>No hay precio de última compra en los archivos recibidos.</b>' +
      'Se revisaron la bajada de SAP (tiene valor de stock, no precio de compra), la ' +
      'homologación (declara que los costos quedan fuera) y los tres PDF de inventario ' +
      '(ninguna mención de precio). Por eso no se informa ninguna valorización. El sistema ' +
      'la calcula sola apenas se cargue el dato.</div>';
    h += '<div class="aviso"><b>La bajada de SAP son los materiales CON STOCK, no el maestro completo.</b>' +
      "Un material dado de alta en SAP con existencia cero no figura en el archivo. Por eso los " +
      num(k.pendientes_alta) + " ítems del grupo 2 <b>no son altas confirmadas</b>: son ítems " +
      "que no aparecieron entre los que tienen stock. Verificar si ya existen en el maestro —y, " +
      "si existen, decidir si se reutiliza el código o se da de baja y se crea de nuevo— " +
      "<b>está fuera del alcance de este trabajo</b> y es el paso previo al alta.</div>";
    h += '<div class="aviso info"><b>Nada de esto modifica SAP.</b>' +
      'Aprobar un alta o una baja deja registrada una propuesta con tu nombre y la fecha. ' +
      'La ejecución es un paso posterior, fuera de esta herramienta.</div>';

    var el = document.getElementById("v-inicio");
    el.innerHTML = h;
    el.querySelectorAll("[data-alm]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!b.dataset.alm) return;
        limpiarFiltros(); estado.filtros.almacen_estado = b.dataset.alm;
        estado.pagina = 1; ir("casos"); }); });
    el.querySelectorAll("[data-rev]").forEach(function (b) {
      b.addEventListener("click", function () { abrirCola(b.dataset.rev); }); });
    el.querySelectorAll("[data-dep]").forEach(function (b) {
      b.addEventListener("click", function () { ir("depurar"); }); });
    el.querySelectorAll("[data-lote]").forEach(function (b) {
      b.addEventListener("click", function () { abrirLote(b.dataset.lote); }); });
    el.querySelectorAll("[data-lista]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.lista === "fuera") { limpiarFiltros(); estado.filtros.clase = "E";
          estado.pagina = 1; return ir("casos"); }
        verListado(b.dataset.lista); }); });
    el.querySelectorAll(".submot").forEach(function (b) {
      b.addEventListener("click", function () { abrirCola(b.dataset.cola, b.dataset.motivo); }); });
  }

  // ------------------------------------------------------------- MODO REVISIÓN
  function pintarTriage() {
    var el = document.getElementById("v-revisar");
    if (!estado.cola || !estado.triage.length) {
      el.innerHTML = '<div class="finito"><div class="ficono">✓</div>' +
        "<h1>No queda nada pendiente en este grupo</h1>" +
        '<p class="sub">Volvé al inicio para seguir con el siguiente.</p>' +
        '<button class="btn pri" id="bInicio">Volver al inicio</button></div>';
      el.querySelector("#bInicio").addEventListener("click", function () { ir("inicio"); });
      return;
    }
    if (estado.tIdx >= estado.triage.length) {
      var q0 = colaPor(estado.cola);
      el.innerHTML = '<div class="finito"><div class="ficono">✓</div>' +
        "<h1>Terminaste esta tanda</h1>" +
        '<p class="sub">Revisaste ' + num(estado.triage.length) + " casos de «" +
        esc(q0.titulo) + '».</p>' +
        '<button class="btn pri" id="bInicio">Volver al inicio</button> ' +
        '<button class="btn" id="bMas">Ver si quedaron pendientes</button></div>';
      el.querySelector("#bInicio").addEventListener("click", function () { ir("inicio"); });
      el.querySelector("#bMas").addEventListener("click", function () {
        abrirCola(estado.cola, estado.motivo); });
      return;
    }

    var c = estado.triage[estado.tIdx], e = efectivo(c), q = colaPor(estado.cola);
    var cant = c.origen === "Inventario físico" ? c.cantidad_fisica : c.stock_sap;

    var h = '<div class="tbarra">' +
      '<button class="btn chico" id="tSalir">← Inicio</button>' +
      '<div class="tprog"><b>' + esc(q.titulo) + (estado.motivo ? " · " + esc(estado.motivo) : "") +
      "</b><div class=\"pbar\"><i style=\"width:" +
      (estado.tIdx / estado.triage.length * 100) + '%;background:var(--c' + q.color + ')"></i></div>' +
      "<span>caso " + (estado.tIdx + 1) + " de " + num(estado.triage.length) + "</span></div>" +
      '<button class="btn chico" id="tSaltar">Saltear →</button></div>';

    h += '<div class="tcaso" id="tFoco" tabindex="-1">';

    // ======== lo que hay en el depósito
    h += '<section class="sist fis"><header class="sh">' +
      '<span class="sico">◉</span><div><b>Lo que hay en el depósito</b>' +
      '<small>' + esc(c.sistema_origen) + " · " + esc(c.base) + " · centro " + esc(c.centro) +
      "</small></div></header><div class=\"sb\">";
    h += '<div class="snom">' + esc(c.nombre_fisico || "—") + "</div>";
    h += '<div class="sdatos">' +
      dato("Cantidad contada", c.origen === "Inventario físico" ? num(cant) + " unidades" : "—") +
      dato("Código en el inventario", c.codigo_fisico || "—") +
      dato("Presentación que declara", c.presentacion || "no declara características") +
      dato("Lotes", c.lotes && c.lotes.length
           ? num(c.lotes.length) + (c.lotes.length === 1 ? " renglón" : " renglones") : "—") +
      "</div></div></section>";

    // ======== lo que hoy tiene stock en SAP
    var limpios = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });
    var sucios = (c.candidatos || []).filter(function (x) { return x.conflictos.length; });
    var nSel = Object.keys(estado.selCand).length;

    h += '<section class="sist sap"><header class="sh">' +
      '<span class="sico">▣</span><div><b>Lo que hoy tiene stock en SAP</b>' +
      "<small>bajada al 02/10 · no es el maestro completo · " +
      (limpios.length ? num(limpios.length) + (limpios.length === 1 ? " candidato" : " candidatos")
       : "ningún candidato compatible") + "</small></div></header><div class=\"sb\">";

    if (limpios.length) {
      h += '<p class="shint">Marcá el o los códigos que son este mismo producto. ' +
        "Si SAP lo tiene abierto en más de un código, marcalos todos.</p>";
      h += '<div class="cands">';
      limpios.forEach(function (x, i) {
        var m = estado.selCand[x.material];
        h += '<button class="cand' + (m ? " marcado" : "") + '" data-mat="' + esc(x.material) + '">' +
          '<span class="cmarca">' + (m ? "✓" : "") + "</span>" +
          '<span class="ckey">' + (i + 1) + "</span>" +
          '<span class="ctxt"><b>' + esc(x.material) + "</b> " + esc(x.texto) +
          (x.presentacion ? '<span class="cpres">' + esc(x.presentacion) + "</span>" : "") +
          "</span></button>";
      });
      h += "</div>";
    } else {
      h += '<p class="svacio">Ningún material <b>con stock</b> en SAP es compatible con este ' +
        "ítem. Los que se parecían por el nombre quedaron descartados por diferencias de " +
        "presentación.<br><br><b>Esto no significa que no exista en SAP.</b> La bajada " +
        "disponible trae sólo los materiales con existencia, así que el material puede estar " +
        "dado de alta con stock cero. Verificarlo contra el maestro completo queda fuera del " +
        "alcance de este trabajo.</p>";
    }
    if (sucios.length) {
      h += '<div class="descart"><b>Descartados por diferencia de presentación</b>' +
        sucios.slice(0, 4).map(function (x) {
          return '<div><span class="dcod">' + esc(x.material) + "</span> " + esc(x.texto) +
            ' <span class="dmot">difiere en ' + esc(x.conflictos.join(", ")) + "</span></div>";
        }).join("") + "</div>";
    }
    h += "</div></section>";

    // ======== comparación característica por característica
    var refCand = limpios.length
      ? (nSel ? limpios.filter(function (x) { return estado.selCand[x.material]; })[0] || limpios[0]
         : limpios[0])
      : (sucios[0] || null);
    if (refCand && refCand.detalle && refCand.detalle.length) {
      h += '<section class="comp"><header class="ch">Comparación característica por ' +
        "característica <small>depósito frente a <b>" + esc(refCand.material) + "</b> «" +
        esc(refCand.texto) + "»</small></header>";
      h += '<table class="tcomp"><thead><tr><th>Característica</th>' +
        "<th>Dice el depósito</th><th>Dice SAP</th><th>Para decidir</th></tr></thead><tbody>";
      refCand.detalle.forEach(function (d) {
        var txt = { coincide: "Confirma", difiere: "Contradice",
                    solo_fisico: "SAP no lo dice", solo_sap: "El depósito no lo dice",
                    incomparable: "No son comparables" }[d.estado];
        h += '<tr class="e-' + d.estado + '"><td>' + esc(d.nombre) + "</td>" +
          "<td>" + esc(d.fisico || "—") + "</td><td>" + esc(d.sap || "—") + "</td>" +
          '<td><span class="marcaest">' + esc(txt) + "</span></td></tr>";
      });
      h += "</tbody></table>";
      h += '<p class="cpie"><b>Por qué el análisis no lo cerró solo:</b> ' +
        esc(c.justificacion) + "</p></section>";
    }

    // ======== decidir
    h += '<section class="decidir">';
    if (estado.cola === "altas") h += panelB(c, e);
    if (q.esAlmacen) h += panelAlmacen(c, e);
    if (limpios.length) {
      h += '<div class="confbar' + (nSel ? " activa" : "") + '">';
      if (!nSel) {
        h += '<span class="cbhint">Marcá arriba con <kbd>1</kbd>…<kbd>' +
          Math.min(limpios.length, 9) + "</kbd> o con el mouse, y confirmá con <kbd>Enter</kbd>.</span>";
      } else if (nSel === 1) {
        h += '<span class="cbtxt">Este ítem del depósito queda identificado con <b>' +
          esc(Object.keys(estado.selCand)[0]) + "</b> en SAP.</span>" +
          '<button class="btn pri" data-acc="confirmar">Confirmar <kbd>Enter</kbd></button>';
      } else {
        h += '<div class="cbgrupo"><div class="cbtxt"><b>' + nSel +
          " códigos marcados.</b> SAP tiene este producto abierto en varios códigos: " +
          "se agrupan bajo la nomenclatura del depósito.</div>" +
          '<input type="text" id="unifNom" class="cod" value="' +
          esc(estado.unif || c.nombre_fisico || "") + '" placeholder="nomenclatura unificada">' +
          '<div class="cbchips">' + Object.keys(estado.selCand).map(function (m) {
            return '<span class="cbchip">' + esc(m) + "</span>"; }).join("") + "</div></div>" +
          '<button class="btn pri" data-acc="confirmar">Agrupar los ' + nSel +
          " <kbd>Enter</kbd></button>";
      }
      h += "</div>";
    }
    h += '<div class="otras"><div class="oizq"><span class="k">' +
      (estado.cola === "altas" ? "Otra salida"
       : q.esAlmacen ? "Si no lo podés resolver ahora" : "Si ninguno corresponde") + "</span>" +
      '<div class="tacc">';
    if (q.esAlmacen) {
      h += bot("gris", "x", "No puedo decidirlo ahora", "X");
    } else if (estado.cola === "revision") {
      h += bot("ok", "n", "Ninguno corresponde · verificar en el maestro", "N");
      h += bot("gris", "x", "No puedo decidirlo ahora", "X");
    } else if (estado.cola === "altas") {
      h += bot("no", "r", "No corresponde darlo de alta", "R");
    } else if (estado.cola === "bajas") {
      h += bot("ok", "a", "Aprobar la baja", "A") +
           bot("no", "r", "Rechazar · el material se usa", "R");
    } else if (estado.cola === "existencias") {
      h += bot("ok", "a", "Registrar la existencia", "A") + bot("no", "r", "No corresponde", "R");
    } else {
      h += bot("ok", "a", "Confirmar la identificación", "A") +
           bot("no", "r", "No corresponde", "R");
    }
    h += bot("gris", "s", "Saltear", "→");
    h += "</div></div>";
    h += '<div class="oder"><span class="k">Observación (opcional)</span>' +
      '<textarea id="tObs" placeholder="Por qué se decide esto…">' + esc(e.observaciones) + "</textarea>" +
      '<div class="tatajos"><b>Atajos</b><div><kbd>1</kbd>…<kbd>9</kbd> marcar · ' +
      "<kbd>Enter</kbd> confirmar · <kbd>A</kbd> aprobar · <kbd>R</kbd> rechazar · " +
      "<kbd>N</kbd> ninguno · <kbd>X</kbd> no puedo · <kbd>→</kbd> saltear · " +
      "<kbd>F</kbd> ficha</div></div>" +
      '<button class="btn chico" id="tFicha">Ver la ficha completa</button></div></section>';

    if (c.bloqueado_por_revision) {
      h += '<div class="cnota" style="grid-column:1/-1">⚠ Este material figura como posible ' +
        "equivalencia de un ítem todavía en revisión. Si ese caso se resuelve a favor, esta " +
        "baja sería un error.</div>";
    }
    h += "</div>";

    el.innerHTML = h;
    // Toma el foco para que los atajos de teclado funcionen apenas se entra,
    // sin obligar a hacer clic primero en ningún lado.
    var foco = el.querySelector("#tFoco");
    if (foco) foco.focus({ preventScroll: true });
    el.querySelector("#tSalir").addEventListener("click", function () { ir("inicio"); });
    el.querySelector("#tSaltar").addEventListener("click", function () { avanzar(); });
    el.querySelector("#tFicha").addEventListener("click", function () {
      estado.volverA = "revisar"; ir("ficha", c.id); });
    el.querySelectorAll(".cand").forEach(function (b) {
      b.addEventListener("click", function () { marcar(c, b.dataset.mat); }); });
    var un = el.querySelector("#unifNom");
    if (un) un.addEventListener("input", function () { estado.unif = un.value; });
    el.querySelectorAll("[data-acc]").forEach(function (b) {
      b.addEventListener("click", function () { accionTriage(c, b.dataset.acc); }); });
  }
  /* ---- Clase B · las dos alternativas ------------------------------------
     El sistema no elige por el usuario ni le impide crear: le hace la pregunta,
     le explica el riesgo del código duplicado y registra qué se decidió. */
  function panelB(c, e) {
    var et = etapaB(c);
    var h = '<div class="rutas">';
    if (et === "ruta") {
      h += '<div class="rpreg"><b>¿Cómo querés trabajar este caso?</b> El ítem está en el ' +
        "depósito y no aparece entre los materiales que <b>hoy tienen stock</b> en SAP. Eso " +
        "no prueba que no exista: la bajada no es el maestro completo. Hay que elegir " +
        "expresamente una de las dos alternativas.</div>";
      h += '<div class="rgrid">';
      h += '<div class="ruta r1"><div class="rtit"><span class="rnum">1</span>' +
        "Verificar antes de crear</div>" +
        '<p class="rtxt">Primero se consulta el maestro completo de SAP para ver si el ' +
        "material ya existe con existencia cero. Recién con esa respuesta se decide: crear, " +
        "reutilizar el código que ya está, o darlo de baja y crearlo de nuevo.</p>" +
        '<ul class="rlista"><li>Es el camino que <b>evita el código duplicado</b>.</li>' +
        "<li>Necesita el maestro completo, que <b>no tenemos en los archivos recibidos</b>: " +
        "la consulta queda como tarea pendiente fuera de esta herramienta.</li>" +
        "<li>El caso queda abierto hasta que cargues el resultado.</li></ul>" +
        '<button class="btn pri grande" data-acc="b1"><span>Elegir la alternativa 1</span>' +
        "<kbd>1</kbd></button></div>";
      h += '<div class="ruta r2"><div class="rtit"><span class="rnum">2</span>' +
        "Crear el material igual, sin verificar</div>" +
        '<p class="rtxt">Se decide avanzar con el alta aunque el maestro completo no se haya ' +
        "verificado. El sistema <b>no lo impide</b>: pregunta expresamente, deja registrado " +
        "quién lo decidió y cuándo, y liga el caso a la depuración del maestro.</p>" +
        '<div class="rriesgo"><b>Riesgo que se asume</b>Si el material ya existe en SAP con ' +
        "stock cero, queda un <b>código duplicado</b>: dos códigos para el mismo producto, " +
        "con el stock, los consumos y el histórico partidos entre los dos. El código viejo " +
        "sigue vivo salvo que se lo depure.</div>" +
        '<button class="btn grande" data-acc="b2"><span>Elegir la alternativa 2</span>' +
        "<kbd>2</kbd></button></div>";
      h += "</div>";
    } else if (et === "verificacion") {
      h += '<div class="rok">✓ <b>Alternativa 1 elegida</b> · ' + esc(e.revisor || "sin identificar") +
        (e.actualizado ? " · " + esc(fecha(e.actualizado)) : "") +
        ". Falta el resultado de la consulta al maestro completo.</div>";
      h += '<div class="rres"><span class="k">¿Qué dijo el maestro completo de SAP?</span>' +
        '<div class="tacc">' +
        bot("ok", "v1", "No existe · proponer el alta", "1") +
        bot("", "v2", "Existe sin stock · reutilizar ese código", "2") +
        bot("", "v3", "Existe sin stock · baja y alta nueva", "3") +
        "</div>" +
        '<input type="text" id="codMaestro" class="cod" value="' + esc(e.codigo_maestro) +
        '" placeholder="código del maestro, si lo encontraste">' +
        '<p class="rnota">Si todavía no pudiste consultarlo, salteá el caso: queda pendiente. ' +
        'También podés <button class="enlace" data-acc="b2">pasar a la alternativa 2</button> ' +
        "y crear el material sin verificar, asumiendo el riesgo.</p></div>";
    }
    h += "</div>";
    return h;
  }

  /* Pregunta expresa antes de crear sin verificar. No se puede confirmar sin marcar
     que se entiende el riesgo: la decisión queda registrada con nombre y fecha. */
  function modalCrearSinVerificar(casos, alVolver) {
    var uno = casos.length === 1;
    var h = '<div class="modalfondo"><div class="modal">' +
      "<h2>Crear " + (uno ? "este material" : num(casos.length) + " materiales") +
      " sin verificar el maestro</h2>" +
      '<p class="sub">Esta es la <b>alternativa 2</b>. El sistema no te lo impide, pero te lo ' +
      "pregunta expresamente porque tiene una consecuencia concreta.</p>";
    if (uno) h += '<div class="mcaso"><b>' + esc(casos[0].nombre_fisico) + "</b>" +
      '<span class="mini">' + esc(casos[0].base) + " · " + esc(casos[0].tipo) +
      (casos[0].codigo_fisico ? " · " + esc(casos[0].codigo_fisico) : "") + "</span></div>";
    h += '<div class="rriesgo grande"><b>El riesgo que estás asumiendo</b>' +
      "No verificamos el maestro completo de SAP, así que <b>no sabemos si este material ya " +
      "existe con stock cero</b>. Si existe y se crea uno nuevo, queda un <b>código " +
      "duplicado</b>: el mismo producto abierto dos veces, con el stock, los consumos, los " +
      "precios y el histórico partidos entre los dos códigos. El código viejo no desaparece " +
      "solo: sigue vivo en el maestro hasta que alguien lo depure.</div>";
    h += '<label class="chk1"><input type="checkbox" id="mkRiesgo"> ' +
      "<span>Entiendo el riesgo de generar un código duplicado y decido crear el material " +
      "igual, sin verificar el maestro completo.</span></label>";
    h += '<label class="chk1"><input type="checkbox" id="mkDep" checked> ' +
      "<span>Sumar " + (uno ? "este material" : "estos materiales") + " al <b>plan de " +
      "depuración del maestro</b>, para buscar y limpiar el código viejo si aparece. " +
      "Es la contracara de esta decisión: si se duplica, hay que depurar.</span></label>";
    h += '<label class="k" style="display:block;margin-top:14px">Por qué se decide así ' +
      "(queda en el registro)</label>" +
      '<textarea id="mObs" placeholder="Ej.: el producto se usa a diario y no podemos esperar el relevamiento del maestro…"></textarea>';
    h += '<div class="modalacc"><span class="mini">No modifica SAP: queda como propuesta ' +
      "con tu nombre y la fecha.</span>" +
      '<button class="btn" id="mCancel">Cancelar</button>' +
      '<button class="btn pri" id="mOk" disabled>Sí, crear sin verificar</button></div>';
    h += "</div></div>";
    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");
    var mk = modal.querySelector("#mkRiesgo"), ok = modal.querySelector("#mOk");
    mk.addEventListener("change", function () { ok.disabled = !mk.checked; });
    function cerrar() { modal.remove(); }
    modal.querySelector("#mCancel").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });
    ok.addEventListener("click", function () {
      var obs = modal.querySelector("#mObs").value.trim();
      var dep = modal.querySelector("#mkDep").checked;
      casos.forEach(function (c) {
        var cam = { ruta_b: RB_CREAR, riesgo_duplicado: "Asumido expresamente",
                    aprobacion: "Aprobado", estado_revision: "Revisado",
                    depuracion: dep ? "Ligado al plan de depuración" : null };
        if (obs) cam.observaciones = obs;
        decidir(c.id, cam, "Alternativa 2 · se decide crear el material sin verificar el " +
                "maestro completo, asumiendo expresamente el riesgo de código duplicado" +
                (dep ? ", ligado al plan de depuración del maestro" : ""));
      });
      cerrar();
      aviso(casos.length === 1 ? "Registrado: crear sin verificar, con el riesgo asumido."
            : num(casos.length) + " casos registrados con el riesgo asumido.");
      if (alVolver) alVolver();
    });
  }

  /* ---- Ubicación --------------------------------------------------------
     Decidir la ubicación no es decidir la identificación. Acá no se toca el
     código SAP: se decide en qué almacén tiene que estar el stock. */
  function panelAlmacen(c, e) {
    var esp = c.almacen_esperado, ubic = c.almacenes || [];
    var actual = ubic.length === 1 ? ubic[0].almacen : null;
    var total = ubic.reduce(function (s, x) { return s + (x.stock || 0); }, 0);
    var h = '<div class="rutas"><div class="rpreg"><b>Esto es un problema de ubicación, no ' +
      "de identificación.</b> El material está bien identificado: lo que no coincide es el " +
      "<b>almacén</b> donde SAP registra su stock dentro del centro " + esc(c.centro || "—") +
      ". Decidir acá no cambia el código SAP.</div>";
    h += '<div class="alcomp"><div class="alcol"><span class="k">Dónde está hoy</span>' +
      '<table class="listalotes"><tbody>' + ubic.map(function (x) {
        return "<tr><td><b>" + esc(x.almacen) + "</b></td>" +
          '<td class="num">' + num(x.stock) + " un.</td>" +
          "<td>" + (x.almacen === esp ? '<span class="estado ap">es el propuesto</span>'
                    : '<span class="estado re">no es el propuesto</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    h += '<div class="alcol"><span class="k">Dónde debería estar</span>' +
      '<div class="alesp"><b>' + esc(esp || "sin definir") + "</b>" +
      '<span class="mini">propuesta para ' + esc(c.base) + " · " + esc(c.tipo) +
      ", a validar con la base</span></div></div></div>";
    h += '<div class="rres"><span class="k">¿Qué se hace?</span><div class="tacc">' +
      (esp && actual !== esp
        ? bot("ok", "al1", "Mover el stock al almacén " + esp, "1") : "") +
      (actual ? bot("", "al2", "El almacén " + actual + " es el correcto · corregir la propuesta", "2") : "") +
      (ubic.length > 1 ? bot("", "al3", "Consolidar en un solo almacén", "3") : "") +
      bot("", "al4", "Lo valida el responsable de la base", "4") +
      "</div>";
    if (ubic.length > 1) {
      h += '<div class="alsel"><span class="k">Si se consolida, ¿en cuál?</span>' +
        '<select id="almDest">' +
        (esp && !ubic.some(function (x) { return x.almacen === esp; })
          ? '<option value="' + esc(esp) + '">' + esc(esp) + " · el propuesto</option>" : "") +
        ubic.map(function (x) {
          return '<option value="' + esc(x.almacen) + '"' +
            (x.almacen === esp ? " selected" : "") + ">" + esc(x.almacen) + " · " +
            num(x.stock) + " un." + (x.almacen === esp ? " · el propuesto" : "") + "</option>";
        }).join("") + "</select>" +
        '<span class="mini">Son ' + num(total) + " unidades repartidas en " + ubic.length +
        " almacenes. Consolidar es una propuesta de movimiento, no un movimiento.</span></div>";
    }
    h += "</div></div>";
    return h;
  }

  function dato(k, v) {
    return '<div class="td"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
  }
  function bot(cls, acc, txt, tecla) {
    return '<button class="btn ' + (cls === "ok" ? "ok" : cls === "no" ? "no" : "") +
      ' grande" data-acc="' + acc + '"><span>' + esc(txt) + '</span><kbd>' + tecla + "</kbd></button>";
  }

  function obsActual() {
    var t = document.getElementById("tObs");
    return t ? t.value.trim() : "";
  }
  function conObs(cambios) {
    var o = obsActual();
    if (o) cambios.observaciones = o;
    return cambios;
  }
  function avanzar() { estado.tIdx++; estado.selCand = {}; estado.unif = ""; pintarTriage(); }

  function marcar(c, mat) {
    if (estado.selCand[mat]) delete estado.selCand[mat];
    else estado.selCand[mat] = 1;
    if (Object.keys(estado.selCand).length > 1 && !estado.unif)
      estado.unif = c.nombre_fisico || "";
    pintarTriage();
  }
  function confirmarSeleccion(c) {
    var mats = Object.keys(estado.selCand);
    if (!mats.length) return aviso("Marcá al menos un código.");
    var nom = "";
    if (mats.length > 1) {
      var el = document.getElementById("unifNom");
      nom = (el ? el.value : estado.unif || "").trim();
      if (!nom) return aviso("Poné un nombre para la nomenclatura unificada.");
    }
    var cam = conObs({ materiales: mats, estado_revision: "Revisado",
                       aprobacion: "Correspondencia confirmada" });
    if (mats.length > 1) cam.nomenclatura_unificada = nom;
    decidir(c.id, cam, mats.length > 1
      ? "Se agruparon " + mats.length + " códigos SAP (" + mats.join(", ") +
        ") bajo la nomenclatura unificada «" + nom + "»"
      : "Se asignó el código SAP " + mats[0]);
    var liberadas = mats.filter(function (m) {
      return D.casos.some(function (x) {
        return x.base === c.base && x.material_sap === m && L(x) === "C"; });
    }).length;
    aviso(mats.length > 1
      ? "Agrupados " + mats.length + " códigos." + (liberadas
          ? " " + liberadas + (liberadas === 1 ? " deja" : " dejan") + " de ser candidato a baja." : "")
      : "Asignado " + mats[0] + "." + (liberadas ? " Deja de ser candidato a baja." : ""));
    avanzar();
  }
  function accionTriage(c, a) {
    if (a === "confirmar") return confirmarSeleccion(c);
    if (a === "s") return avanzar();
    // ---- clase B: elegir alternativa y registrar el resultado de la verificación
    if (a === "b1") {
      decidir(c.id, conObs({ ruta_b: RB_VERIF, estado_revision: "Pendiente de validación",
                             aprobacion: "Pendiente de verificación en el maestro" }),
              "Alternativa 1 · se verifica el maestro completo de SAP antes de crear");
      aviso("Alternativa 1 registrada. Cargá el resultado cuando lo tengas.");
      return pintarTriage();
    }
    if (a === "b2") return modalCrearSinVerificar([c], function () { avanzar(); });
    if (a === "v1" || a === "v2" || a === "v3") {
      var ci = document.getElementById("codMaestro");
      var cod = ci ? ci.value.trim() : "";
      if ((a === "v2" || a === "v3") && !cod)
        return aviso("Poné el código que encontraste en el maestro.");
      var res = a === "v1" ? VER_NO : a === "v2" ? VER_REUSA : VER_NUEVO;
      var cam = conObs({ verificacion: res, codigo_maestro: cod,
                         estado_revision: "Revisado",
                         aprobacion: a === "v2" ? "Rechazado" : "Aprobado" });
      if (a === "v2") cam.materiales = [cod];
      if (a === "v3") cam.depuracion = "Ligado al plan de depuración";
      decidir(c.id, cam, a === "v1"
        ? "Verificado en el maestro: no existe. Se propone el alta (no ejecuta nada en SAP)"
        : a === "v2"
        ? "Verificado en el maestro: ya existe sin stock como " + cod +
          ". No se da de alta: se reutiliza ese código"
        : "Verificado en el maestro: existe sin stock como " + cod +
          ". Se propone darlo de baja y crear uno nuevo, ligado al plan de depuración");
      return avanzar();
    }
    // ---- ubicación: no toca el código SAP, decide el almacén
    if (a === "al1" || a === "al2" || a === "al3" || a === "al4") {
      var ub = c.almacenes || [];
      var act = ub.length === 1 ? ub[0].almacen : null;
      var dst = document.getElementById("almDest");
      var destino = a === "al1" ? c.almacen_esperado
                  : a === "al2" ? act
                  : a === "al3" ? (dst ? dst.value : null) : null;
      var txt = { al1: "Mover el stock al almacén propuesto (" + c.almacen_esperado + ")",
                  al2: "El almacén " + act + " es el correcto: se corrige la propuesta",
                  al3: "Consolidar el stock en el almacén " + destino,
                  al4: "Lo valida el responsable de la base" }[a];
      decidir(c.id, conObs({ almacen_decision: txt, almacen_propuesto: destino }),
              "Ubicación · " + txt + " (propuesta, no mueve stock en SAP)");
      return avanzar();
    }
    if (a === "x") {
      decidir(c.id, conObs({ estado_revision: "Pendiente de validación" }),
              "Se marcó como pendiente de validación"); return avanzar();
    }
    if (a === "n") {
      decidir(c.id, conObs({ aprobacion: "Aprobado", estado_revision: "Revisado",
                             reclasificado: "Candidato a alta" }),
              "Ningún material con stock corresponde: pasa a verificar contra el maestro de SAP");
      aviso("Pasa a verificación contra el maestro de SAP."); return avanzar();
    }
    if (a === "a") {
      var txt = { altas: "Verificado contra el maestro: se propone el alta (no ejecuta nada en SAP)",
                  bajas: "Se aprobó la PROPUESTA de baja (no ejecuta nada en SAP)",
                  existencias: "Se marcó para registrar la existencia en SAP",
                  identificados: "Se confirmó la correspondencia con SAP" }[estado.cola];
      decidir(c.id, conObs({ aprobacion: estado.cola === "identificados"
                             ? "Correspondencia confirmada" : "Aprobado",
                             estado_revision: "Revisado" }), txt);
      return avanzar();
    }
    if (a === "r") {
      decidir(c.id, conObs({ aprobacion: "Rechazado", estado_revision: "Revisado" }),
              "Se rechazó la propuesta"); return avanzar();
    }
  }

  function teclas(ev) {
    if (estado.vista !== "revisar") return;
    var t = ev.target.tagName;
    if (t === "TEXTAREA" || t === "INPUT" || t === "SELECT") return;
    var c = estado.triage[estado.tIdx];
    if (!c) return;
    var k = ev.key.toLowerCase();
    if (/^[1-9]$/.test(k)) {
      // En las colas de clase B y de almacenes los números eligen una decisión,
      // no un candidato: esas colas no tienen candidatos que marcar.
      if (estado.cola === "almacenes") {
        var ba = document.querySelector('[data-acc="al' + k + '"]');
        if (ba) { ev.preventDefault(); ba.click(); }
        return;
      }
      if (estado.cola === "altas") {
        var br = document.querySelector('[data-acc="' +
                 (etapaB(c) === "ruta" ? "b" : "v") + k + '"]');
        if (br) { ev.preventDefault(); br.click(); }
        return;
      }
      var b = document.querySelectorAll(".cand")[parseInt(k, 10) - 1];
      if (b) { ev.preventDefault(); b.click(); }
      return;
    }
    if (k === "enter") {
      var cf = document.querySelector('[data-acc="confirmar"]');
      if (cf) { ev.preventDefault(); cf.click(); }
      return;
    }
    var mapa = { a: "a", r: "r", n: "n", x: "x", s: "s", arrowright: "s" };
    if (mapa[k]) {
      var bb = document.querySelector('[data-acc="' + mapa[k] + '"]');
      if (bb) { ev.preventDefault(); bb.click(); }
    }
    if (k === "f") { ev.preventDefault(); estado.volverA = "revisar"; ir("ficha", c.id); }
  }

  // ------------------------------------------------------------- LOTE
  function abrirLote(id) {
    if (id === "altas") return abrirLoteB();
    if (id === "depurar") return ir("depurar");
    var q = colaPor(id), pend = deCola(id).filter(pendiente);
    var libres = pend.filter(function (c) { return !c.bloqueado_por_revision; });
    var bloq = pend.length - libres.length;
    var porBase = {};
    libres.forEach(function (c) { porBase[c.base] = (porBase[c.base] || 0) + 1; });

    var verbo = { altas: "Aprobar las altas", bajas: "Aprobar las bajas",
                  identificados: "Confirmar las identificaciones",
                  existencias: "Marcar para registrar" }[id];
    var h = '<div class="modalfondo"><div class="modal">' +
      "<h2>" + esc(verbo) + " en lote</h2>" +
      '<p class="sub">Vas a decidir muchos casos de una sola vez. Queda registrado con tu ' +
      "nombre y la fecha, y se puede deshacer caso por caso.</p>";
    if (bloq) {
      h += '<div class="aviso" style="margin:12px 0"><b>' + num(bloq) + " casos quedan afuera.</b>" +
        "Dependen de un caso del grupo 1 todavía en revisión. No se incluyen en el lote: " +
        "conviene resolver esos primero.</div>";
    }
    h += '<div class="lotebases">' + Object.keys(porBase).sort().map(function (b) {
      return '<label class="lb"><input type="checkbox" class="lbase" value="' + esc(b) +
        '" checked> ' + esc(b) + ' <b>' + num(porBase[b]) + "</b></label>";
    }).join("") + "</div>";
    h += '<label class="k" style="display:block;margin-top:12px">Observación para todo el lote (opcional)</label>' +
      '<textarea id="loteObs" placeholder="Por qué se decide esto…"></textarea>';
    h += '<div class="modalacc"><span class="mini" id="loteCuenta"></span>' +
      '<button class="btn" id="loteCancel">Cancelar</button>' +
      '<button class="btn no" id="loteNo">Rechazar seleccionados</button>' +
      '<button class="btn pri" id="loteSi">' + esc(verbo) + "</button></div>";
    h += "</div></div>";

    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");

    function seleccionados() {
      var bs = {};
      modal.querySelectorAll(".lbase:checked").forEach(function (i) { bs[i.value] = 1; });
      return libres.filter(function (c) { return bs[c.base]; });
    }
    function refrescar() {
      modal.querySelector("#loteCuenta").textContent =
        num(seleccionados().length) + " casos seleccionados";
    }
    modal.querySelectorAll(".lbase").forEach(function (i) {
      i.addEventListener("change", refrescar); });
    refrescar();
    function cerrar() { modal.remove(); }
    modal.querySelector("#loteCancel").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });

    function aplicar(aprobar) {
      var sel = seleccionados();
      if (!sel.length) return aviso("No hay casos seleccionados.");
      if (!confirm((aprobar ? verbo : "Rechazar") + ": " + sel.length +
                   " casos.\n\nQueda registrado y no modifica SAP. ¿Seguir?")) return;
      var o = modal.querySelector("#loteObs").value.trim();
      var txt = (aprobar ? "Decisión en lote · " + verbo : "Decisión en lote · rechazado");
      sel.forEach(function (c) {
        var cam = { aprobacion: aprobar
                      ? (id === "identificados" ? "Correspondencia confirmada" : "Aprobado")
                      : "Rechazado",
                    estado_revision: "Revisado" };
        if (o) cam.observaciones = o;
        decidir(c.id, cam, txt);
      });
      cerrar(); aviso(num(sel.length) + " casos decididos."); ir("inicio");
    }
    modal.querySelector("#loteSi").addEventListener("click", function () { aplicar(true); });
    modal.querySelector("#loteNo").addEventListener("click", function () { aplicar(false); });
  }

  /* La clase B no se decide con un «aprobar todo»: lo que se elige en lote es la
     alternativa de trabajo, y la alternativa 2 pasa igual por la pregunta expresa. */
  function abrirLoteB() {
    var pend = deCola("altas").filter(function (c) { return etapaB(c) === "ruta"; });
    var esperando = deCola("altas").filter(function (c) { return etapaB(c) === "verificacion"; });
    var porBase = {};
    pend.forEach(function (c) { porBase[c.base] = (porBase[c.base] || 0) + 1; });

    var h = '<div class="modalfondo"><div class="modal ancho">' +
      "<h2>Elegir la alternativa en lote</h2>" +
      '<p class="sub">Son ítems que están en el depósito y no aparecieron entre los ' +
      "materiales con stock en SAP. Lo que se decide acá es <b>cómo se trabajan</b>, no si " +
      "se crean: la alternativa 2 vuelve a preguntarte expresamente.</p>";
    if (!pend.length) {
      h += '<div class="aviso info" style="margin-top:14px"><b>No queda ninguno sin ' +
        "alternativa elegida.</b>" + (esperando.length
          ? num(esperando.length) + " están esperando el resultado de la consulta al maestro: " +
            "eso se carga de a uno, en «Revisar de a uno»."
          : "Todos los casos de este grupo ya están resueltos.") + "</div>";
    } else {
      h += '<div class="lotebases">' + Object.keys(porBase).sort().map(function (b) {
        return '<label class="lb"><input type="checkbox" class="lbase" value="' + esc(b) +
          '" checked> ' + esc(b) + " <b>" + num(porBase[b]) + "</b></label>";
      }).join("") + "</div>";
      h += '<div class="rgrid chico" style="margin-top:16px">' +
        '<div class="ruta r1"><div class="rtit"><span class="rnum">1</span>Verificar antes de crear</div>' +
        '<p class="rtxt">Quedan marcados como pendientes de consulta al maestro completo. ' +
        "Después se carga el resultado de a uno.</p>" +
        '<button class="btn pri" id="loteB1">Marcar para verificar</button></div>' +
        '<div class="ruta r2"><div class="rtit"><span class="rnum">2</span>Crear sin verificar</div>' +
        '<p class="rtxt">Se decide crearlos igual. Antes de registrarlo el sistema te muestra ' +
        "el riesgo de código duplicado y te lo pregunta expresamente.</p>" +
        '<button class="btn" id="loteB2">Crear sin verificar…</button></div></div>';
      h += '<label class="k" style="display:block;margin-top:14px">Observación para todo el lote (opcional)</label>' +
        '<textarea id="loteObs" placeholder="Por qué se decide esto…"></textarea>';
    }
    h += '<div class="modalacc"><span class="mini" id="loteCuenta"></span>' +
      '<button class="btn" id="loteCancel">Cerrar</button>' +
      (pend.length ? '<button class="btn no" id="loteNo">No dar de alta los seleccionados</button>' : "") +
      "</div></div></div>";

    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");
    function seleccionados() {
      var bs = {};
      modal.querySelectorAll(".lbase:checked").forEach(function (i) { bs[i.value] = 1; });
      return pend.filter(function (c) { return bs[c.base]; });
    }
    function refrescar() {
      modal.querySelector("#loteCuenta").textContent =
        pend.length ? num(seleccionados().length) + " casos seleccionados" : "";
    }
    modal.querySelectorAll(".lbase").forEach(function (i) {
      i.addEventListener("change", refrescar); });
    refrescar();
    function cerrar() { modal.remove(); }
    modal.querySelector("#loteCancel").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });
    function obsLote() {
      var t = modal.querySelector("#loteObs");
      return t ? t.value.trim() : "";
    }
    var b1 = modal.querySelector("#loteB1");
    if (b1) b1.addEventListener("click", function () {
      var sel = seleccionados();
      if (!sel.length) return aviso("No hay casos seleccionados.");
      var o = obsLote();
      sel.forEach(function (c) {
        var cam = { ruta_b: RB_VERIF, estado_revision: "Pendiente de validación",
                    aprobacion: "Pendiente de verificación en el maestro" };
        if (o) cam.observaciones = o;
        decidir(c.id, cam, "Decisión en lote · alternativa 1 · verificar el maestro antes de crear");
      });
      cerrar(); aviso(num(sel.length) + " casos marcados para verificar."); ir("inicio");
    });
    var b2 = modal.querySelector("#loteB2");
    if (b2) b2.addEventListener("click", function () {
      var sel = seleccionados();
      if (!sel.length) return aviso("No hay casos seleccionados.");
      cerrar();
      modalCrearSinVerificar(sel, function () { ir("inicio"); });
    });
    var bn = modal.querySelector("#loteNo");
    if (bn) bn.addEventListener("click", function () {
      var sel = seleccionados();
      if (!sel.length) return aviso("No hay casos seleccionados.");
      if (!confirm("No dar de alta: " + sel.length +
                   " casos.\n\nQueda registrado y no modifica SAP. ¿Seguir?")) return;
      var o = obsLote();
      sel.forEach(function (c) {
        var cam = { aprobacion: "Rechazado", estado_revision: "Revisado" };
        if (o) cam.observaciones = o;
        decidir(c.id, cam, "Decisión en lote · no corresponde darlo de alta");
      });
      cerrar(); aviso(num(sel.length) + " casos decididos."); ir("inicio");
    });
  }

  // ------------------------------------------------------------- LISTADO
  function filtrados() {
    var f = estado.filtros, txt = (f.texto || "").trim().toLowerCase();
    var out = D.casos.filter(function (c) {
      var e = efectivo(c);
      if (f.base && c.base !== f.base) return false;
      if (f.tipo && c.tipo !== f.tipo) return false;
      if (f.clase && L(c) !== f.clase) return false;
      if (f.grupo === "existencias" && !sinStock(c)) return false;
      if (f.grupo === "identificados" && sinStock(c)) return false;
      if (f.revision && e.estado_revision !== f.revision) return false;
      if (f.aprobacion === "__pend" && !pendiente(c)) return false;
      if (f.aprobacion === "__hecho" && pendiente(c)) return false;
      if (f.aprobacion && f.aprobacion.indexOf("__") !== 0 && e.aprobacion !== f.aprobacion) return false;
      if (f.motivo && c.motivo !== f.motivo) return false;
      if (f.valorizacion === "pendiente" && c.estado_valorizacion !== "Pendiente de valorización") return false;
      if (f.almacen && !(c.almacenes || []).some(function (x) { return x.almacen === f.almacen; })) return false;
      if (f.almacen_estado && c.almacen_estado !== f.almacen_estado) return false;
      if (f.obs === "con" && !e.observaciones) return false;
      if (f.obs === "sin" && e.observaciones) return false;
      if (txt) {
        var heno = [c.nombre_fisico, c.texto_sap, e.material, c.material_sugerido,
                    c.codigo_fisico, c.presentacion, e.observaciones, c.base, c.tipo]
                   .join(" ").toLowerCase();
        if (heno.indexOf(txt) === -1) return false;
      }
      return true;
    });
    var o = estado.orden;
    out.sort(function (a, b) {
      var va = valorOrden(a, o.campo), vb = valorOrden(b, o.campo);
      return va < vb ? (o.desc ? 1 : -1) : va > vb ? (o.desc ? -1 : 1) : 0;
    });
    return out;
  }
  function valorOrden(c, campo) {
    var e = efectivo(c);
    switch (campo) {
      case "base": return c.base; case "tipo": return c.tipo;
      case "clase": return c.clasificacion;
      case "nombre": return (c.nombre_fisico || c.texto_sap || "").toLowerCase();
      case "material": return e.material || "zzz";
      case "cantidad": return -(c.cantidad_fisica || c.stock_sap || 0);
      case "aprobacion": return e.aprobacion;
      default: return c.n;
    }
  }

  function pintarCasos() {
    var lista = filtrados(), f = estado.filtros;
    var paginas = Math.max(1, Math.ceil(lista.length / estado.porPagina));
    if (estado.pagina > paginas) estado.pagina = paginas;
    var ini = (estado.pagina - 1) * estado.porPagina;
    var pag = lista.slice(ini, ini + estado.porPagina);
    var nSel = Object.keys(estado.sel).length;

    var h = '<div class="cabi"><div><h1>Todos los casos</h1>' +
      '<p class="sub">' + num(lista.length) + " de " + num(D.casos.length) +
      ' casos con los filtros actuales. Para trabajar ordenado conviene usar ' +
      '<b>Inicio</b>; esta vista es para buscar algo puntual.</p></div>' +
      '<button class="btn" id="bInicio2">← Ir al inicio</button></div>';

    h += '<div class="filtros">' +
      '<input type="text" id="fTexto" placeholder="Buscar por nombre, código SAP, nomenclatura u observación…" value="' + esc(f.texto) + '">' +
      sel("fBase", "Base", f.base, D.meta.bases) +
      sel("fTipo", "Tipo", f.tipo, D.meta.tipos) +
      sel("fClase", "Clasificación", f.clase, ["A", "B", "C", "D", "E", "F"],
          function (v) { return v + " · " + CORTO[v]; }) +
      sel("fMotivo", "Motivo de revisión", f.motivo, D.meta.motivos_revision) +
      sel("fApr", "Estado", f.aprobacion,
          ["__pend", "__hecho", "Aprobado", "Rechazado", "Correspondencia confirmada"],
          function (v) { return v === "__pend" ? "Pendientes" : v === "__hecho" ? "Ya decididos" : v; }) +
      sel("fVal", "Valorización", f.valorizacion, ["pendiente"],
          function () { return "Pendiente"; }) +
      sel("fAlmEst", "Estado de almacén", f.almacen_estado,
          [AL_OK, AL_CAMB, AL_MULT, AL_VAL, AL_NOID, AL_SINS]) +
      sel("fAlm", "Almacén", f.almacen, (D.meta.almacenes.observados || [])) +
      sel("fObs", "Observaciones", f.obs, ["con", "sin"],
          function (v) { return v === "con" ? "Con observación" : "Sin observación"; }) +
      '<button class="btn chico" id="fLimpiar">Limpiar</button>' + "</div>";

    h += '<div class="tablabox"><table><thead><tr>' +
      '<th class="chk"><input type="checkbox" id="selTodos" title="Seleccionar la página"></th>' +
      th("clase", "Clasificación") + th("base", "Base") +
      '<th class="hfis" data-campo="nombre">En el depósito</th>' +
      '<th class="hsap" data-campo="material">Con stock en SAP</th>' +
      th("cantidad", "Cantidad") + th("aprobacion", "Estado") + "</tr></thead><tbody>";
    if (!pag.length) h += '<tr><td colspan="7" class="vacio">No hay casos con estos filtros.</td></tr>';
    pag.forEach(function (c) {
      var e = efectivo(c), l = L(c);
      var cant = c.origen === "Inventario físico" ? c.cantidad_fisica : c.stock_sap;
      h += '<tr data-id="' + esc(c.id) + '"' + (estado.sel[c.id] ? ' class="selec"' : "") + ">" +
        '<td class="chk"><input type="checkbox" class="selUno" data-id="' + esc(c.id) + '"' +
          (estado.sel[c.id] ? " checked" : "") + (l === "E" ? " disabled" : "") + "></td>" +
        '<td><span class="et ' + l + '"><i class="pt" style="background:var(--c' + l + ')"></i>' +
          l + " · " + CORTO[l] + "</span>" +
          (c.motivo ? '<div class="mini">' + esc(c.motivo) + "</div>" : "") + "</td>" +
        "<td>" + esc(c.base) + '<div class="mini">' + esc(c.tipo) + "</div></td>" +
        '<td class="cfis">' + (c.nombre_fisico
            ? "<b>" + esc(c.nombre_fisico) + "</b><div class=\"mini\">" +
              esc(c.sistema_origen) + (c.codigo_fisico ? " · " + esc(c.codigo_fisico) : "") + "</div>"
            : '<span class="nohay">no figura en el inventario</span>') + "</td>" +
        '<td class="csap">' + (e.materiales.length || c.texto_sap || c.material_sugerido
            ? (e.materiales.length
               ? "<b>" + e.materiales.map(esc).join(" · ") + "</b>"
               : c.material_sugerido
                 ? '<span class="mini">candidato ' + esc(c.material_sugerido) + ", sin confirmar</span>"
                 : "") +
              (c.texto_sap ? '<div class="mini">' + esc(c.texto_sap) + "</div>" : "") +
              (e.agrupado ? '<div class="mini">agrupados como «' + esc(e.unificada) + "»</div>" : "") +
              (resueltoPorAgrupacion(c) ? '<div class="mini ok">identificado en una agrupación</div>' : "")
            : '<span class="nohay">no está entre los que tienen stock</span>') + "</td>" +
        '<td class="num">' + num(cant) + "</td>" +
        "<td><span class=\"estado " + (e.aprobacion === "Aprobado" || e.aprobacion === "Correspondencia confirmada" ? "ap" :
            e.aprobacion === "Rechazado" ? "re" : "") + '">' + esc(e.aprobacion) + "</span>" +
          (e.observaciones ? '<div class="mini">con observación</div>' : "") + "</td></tr>";
    });
    h += "</tbody></table>";
    h += '<div class="pager">' +
      '<button class="btn chico" id="pPrev"' + (estado.pagina <= 1 ? " disabled" : "") + ">← Anterior</button>" +
      "<span>Página " + estado.pagina + " de " + paginas + "</span>" +
      '<button class="btn chico" id="pNext"' + (estado.pagina >= paginas ? " disabled" : "") + ">Siguiente →</button>" +
      "</div></div>";

    if (nSel) {
      h += '<div class="selbarra"><b>' + num(nSel) + " seleccionados</b>" +
        '<button class="btn chico" id="selTodosF">Seleccionar los ' + num(lista.length) + " del filtro</button>" +
        '<button class="btn chico" id="selNada">Quitar selección</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn ok chico" id="selOk">Aprobar / confirmar</button>' +
        '<button class="btn no chico" id="selNo">Rechazar</button></div>';
    }

    var el = document.getElementById("v-casos");
    el.innerHTML = h;
    el.querySelector("#bInicio2").addEventListener("click", function () { ir("inicio"); });
    el.querySelector("#fTexto").addEventListener("input", function (ev) {
      estado.filtros.texto = ev.target.value; estado.pagina = 1;
      var p = ev.target.selectionStart; pintarCasos();
      var n2 = document.getElementById("fTexto"); n2.focus(); n2.setSelectionRange(p, p);
    });
    [["fBase", "base"], ["fTipo", "tipo"], ["fClase", "clase"], ["fMotivo", "motivo"],
     ["fApr", "aprobacion"], ["fVal", "valorizacion"], ["fObs", "obs"],
     ["fAlmEst", "almacen_estado"], ["fAlm", "almacen"]].forEach(function (par) {
      var n3 = el.querySelector("#" + par[0]);
      if (n3) n3.addEventListener("change", function (ev) {
        estado.filtros[par[1]] = ev.target.value; estado.pagina = 1; pintarCasos(); });
    });
    el.querySelector("#fLimpiar").addEventListener("click", function () {
      limpiarFiltros(); estado.pagina = 1; pintarCasos(); });
    el.querySelector("#pPrev").addEventListener("click", function () { estado.pagina--; pintarCasos(); });
    el.querySelector("#pNext").addEventListener("click", function () { estado.pagina++; pintarCasos(); });
    el.querySelectorAll("tbody tr[data-id]").forEach(function (tr) {
      tr.addEventListener("click", function (ev) {
        if (ev.target.classList.contains("selUno")) return;
        estado.volverA = "casos"; ir("ficha", tr.dataset.id); });
    });
    el.querySelectorAll(".selUno").forEach(function (i) {
      i.addEventListener("change", function () {
        if (i.checked) estado.sel[i.dataset.id] = 1; else delete estado.sel[i.dataset.id];
        pintarCasos(); });
    });
    var st = el.querySelector("#selTodos");
    if (st) st.addEventListener("change", function () {
      pag.forEach(function (c) {
        if (L(c) === "E") return;
        if (st.checked) estado.sel[c.id] = 1; else delete estado.sel[c.id]; });
      pintarCasos(); });
    if (nSel) {
      el.querySelector("#selNada").addEventListener("click", function () {
        estado.sel = {}; pintarCasos(); });
      el.querySelector("#selTodosF").addEventListener("click", function () {
        lista.forEach(function (c) { if (L(c) !== "E") estado.sel[c.id] = 1; }); pintarCasos(); });
      el.querySelector("#selOk").addEventListener("click", function () { loteSel(true); });
      el.querySelector("#selNo").addEventListener("click", function () { loteSel(false); });
    }
  }
  function loteSel(aprobar) {
    var ids = Object.keys(estado.sel);
    if (!ids.length) return;
    if (!confirm((aprobar ? "Aprobar / confirmar" : "Rechazar") + " " + ids.length +
                 " casos.\n\nQueda registrado con tu nombre y no modifica SAP. ¿Seguir?")) return;
    ids.forEach(function (id) {
      var c = caso(id); if (!c) return;
      decidir(id, { aprobacion: aprobar
                      ? (L(c) === "A" ? "Correspondencia confirmada" : "Aprobado")
                      : "Rechazado",
                    estado_revision: "Revisado" },
              "Decisión en lote desde el listado");
    });
    estado.sel = {}; aviso(ids.length + " casos decididos."); pintarCasos();
  }
  function th(campo, texto) {
    var o = estado.orden;
    return '<th data-campo="' + campo + '">' + esc(texto) +
      (o.campo === campo ? (o.desc ? " ↓" : " ↑") : "") + "</th>";
  }
  function sel(id, etiqueta, valor, opciones, fmt) {
    return "<label>" + esc(etiqueta) + '<select id="' + id + '"><option value="">Todos</option>' +
      opciones.map(function (o) {
        return '<option value="' + esc(o) + '"' + (valor === o ? " selected" : "") + ">" +
               esc(fmt ? fmt(o) : o) + "</option>"; }).join("") + "</select></label>";
  }

  // ------------------------------------------------------------- FICHA
  function pintarFicha() {
    var c = caso(estado.fichaId);
    if (!c) return ir("casos");
    var e = efectivo(c), l = L(c);

    var h = '<div style="display:flex;gap:9px;align-items:center;margin-bottom:13px;flex-wrap:wrap">' +
      '<button class="btn chico" id="bVolver">← Volver</button></div>';
    h += "<h1>" + esc(c.nombre_fisico || c.texto_sap) + "</h1>" +
      '<p class="sub"><span class="et ' + l + '"><i class="pt" style="background:var(--c' + l + ')"></i>' +
      l + " · " + CORTO[l] + "</span> &nbsp; " + esc(c.base) + " · " + esc(c.tipo) +
      (c.motivo ? " · " + esc(c.motivo) : "") + "</p>";

    h += '<div class="ficha"><div>';
    h += '<div class="bloque"><h3>Curso de acción sugerido</h3>' +
      '<div class="campo"><div class="v g">' + esc(c.accion) + "</div></div>" +
      '<div class="just" style="margin-top:11px">' + esc(c.justificacion) + "</div>" +
      (c.falta_para_alta && c.falta_para_alta.length ?
        '<div style="margin-top:11px"><div class="k mini">Para darlo de alta hace falta:</div><ul style="margin:5px 0 0;padding-left:19px;font-size:13px;color:var(--tinta2)">' +
        c.falta_para_alta.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      "</div>";
    h += '<div class="bloque bfis"><h3><span class="sico">◉</span> Lo que hay en el depósito · ' +
      esc(c.sistema_origen) + '</h3><div class="campos">' +
      campo("Base", c.base) + campo("Centro", c.centro) + campo("Informe", c.informe_origen) +
      campo("Código en el inventario físico", c.codigo_fisico || "—") +
      campo("Nomenclatura original", c.nombre_fisico || "—") +
      campo("Presentación detectada", c.presentacion || "—") +
      campo("Cantidad física", c.origen === "Inventario físico"
            ? num(c.cantidad_fisica) + " unidades" : "—", true) + "</div></div>";
    h += '<div class="bloque bsap"><h3><span class="sico">▣</span> Lo que hoy tiene stock en ' +
      'SAP · bajada al 02/10</h3><div class="campos">' +
      campo(e.materiales.length > 1 ? "Códigos SAP agrupados" : "Código SAP",
            e.materiales.length ? e.materiales.join(" · ")
            : (c.material_sugerido ? c.material_sugerido + " (sugerido, sin confirmar)"
               : "Sin asignar"), true) +
      (e.agrupado ? campo("Nomenclatura unificada", e.unificada) : "") +
      campo("Descripción en SAP", c.texto_sap || "—") +
      campo("Atributos verificados", (c.atributos_verificados || []).join(", ") || "ninguno") +
      campo("Confianza del cruce", c.confianza || "—") +
      (c.material_sin_stock_en_base
        ? campo("Atención", "SAP no tiene stock de este material en " + c.base +
                (c.stock_sap_otras_bases && c.stock_sap_otras_bases.length
                 ? ". Sí lo tiene en " + c.stock_sap_otras_bases.join(", ") + "." : ".")) : "") +
      (c.identificado_en_otras_bases && c.identificado_en_otras_bases.length
        ? campo("Identificado en otras bases", c.identificado_en_otras_bases.join(", ")) : "") +
      (resueltoPorAgrupacion(c)
        ? campo("Ya no es candidato a baja",
                "Este material quedó identificado al agruparlo con un ítem del inventario físico.")
        : "") + "</div>";
    if (c.candidatos && c.candidatos.length) {
      h += '<h3 style="margin-top:15px">Candidatos evaluados</h3><table class="listalotes"><thead><tr>' +
        "<th>Código</th><th>Descripción en SAP</th><th>Coincide en</th><th>Contradice en</th></tr></thead><tbody>";
      c.candidatos.forEach(function (x) {
        h += "<tr><td>" + esc(x.material) + "</td><td>" + esc(x.texto) + "</td><td>" +
          (x.coinciden && x.coinciden.length ? esc(x.coinciden.join(", ")) : "—") + "</td><td>" +
          (x.conflictos && x.conflictos.length
            ? '<span style="color:var(--alerta)">' + esc(x.conflictos.join(", ")) + "</span>" : "—") +
          "</td></tr>"; });
      h += "</tbody></table>";
    }
    h += "</div>";
    var cmp = (c.candidatos || [])[0];
    if (cmp && cmp.detalle && cmp.detalle.length) {
      h += '<div class="bloque"><h3>Comparación característica por característica</h3>' +
        '<p class="mini" style="margin:-6px 0 12px">Depósito frente a <b>' + esc(cmp.material) +
        "</b> «" + esc(cmp.texto) + "»</p>" +
        '<table class="tcomp"><thead><tr><th>Característica</th><th>Dice el depósito</th>' +
        "<th>Dice SAP</th><th>Para decidir</th></tr></thead><tbody>";
      cmp.detalle.forEach(function (dd) {
        var tx = { coincide: "Confirma", difiere: "Contradice",
                   solo_fisico: "SAP no lo dice", solo_sap: "El depósito no lo dice",
                   incomparable: "No son comparables" }[dd.estado];
        h += '<tr class="e-' + dd.estado + '"><td>' + esc(dd.nombre) + "</td><td>" +
          esc(dd.fisico || "—") + "</td><td>" + esc(dd.sap || "—") +
          '</td><td><span class="marcaest">' + esc(tx) + "</span></td></tr>";
      });
      h += "</tbody></table></div>";
    }
    h += bloqueAlmacen(c, e);
    if (l === "B") h += bloqueB(c, e);
    h += '<div class="bloque"><h3>Valorización</h3><div class="campos">' +
      campo("Criterio", "Precio de última compra") +
      campo("Estado", c.estado_valorizacion, true) +
      campo("Precio de última compra", c.precio_ultima_compra !== null && c.precio_ultima_compra !== undefined
            ? pesos(c.precio_ultima_compra) : "No disponible") +
      campo("Fuente del precio", c.fuente_precio) + "</div>" +
      (c.motivo_pendiente ? '<div class="just" style="margin-top:11px">' + esc(c.motivo_pendiente) + "</div>" : "");
    if (c.vu_sap_referencia) {
      h += '<div class="just" style="margin-top:11px"><b>Referencia, no es el criterio pedido.</b> ' +
        "SAP valoriza este material a " + pesos(c.vu_sap_referencia) + " por unidad (" +
        esc(c.vu_sap_alcance) + "), lo que da " + pesos(c.valor_sap_referencia) +
        ". Es el valor contable del stock dividido por las unidades, no el precio de la última compra.</div>";
    }
    h += "</div>";
    if (c.lotes && c.lotes.length) {
      h += '<div class="bloque"><h3>Lotes del recuento (' + c.lotes.length + ")</h3>" +
        '<table class="listalotes"><thead><tr><th>Lote</th><th>Vencimiento</th>' +
        '<th style="text-align:right">Stock</th></tr></thead><tbody>';
      c.lotes.forEach(function (lo) {
        h += "<tr><td>" + esc(lo.lote || "—") + "</td><td>" + esc(lo.vencimiento || "—") +
          '</td><td class="num">' + num(lo.stock) + "</td></tr>"; });
      h += "</tbody></table></div>";
    }

    h += "</div><div>";
    h += '<div class="bloque"><h3>Decisión</h3><div class="campos" style="margin-bottom:13px">' +
      campo("Estado de revisión", e.estado_revision) + campo("Decisión", e.aprobacion) +
      (e.revisor ? campo("Último cambio", e.revisor + " · " + fecha(e.actualizado)) : "") + "</div>";
    h += '<div class="acciones"><div class="grupo">' +
      (l === "A" || l === "D"
        ? '<button class="btn ok" data-acc="confirmar">Confirmar correspondencia</button>'
        : '<button class="btn ok" data-acc="aprobar">Aprobar la propuesta</button>') +
      '<button class="btn no" data-acc="rechazar">Rechazar</button></div>' +
      '<div class="grupo"><button class="btn" data-acc="validar">Pendiente de validación</button>' +
      '<button class="btn" data-acc="reabrir">Reabrir</button></div>';
    h += '<div style="margin-top:9px"><div class="k mini">Corregir el código SAP a mano</div>' +
      '<div style="display:flex;gap:6px;margin-top:4px">' +
      '<input type="text" class="cod" id="codManual" placeholder="código SAP" value="' +
        esc(dec(c.id) && dec(c.id).material_corregido ? dec(c.id).material_corregido : "") + '">' +
      '<button class="btn" data-acc="corregir">Aplicar</button></div>' +
      '<div class="mini" id="avisoCod" style="margin-top:4px"></div></div>';
    h += '<div style="margin-top:11px"><div class="k mini">Observaciones</div>' +
      '<textarea id="obs" placeholder="Por qué se decide esto…">' + esc(e.observaciones) + "</textarea>" +
      '<button class="btn" data-acc="obs" style="margin-top:6px">Guardar observación</button></div>';
    h += "</div></div>";
    h += '<div class="bloque"><h3>Historial</h3>';
    if (!e.historial.length) h += '<div class="mini">Sin decisiones registradas. Se muestra el resultado del análisis.</div>';
    else {
      e.historial.slice().reverse().forEach(function (x) {
        h += '<div class="hist"><b>' + esc(x.que) + '</b><span class="cuando">' +
          esc(x.quien) + " · " + fecha(x.cuando) + "</span></div>"; });
      h += '<button class="btn chico no" data-acc="deshacer" style="margin-top:6px">Descartar mis cambios</button>';
    }
    h += "</div></div></div>";

    var el = document.getElementById("v-ficha");
    el.innerHTML = h;
    el.querySelector("#bVolver").addEventListener("click", function () { ir(estado.volverA || "casos"); });
    el.querySelectorAll("[data-acc]").forEach(function (b) {
      b.addEventListener("click", function () { accionFicha(c, b.dataset.acc); }); });
  }
  /* La ubicación es una dimensión aparte: un material bien identificado puede estar
     en el almacén equivocado, y eso no lo convierte en alta ni en baja. */
  function bloqueAlmacen(c, e) {
    if (!c.almacen_estado && !(c.almacenes || []).length) {
      if (c.origen !== "Inventario físico" || !c.almacen_nota) return "";
      return '<div class="bloque"><h3>Ubicación del stock</h3>' +
        '<div class="mini">' + esc(c.almacen_nota) + "</div></div>";
    }
    var est = c.almacen_estado;
    var cl = est === AL_OK ? "A" : est === AL_CAMB ? "C" : est === AL_MULT ? "D" : "E";
    var h = '<div class="bloque"><h3>Ubicación del stock · centro ' + esc(c.centro || "—") +
      "</h3>" +
      '<p class="mini" style="margin:-6px 0 12px">El <b>centro</b> es la base; el ' +
      "<b>almacén</b> es el depósito dentro de esa base. Son dos campos distintos y acá se " +
      "comparan por separado.</p>";
    h += '<div class="campos">' +
      campo("Base física (de dónde salió el recuento)", c.base) +
      campo("Centro en SAP", c.centro || "—") +
      campo("Almacén donde figura el stock", (c.almacenes || []).length
            ? c.almacenes.map(function (x) { return x.almacen; }).join(" · ") : "—", true) +
      campo("Almacén esperado (propuesta a validar)", c.almacen_esperado || "sin definir") +
      "</div>";
    h += '<div style="margin-top:12px"><span class="et ' + cl + '">' +
      '<i class="pt" style="background:var(--c' + cl + ')"></i>' + esc(est || "—") + "</span>" +
      (e.almacen_decidido ? ' <span class="mini">· decidido por ' + esc(e.revisor || "—") + "</span>" : "") +
      "</div>";
    if (e.almacen_decidido) {
      h += '<div class="just" style="margin-top:11px"><b>Decisión registrada:</b> ' +
        esc(e.almacen_decidido) +
        (e.almacen_propuesto ? " · almacén destino " + esc(e.almacen_propuesto) : "") +
        ". Es una propuesta: no mueve stock en SAP.</div>";
    }
    if ((c.almacenes || []).length > 1) {
      h += '<table class="listalotes" style="margin-top:12px"><thead><tr><th>Almacén</th>' +
        '<th style="text-align:right">Stock</th></tr></thead><tbody>' +
        c.almacenes.map(function (x) {
          return "<tr><td>" + esc(x.almacen) + '</td><td class="num">' + num(x.stock) +
                 "</td></tr>"; }).join("") + "</tbody></table>";
    }
    if (c.almacen_nota) h += '<div class="just" style="margin-top:11px">' +
      esc(c.almacen_nota) + "</div>";
    h += '<div class="mini" style="margin-top:10px">La descripción de los códigos de almacén ' +
      "no viene en la bajada: sólo el código. Qué almacén <i>debe</i> tener el stock de " +
      "farmacia en cada base es una <b>propuesta a validar</b>, no un dato del archivo.</div>";
    h += "</div>";
    return h;
  }

  /* En la ficha de un caso de clase B se ve qué alternativa se eligió y con qué riesgo. */
  function bloqueB(c, e) {
    var h = '<div class="bloque"><h3>Alternativa de trabajo · sin correspondencia con stock</h3>';
    if (!e.ruta_b) {
      h += '<p class="mini" style="margin:-6px 0 12px">Todavía no se eligió alternativa. ' +
        "Se elige en el grupo 2 del inicio, «Verificar los que no aparecieron en SAP».</p>" +
        '<div class="campos">' +
        campo("Alternativa 1", "Verificar el maestro completo antes de crear. Evita el código duplicado.") +
        campo("Alternativa 2", "Crear igual, asumiendo el riesgo de duplicado y ligándolo a la depuración.") +
        "</div>";
    } else {
      h += '<div class="campos">' +
        campo("Alternativa elegida", e.ruta_b, true) +
        campo("Resultado de la verificación", e.verificacion || "todavía sin cargar") +
        (e.codigo_maestro ? campo("Código encontrado en el maestro", e.codigo_maestro) : "") +
        (e.riesgo_duplicado ? campo("Riesgo de código duplicado", e.riesgo_duplicado) : "") +
        (e.depuracion ? campo("Depuración del maestro", e.depuracion) : "") +
        "</div>";
      if (e.ruta_b === RB_CREAR) {
        h += '<div class="rriesgo" style="margin-top:12px"><b>Queda abierto</b>' +
          "Se creó sin verificar el maestro, así que <b>no sabemos si existe un código " +
          "anterior</b>. Buscarlo y resolverlo es parte del plan de depuración.</div>";
      }
    }
    h += "</div>";
    return h;
  }

  function campo(k, v, g) {
    return '<div class="campo"><div class="k">' + esc(k) + '</div><div class="v' +
           (g ? " g" : "") + '">' + esc(v) + "</div></div>";
  }
  function accionFicha(c, a) {
    var o = document.getElementById("obs") ? document.getElementById("obs").value : "";
    switch (a) {
      case "confirmar":
        decidir(c.id, { aprobacion: "Correspondencia confirmada", estado_revision: "Revisado" },
                "Se confirmó la correspondencia con SAP"); aviso("Confirmado."); break;
      case "aprobar":
        decidir(c.id, { aprobacion: "Aprobado", estado_revision: "Revisado" },
                "Se aprobó la PROPUESTA (no ejecuta nada en SAP)"); aviso("Aprobado."); break;
      case "rechazar":
        decidir(c.id, { aprobacion: "Rechazado", estado_revision: "Revisado" },
                "Se rechazó la propuesta"); break;
      case "validar":
        decidir(c.id, { estado_revision: "Pendiente de validación" },
                "Se marcó como pendiente de validación"); break;
      case "reabrir":
        decidir(c.id, { estado_revision: "En revisión", aprobacion: "Sin decidir" },
                "Se reabrió el caso"); break;
      case "corregir": {
        var v = document.getElementById("codManual").value.trim();
        var av = document.getElementById("avisoCod");
        if (!v) { av.textContent = "Escribí un código SAP."; return; }
        if (!existeMaterial(v)) {
          av.innerHTML = '<span style="color:var(--alerta)">El código ' + esc(v) +
            " no figura en la bajada de SAP.</span>"; return;
        }
        decidir(c.id, { material_corregido: v, estado_revision: "Revisado",
                        aprobacion: "Correspondencia confirmada" },
                "Se corrigió el código SAP a mano: " + v); aviso("Corregido a " + v + "."); break;
      }
      case "obs":
        decidir(c.id, { observaciones: o }, "Se registró una observación");
        aviso("Observación guardada."); break;
      case "deshacer":
        if (!confirm("Se descartan tus decisiones en esta ficha. ¿Seguir?")) return;
        delete decisiones[c.id]; guardar(); aviso("Restituida al análisis original."); break;
    }
    pintarFicha();
  }
  var INDICE_MAT = null;
  function existeMaterial(cod) {
    if (!INDICE_MAT) {
      INDICE_MAT = {};
      D.casos.forEach(function (c) {
        if (c.material_sap) INDICE_MAT[c.material_sap] = 1;
        if (c.material_sugerido) INDICE_MAT[c.material_sugerido] = 1;
        (c.candidatos || []).forEach(function (x) { INDICE_MAT[x.material] = 1; });
      });
    }
    return !!INDICE_MAT[cod];
  }


  // ------------------------------------------------- DEPURACIÓN DEL MAESTRO
  /* Un material sin stock no se da de baja: no hay existencia que dar de baja. Lo que
     se decide es qué pasa con el REGISTRO en el maestro. Son tres caminos posibles y
     se pueden tomar de a uno o en masa, dejando las excepciones anotadas. */

  /* El universo visible. Ojo con lo que NO está: la bajada de SAP trae sólo materiales
     con stock, así que éstos son los que aparecieron con existencia cero, no todos los
     que el maestro tiene en cero. */
  function universoDep() {
    var filas = [], visto = {};
    D.casos.forEach(function (c) {
      if (L(c) !== "F" || !c.material_sap || visto[c.material_sap]) return;
      visto[c.material_sap] = 1;
      filas.push({ codigo: c.material_sap, texto: c.texto_sap || "", tipo: c.tipo || "",
                   base: c.base || "", centro: c.centro || "", caso: c.id,
                   origen: "Bajada de SAP · existencia cero" });
    });
    // Códigos que aparecieron al verificar el maestro en un caso de clase B.
    D.casos.forEach(function (c) {
      if (L(c) !== "B") return;
      var e = efectivo(c);
      if (e.verificacion !== VER_NUEVO || !e.codigo_maestro) return;
      if (visto[e.codigo_maestro]) return;
      visto[e.codigo_maestro] = 1;
      filas.push({ codigo: e.codigo_maestro, texto: c.nombre_fisico || "", tipo: c.tipo || "",
                   base: c.base || "", centro: c.centro || "", caso: c.id,
                   origen: "Encontrado al verificar el maestro (caso de alta)" });
    });
    // Lo que trajo el maestro importado, si se importó.
    if (depu.maestro && depu.maestro.filas) {
      depu.maestro.filas.forEach(function (m) {
        if (visto[m.codigo]) return;
        visto[m.codigo] = 1;
        filas.push({ codigo: m.codigo, texto: m.texto || "", tipo: m.tipo || "",
                     base: "", centro: "", caso: null,
                     origen: "Maestro importado · existencia cero" });
      });
    }
    filas.sort(function (a, b) { return a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0; });
    return filas;
  }
  /* La acción que rige hoy sobre un material: la individual manda sobre la masiva. */
  function accionDep(cod) {
    var ind = depu.materiales[cod];
    if (ind && ind.accion) return { accion: ind.accion, motivo: ind.motivo || "",
                                    fuente: "individual", quien: ind.quien, cuando: ind.cuando,
                                    excepcion: !!(depu.politica && ind.accion !== depu.politica.accion) };
    if (depu.politica) return { accion: depu.politica.accion, motivo: depu.politica.criterio || "",
                                fuente: "masiva", quien: depu.politica.quien,
                                cuando: depu.politica.cuando, excepcion: false };
    return { accion: "", motivo: "", fuente: "", excepcion: false };
  }
  /* Casos de alta ligados a la depuración: si se crea un código nuevo sin verificar,
     el viejo —si existe— hay que encontrarlo y limpiarlo. */
  function ligadosDep() {
    return D.casos.filter(function (c) { return !!efectivo(c).depuracion; });
  }

  function pintarDepurar() {
    var filas = universoDep(), lig = ligadosDep();
    var cuenta = { "": 0 }; DP_ACCIONES.forEach(function (a) { cuenta[a] = 0; });
    var exc = 0;
    filas.forEach(function (f) {
      var a = accionDep(f.codigo);
      cuenta[a.accion] = (cuenta[a.accion] || 0) + 1;
      if (a.excepcion) exc++;
    });
    var decididos = filas.length - (cuenta[""] || 0);
    var deBajada = filas.filter(function (f) { return f.origen.indexOf("Bajada") === 0; }).length;

    var h = '<div class="cabi"><div><h1>Depuración del maestro de materiales</h1>' +
      '<p class="sub">Materiales que figuran en SAP <b>con existencia cero</b>. No son ' +
      "candidatos a baja de stock —no hay stock— sino registros del maestro sobre los que " +
      "hay que decidir: se mantienen, se bloquean o se dan de baja. Se puede decidir de a " +
      "uno o en masa, con excepciones anotadas.</p></div>" +
      '<div class="globo"><div class="k">Avance</div><div class="n">' +
      (filas.length ? Math.round(decididos / filas.length * 100) : 0) + "%</div>" +
      '<div class="d">' + num(decididos) + " de " + num(filas.length) + " con acción definida</div>" +
      '<div class="pbar grande"><i style="width:' +
      (filas.length ? decididos / filas.length * 100 : 0) + '%"></i></div></div></div>';

    // ---- alcance honesto
    h += '<div class="aviso"><b>Lo que ves acá no es todo el universo a depurar.</b>' +
      "La bajada de SAP que tenemos trae los materiales <b>con stock</b>. Estos " +
      num(deBajada) + " aparecieron igual con existencia cero: son la <b>punta visible</b>. " +
      "Cuántos materiales tiene el maestro completo en cero <b>no se puede saber con los " +
      "archivos recibidos</b>. Por eso la política masiva se define igual, pero su alcance " +
      "real queda sujeto al maestro completo.";
    if (depu.maestro) h += "<br><br><b>Maestro importado:</b> " + esc(depu.maestro.nombre) +
      " · " + num(depu.maestro.filas.length) + " materiales sin stock · importado el " +
      esc(fecha(depu.maestro.cuando)) + ".";
    h += "</div>";

    // ---- importar el maestro
    h += '<div class="panelito"><h2 class="ph">Traer el maestro completo</h2>' +
      '<p class="pnota">Si conseguís la exportación del maestro de materiales (MM60 o ' +
      "equivalente), importala en CSV y el universo de depuración se completa solo. El " +
      "archivo no se sube a ningún lado: se lee en esta misma computadora.</p>" +
      '<p class="pnota"><b>Qué columnas necesita:</b> una con el código de material ' +
      "(«Material», «Código» o «Nº material»), y opcionalmente descripción, tipo de " +
      "material y stock. Las filas con stock distinto de cero se ignoran.</p>" +
      '<div class="impfila"><input type="file" id="depArch" accept=".csv,.txt,.tsv">' +
      (depu.maestro ? '<button class="btn chico" id="depQuitar">Quitar el maestro importado</button>' : "") +
      '</div><div id="depMsg" class="mini"></div></div>';

    // ---- política masiva
    h += "<h2>Decisión masiva</h2>";
    if (!depu.politica) {
      h += '<div class="panelito"><p class="pnota">No hay ninguna política masiva definida: ' +
        "hoy cada material se decide de a uno. Si querés resolver todo el conjunto de una " +
        "vez —y después anotar las excepciones— definí una política.</p>" +
        '<button class="btn pri" id="depPol">Definir una política masiva</button></div>';
    } else {
      var p = depu.politica;
      h += '<div class="panelito polact"><div class="poltit"><span class="et ' +
        (p.accion === DP_BAJA ? "C" : p.accion === DP_BLOQ ? "D" : "A") + '">' +
        esc(p.accion) + "</span><b>Política masiva vigente</b></div>" +
        '<table class="listalotes"><tbody>' +
        "<tr><td>Acción</td><td><b>" + esc(p.accion) + "</b></td></tr>" +
        "<tr><td>Alcance</td><td>" + esc(p.alcance) + "</td></tr>" +
        "<tr><td>Criterio</td><td>" + (p.criterio ? esc(p.criterio) : "<i>sin criterio escrito</i>") + "</td></tr>" +
        "<tr><td>Quién y cuándo</td><td>" + esc(p.quien) + " · " + esc(fecha(p.cuando)) + "</td></tr>" +
        "<tr><td>Excepciones registradas</td><td><b>" + num(exc) + "</b>" +
        (exc ? " material" + (exc === 1 ? "" : "es") + " con una decisión distinta de la masiva" : "") +
        "</td></tr></tbody></table>" +
        '<div class="polacc"><button class="btn" id="depPol">Cambiar la política</button>' +
        '<button class="btn no" id="depPolNo">Quitar la política</button></div></div>';
      h += '<div class="aviso info"><b>Esto es una propuesta, no una ejecución.</b>' +
        "Definir una política masiva no modifica SAP ni da de baja nada. Deja escrito qué se " +
        "decidió, con qué criterio, quién lo decidió y sobre qué materiales, para que la " +
        "ejecución posterior tenga un respaldo.</div>";
    }

    // ---- resumen por acción
    function kdep(color, titulo, n, det, filtro) {
      return '<button class="kpi ' + color + (estado.depFiltro === filtro ? " activo" : "") +
        '" data-dfil="' + esc(filtro) + '">' +
        '<div class="t"><i class="pt" style="background:var(--c' + color + ')"></i>' +
        esc(titulo) + '</div><div class="n">' + num(n) + '</div><div class="d">' +
        esc(det) + "</div></button>";
    }
    h += '<div class="kpis" style="margin-top:14px">' +
      kdep("E", "Sin decidir", cuenta[""] || 0, "todavía sin acción", "__sin") +
      kdep("A", DP_MANT, cuenta[DP_MANT] || 0, "el registro se conserva", DP_MANT) +
      kdep("D", DP_BLOQ, cuenta[DP_BLOQ] || 0, "no se puede usar, no se borra", DP_BLOQ) +
      kdep("C", DP_BAJA, cuenta[DP_BAJA] || 0, "se propone eliminar el registro", DP_BAJA) +
      "</div>";

    // ---- listado individual
    h += "<h2>Material por material</h2>" +
      '<p class="pnota" style="max-width:92ch">Cada decisión individual <b>manda sobre la ' +
      "masiva</b>: si elegís algo distinto de la política, el material queda anotado como " +
      "<b>excepción</b> y se informa como tal. Para sacar una excepción, volvé a dejarla " +
      "en «Según la política».</p>";
    if (estado.depFiltro) h += '<div class="dfil">Mostrando sólo <b>' +
      esc(estado.depFiltro === "__sin" ? "los que están sin decidir" : estado.depFiltro) +
      '</b> <button class="enlace" id="depFilNo">ver todos</button></div>';
    var vista = filas.filter(function (f) {
      if (!estado.depFiltro) return true;
      var a = accionDep(f.codigo);
      return estado.depFiltro === "__sin" ? !a.accion : a.accion === estado.depFiltro;
    });
    h += '<div class="tablabox"><table><thead><tr>' +
      "<th>Material</th><th>Tipo</th><th>De dónde sale</th><th>Acción</th>" +
      "<th>Quién decidió</th></tr></thead><tbody>";
    if (!vista.length) h += '<tr><td colspan="5" class="vacio">No hay materiales ' +
      (estado.depFiltro ? "con ese estado." : "sin stock en el universo visible.") + "</td></tr>";
    vista.forEach(function (f) {
      var a = accionDep(f.codigo);
      h += '<tr><td><b class="dcod">' + esc(f.codigo) + "</b>" +
        '<div class="mini">' + esc(f.texto || "—") + "</div></td>" +
        "<td>" + esc(f.tipo || "—") + (f.base ? '<div class="mini">' + esc(f.base) + "</div>" : "") + "</td>" +
        '<td class="mini">' + esc(f.origen) + "</td>" +
        '<td><div class="depacc">' +
        DP_ACCIONES.map(function (ac) {
          return '<button class="dbot' + (a.accion === ac ? " on" : "") +
            '" data-cod="' + esc(f.codigo) + '" data-acc="' + esc(ac) + '">' + esc(ac) + "</button>";
        }).join("") +
        (depu.politica
          ? '<button class="dbot' + (a.fuente === "masiva" ? " on" : "") +
            '" data-cod="' + esc(f.codigo) + '" data-acc="__pol">Según la política</button>'
          : "") +
        "</div>" +
        (a.excepcion ? '<div class="mini exc">excepción a la política masiva</div>' : "") +
        (a.fuente === "individual" && a.motivo ? '<div class="mini">' + esc(a.motivo) + "</div>" : "") +
        "</td>" +
        '<td class="mini">' + (a.fuente === "individual"
          ? esc(a.quien || "—") + "<br>" + esc(fecha(a.cuando))
          : a.fuente === "masiva" ? "por la política masiva" : "—") + "</td></tr>";
    });
    h += "</tbody></table></div>";

    // ---- ligados por decisiones de alta
    h += "<h2>Ligado a las decisiones de alta</h2>";
    if (!lig.length) {
      h += '<div class="panelito"><p class="pnota">Todavía no hay ninguna decisión de alta ' +
        "ligada a la depuración. Cuando en el grupo 2 se elija <b>crear un material sin " +
        "verificar el maestro</b>, o se verifique que existe sin stock y se decida " +
        "<b>darlo de baja y crearlo de nuevo</b>, el caso aparece acá.</p></div>";
    } else {
      h += '<p class="pnota" style="max-width:92ch">Son las dos caras de la misma decisión: ' +
        "crear un código nuevo sin haber verificado el maestro puede dejar un duplicado, y " +
        "ese duplicado es exactamente lo que hay que depurar. Quedan listados juntos para " +
        "que la búsqueda en el maestro se haga una sola vez.</p>";
      h += '<div class="tablabox"><table><thead><tr><th>Ítem del depósito</th><th>Base</th>' +
        "<th>Qué se decidió</th><th>Código a buscar</th><th>Quién</th></tr></thead><tbody>";
      lig.forEach(function (c) {
        var e = efectivo(c);
        h += '<tr data-ficha="' + esc(c.id) + '" class="clic"><td><b>' +
          esc(c.nombre_fisico || c.texto_sap || "—") + "</b>" +
          '<div class="mini">' + esc(c.tipo) + "</div></td>" +
          "<td>" + esc(c.base) + "</td>" +
          "<td>" + esc(e.verificacion || e.ruta_b || "—") +
          (e.riesgo_duplicado ? '<div class="mini exc">riesgo de duplicado ' +
            esc(e.riesgo_duplicado.toLowerCase()) + "</div>" : "") + "</td>" +
          '<td class="dcod">' + esc(e.codigo_maestro || "—") + "</td>" +
          '<td class="mini">' + esc(e.revisor || "—") + "</td></tr>";
      });
      h += "</tbody></table></div>";
    }

    // ---- qué falta
    h += "<h2>Qué falta para poder ejecutar esto</h2>" +
      '<div class="panelito"><ol class="falta">' +
      ["El <b>maestro completo de materiales</b> de SAP. Sin él no se sabe cuántos " +
       "materiales hay en cero ni desde cuándo.",
       "La <b>fecha del último movimiento</b> de cada material. Un material sin stock que " +
       "se consumió el mes pasado no es lo mismo que uno sin movimiento desde hace tres años.",
       "Si el material está <b>incluido en algún contrato, protocolo o vademécum vigente</b>. " +
       "Eso puede obligar a mantenerlo aunque no tenga stock.",
       "Quién <b>autoriza</b> la baja de un registro del maestro y con qué circuito. Esta " +
       "herramienta deja la propuesta; no la ejecuta."]
      .map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol></div>";

    // ---- historial
    if (depu.historial && depu.historial.length) {
      h += "<h2>Historial de la depuración</h2><div class=\"panelito\">" +
        depu.historial.slice().reverse().slice(0, 40).map(function (x) {
          return '<div class="hist"><b>' + esc(x.que) + '</b><span class="cuando">' +
            esc(x.quien) + " · " + esc(fecha(x.cuando)) + "</span></div>";
        }).join("") + "</div>";
    }

    var el = document.getElementById("v-depurar");
    el.innerHTML = h;
    var arch = el.querySelector("#depArch");
    if (arch) arch.addEventListener("change", function () { importarMaestro(arch); });
    var q = el.querySelector("#depQuitar");
    if (q) q.addEventListener("click", function () {
      if (!confirm("Se quita el maestro importado. Las decisiones ya tomadas se conservan. ¿Seguir?")) return;
      depu.maestro = null; anotarDep("Se quitó el maestro importado");
      guardarDep(); pintarDepurar();
    });
    var bp = el.querySelector("#depPol");
    if (bp) bp.addEventListener("click", modalPolitica);
    var bn = el.querySelector("#depPolNo");
    if (bn) bn.addEventListener("click", function () {
      if (!confirm("Se quita la política masiva. Las decisiones individuales se conservan. ¿Seguir?")) return;
      depu.politica = null; anotarDep("Se quitó la política masiva");
      guardarDep(); aviso("Política quitada."); pintarDepurar();
    });
    el.querySelectorAll(".dbot").forEach(function (b) {
      b.addEventListener("click", function () { decidirMaterial(b.dataset.cod, b.dataset.acc); }); });
    el.querySelectorAll("[data-ficha]").forEach(function (t) {
      t.addEventListener("click", function () {
        estado.volverA = "depurar"; ir("ficha", t.dataset.ficha); }); });
    el.querySelectorAll("[data-dfil]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.depFiltro = estado.depFiltro === b.dataset.dfil ? "" : b.dataset.dfil;
        pintarDepurar(); }); });
    var fn = el.querySelector("#depFilNo");
    if (fn) fn.addEventListener("click", function () {
      estado.depFiltro = ""; pintarDepurar(); });
  }

  function decidirMaterial(cod, acc) {
    if (acc === "__pol") {
      delete depu.materiales[cod];
      anotarDep("El material " + cod + " vuelve a seguir la política masiva");
      guardarDep(); pintarDepurar();
      return aviso(cod + " vuelve a la política masiva.");
    }
    var actual = depu.materiales[cod];
    if (actual && actual.accion === acc) {
      delete depu.materiales[cod];
      anotarDep("Se quitó la decisión individual sobre " + cod);
      guardarDep(); pintarDepurar(); return;
    }
    var esExc = depu.politica && acc !== depu.politica.accion;
    var motivo = "";
    if (esExc) {
      motivo = prompt("Es una excepción a la política masiva («" + depu.politica.accion +
                      "»).\nTiene que quedar escrito por qué este material va por otro camino:", "");
      if (motivo === null) return;
      motivo = motivo.trim();
      if (!motivo) return aviso("La excepción necesita un motivo escrito.");
    }
    depu.materiales[cod] = { accion: acc, motivo: motivo,
                             quien: revisor || "(sin identificar)",
                             cuando: new Date().toISOString() };
    anotarDep((esExc ? "Excepción · " : "") + cod + " → " + acc + (motivo ? " · " + motivo : ""));
    guardarDep(); pintarDepurar();
    aviso(cod + " → " + acc + (esExc ? " (excepción registrada)" : ""));
  }

  function modalPolitica() {
    var p = depu.politica || {};
    var h = '<div class="modalfondo"><div class="modal ancho">' +
      "<h2>Política masiva de depuración</h2>" +
      '<p class="sub">Una sola decisión para todos los materiales sin stock, con las ' +
      "excepciones que después quieras anotar de a una. No ejecuta nada en SAP.</p>";
    h += '<div class="polopc">' + DP_ACCIONES.map(function (a, i) {
      var txt = [["Mantener", "El registro queda como está. Es lo más conservador: no se " +
                  "pierde histórico ni se rompe ninguna referencia, pero el maestro sigue creciendo."],
                 ["Bloquear", "El material no se puede usar en documentos nuevos, pero el " +
                  "registro y su histórico se conservan. Es el camino intermedio y el " +
                  "reversible: si hizo falta, se desbloquea."],
                 ["Dar de baja del maestro", "Se propone eliminar el registro. Es el más " +
                  "drástico y el más difícil de volver atrás: hay que estar seguro de que " +
                  "no queda ninguna referencia viva."]][i];
      return '<label class="polopcion"><input type="radio" name="polacc" value="' + esc(a) +
        '"' + (p.accion === a ? " checked" : "") + "> <span><b>" + esc(txt[0]) + "</b>" +
        esc(txt[1]) + "</span></label>";
    }).join("") + "</div>";
    h += '<label class="k" style="display:block;margin-top:16px">Hasta dónde llega</label>' +
      '<select id="polAlc" class="selalc">' +
      ["Sólo los materiales sin stock que están a la vista",
       "Todos los materiales sin stock del maestro completo, cuando se consiga"]
      .map(function (x) {
        return "<option" + (p.alcance === x ? " selected" : "") + ">" + esc(x) + "</option>";
      }).join("") + "</select>";
    h += '<label class="k" style="display:block;margin-top:14px">Con qué criterio ' +
      "(queda escrito en el informe)</label>" +
      '<textarea id="polCrit" placeholder="Ej.: se bloquean todos los materiales sin stock y sin movimiento en los últimos 24 meses; los de contrato vigente quedan como excepción…">' +
      esc(p.criterio || "") + "</textarea>";
    h += '<div class="aviso" style="margin-top:16px"><b>Lo que esta decisión no puede ' +
      "saber todavía.</b>No tenemos el maestro completo ni la fecha de último movimiento " +
      "de cada material. Una política masiva definida hoy se aplica sobre lo que está a la " +
      "vista; sobre el resto queda como criterio acordado, para aplicarlo cuando llegue el " +
      "dato.</div>";
    h += '<div class="modalacc"><span class="mini">Queda registrada con tu nombre y la fecha.</span>' +
      '<button class="btn" id="polCancel">Cancelar</button>' +
      '<button class="btn pri" id="polOk">Guardar la política</button></div>';
    h += "</div></div>";
    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");
    function cerrar() { modal.remove(); }
    modal.querySelector("#polCancel").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });
    modal.querySelector("#polOk").addEventListener("click", function () {
      var r = modal.querySelector('input[name="polacc"]:checked');
      if (!r) return aviso("Elegí una acción.");
      var crit = modal.querySelector("#polCrit").value.trim();
      if (!crit) return aviso("Escribí el criterio: sin criterio la decisión no se puede defender.");
      depu.politica = { accion: r.value, alcance: modal.querySelector("#polAlc").value,
                        criterio: crit, quien: revisor || "(sin identificar)",
                        cuando: new Date().toISOString() };
      anotarDep("Política masiva: " + r.value + " · " + depu.politica.alcance + " · " + crit);
      guardarDep(); cerrar(); aviso("Política masiva registrada."); pintarDepurar();
    });
  }

  /* Lectura del maestro en CSV. Se hace en el navegador: el archivo no sale de acá. */
  function importarMaestro(input) {
    var f = input.files && input.files[0];
    var msg = document.getElementById("depMsg");
    if (!f) return;
    var lector = new FileReader();
    lector.onload = function () {
      var r;
      try { r = leerCsvMaestro(String(lector.result)); }
      catch (err) { msg.className = "mini exc"; msg.textContent = "No se pudo leer: " + err.message; return; }
      if (!r.filas.length) {
        msg.className = "mini exc";
        msg.textContent = "El archivo se leyó (" + r.total + " filas) pero no quedó ningún " +
          "material sin stock. " + r.nota;
        return;
      }
      depu.maestro = { nombre: f.name, filas: r.filas, cuando: new Date().toISOString(),
                       total: r.total, columnas: r.columnas };
      anotarDep("Se importó el maestro «" + f.name + "»: " + r.total + " filas leídas, " +
                r.filas.length + " materiales sin stock");
      guardarDep();
      aviso("Maestro importado: " + r.filas.length + " materiales sin stock.");
      pintarDepurar();
    };
    lector.onerror = function () {
      msg.className = "mini exc"; msg.textContent = "No se pudo abrir el archivo.";
    };
    lector.readAsText(f, "utf-8");
  }
  function leerCsvMaestro(txt) {
    var lineas = txt.split(/\r?\n/).filter(function (x) { return x.trim(); });
    if (lineas.length < 2) throw new Error("el archivo no tiene filas de datos.");
    var sep = [";", "\t", ","].map(function (s) {
      return { s: s, n: lineas[0].split(s).length }; })
      .sort(function (a, b) { return b.n - a.n; })[0];
    if (sep.n < 2) throw new Error("no se reconoce el separador de columnas (; , o tabulación).");
    function celdas(l) {
      return l.split(sep.s).map(function (x) {
        return x.trim().replace(/^"(.*)"$/, "$1").trim(); });
    }
    var cab = celdas(lineas[0]).map(function (x) {
      return x.toLowerCase().replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim(); });
    function col(res) {
      for (var i = 0; i < cab.length; i++)
        for (var j = 0; j < res.length; j++) if (res[j].test(cab[i])) return i;
      return -1;
    }
    var iCod = col([/^material$/, /^n material$/, /^no material$/, /^codigo$/, /^c digo$/,
                    /material/, /codigo/]);
    if (iCod < 0) throw new Error("no se encontró la columna con el código de material.");
    var iTxt = col([/descripcion/, /denominacion/, /texto breve/, /^texto$/, /^descripci n$/]);
    var iTipo = col([/tipo de material/, /^tipo$/, /^tm$/]);
    var iStk = col([/libre utilizacion/, /^stock$/, /existencia/, /cantidad/, /^utilizaci n libre$/]);
    var filas = [], total = 0;
    for (var i = 1; i < lineas.length; i++) {
      var c = celdas(lineas[i]);
      var cod = (c[iCod] || "").replace(/^0+(?=\d)/, "");
      if (!cod) continue;
      total++;
      if (iStk >= 0) {
        var v = (c[iStk] || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
        if (v && Math.abs(parseFloat(v)) > 0.0001) continue;   // tiene stock: no es de depuración
      }
      filas.push({ codigo: cod, texto: iTxt >= 0 ? c[iTxt] || "" : "",
                   tipo: iTipo >= 0 ? c[iTipo] || "" : "" });
    }
    return { filas: filas, total: total, columnas: cab,
             nota: iStk < 0 ? "No se encontró columna de stock: se tomaron todas las filas."
                            : "Se descartaron las filas con stock distinto de cero." };
  }

  // ------------------------------------------------------------- AYUDA
  function pintarAyuda() {
    document.getElementById("v-ayuda").innerHTML =
      '<h1>Cómo se usa</h1><p class="sub">Dos minutos y ya se puede trabajar.</p>' +
      '<div class="bloque"><h3>En una frase</h3><p>Una herramienta para decidir qué producto ' +
      'del inventario físico corresponde a qué código de SAP, qué hay que crear y qué sobra. ' +
      '<b>No modifica SAP:</b> todo lo que aprobás queda como propuesta documentada, con tu ' +
      'nombre y la fecha.</p></div>' +
      '<div class="bloque"><h3>El camino corto</h3><ol style="padding-left:19px;color:var(--tinta2)">' +
      "<li>Escribí tu nombre arriba, en <b>Revisor</b>.</li>" +
      "<li>Andá a <b>Inicio</b>. Está el trabajo en siete grupos, ordenados por prioridad.</li>" +
      "<li>Apretá <b>Revisar de a uno</b> en el grupo 1: te muestra un caso por pantalla con " +
      "los candidatos. Elegís con el teclado y pasa solo al siguiente.</li>" +
      "<li>Los grupos grandes (bajas, identificaciones) tienen <b>Decidir en lote</b>: se " +
      "resuelven por base de una sola vez.</li>" +
      "<li>Al terminar, <b>Descargar Excel</b>: es tu respaldo y la forma de compartirlo.</li>" +
      "</ol></div>" +
      '<div class="bloque"><h3>Atajos del modo revisión</h3><p>' +
      "<kbd>1</kbd>…<kbd>9</kbd> elegir un candidato · <kbd>A</kbd> aprobar o confirmar · " +
      "<kbd>R</kbd> rechazar · <kbd>N</kbd> ninguno corresponde · <kbd>X</kbd> no puedo " +
      "decidirlo ahora · <kbd>→</kbd> saltear · <kbd>F</kbd> ver la ficha completa.</p>" +
      "<p>En el <b>grupo 2</b> los números eligen la alternativa (<kbd>1</kbd> verificar, " +
      "<kbd>2</kbd> crear igual) y después el resultado de la verificación. En el <b>grupo " +
      "5</b> eligen qué se hace con la ubicación.</p></div>" +

      '<div class="bloque"><h3>Las dos alternativas del grupo 2</h3>' +
      "<p>Un ítem que no aparece entre los materiales con stock <b>no está probado que no " +
      "exista en SAP</b>. Por eso el sistema no decide solo: te pregunta cuál de los dos " +
      "caminos querés tomar.</p>" +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>Alternativa 1</b><br>Verificar antes de crear</td>' +
      "<td>Se consulta el maestro completo antes de crear nada. Si el material ya existe " +
      "con stock cero, se decide si se reutiliza el código o se da de baja y se crea de " +
      "nuevo. Es el camino que evita el código duplicado. El caso queda abierto hasta que " +
      "cargues el resultado de esa consulta.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Alternativa 2</b><br>Crear igual, sin verificar</td>' +
      "<td>El sistema <b>no te lo impide</b> por no tener el maestro. Te lo pregunta " +
      "expresamente, te muestra el riesgo —un código duplicado, con el stock y el histórico " +
      "partidos— y te pide que lo confirmes marcando que lo entendés. La decisión queda " +
      "registrada con tu nombre y se liga al plan de depuración del maestro.</td></tr>" +
      "</tbody></table></div>" +

      '<div class="bloque"><h3>La depuración del maestro</h3>' +
      "<p>En la solapa <b>Maestro</b> están los materiales que figuran en SAP con " +
      "<b>existencia cero</b>. No son candidatos a baja de stock —no hay stock— sino " +
      "registros del maestro: se <b>mantienen</b>, se <b>bloquean</b> o se <b>dan de " +
      "baja</b>.</p>" +
      "<p>Se puede decidir de a uno o definir una <b>política masiva</b> para todo el " +
      "conjunto. La decisión individual siempre manda sobre la masiva: cuando difiere, el " +
      "material queda anotado como <b>excepción</b>, con su motivo escrito.</p>" +
      "<p><b>Lo que ves ahí no es todo el universo.</b> La bajada trae los materiales con " +
      "stock; éstos aparecieron igual con existencia cero y son la punta visible. Si " +
      "conseguís el maestro completo, se puede <b>importar en CSV</b> desde esa misma " +
      "pantalla y el universo se completa.</p>" +
      "<p>Las dos cosas están ligadas: crear un código nuevo sin verificar puede dejar un " +
      "duplicado, y ese duplicado es exactamente lo que hay que depurar.</p></div>" +

      '<div class="bloque"><h3>Centro, almacén y ubicación</h3>' +
      "<p>El <b>centro</b> es la base; el <b>almacén</b> es el depósito dentro de esa base. " +
      "Son dos campos distintos de SAP y el sistema los trata por separado.</p>" +
      "<p>Una cosa es que el material esté bien <b>identificado</b>, otra que tenga " +
      "<b>stock</b>, y otra que ese stock esté en el <b>almacén que corresponde</b>. Un " +
      "material perfectamente identificado puede figurar en el almacén equivocado: eso no " +
      "lo convierte en candidato a alta ni a baja.</p>" +
      "<p>Qué almacén <i>pertenece</i> a cada base <b>está observado</b> en la bajada: cada " +
      "código aparece bajo un único centro. Qué almacén <i>debería</i> tener el stock de " +
      "farmacia es una <b>propuesta a validar</b>, deducida de la composición observada. " +
      "La descripción de los almacenes no viene en los archivos: sólo el código.</p></div>" +
      '<div class="bloque"><h3>Qué significa cada grupo</h3><table class="listalotes"><tbody>' +
      [["Resolver los casos en revisión", "El cruce encontró algo parecido pero no pudo confirmarlo por las características. Lo decide una persona."],
       ["Verificar los que no aparecieron", "Existen físicamente y no están entre los materiales con stock en SAP. Pueden existir en el maestro sin stock: hay que verificarlo."],
       ["Registrar existencias", "El código existe y el producto está, pero SAP no registra stock en esa base. No son altas."],
       ["Confirmar identificaciones", "Ya tienen código verificado por nomenclatura y presentación. Sólo hay que dar el visto bueno."],
       ["Aprobar las bajas", "Material con stock en SAP que ningún inventario identificó en esa base."],
       ["Corregir la ubicación", "El material está bien identificado pero su stock figura en un almacén distinto del propuesto, o repartido en varios."],
       ["Depurar el maestro", "Materiales que figuran en SAP con existencia cero. No hay stock que dar de baja: se decide qué pasa con el registro."],
       ["Fuera del alcance", "Indumentaria, equipos y repuestos. El inventario es de Farmacia: su ausencia no prueba nada."]]
      .map(function (x) {
        return "<tr><td style=\"white-space:nowrap\"><b>" + esc(x[0]) + "</b></td><td>" +
               esc(x[1]) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<div class="bloque"><h3>Contra qué se cruza (importante)</h3><p>La contraparte es la ' +
      '<b>bajada de stock de SAP</b>, no el maestro completo de materiales: <b>sólo los ' +
      'materiales que hoy tienen existencia</b>. Un material dado de alta con stock cero no ' +
      'figura.</p><p>Consecuencia práctica: cuando un ítem del depósito no encuentra ' +
      'correspondencia, <b>no está probado que no exista en SAP</b>. Puede existir sin stock. ' +
      'Por eso el grupo 2 no dice «dar de alta» sino «verificar en el maestro». Esa ' +
      'verificación —y la decisión de reutilizar el código o darlo de baja y crearlo de ' +
      'nuevo— <b>está fuera del alcance</b> de este trabajo.</p></div>' +
      '<div class="bloque"><h3>Cómo se decide una coincidencia</h3><p>El parecido del nombre ' +
      'genera el candidato; <b>las características deciden</b>: concentración, forma, volumen, ' +
      'calibre, medidas, talle, modelo, longitud y población. Si los dos lados declaran la misma ' +
      'característica con valores distintos, no son el mismo material. Si una se declara de un ' +
      'lado y no del otro, el caso va a revisión. Por eso hay tantos casos en el grupo 1: es a ' +
      'propósito.</p></div>' +
      '<div class="bloque"><h3>Dónde se guardan las decisiones</h3><p>En este navegador, en esta ' +
      'computadora. No se sincronizan ni se envían a ningún lado. <b>Exportá el Excel al ' +
      'terminar cada sesión</b>: es el respaldo y la forma de compartir lo decidido. Trae una ' +
      'hoja «Decisiones» con todo el historial.</p></div>' +
      '<div class="bloque"><h3>La valorización</h3><p>El criterio pedido es <b>precio de última ' +
      'compra</b> y ese dato <b>no existe en los archivos recibidos</b>. Por eso no se informa ' +
      'ninguna valorización. Lo que sí se muestra, siempre rotulado, es la valorización de stock ' +
      'de SAP: el valor contable dividido por las unidades. No es lo mismo.</p></div>';
  }

  // ------------------------------------------------------------- varios
  function aviso(txt) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }
  function medirBarra() {
    var b = document.querySelector(".barra");
    if (b) document.documentElement.style.setProperty(
      "--alto-barra", Math.ceil(b.getBoundingClientRect().height) + "px");
  }

  function iniciar() {
    cargar(); medirBarra();
    window.addEventListener("resize", medirBarra);
    document.addEventListener("keydown", teclas);
    var inp = document.getElementById("revisor");
    inp.value = revisor;
    inp.addEventListener("input", function () {
      revisor = inp.value;
      try { localStorage.setItem(CLAVE_REV, revisor); } catch (e) {} });
    document.querySelectorAll("#nav button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.vista === "revisar" && !estado.triage.length) return ir("inicio");
        ir(b.dataset.vista); }); });
    document.getElementById("bTema").addEventListener("click", function () {
      var r = document.documentElement, hay = r.getAttribute("data-theme");
      var osc = hay ? hay === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      r.setAttribute("data-theme", osc ? "light" : "dark"); });
    document.getElementById("bExcel").addEventListener("click", function () {
      Exportar.excel(); aviso("Excel generado con tus decisiones."); });
    document.getElementById("bPdf").addEventListener("click", function () {
      ir("informe"); setTimeout(function () { window.print(); }, 350); });
    ir("inicio");
  }

  return { iniciar: iniciar, ir: ir, esc: esc, num: num, pesos: pesos, fecha: fecha,
           efectivo: efectivo, filtrados: filtrados, conteos: conteos,
           depuracion: function () { return depu; }, universoDep: universoDep,
           accionDep: accionDep, ligadosDep: ligadosDep, etapaB: etapaB,
           RB: { VERIF: RB_VERIF, CREAR: RB_CREAR, NO: VER_NO, REUSA: VER_REUSA, NUEVO: VER_NUEVO },
           DP: { MANT: DP_MANT, BLOQ: DP_BLOQ, BAJA: DP_BAJA, ACCIONES: DP_ACCIONES },
           decisiones: function () { return decisiones; }, datos: function () { return D; },
           revisor: function () { return revisor; }, LETRA: LETRA, CORTO: CORTO };
})();
