/* Sistema de gestión · Inventario físico vs SAP
   Los datos del análisis (datos.js) son de sólo lectura y nunca se alteran.
   Las decisiones del usuario viven en una capa aparte, con historial, de modo
   que siempre se puede saber qué decía el análisis y qué cambió una persona. */
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

  var estado = {
    vista: "panel",
    filtros: { base: "", tipo: "", clase: "", revision: "", aprobacion: "",
               motivo: "", valorizacion: "", obs: "", texto: "" },
    orden: { campo: "n", desc: false },
    pagina: 1, porPagina: 50,
    fichaId: null,
  };
  var decisiones = {};
  var revisor = "";

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
    d.historial.push({
      cuando: new Date().toISOString(),
      quien: revisor || "(sin identificar)",
      que: descripcion, antes: antes, despues: cambios,
    });
    d.revisor = revisor || "(sin identificar)";
    d.actualizado = new Date().toISOString();
    decisiones[id] = d;
    guardar();
  }

  // ------------------------------------------------------------- datos derivados
  function caso(id) {
    for (var i = 0; i < D.casos.length; i++) if (D.casos[i].id === id) return D.casos[i];
    return null;
  }
  /* Vista efectiva de un caso: el análisis, con la decisión aplicada encima. */
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
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
  }
  function num(n, dec0) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toLocaleString("es-AR",
      { minimumFractionDigits: dec0 || 0, maximumFractionDigits: dec0 || 0 });
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

  // ------------------------------------------------------------- filtrado
  function filtrados() {
    var f = estado.filtros;
    var txt = f.texto.trim().toLowerCase();
    var out = D.casos.filter(function (c) {
      var e = efectivo(c);
      if (f.base && c.base !== f.base) return false;
      if (f.tipo && c.tipo !== f.tipo) return false;
      if (f.clase && LETRA[c.clasificacion] !== f.clase) return false;
      if (f.revision && e.estado_revision !== f.revision) return false;
      if (f.aprobacion && e.aprobacion !== f.aprobacion) return false;
      if (f.motivo && c.motivo !== f.motivo) return false;
      if (f.valorizacion === "pendiente" && c.estado_valorizacion !== "Pendiente de valorización") return false;
      if (f.valorizacion === "valorizado" && c.estado_valorizacion === "Pendiente de valorización") return false;
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
      if (va < vb) return o.desc ? 1 : -1;
      if (va > vb) return o.desc ? -1 : 1;
      return 0;
    });
    return out;
  }
  function valorOrden(c, campo) {
    var e = efectivo(c);
    switch (campo) {
      case "n": return c.n;
      case "base": return c.base;
      case "tipo": return c.tipo;
      case "clase": return c.clasificacion;
      case "nombre": return (c.nombre_fisico || c.texto_sap || "").toLowerCase();
      case "material": return e.material || "zzz";
      case "cantidad": return -(c.cantidad_fisica || c.stock_sap || 0);
      case "revision": return e.estado_revision;
      case "aprobacion": return e.aprobacion;
      default: return c.n;
    }
  }

  // ------------------------------------------------------------- navegación
  function ir(vista, id) {
    estado.vista = vista;
    if (id) estado.fichaId = id;
    ["panel", "casos", "ficha", "informe", "ayuda"].forEach(function (v) {
      document.getElementById("v-" + v).classList.toggle("oculto", v !== vista);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      if (b.dataset.vista === vista) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (vista === "panel") pintarPanel();
    if (vista === "casos") pintarCasos();
    if (vista === "ficha") pintarFicha();
    if (vista === "informe") document.getElementById("v-informe").innerHTML = Exportar.informeHtml();
    if (vista === "ayuda") pintarAyuda();
    window.scrollTo(0, 0);
  }
  function verClase(letra) {
    limpiarFiltros();
    estado.filtros.clase = letra; estado.pagina = 1;
    ir("casos");
  }
  function limpiarFiltros() {
    estado.filtros = { base: "", tipo: "", clase: "", revision: "", aprobacion: "",
                       motivo: "", valorizacion: "", obs: "", texto: "" };
  }

  // ------------------------------------------------------------- panel
  function conteos(lista) {
    var r = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    lista.forEach(function (c) { r[LETRA[c.clasificacion]]++; });
    return r;
  }
  function barraDist(c, total) {
    var orden = ["A", "B", "C", "D", "E"];
    return '<div class="barr">' + orden.map(function (k) {
      if (!c[k]) return "";
      var pct = c[k] / total * 100;
      // El número va escrito dentro de la barra: la clase nunca se distingue
      // sólo por color (regla de relieve del verificador de contraste).
      return '<span style="flex:' + c[k] + ';background:var(--c' + k + ')" title="' +
             CORTO[k] + ': ' + c[k] + '">' + (pct > 6 ? k + " " + c[k] : "") + "</span>";
    }).join("") + "</div>";
  }

  function pintarPanel() {
    var k = D.kpis, t = conteos(D.casos);
    var pend = D.casos.filter(function (c) {
      return efectivo(c).aprobacion === "Sin decidir" &&
             LETRA[c.clasificacion] !== "E";
    }).length;
    var decid = D.casos.length - pend - t.E;

    var h = '<h1>Panel de control</h1>' +
      '<p class="sub">' + num(k.items_fisicos) + ' ítems relevados en los inventarios físicos · ' +
      num(k.unidades_fisicas) + ' unidades contadas · ' + num(k.total_casos) +
      ' casos en total (los ítems físicos más los materiales de SAP que ninguno identificó).' +
      ' Hacé clic en cualquier indicador para ver su listado.</p>';

    h += '<h2>Estado del universo analizado</h2><div class="kpis">' +
      tarjeta("N", "Ítems del inventario físico", k.items_fisicos,
              num(k.unidades_fisicas) + " unidades · el universo base", "") +
      tarjeta("A", "Identificados en SAP", t.A,
              "con código verificado por presentación", "A") +
      tarjeta("B", "Pendientes de alta", t.B,
              "físicos sin correspondencia en SAP", "B") +
      tarjeta("C", "Candidatos a baja", t.C,
              "material SAP que nadie identificó", "C") +
      tarjeta("D", "Casos en revisión", t.D,
              "no se resuelven automáticamente", "D") +
      tarjeta("E", "Fuera del alcance", t.E,
              "indumentaria, equipos y repuestos", "E") +
      "</div>";

    h += '<h2>Decisiones y valorización</h2><div class="kpis">' +
      tarjeta("N", "Decisiones registradas", decid,
              "de " + num(D.casos.length - t.E) + " casos que requieren decisión", "decididos") +
      tarjeta("N", "Pendientes de decidir", pend, "esperan aprobación o rechazo", "pendientes") +
      tarjeta("N", "Pendientes de valorización", k.pendientes_valorizacion,
              "no hay precio de última compra", "valorizacion") +
      tarjeta("N", "Valorización por última compra", "—",
              "el dato no está disponible · ver aviso", "valorizacion") +
      "</div>";

    // avisos: lo que hay que saber antes de leer cualquier número
    h += '<h2>Lo que hay que tener en cuenta</h2>';
    h += '<div class="aviso"><b>No hay precio de última compra en los archivos recibidos.</b>' +
      'Se revisaron la bajada de SAP (tiene valor de stock, no precio de compra), la ' +
      'homologación (declara que los costos quedan fuera) y los tres PDF de inventario ' +
      '(ninguna mención de precio). Por eso los ' + num(k.pendientes_valorizacion) +
      ' casos figuran como pendientes de valorización. El sistema muestra en paralelo la ' +
      'valorización de stock de SAP, rotulada como tal, y admite cargar el precio de ' +
      'última compra apenas esté disponible.</div>';
    if (k.bajas_bloqueadas) {
      h += '<div class="aviso"><b>' + k.bajas_bloqueadas + ' candidatos a baja dependen de un caso en revisión.</b>' +
        'Esos materiales figuran como posible equivalencia de un ítem físico todavía sin ' +
        'resolver. Si el caso se resuelve a favor, dejan de ser candidatos a baja. ' +
        'Conviene cerrar la revisión antes de aprobar esas bajas.</div>';
    }
    if (k.sin_stock_en_base) {
      h += '<div class="aviso dato"><b>' + k.sin_stock_en_base + ' ítems están identificados pero SAP no tiene stock de ese material en su base.</b>' +
        'Hay existencia física y el código existe: no son altas. Lo que corresponde es ' +
        'registrar la existencia en ese centro o revisar dónde está cargado el stock.</div>';
    }
    h += '<div class="aviso info"><b>Las propuestas de alta y de baja no son acciones ejecutadas.</b>' +
      'Nada de lo que figura acá modifica SAP. Son propuestas para revisar y aprobar; ' +
      'la ejecución es posterior y externa a esta herramienta.</div>';

    h += '<h2>Distribución por base</h2><div class="panelito">';
    D.meta.bases.forEach(function (b) {
      var g = D.casos.filter(function (c) { return c.base === b; });
      var cc = conteos(g), fu = D.meta.fuentes.filter(function (x) { return x.base === b; })[0];
      h += '<div class="fila-dist"><div class="cab"><span><b>' + b + '</b> · ' +
        esc(fu.sistema) + ' · ' + num(fu.items) + ' ítems relevados, ' +
        num(fu.unidades) + ' unidades</span><span>' + num(g.length) + ' casos</span></div>' +
        barraDist(cc, g.length) + "</div>";
    });
    h += leyenda() + "</div>";

    h += '<h2>Distribución por tipo de material</h2><div class="panelito">';
    Object.keys(D.kpis.por_tipo).sort(function (a, b) {
      return D.kpis.por_tipo[b].casos - D.kpis.por_tipo[a].casos;
    }).forEach(function (t2) {
      var g = D.casos.filter(function (c) { return c.tipo === t2; });
      h += '<div class="fila-dist"><div class="cab"><span><b>' + esc(t2) + "</b></span><span>" +
        num(g.length) + ' casos</span></div>' + barraDist(conteos(g), g.length) + "</div>";
    });
    h += leyenda() + "</div>";

    h += '<h2>Motivos de los casos en revisión</h2><div class="panelito"><table>' +
      "<thead><tr><th>Motivo</th><th>Casos</th><th></th></tr></thead><tbody>";
    Object.keys(D.kpis.motivos).sort(function (a, b) {
      return D.kpis.motivos[b] - D.kpis.motivos[a];
    }).forEach(function (m) {
      h += '<tr data-motivo="' + esc(m) + '"><td>' + esc(m) + '</td><td class="num">' +
        num(D.kpis.motivos[m]) + '</td><td class="mini">ver listado →</td></tr>';
    });
    h += "</tbody></table></div>";

    h += '<h2>Control de integridad contra las fuentes</h2><div class="panelito"><table>' +
      "<thead><tr><th>Control</th><th>En la fuente</th><th>En el sistema</th><th>Estado</th></tr></thead><tbody>";
    D.control.forEach(function (c) {
      var cls = c.estado === "Coincide" ? "ap" : (c.estado === "Informativo" ? "list" : "re");
      h += "<tr><td>" + esc(c.control) + (c.detalle ? '<div class="mini">' + esc(c.detalle) + "</div>" : "") +
        '</td><td class="num">' + num(c.fuente) + '</td><td class="num">' + num(c.sistema) +
        '</td><td><span class="estado ' + cls + '">' + esc(c.estado) + "</span></td></tr>";
    });
    h += "</tbody></table></div>";

    var el = document.getElementById("v-panel");
    el.innerHTML = h;
    Array.prototype.forEach.call(el.querySelectorAll(".kpi"), function (b) {
      b.addEventListener("click", function () {
        var a = b.dataset.accion;
        if (!a) { limpiarFiltros(); ir("casos"); return; }
        if (a.length === 1) return verClase(a);
        limpiarFiltros();
        if (a === "pendientes") estado.filtros.aprobacion = "Sin decidir";
        if (a === "decididos") estado.filtros.aprobacion = "__decidido";
        if (a === "valorizacion") estado.filtros.valorizacion = "pendiente";
        estado.pagina = 1; ir("casos");
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll("tr[data-motivo]"), function (tr) {
      tr.addEventListener("click", function () {
        limpiarFiltros(); estado.filtros.motivo = tr.dataset.motivo;
        estado.pagina = 1; ir("casos");
      });
    });
  }
  function tarjeta(cls, titulo, n, det, accion) {
    return '<button class="kpi ' + cls + '" data-accion="' + (accion || "") + '">' +
      '<div class="t">' + (accion && accion.length === 1
        ? '<i class="pt" style="background:var(--c' + accion + ')"></i>' : "") +
      esc(titulo) + '</div><div class="n">' + (typeof n === "number" ? num(n) : n) +
      '</div><div class="d">' + esc(det) + "</div></button>";
  }
  function leyenda() {
    return '<div class="leyenda">' + ["A", "B", "C", "D", "E"].map(function (k) {
      return '<span><i class="pt" style="background:var(--c' + k + ')"></i>' +
             k + " · " + CORTO[k] + "</span>";
    }).join("") + "</div>";
  }

  // ------------------------------------------------------------- listado
  function pintarCasos() {
    var lista = filtrados();
    var f = estado.filtros;
    var paginas = Math.max(1, Math.ceil(lista.length / estado.porPagina));
    if (estado.pagina > paginas) estado.pagina = paginas;
    var ini = (estado.pagina - 1) * estado.porPagina;
    var pag = lista.slice(ini, ini + estado.porPagina);

    var h = '<h1>Casos</h1><p class="sub">' + num(lista.length) +
      " de " + num(D.casos.length) + " casos con los filtros actuales.</p>";

    h += '<div class="filtros">' +
      '<input type="text" id="fTexto" placeholder="Buscar por nombre, código SAP, nomenclatura u observación…" value="' + esc(f.texto) + '">' +
      sel("fBase", "Base", f.base, D.meta.bases) +
      sel("fTipo", "Tipo", f.tipo, D.meta.tipos) +
      sel("fClase", "Clasificación", f.clase, ["A", "B", "C", "D", "E"],
          function (v) { return v + " · " + CORTO[v]; }) +
      sel("fMotivo", "Motivo de revisión", f.motivo, D.meta.motivos_revision) +
      sel("fRev", "Estado de revisión", f.revision,
          ["Pendiente", "En revisión", "Revisado", "Pendiente de validación"]) +
      sel("fApr", "Aprobación", f.aprobacion,
          ["Sin decidir", "Aprobado", "Rechazado", "Correspondencia confirmada"]) +
      sel("fVal", "Valorización", f.valorizacion, ["pendiente", "valorizado"],
          function (v) { return v === "pendiente" ? "Pendiente" : "Valorizado"; }) +
      sel("fObs", "Observaciones", f.obs, ["con", "sin"],
          function (v) { return v === "con" ? "Con observación" : "Sin observación"; }) +
      '<button class="btn chico" id="fLimpiar">Limpiar filtros</button>' +
      "</div>";

    h += '<div class="tablabox"><table><thead><tr>' +
      th("clase", "Clasificación") + th("base", "Base") + th("tipo", "Tipo") +
      th("nombre", "Ítem físico / material SAP") + th("material", "Código SAP") +
      th("cantidad", "Cantidad") + th("revision", "Revisión") +
      th("aprobacion", "Decisión") + "</tr></thead><tbody>";
    if (!pag.length) {
      h += '<tr><td colspan="8" class="vacio">No hay casos con estos filtros.</td></tr>';
    }
    pag.forEach(function (c) {
      var e = efectivo(c), L = LETRA[c.clasificacion];
      var cant = c.origen === "Inventario físico" ? c.cantidad_fisica : c.stock_sap;
      h += '<tr data-id="' + esc(c.id) + '">' +
        '<td><span class="et ' + L + '"><i class="pt" style="background:var(--c' + L + ')"></i>' +
          L + " · " + CORTO[L] + "</span>" +
          (c.motivo ? '<div class="mini">' + esc(c.motivo) + "</div>" : "") + "</td>" +
        "<td>" + esc(c.base) + '<div class="mini">' + esc(c.sistema_origen) + "</div></td>" +
        "<td>" + esc(c.tipo) + "</td>" +
        "<td><b>" + esc(c.nombre_fisico || c.texto_sap) + "</b>" +
          (c.nombre_fisico && c.texto_sap ? '<div class="mini">SAP: ' + esc(c.texto_sap) + "</div>" : "") +
          (c.codigo_fisico ? '<div class="mini">cód. inventario: ' + esc(c.codigo_fisico) + "</div>" : "") +
          "</td>" +
        "<td>" + (e.material ? esc(e.material) + (e.corregido ? '<div class="mini">corregido a mano</div>' : "")
                 : (c.material_sugerido ? '<span class="mini">sugerido ' + esc(c.material_sugerido) + "</span>" : "—")) + "</td>" +
        '<td class="num">' + num(cant) +
          (c.origen === "Inventario físico" ? '<div class="mini">físicas</div>' : '<div class="mini">en SAP</div>') + "</td>" +
        "<td><span class=\"estado " + (e.estado_revision === "Revisado" ? "ap" :
            e.estado_revision === "Pendiente de validación" ? "pv" : "") + '">' +
          esc(e.estado_revision) + "</span></td>" +
        "<td><span class=\"estado " + (e.aprobacion === "Aprobado" || e.aprobacion === "Correspondencia confirmada" ? "ap" :
            e.aprobacion === "Rechazado" ? "re" : "") + '">' + esc(e.aprobacion) + "</span>" +
          (e.observaciones ? '<div class="mini">tiene observación</div>' : "") + "</td>" +
        "</tr>";
    });
    h += "</tbody></table>";
    h += '<div class="pager">' +
      '<button class="btn chico" id="pPrev"' + (estado.pagina <= 1 ? " disabled" : "") + ">← Anterior</button>" +
      "<span>Página " + estado.pagina + " de " + paginas + "</span>" +
      '<button class="btn chico" id="pNext"' + (estado.pagina >= paginas ? " disabled" : "") + ">Siguiente →</button>" +
      "</div></div>";

    var el = document.getElementById("v-casos");
    el.innerHTML = h;
    el.querySelector("#fTexto").addEventListener("input", function (ev) {
      estado.filtros.texto = ev.target.value; estado.pagina = 1;
      var p = ev.target.selectionStart;
      pintarCasos();
      var n2 = document.getElementById("fTexto"); n2.focus(); n2.setSelectionRange(p, p);
    });
    [["fBase", "base"], ["fTipo", "tipo"], ["fClase", "clase"], ["fMotivo", "motivo"],
     ["fRev", "revision"], ["fApr", "aprobacion"], ["fVal", "valorizacion"],
     ["fObs", "obs"]].forEach(function (par) {
      var n3 = el.querySelector("#" + par[0]);
      if (n3) n3.addEventListener("change", function (ev) {
        estado.filtros[par[1]] = ev.target.value; estado.pagina = 1; pintarCasos();
      });
    });
    el.querySelector("#fLimpiar").addEventListener("click", function () {
      limpiarFiltros(); estado.pagina = 1; pintarCasos();
    });
    el.querySelector("#pPrev").addEventListener("click", function () { estado.pagina--; pintarCasos(); });
    el.querySelector("#pNext").addEventListener("click", function () { estado.pagina++; pintarCasos(); });
    Array.prototype.forEach.call(el.querySelectorAll("tbody tr[data-id]"), function (tr) {
      tr.addEventListener("click", function () { ir("ficha", tr.dataset.id); });
    });
    Array.prototype.forEach.call(el.querySelectorAll("th[data-campo]"), function (t2) {
      t2.addEventListener("click", function () {
        if (estado.orden.campo === t2.dataset.campo) estado.orden.desc = !estado.orden.desc;
        else { estado.orden.campo = t2.dataset.campo; estado.orden.desc = false; }
        pintarCasos();
      });
    });
  }
  function th(campo, texto) {
    var o = estado.orden;
    return '<th data-campo="' + campo + '">' + esc(texto) +
      (o.campo === campo ? (o.desc ? " ↓" : " ↑") : "") + "</th>";
  }
  function sel(id, etiqueta, valor, opciones, fmt) {
    return '<label>' + esc(etiqueta) + '<select id="' + id + '"><option value="">Todos</option>' +
      opciones.map(function (o) {
        return '<option value="' + esc(o) + '"' + (valor === o ? " selected" : "") + ">" +
               esc(fmt ? fmt(o) : o) + "</option>";
      }).join("") + "</select></label>";
  }

  // ------------------------------------------------------------- ficha
  function pintarFicha() {
    var c = caso(estado.fichaId);
    if (!c) return ir("casos");
    var e = efectivo(c), L = LETRA[c.clasificacion];
    var lista = filtrados(), idx = -1;
    for (var i = 0; i < lista.length; i++) if (lista[i].id === c.id) idx = i;

    var h = '<div style="display:flex;gap:9px;align-items:center;margin-bottom:13px;flex-wrap:wrap">' +
      '<button class="btn chico" id="bVolver">← Volver al listado</button>' +
      (idx > 0 ? '<button class="btn chico" id="bAnt">← Anterior</button>' : "") +
      (idx >= 0 && idx < lista.length - 1 ? '<button class="btn chico" id="bSig">Siguiente →</button>' : "") +
      (idx >= 0 ? '<span class="mini">caso ' + (idx + 1) + " de " + lista.length + " del listado filtrado</span>" : "") +
      "</div>";

    h += "<h1>" + esc(c.nombre_fisico || c.texto_sap) + "</h1>" +
      '<p class="sub"><span class="et ' + L + '"><i class="pt" style="background:var(--c' + L + ')"></i>' +
      L + " · " + CORTO[L] + "</span> &nbsp; " + esc(c.base) + " · " + esc(c.tipo) +
      (c.motivo ? " · " + esc(c.motivo) : "") + "</p>";

    h += '<div class="ficha"><div>';

    h += '<div class="bloque"><h3>Curso de acción sugerido</h3>' +
      '<div class="campo"><div class="v g">' + esc(c.accion) + "</div></div>" +
      '<div class="just" style="margin-top:11px">' + esc(c.justificacion) + "</div>" +
      (c.falta_para_alta && c.falta_para_alta.length ?
        '<div style="margin-top:11px"><div class="k mini">Para poder darlo de alta hace falta:</div><ul style="margin:5px 0 0;padding-left:19px;font-size:13px;color:var(--tinta2)">' +
        c.falta_para_alta.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      "</div>";

    h += '<div class="bloque"><h3>Origen del dato</h3><div class="campos">' +
      campo("Base", c.base) + campo("Centro", c.centro) +
      campo("Sistema de origen", c.sistema_origen) +
      campo("Informe", c.informe_origen) +
      campo("Código en el inventario físico", c.codigo_fisico || "—") +
      campo("Nomenclatura original", c.nombre_fisico || "—") +
      campo("Presentación detectada", c.presentacion || "—") +
      campo("Cantidad física", c.origen === "Inventario físico" ? num(c.cantidad_fisica) + " unidades" : "—", true) +
      "</div></div>";

    h += '<div class="bloque"><h3>Correspondencia con SAP</h3><div class="campos">' +
      campo("Código SAP", e.material || (c.material_sugerido ? c.material_sugerido + " (sugerido, sin confirmar)" : "Sin asignar"), true) +
      campo("Descripción en SAP", c.texto_sap || "—") +
      campo("Atributos verificados", (c.atributos_verificados || []).join(", ") || "ninguno") +
      campo("Confianza del cruce", c.confianza || "—") +
      campo("Stock de SAP en esta base", c.stock_sap !== undefined && c.stock_sap !== null
            ? num(c.stock_sap) : (c.stock_sap_en_base !== null && c.stock_sap_en_base !== undefined
            ? num(c.stock_sap_en_base) : "—")) +
      (c.material_sin_stock_en_base
        ? campo("Atención", "SAP no tiene stock de este material en " + c.base +
                (c.stock_sap_otras_bases && c.stock_sap_otras_bases.length
                 ? ". Sí lo tiene en " + c.stock_sap_otras_bases.join(", ") + "." : "."))
        : "") +
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
          "</td></tr>";
      });
      h += "</tbody></table>";
    }
    h += "</div>";

    h += '<div class="bloque"><h3>Valorización</h3><div class="campos">' +
      campo("Criterio", "Precio de última compra") +
      campo("Estado", c.estado_valorizacion, true) +
      campo("Precio de última compra", c.precio_ultima_compra !== null && c.precio_ultima_compra !== undefined
            ? pesos(c.precio_ultima_compra) : "No disponible") +
      campo("Fecha de la compra", c.fecha_ultima_compra || "—") +
      campo("Fuente del precio", c.fuente_precio) +
      campo("Valorización", c.valorizacion !== null && c.valorizacion !== undefined
            ? pesos(c.valorizacion) : "No se puede calcular") +
      "</div>" +
      (c.motivo_pendiente ? '<div class="just" style="margin-top:11px">' + esc(c.motivo_pendiente) + "</div>" : "");
    if (c.vu_sap_referencia) {
      h += '<div class="just" style="margin-top:11px"><b>Referencia, no es el criterio pedido.</b> ' +
        "SAP valoriza este material a " + pesos(c.vu_sap_referencia) + " por unidad (" +
        esc(c.vu_sap_alcance) + "), lo que da " + pesos(c.valor_sap_referencia) +
        ". Es el valor contable del stock dividido por las unidades, no el precio de la última compra.</div>";
    }
    if (c.valor_sugerido_referencia) {
      h += '<div class="just" style="margin-top:9px"><b>Orden de magnitud sin confirmar.</b> ' +
        esc(c.nota_valor_sugerido) + " Daría " + pesos(c.valor_sugerido_referencia) + ".</div>";
    }
    h += "</div>";

    if (c.lotes && c.lotes.length) {
      h += '<div class="bloque"><h3>Lotes del recuento físico (' + c.lotes.length + ")</h3>" +
        '<table class="listalotes"><thead><tr><th>Lote</th><th>Vencimiento</th>' +
        '<th style="text-align:right">Stock</th></tr></thead><tbody>';
      c.lotes.forEach(function (l) {
        h += "<tr><td>" + esc(l.lote || "—") + "</td><td>" + esc(l.vencimiento || "—") +
          '</td><td class="num">' + num(l.stock) + "</td></tr>";
      });
      h += '</tbody></table><div class="mini" style="margin-top:7px">Suma de los lotes: ' +
        num(c.lotes.reduce(function (a, l) { return a + (l.stock || 0); }, 0)) +
        " · cantidad informada: " + num(c.cantidad_fisica) + "</div></div>";
    }

    // ---- panel lateral de decisiones
    h += "</div><div>";
    h += '<div class="bloque"><h3>Gestión de la decisión</h3>' +
      '<div class="campos" style="margin-bottom:13px">' +
      campo("Estado de revisión", e.estado_revision) +
      campo("Decisión", e.aprobacion) +
      (e.revisor ? campo("Último cambio", e.revisor + " · " + fecha(e.actualizado)) : "") +
      "</div>";

    h += '<div class="acciones">';
    if (L === "A" || L === "D") {
      h += '<div class="grupo">' +
        '<button class="btn ok" data-acc="confirmar">Confirmar correspondencia</button>' +
        '<button class="btn" data-acc="validar">Marcar pendiente de validación</button>' +
        "</div>";
    }
    if (L === "B") {
      h += '<div class="grupo">' +
        '<button class="btn ok" data-acc="aprobar-alta">Aprobar propuesta de alta</button>' +
        '<button class="btn no" data-acc="rechazar-alta">Rechazar alta</button></div>';
    }
    if (L === "C") {
      h += '<div class="grupo">' +
        '<button class="btn ok" data-acc="aprobar-baja">Aprobar propuesta de baja</button>' +
        '<button class="btn no" data-acc="rechazar-baja">Rechazar baja</button></div>';
    }
    h += '<div class="grupo"><button class="btn" data-acc="revisado">Marcar como revisado</button>' +
      '<button class="btn" data-acc="reabrir">Reabrir</button></div>';
    h += '<div style="margin-top:9px"><div class="k mini">Corregir el código SAP a mano</div>' +
      '<div style="display:flex;gap:6px;margin-top:4px">' +
      '<input type="text" class="cod" id="codManual" placeholder="código SAP" value="' +
        esc(dec(c.id) && dec(c.id).material_corregido ? dec(c.id).material_corregido : "") + '">' +
      '<button class="btn" data-acc="corregir">Aplicar</button></div>' +
      '<div class="mini" id="avisoCod" style="margin-top:4px"></div></div>';
    h += '<div style="margin-top:11px"><div class="k mini">Observaciones y justificación</div>' +
      '<textarea id="obs" placeholder="Por qué se decide esto…">' + esc(e.observaciones) + "</textarea>" +
      '<button class="btn" data-acc="obs" style="margin-top:6px">Guardar observación</button></div>';
    h += "</div></div>";

    h += '<div class="bloque"><h3>Historial de esta ficha</h3>';
    if (!e.historial.length) {
      h += '<div class="mini">Todavía no se registró ninguna decisión. El dato que se ve es el del análisis original.</div>';
    } else {
      e.historial.slice().reverse().forEach(function (x) {
        h += '<div class="hist"><b>' + esc(x.que) + '</b><span class="cuando">' +
          esc(x.quien) + " · " + fecha(x.cuando) + "</span></div>";
      });
      h += '<button class="btn chico no" data-acc="deshacer" style="margin-top:6px">Descartar mis cambios en esta ficha</button>';
    }
    h += "</div></div></div>";

    var el = document.getElementById("v-ficha");
    el.innerHTML = h;
    el.querySelector("#bVolver").addEventListener("click", function () { ir("casos"); });
    var ba = el.querySelector("#bAnt"), bs = el.querySelector("#bSig");
    if (ba) ba.addEventListener("click", function () { ir("ficha", lista[idx - 1].id); });
    if (bs) bs.addEventListener("click", function () { ir("ficha", lista[idx + 1].id); });
    Array.prototype.forEach.call(el.querySelectorAll("[data-acc]"), function (b) {
      b.addEventListener("click", function () { accion(c, b.dataset.acc); });
    });
  }
  function campo(k, v, grande) {
    return '<div class="campo"><div class="k">' + esc(k) + '</div><div class="v' +
           (grande ? " g" : "") + '">' + esc(v) + "</div></div>";
  }

  function accion(c, a) {
    var obsEl = document.getElementById("obs");
    var obs = obsEl ? obsEl.value : "";
    switch (a) {
      case "confirmar":
        decidir(c.id, { aprobacion: "Correspondencia confirmada", estado_revision: "Revisado" },
                "Se confirmó la correspondencia con SAP");
        aviso("Correspondencia confirmada."); break;
      case "validar":
        decidir(c.id, { estado_revision: "Pendiente de validación" },
                "Se marcó como pendiente de validación"); aviso("Marcado para validar."); break;
      case "aprobar-alta":
        decidir(c.id, { aprobacion: "Aprobado", estado_revision: "Revisado" },
                "Se aprobó la PROPUESTA de alta (no ejecuta nada en SAP)");
        aviso("Propuesta de alta aprobada. No modifica SAP."); break;
      case "rechazar-alta":
        decidir(c.id, { aprobacion: "Rechazado", estado_revision: "Revisado" },
                "Se rechazó la propuesta de alta"); aviso("Alta rechazada."); break;
      case "aprobar-baja":
        if (c.bloqueado_por_revision &&
            !confirm("Este material figura como posible equivalencia de un ítem físico " +
                     "todavía en revisión. Si ese caso se resuelve a favor, la baja sería " +
                     "un error.\n\n¿Aprobar igual?")) return;
        decidir(c.id, { aprobacion: "Aprobado", estado_revision: "Revisado" },
                "Se aprobó la PROPUESTA de baja (no ejecuta nada en SAP)");
        aviso("Propuesta de baja aprobada. No modifica SAP."); break;
      case "rechazar-baja":
        decidir(c.id, { aprobacion: "Rechazado", estado_revision: "Revisado" },
                "Se rechazó la propuesta de baja"); aviso("Baja rechazada."); break;
      case "revisado":
        decidir(c.id, { estado_revision: "Revisado" }, "Se marcó como revisado"); break;
      case "reabrir":
        decidir(c.id, { estado_revision: "En revisión", aprobacion: "Sin decidir" },
                "Se reabrió el caso"); break;
      case "corregir": {
        var v = document.getElementById("codManual").value.trim();
        var av = document.getElementById("avisoCod");
        if (!v) { av.textContent = "Escribí un código SAP."; return; }
        if (!existeMaterial(v)) {
          av.innerHTML = '<span style="color:var(--alerta)">El código ' + esc(v) +
            " no figura en la bajada de SAP. Revisalo antes de aplicarlo.</span>";
          return;
        }
        decidir(c.id, { material_corregido: v, estado_revision: "Revisado",
                        aprobacion: "Correspondencia confirmada" },
                "Se corrigió el código SAP a mano: " + v);
        aviso("Código corregido a " + v + "."); break;
      }
      case "obs":
        decidir(c.id, { observaciones: obs }, "Se registró una observación");
        aviso("Observación guardada."); break;
      case "deshacer":
        if (!confirm("Se descartan todas tus decisiones en esta ficha y vuelve a mostrarse " +
                     "el resultado original del análisis. ¿Seguir?")) return;
        delete decisiones[c.id]; guardar(); aviso("Ficha restituida al análisis original."); break;
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

  // ------------------------------------------------------------- ayuda
  function pintarAyuda() {
    document.getElementById("v-ayuda").innerHTML =
      '<h1>Cómo se usa</h1><p class="sub">Tres minutos de lectura y ya se puede trabajar.</p>' +
      '<div class="bloque"><h3>Qué es esto</h3><p>Una herramienta para revisar, decidir y ' +
      'dejar registrado qué material del inventario físico corresponde a qué código de SAP, ' +
      'qué hay que dar de alta y qué es candidato a baja. <b>No modifica SAP.</b> Todo lo que ' +
      'se aprueba acá queda como propuesta documentada.</p></div>' +
      '<div class="bloque"><h3>El criterio del cruce</h3><p>El universo son los ' +
      'inventarios físicos. Cada ítem se cruza contra SAP y la coincidencia sólo se da por ' +
      'buena si está justificada por las características del material: concentración, forma ' +
      'farmacéutica, volumen, calibre, medidas, talle, modelo y población. Si dos materiales ' +
      'declaran la misma característica con valores distintos, no son el mismo material y el ' +
      'código no se asigna. Si una característica se declara de un lado y no del otro, el caso ' +
      'va a revisión: el parecido del nombre nunca alcanza por sí solo.</p></div>' +
      '<div class="bloque"><h3>Las cinco clasificaciones</h3><table class="listalotes"><tbody>' +
      ["A · Identificado en SAP|Existe físicamente y se encontró un código cuya nomenclatura y presentación se corresponden. No hay que dar de alta nada.",
       "B · Candidato a alta|Existe físicamente y no hay en SAP ningún material que se corresponda. La ficha dice qué información falta para poder crearlo.",
       "C · Candidato a baja|Material con stock en SAP que ningún inventario físico identificó en esa base. Se propone la baja del stock de esa base.",
       "D · Requiere revisión|Coincidencia parcial, diferencia de presentación, varios códigos posibles o nomenclatura insuficiente. No se resuelve solo: lo decide una persona.",
       "E · Fuera del alcance|Indumentaria, equipamiento y repuestos. El inventario relevado es de Farmacia, así que nunca iban a aparecer: su ausencia no prueba nada y no se propone ninguna baja."]
      .map(function (x) { var p = x.split("|");
        return "<tr><td style=\"white-space:nowrap\"><b>" + esc(p[0]) + "</b></td><td>" + esc(p[1]) + "</td></tr>"; }).join("") +
      "</tbody></table></div>" +
      '<div class="bloque"><h3>Cómo trabajar</h3><ol style="padding-left:19px;color:var(--tinta2)">' +
      "<li>Escribí tu nombre arriba a la derecha, en <b>Revisor</b>: queda registrado en cada decisión.</li>" +
      "<li>Desde el <b>Panel</b>, hacé clic en el indicador que quieras trabajar.</li>" +
      "<li>En <b>Casos</b>, filtrá y buscá. Hacé clic en una fila para abrir la ficha.</li>" +
      "<li>En la ficha, leé la justificación y los candidatos evaluados, y decidí.</li>" +
      "<li>Todo queda guardado en este navegador y en el historial de la ficha.</li>" +
      "<li>Con <b>Descargar Excel</b> y <b>Descargar PDF</b> exportás todo con tus decisiones incluidas.</li>" +
      "</ol></div>" +
      '<div class="bloque"><h3>Dónde se guardan las decisiones</h3><p>En el almacenamiento ' +
      'local de este navegador, en esta computadora. No se envían a ningún lado. Si trabajás ' +
      'desde otra máquina no vas a ver las decisiones de ésta: para compartirlas, exportá el ' +
      'Excel. Si limpiás los datos del navegador, se borran — por eso conviene exportar al ' +
      'terminar cada sesión de trabajo.</p></div>' +
      '<div class="bloque"><h3>La valorización</h3><p>El criterio pedido es <b>precio de ' +
      'última compra</b>, y ese dato <b>no existe en ninguno de los archivos recibidos</b>. ' +
      'Por eso todos los casos figuran como pendientes de valorización. Lo que sí se muestra, ' +
      'siempre rotulado, es la valorización de stock de SAP: el valor contable dividido por ' +
      'las unidades. No es lo mismo y no debe presentarse como tal.</p></div>';
  }

  // ------------------------------------------------------------- varios
  function aviso(txt) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* La barra superior envuelve en pantallas angostas: su alto real se publica como
     variable CSS para que el encabezado de la tabla se pegue en el lugar correcto. */
  function medirBarra() {
    var b = document.querySelector(".barra");
    if (b) document.documentElement.style.setProperty(
      "--alto-barra", Math.ceil(b.getBoundingClientRect().height) + "px");
  }

  function iniciar() {
    cargar();
    medirBarra();
    window.addEventListener("resize", medirBarra);
    var inp = document.getElementById("revisor");
    inp.value = revisor;
    inp.addEventListener("input", function () {
      revisor = inp.value;
      try { localStorage.setItem(CLAVE_REV, revisor); } catch (e) {}
    });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      b.addEventListener("click", function () { ir(b.dataset.vista); });
    });
    document.getElementById("bTema").addEventListener("click", function () {
      var r = document.documentElement;
      var hay = r.getAttribute("data-theme");
      var oscuro = hay ? hay === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      r.setAttribute("data-theme", oscuro ? "light" : "dark");
    });
    document.getElementById("bExcel").addEventListener("click", function () {
      Exportar.excel(); aviso("Excel generado con tus decisiones.");
    });
    document.getElementById("bPdf").addEventListener("click", function () {
      ir("informe"); setTimeout(function () { window.print(); }, 350);
    });
    ir("panel");
  }

  return { iniciar: iniciar, ir: ir, esc: esc, num: num, pesos: pesos, fecha: fecha,
           efectivo: efectivo, filtrados: filtrados, decisiones: function () { return decisiones; },
           LETRA: LETRA, CORTO: CORTO, conteos: conteos, datos: function () { return D; },
           revisor: function () { return revisor; } };
})();
