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
  var CLAVE_REV = "invsap.revisor";
  var LETRA = { "A · Identificado en SAP": "A", "B · Candidato a alta": "B",
                "C · Candidato a baja": "C", "D · Requiere revisión": "D",
                "E · Fuera del alcance": "E" };
  var CORTO = { A: "Identificados", B: "Pendientes de alta", C: "Candidatos a baja",
                D: "En revisión", E: "Fuera del alcance" };

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
    { id: "altas", titulo: "Validar las altas propuestas",
      desc: "Existen físicamente y no hay en SAP ningún material que se corresponda. " +
            "Aprobar significa proponer su creación, no crearlos.",
      pred: function (c) { return L(c) === "B"; }, lote: true, color: "B" },
    { id: "existencias", titulo: "Registrar existencias que SAP no tiene",
      desc: "Están identificados y el código existe, pero SAP no registra stock de ese " +
            "material en esa base. No son altas: falta registrar la existencia.",
      pred: function (c) { return L(c) === "A" && sinStock(c); }, lote: true, color: "A" },
    { id: "identificados", titulo: "Confirmar las identificaciones",
      desc: "Ya tienen un código verificado por nomenclatura y presentación. Sólo hay que " +
            "confirmarlas o corregir las que no correspondan.",
      pred: function (c) { return L(c) === "A" && !sinStock(c); }, lote: true, color: "A" },
    { id: "bajas", titulo: "Aprobar las bajas propuestas",
      desc: "Material con stock en SAP que ningún inventario físico identificó en esa base. " +
            "Aprobar significa proponer la baja, no ejecutarla.",
      pred: function (c) { return L(c) === "C"; }, lote: true, color: "C" },
  ];

  var estado = {
    vista: "inicio",
    filtros: { base: "", tipo: "", clase: "", revision: "", aprobacion: "",
               motivo: "", valorizacion: "", obs: "", texto: "" },
    orden: { campo: "n", desc: false },
    pagina: 1, porPagina: 50,
    fichaId: null, volverA: "casos",
    cola: null, motivo: null, triage: [], tIdx: 0,
    sel: {},
  };
  var decisiones = {}, revisor = "";

  // ------------------------------------------------------------- persistencia
  function cargar() {
    try { decisiones = JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; }
    catch (e) { decisiones = {}; }
    try { revisor = localStorage.getItem(CLAVE_REV) || ""; } catch (e) { revisor = ""; }
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
    decisiones[id] = d; guardar();
  }

  // ------------------------------------------------------------- derivados
  function caso(id) {
    for (var i = 0; i < D.casos.length; i++) if (D.casos[i].id === id) return D.casos[i];
    return null;
  }
  function efectivo(c) {
    var d = dec(c.id) || {};
    return {
      estado_revision: d.estado_revision || c.estado_revision,
      aprobacion: d.aprobacion || c.aprobacion,
      material: d.material_corregido !== undefined && d.material_corregido !== null
                ? d.material_corregido : c.material_sap,
      corregido: d.material_corregido !== undefined && d.material_corregido !== null,
      observaciones: d.observaciones || c.observaciones || "",
      revisor: d.revisor || "", actualizado: d.actualizado || "",
      historial: d.historial || [],
    };
  }
  function pendiente(c) { return efectivo(c).aprobacion === "Sin decidir"; }
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
  function barraProgreso(hechos, total, color) {
    var p = total ? Math.round(hechos / total * 100) : 100;
    return '<div class="prog"><div class="pbar"><i style="width:' + p + "%;background:var(--c" +
      (color || "A") + ')"></i></div><span>' + num(hechos) + " de " + num(total) +
      " · " + p + "%</span></div>";
  }

  // ------------------------------------------------------------- navegación
  var VISTAS = ["inicio", "revisar", "casos", "ficha", "informe", "ayuda"];
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
    if (vista === "informe") document.getElementById("v-informe").innerHTML = Exportar.informeHtml();
    if (vista === "ayuda") pintarAyuda();
    window.scrollTo(0, 0);
  }

  function abrirCola(id, motivo) {
    var q = colaPor(id);
    estado.cola = id; estado.motivo = motivo || null;
    estado.triage = deCola(id).filter(function (c) {
      return pendiente(c) && (!motivo || c.motivo === motivo);
    });
    estado.tIdx = 0;
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
                       motivo: "", valorizacion: "", obs: "", texto: "", grupo: "" };
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
      var pend = todos.filter(pendiente);
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

      if (q.id === "bajas" && !listo) {
        var bloq = pend.filter(function (c) { return c.bloqueado_por_revision; }).length;
        if (bloq) h += '<div class="cnota">⚠ ' + num(bloq) + " de estas bajas dependen de un " +
          "caso del grupo 1. Conviene resolver esos primero: pueden dejar de ser bajas.</div>";
      }
      h += "</div>";

      h += '<div class="cacc">' + (listo
        ? '<div class="cpend ok">' + num(todos.length) + "<small>resueltos</small></div>"
        : '<div class="cpend">' + num(pend.length) + "<small>pendientes</small></div>") +
        (listo ? "" :
          '<button class="btn pri" data-rev="' + q.id + '">Revisar de a uno</button>' +
          (q.lote ? '<button class="btn" data-lote="' + q.id + '">Decidir en lote</button>' : "")) +
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

    h += '<h2>Antes de cerrar, dos cosas</h2>';
    h += '<div class="aviso"><b>No hay precio de última compra en los archivos recibidos.</b>' +
      'Se revisaron la bajada de SAP (tiene valor de stock, no precio de compra), la ' +
      'homologación (declara que los costos quedan fuera) y los tres PDF de inventario ' +
      '(ninguna mención de precio). Por eso no se informa ninguna valorización. El sistema ' +
      'la calcula sola apenas se cargue el dato.</div>';
    h += '<div class="aviso info"><b>Nada de esto modifica SAP.</b>' +
      'Aprobar un alta o una baja deja registrada una propuesta con tu nombre y la fecha. ' +
      'La ejecución es un paso posterior, fuera de esta herramienta.</div>';

    var el = document.getElementById("v-inicio");
    el.innerHTML = h;
    el.querySelectorAll("[data-rev]").forEach(function (b) {
      b.addEventListener("click", function () { abrirCola(b.dataset.rev); }); });
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

    h += '<div class="tcaso" id="tFoco" tabindex="-1"><div class="tizq">';
    h += '<div class="tcab"><span class="et ' + L(c) + '"><i class="pt" style="background:var(--c' +
      L(c) + ')"></i>' + L(c) + " · " + CORTO[L(c)] + "</span>" +
      '<span class="mini">' + esc(c.base) + " · " + esc(c.sistema_origen) + " · " +
      esc(c.tipo) + "</span></div>";
    h += "<h1>" + esc(c.nombre_fisico || c.texto_sap) + "</h1>";
    h += '<div class="tdatos">' +
      dato("Cantidad", num(cant) + (c.origen === "Inventario físico" ? " unidades contadas" : " en SAP")) +
      dato("Presentación detectada", c.presentacion || "no declara características") +
      (c.codigo_fisico ? dato("Código en el inventario", c.codigo_fisico) : "") +
      (c.texto_sap && c.nombre_fisico ? dato("Descripción en SAP", c.texto_sap) : "") +
      "</div>";
    h += '<div class="tpor"><b>Por qué llegó acá:</b> ' + esc(c.justificacion) + "</div>";

    // candidatos elegibles: el corazón del modo revisión
    var limpios = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });
    var sucios = (c.candidatos || []).filter(function (x) { return x.conflictos.length; });
    if (L(c) === "D" && limpios.length) {
      h += '<h3 class="th">' + (limpios.length === 1
        ? "¿Es este? Hacé clic para confirmarlo"
        : "¿Cuál corresponde? Hacé clic en el correcto") + '</h3><div class="cands">';
      limpios.forEach(function (x, i) {
        h += '<button class="cand" data-mat="' + esc(x.material) + '">' +
          '<span class="ckey">' + (i + 1) + "</span>" +
          '<span class="ctxt"><b>' + esc(x.material) + "</b> " + esc(x.texto) +
          (x.coinciden.length
            ? '<span class="cok">✓ coincide en ' + esc(x.coinciden.join(", ")) + "</span>"
            : '<span class="cno">sin ninguna característica verificada</span>') +
          "</span></button>";
      });
      h += "</div>";
    }
    if (sucios.length) {
      h += '<div class="descart"><b>Descartados:</b> ' + sucios.slice(0, 3).map(function (x) {
        return esc(x.material) + " (difiere en " + esc(x.conflictos.join(", ")) + ")";
      }).join(" · ") + "</div>";
    }
    h += "</div>";

    // ---- acciones de la cola
    h += '<div class="tder"><h3 class="th">Decidir</h3><div class="tacc">';
    if (estado.cola === "revision") {
      h += bot("ok", "n", "No corresponde ninguno · proponer alta", "N");
      h += bot("gris", "x", "No puedo decidirlo ahora", "X");
    } else if (estado.cola === "altas") {
      h += bot("ok", "a", "Aprobar el alta", "A");
      h += bot("no", "r", "Rechazar", "R");
    } else if (estado.cola === "bajas") {
      h += bot("ok", "a", "Aprobar la baja", "A");
      h += bot("no", "r", "Rechazar · el material se usa", "R");
    } else if (estado.cola === "existencias") {
      h += bot("ok", "a", "Registrar la existencia", "A");
      h += bot("no", "r", "No corresponde", "R");
    } else {
      h += bot("ok", "a", "Confirmar la identificación", "A");
      h += bot("no", "r", "No corresponde", "R");
    }
    h += bot("gris", "s", "Saltear", "→");
    h += "</div>";
    h += '<div class="tobs"><label class="k">Observación (opcional)</label>' +
      '<textarea id="tObs" placeholder="Por qué…">' + esc(e.observaciones) + "</textarea></div>";
    h += '<div class="tatajos"><b>Atajos:</b> <kbd>1</kbd>…<kbd>9</kbd> elegir candidato · ' +
      "<kbd>A</kbd> aprobar · <kbd>R</kbd> rechazar · <kbd>→</kbd> saltear · " +
      "<kbd>F</kbd> ver la ficha completa</div>";
    h += '<button class="btn chico" id="tFicha">Ver la ficha completa</button>';
    if (c.bloqueado_por_revision) {
      h += '<div class="cnota" style="margin-top:11px">⚠ Este material figura como posible ' +
        "equivalencia de un ítem todavía en revisión. Si ese caso se resuelve a favor, esta " +
        "baja sería un error.</div>";
    }
    h += "</div></div>";

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
      b.addEventListener("click", function () { elegirCandidato(c, b.dataset.mat); }); });
    el.querySelectorAll("[data-acc]").forEach(function (b) {
      b.addEventListener("click", function () { accionTriage(c, b.dataset.acc); }); });
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
  function avanzar() { estado.tIdx++; pintarTriage(); }

  function elegirCandidato(c, mat) {
    decidir(c.id, conObs({ material_corregido: mat, estado_revision: "Revisado",
                           aprobacion: "Correspondencia confirmada" }),
            "Se eligió el código SAP " + mat + " entre los candidatos");
    aviso("Asignado " + mat + "."); avanzar();
  }
  function accionTriage(c, a) {
    if (a === "s") return avanzar();
    if (a === "x") {
      decidir(c.id, conObs({ estado_revision: "Pendiente de validación" }),
              "Se marcó como pendiente de validación"); return avanzar();
    }
    if (a === "n") {
      decidir(c.id, conObs({ aprobacion: "Aprobado", estado_revision: "Revisado",
                             reclasificado: "Candidato a alta" }),
              "Ningún candidato corresponde: se propone darlo de alta");
      aviso("Propuesto como alta."); return avanzar();
    }
    if (a === "a") {
      var txt = { altas: "Se aprobó la PROPUESTA de alta (no ejecuta nada en SAP)",
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
      var b = document.querySelectorAll(".cand")[parseInt(k, 10) - 1];
      if (b) { ev.preventDefault(); b.click(); }
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
      sel("fClase", "Clasificación", f.clase, ["A", "B", "C", "D", "E"],
          function (v) { return v + " · " + CORTO[v]; }) +
      sel("fMotivo", "Motivo de revisión", f.motivo, D.meta.motivos_revision) +
      sel("fApr", "Estado", f.aprobacion,
          ["__pend", "__hecho", "Aprobado", "Rechazado", "Correspondencia confirmada"],
          function (v) { return v === "__pend" ? "Pendientes" : v === "__hecho" ? "Ya decididos" : v; }) +
      sel("fVal", "Valorización", f.valorizacion, ["pendiente"],
          function () { return "Pendiente"; }) +
      sel("fObs", "Observaciones", f.obs, ["con", "sin"],
          function (v) { return v === "con" ? "Con observación" : "Sin observación"; }) +
      '<button class="btn chico" id="fLimpiar">Limpiar</button>' + "</div>";

    h += '<div class="tablabox"><table><thead><tr>' +
      '<th class="chk"><input type="checkbox" id="selTodos" title="Seleccionar la página"></th>' +
      th("clase", "Clasificación") + th("base", "Base") +
      th("nombre", "Ítem físico / material SAP") + th("material", "Código SAP") +
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
        "<td><b>" + esc(c.nombre_fisico || c.texto_sap) + "</b>" +
          (c.nombre_fisico && c.texto_sap ? '<div class="mini">SAP: ' + esc(c.texto_sap) + "</div>" : "") +
          "</td>" +
        "<td>" + (e.material ? esc(e.material) + (e.corregido ? '<div class="mini">corregido</div>' : "")
                 : (c.material_sugerido ? '<span class="mini">sug. ' + esc(c.material_sugerido) + "</span>" : "—")) + "</td>" +
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
     ["fApr", "aprobacion"], ["fVal", "valorizacion"], ["fObs", "obs"]].forEach(function (par) {
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
    h += '<div class="bloque"><h3>Origen del dato</h3><div class="campos">' +
      campo("Base", c.base) + campo("Centro", c.centro) +
      campo("Sistema de origen", c.sistema_origen) + campo("Informe", c.informe_origen) +
      campo("Código en el inventario físico", c.codigo_fisico || "—") +
      campo("Nomenclatura original", c.nombre_fisico || "—") +
      campo("Presentación detectada", c.presentacion || "—") +
      campo("Cantidad física", c.origen === "Inventario físico"
            ? num(c.cantidad_fisica) + " unidades" : "—", true) + "</div></div>";
    h += '<div class="bloque"><h3>Correspondencia con SAP</h3><div class="campos">' +
      campo("Código SAP", e.material || (c.material_sugerido
            ? c.material_sugerido + " (sugerido, sin confirmar)" : "Sin asignar"), true) +
      campo("Descripción en SAP", c.texto_sap || "—") +
      campo("Atributos verificados", (c.atributos_verificados || []).join(", ") || "ninguno") +
      campo("Confianza del cruce", c.confianza || "—") +
      (c.material_sin_stock_en_base
        ? campo("Atención", "SAP no tiene stock de este material en " + c.base +
                (c.stock_sap_otras_bases && c.stock_sap_otras_bases.length
                 ? ". Sí lo tiene en " + c.stock_sap_otras_bases.join(", ") + "." : ".")) : "") +
      (c.identificado_en_otras_bases && c.identificado_en_otras_bases.length
        ? campo("Identificado en otras bases", c.identificado_en_otras_bases.join(", ")) : "") +
      "</div>";
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
      "<li>Andá a <b>Inicio</b>. Está el trabajo en cinco grupos, ordenados por prioridad.</li>" +
      "<li>Apretá <b>Revisar de a uno</b> en el grupo 1: te muestra un caso por pantalla con " +
      "los candidatos. Elegís con el teclado y pasa solo al siguiente.</li>" +
      "<li>Los grupos grandes (bajas, identificaciones) tienen <b>Decidir en lote</b>: se " +
      "resuelven por base de una sola vez.</li>" +
      "<li>Al terminar, <b>Descargar Excel</b>: es tu respaldo y la forma de compartirlo.</li>" +
      "</ol></div>" +
      '<div class="bloque"><h3>Atajos del modo revisión</h3><p>' +
      "<kbd>1</kbd>…<kbd>9</kbd> elegir un candidato · <kbd>A</kbd> aprobar o confirmar · " +
      "<kbd>R</kbd> rechazar · <kbd>N</kbd> ninguno corresponde · <kbd>X</kbd> no puedo " +
      "decidirlo ahora · <kbd>→</kbd> saltear · <kbd>F</kbd> ver la ficha completa.</p></div>" +
      '<div class="bloque"><h3>Qué significa cada grupo</h3><table class="listalotes"><tbody>' +
      [["Resolver los casos en revisión", "El cruce encontró algo parecido pero no pudo confirmarlo por las características. Lo decide una persona."],
       ["Validar las altas", "Existen físicamente y no hay material equivalente en SAP. Habría que crearlos."],
       ["Registrar existencias", "El código existe y el producto está, pero SAP no registra stock en esa base. No son altas."],
       ["Confirmar identificaciones", "Ya tienen código verificado por nomenclatura y presentación. Sólo hay que dar el visto bueno."],
       ["Aprobar las bajas", "Material con stock en SAP que ningún inventario identificó en esa base."],
       ["Fuera del alcance", "Indumentaria, equipos y repuestos. El inventario es de Farmacia: su ausencia no prueba nada."]]
      .map(function (x) {
        return "<tr><td style=\"white-space:nowrap\"><b>" + esc(x[0]) + "</b></td><td>" +
               esc(x[1]) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
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
           decisiones: function () { return decisiones; }, datos: function () { return D; },
           revisor: function () { return revisor; }, LETRA: LETRA, CORTO: CORTO };
})();
