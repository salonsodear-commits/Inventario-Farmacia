/* Sistema de gestión · Inventario físico vs SAP
   Está pensado como un flujo de trabajo, no como un listado: la pantalla de
   inicio dice qué hay que hacer y en qué orden, el modo revisión resuelve los
   casos de a uno con el teclado, y los grupos grandes se deciden en lote.
   Los datos del análisis (datos.js) son de sólo lectura; las decisiones viven
   en una capa aparte, con historial. */
var App = (function () {
  "use strict";

  var D = window.DATOS;
  /* Dónde se guardan las decisiones lo resuelve Almacen: base SQLite del
     servidor cuando se entró con la cuenta de Emergencias, o almacenamiento
     del navegador cuando se abrió el archivo único. Acá no se distingue. */
  function decisiones() { return Almacen.todas(); }
  function depuObj() { return Almacen.depuracion(); }
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
  var VER_NO    = "Consultado en SAP · no existe · se crea";
  /* «Existe sin stock · reutilizar ese código» se quitó: era un camino
     duplicado. Si el material aparece en SAP y sirve, lo que corresponde es
     asignarle ese código como a cualquier otro ítem identificado, desde la
     ficha, y el caso se cierra como identificado. No hacía falta una decisión
     propia que terminara en lo mismo por otro lado. */
  var VER_NUEVO = "Consultado en SAP · existe pero no sirve · baja y alta nueva";
  /* El tercer resultado posible de la consulta, y el más frecuente cuando el
     maestro completo aparece: existe y sirve. Antes había que ir a la ficha a
     escribir el código a mano; ahora se carga donde se está decidiendo. */
  var VER_SIRVE = "Consultado en SAP · existe y sirve · se le asigna ese código";
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
    { id: "revision", que: "A qué material de SAP corresponde cada ítem contado. Sin eso, no se puede decidir nada más del caso.", titulo: "Decidir a qué código de SAP corresponde", corto: "Decidir el código",
      desc: "Es el trabajo principal y el que destraba el resto. Cada caso llega con el " +
            "candidato más probable y el motivo exacto por el que no se cerró solo. " +
            "Acá se decide QUÉ material es; dónde está su stock se ve después.",
      pred: function (c) { return L(c) === "D"; },
      porMotivo: true, lote: false, color: "D" },
    { id: "altas", que: "Están en el depósito y ningún material del maestro les corresponde. ¿Se crean en SAP?", titulo: "No se encontró en el maestro: ¿se crea?", corto: "Crear en SAP",
      desc: "Están contados en el depósito y ningún material del maestro cargado les " +
            "corresponde. Lo que se decide acá es si se crea el material en SAP, y con qué " +
            "centro y almacén.",
      pred: function (c) { return L(c) === "B"; }, lote: true, color: "B" },
    { id: "existencias", que: "El código existe y la mercadería está, pero SAP no registra existencia en esa base.", titulo: "Cargar en SAP existencia que falta", corto: "Ajustar el stock",
      desc: "El material existe en SAP y está identificado, pero SAP no registra existencia " +
            "en esa base. No es un alta: es un ajuste de stock, y tiene que cuadrar un " +
            "almacén concreto.",
      pred: function (c) { return L(c) === "A" && sinStock(c); }, lote: true, color: "A" },
    { id: "identificados", que: "El análisis ya les encontró el código y lo verificó. Falta que una persona lo confirme.", titulo: "Confirmar las correspondencias encontradas", corto: "Confirmar el código",
      desc: "El análisis ya les encontró el código y lo verificó por nomenclatura y " +
            "características. Sólo falta que una persona lo confirme, o corrija el que no " +
            "corresponda.",
      pred: function (c) { return L(c) === "A" && !sinStock(c); }, lote: true, color: "A" },
    { id: "almacenes", que: "El material está bien identificado; lo que no corresponde es el almacén donde figura.", titulo: "Dónde está el stock: el almacén", corto: "Dónde está el stock",
      desc: "El material está bien identificado; lo que no coincide es el almacén donde SAP " +
            "registra su stock. Detectar la diferencia y decidir cambiarla son dos cosas " +
            "distintas: acá se decide, de a una.",
      pred: function (c) { return c.almacen_estado === AL_CAMB || c.almacen_estado === AL_MULT; },
      lote: false, color: "D", esAlmacen: true },
    { id: "depurar", que: "Materiales con existencia cero. No hay stock que dar de baja: se decide el registro.", titulo: "Materiales del maestro sin existencia", corto: "Maestro en cero",
      desc: "Están en el maestro con existencia CERO. No hay stock que dar de baja: lo que " +
            "se decide es qué pasa con el registro —se mantiene, se bloquea o se da de baja—.",
      pred: function (c) { return L(c) === "F"; }, lote: true, color: "E" },
    { id: "bajas", que: "SAP registra stock en esa base y ningún inventario lo encontró. Van últimas.", titulo: "Dar de baja lo que no se encontró", corto: "Dar de baja",
      desc: "SAP registra stock en esa base y ningún inventario físico lo identificó. " +
            "Aprobar significa proponer la baja, no ejecutarla. Conviene dejarlo para el " +
            "final: la lista se achica a medida que se resuelven los códigos.",
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
    cola: null, motivo: null, triage: [], tIdx: 0, selCand: {}, selPar: {}, unif: "",
    sel: {}, depFiltro: "",
    /* El panel: qué base se está mirando, qué segmento está abierto y con qué
       filtros. El alcance (base) es aparte de los filtros a propósito: no es
       un filtro más, es el encuadre, y se conserva al cambiar de segmento. */
    base: "", seg: "revision", bpag: 1, bVer: "pend", mTab: "general",
    /* "bandeja" para ver y decidir muchos; "foco" para un caso por pantalla.
       Son dos modos de la misma pantalla, no dos pantallas. */
    modo: "bandeja",
    bf: { texto: "", tipo: "", motivo: "", almacen: "", obs: "" },
    /* Qué acciones del plan están desplegadas en «Aplicar en SAP». */
    apl: {},
  };


  // ------------------------------------------------------------- persistencia
  function dec(id) { return decisiones()[id] || null; }
  function revisorActual() { return Almacen.revisor(); }

  /* Una decisión nunca pisa el dato original: se guarda aparte, con quién y
     cuándo. Quién sale de la sesión cuando se entró con Entra ID, así que en
     ese modo no es un nombre escrito a mano. */
  function decidir(id, cambios, descripcion) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    Almacen.decidir(id, cambios, descripcion);
    invalidar();
  }

  /* Una sola explicación, en el único lugar por el que pasan todas las
     decisiones. Antes de esto, el archivo suelto dejaba decidir y lo decidido
     no llegaba a ningún lado. */
  var yaAvisoConsulta = false;
  function avisarConsulta() {
    if (yaAvisoConsulta) { aviso("Esta copia es para consultar: las decisiones van en la aplicación."); return; }
    yaAvisoConsulta = true;
    var donde = (D.meta && D.meta.aplicacion) || "";
    var cont = document.createElement("div");
    cont.innerHTML = '<div class="modalfondo"><div class="modal">' +
      "<h2>Esta copia es para consultar</h2>" +
      '<p class="sub">Podés mirar todo —el análisis, las fichas, la comparación ' +
      "característica por característica, el informe— pero las decisiones se " +
      "toman en la aplicación.</p>" +
      '<div class="aviso" style="margin-top:16px"><b>Por qué.</b>' +
      "Cuando el sistema era un archivo que circulaba por correo, cada copia era " +
      "un lugar donde alguien decidía sin que nadie se enterara, y eso no entraba " +
      "en ningún lado. En la aplicación las decisiones quedan en una base " +
      "compartida, firmadas con tu cuenta, y todos ven lo mismo.</div>" +
      (donde ? '<p class="sub" style="margin-top:16px">La aplicación está en ' +
               '<b>' + esc(donde) + "</b>.</p>" : "") +
      '<div class="modalacc"><button class="btn pri" id="cqOk">Entendido</button></div>' +
      "</div></div>";
    document.body.appendChild(cont.firstChild);
    var m = document.querySelector(".modalfondo");
    function cerrar() { m.remove(); }
    m.querySelector("#cqOk").addEventListener("click", cerrar);
    m.addEventListener("click", function (ev) { if (ev.target === m) cerrar(); });
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

  /* ---- Equivalencias entre nomenclaturas -------------------------------
     El depósito y SAP no nombran igual las cosas, y la correspondencia no es
     uno a uno en ninguno de los dos sentidos:

       · un ítem del depósito puede ser VARIOS códigos de SAP (el mismo
         producto abierto más de una vez), y
       · varios ítems del depósito —con nombres distintos, de la misma base o
         de bases distintas— pueden ser UN MISMO código de SAP.

     Lo segundo es masivo: hay cientos de códigos con más de un ítem físico
     compatible. «Adrenalina amp 1 ml», «ADRENALINA INY» y «Adrenalina 1
     amp=1ml» son tres nombres del mismo material. Si cada uno se decide por
     separado, la misma pregunta se contesta tres veces y puede contestarse
     distinto.

     Por eso se pueden declarar equivalencias en los dos sentidos, y quedan
     registradas como tales. */

  /* Los otros ítems que podrían ser lo mismo que éste.

     La lista viene del análisis, no se arma acá. Un primer intento la armaba
     en el navegador con «comparten un candidato en SAP», y eso proponía
     juntar «Ácido acetilsalicílico 100 mg» con «N-acetilcisteína 600»: el
     candidato lo genera el parecido del nombre, no el producto. Del lado del
     análisis se comparan las características, que es el mismo criterio con el
     que se decide todo lo demás.

     Acá sólo se ordena: primero los que siguen en revisión, que son los que
     esta decisión destraba. */
  function parientes(c) {
    var lista = (D.meta.equivalencias || {})[c.id] || [];
    return lista.map(function (x) {
      var o = caso(x.id);
      return { caso: o, por: x.por, coinciden: x.coinciden || [],
               fuertes: x.fuertes || [], parecido: x.parecido,
               enRevision: L(o) === "D" || L(o) === "B" };
    }).filter(function (x) { return !!x.caso; })
      .sort(function (a, b) {
        if (a.enRevision !== b.enRevision) return a.enRevision ? -1 : 1;
        return b.fuertes.length - a.fuertes.length;
      });
  }
  /* Dónde está el stock de un material en una base. */
  /* ---- Importe de última compra -----------------------------------------
     No está en ninguno de los archivos recibidos: entra por el maestro general
     unificado, que se importa desde Maestro. Mientras no esté, no se inventa
     ningún valor: el caso queda PENDIENTE DE VALORIZACIÓN y se dice. */
  /* Cuántos códigos tiene el maestro con el que se está trabajando. Es la
     bajada de SAP más lo que se haya importado: incluye los que tienen
     existencia y los que están en cero. */
  function totalMaestro() { return maestroUnificado().filas.length; }

  function precios() {
    var m = depuObj().maestro;
    return (m && m.precios) || {};
  }
  function precioDe(cod) {
    if (!cod) return null;
    var p = precios()[cod];
    return (typeof p === "number" && isFinite(p)) ? p : null;
  }
  function unidadesDe(c) {
    return c.origen === "Inventario físico" ? (c.cantidad_fisica || 0) : (c.stock_sap || 0);
  }
  /* Qué se puede valorizar y qué no. La metodología, escrita: unidades del
     caso por el importe de última compra del material decidido. Si falta el
     importe, el caso cuenta como pendiente de valorizar y no suma cero: suma
     nada, que no es lo mismo. */
  function economia(lista) {
    var casos = lista || D.casos.filter(enAlcance);
    var pre = precios(), mats = {}, conPrecio = 0;
    Object.keys(pre).forEach(function (k) {
      if (typeof pre[k] === "number" && isFinite(pre[k])) conPrecio++; });
    var r = { conPrecio: conPrecio, materiales: 0, valorizados: 0, pendientes: 0,
              total: 0, porAccion: {} };
    casos.forEach(function (c) {
      var e = efectivo(c);
      (e.materiales.length ? e.materiales : (c.material_sap ? [c.material_sap] : []))
        .forEach(function (m) { mats[m] = 1; });
      if (L(c) === "E") return;                   // fuera del alcance: no hay nada que valorizar
      /* Sólo lo YA DECIDIDO tiene impacto económico: una decisión que todavía
         no se tomó no vale plata. Los materiales del maestro sin stock se
         deciden por código, no por caso, así que ahí se pregunta por la
         depuración. */
      if (L(c) === "F") { if (!accionDep(c.material_sap).accion) return; }
      else if (pendiente(c)) return;
      var cod = e.material || c.material_sap;
      var pu = precioDe(cod), un = unidadesDe(c);
      var acc = e.aprobacion;
      var g = r.porAccion[acc] || (r.porAccion[acc] = { n: 0, un: 0, val: 0, sinPrecio: 0 });
      g.n++; g.un += un;
      if (pu == null) { g.sinPrecio++; r.pendientes++; return; }
      g.val += un * pu; r.total += un * pu; r.valorizados++;
    });
    r.materiales = Object.keys(mats).length;
    return r;
  }

  /* Un color por base. El índice sale del orden del análisis, no del
     alfabético, y es el mismo en la pantalla, en el Excel y en el informe: el
     color tiene que significar lo mismo en los tres lados. Nunca va solo —el
     nombre se escribe siempre al lado—, porque un color no se recuerda; lo que
     resuelve es encontrar de un vistazo lo de cada base en una lista larga. */
  function nBase(b) {
    var i = D.meta.bases.indexOf(b);
    return i >= 0 ? i + 1 : 0;
  }
  /* Quién decidió, cuando hay quién. El almacén guarda «(sin identificar)» si
     nadie escribió su nombre, y eso pegado a «Correspondencia confirmada» se
     lee como si lo que faltara identificar fuera el material. */
  var SIN_FIRMA = "(sin identificar)";
  function quienDecidio(e) {
    return e.revisor && e.revisor !== SIN_FIRMA ? e.revisor : "";
  }

  function chipBase(b) {
    return '<span class="bs bs' + nBase(b) + '"><i></i>' + esc(b) + "</span>";
  }
  function puntoBase(b) {
    return '<span class="bsp bs' + nBase(b) + '"><i></i>' + esc(b) + "</span>";
  }

  function ubicacionDe(base, material) {
    var u = (D.meta.almacenes.ubicacion || {})[base + "|" + material];
    return u || [];
  }

  /* Códigos que quedaron asignados a algún ítem físico, por base. Un material que
     fue agrupado deja de ser candidato a baja: alguien lo identificó. */
  var CACHE_ASIG = null;
  function invalidar() { CACHE_ASIG = null; CACHE_UNI = null; CACHE_PRES = null; }
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
  /* Los grupos de equivalencia ya declarados, en los dos sentidos: los nombres
     del depósito de un lado y los códigos de SAP del otro. Un grupo puede tener
     varios de cada lado. Se arman por la nomenclatura unificada, que es lo que
     los identifica como el mismo producto. */
  function grupos() {
    var porNombre = {}, sueltos = [];
    D.casos.forEach(function (c) {
      var e = efectivo(c);
      if (e.unificada) {
        var g = porNombre[e.unificada] || (porNombre[e.unificada] = {
          nombre: e.unificada, items: [], materiales: {}, bases: {}, revisor: e.revisor });
        if (c.origen === "Inventario físico") g.items.push(c);
        e.materiales.forEach(function (m) { g.materiales[m] = 1; });
        g.bases[c.base] = 1;
        if (e.revisor) g.revisor = e.revisor;
      } else if (e.materiales.length > 1) {
        // Agrupó códigos sin ponerle nombre al grupo.
        sueltos.push({ nombre: c.nombre_fisico, items: [c],
                       materiales: e.materiales.reduce(function (o, m) { o[m] = 1; return o; }, {}),
                       bases: {}, revisor: e.revisor });
        sueltos[sueltos.length - 1].bases[c.base] = 1;
      }
    });
    return Object.keys(porNombre).map(function (k) { return porNombre[k]; })
      .concat(sueltos)
      .map(function (g) {
        return { nombre: g.nombre, items: g.items,
                 materiales: Object.keys(g.materiales).sort(),
                 bases: Object.keys(g.bases).sort(), revisor: g.revisor };
      })
      .sort(function (a, b) { return b.items.length - a.items.length; });
  }
  // ------------------------------------------------------- QUÉ APLICAR EN SAP
  /* La pregunta que tiene que poder contestarse al final es una sola: «qué
     hago yo en SAP». Se contesta acá, una vez, y de este mismo cálculo salen
     la pantalla «Aplicar en SAP», la primera hoja del Excel y la sección del
     informe. Tres salidas, un solo criterio: si cambia algo, cambia en los
     tres lados a la vez. */

  /* Las dos magnitudes, siempre separadas. Un alta se mide en unidades
     CONTADAS en el depósito; una baja, en unidades que SAP registra. Sumarlas
     daría un número que no significa nada. */
  function unContadas(c) { return c.cantidad_fisica || 0; }
  function unDeSap(c) {
    return c.origen === "Inventario físico" ? (c.stock_sap_en_base || 0) : (c.stock_sap || 0);
  }

  /* La acción concreta, derivada del estado del caso y de lo decidido.
     Devuelve el verbo (con el que se agrupa), el detalle (con el que se
     ejecuta), si todavía falta decidirla, y la cantidad con su magnitud. */
  function accionSap(c) {
    var e = efectivo(c), l = L(c);
    var d = decisiones()[c.id] || {};
    var mat = e.materiales.join(" · ") || c.material_sap || "";
    var ub = (c.almacenes || []).map(function (x) { return x.almacen; });
    var esp = c.almacen_esperado || c.almacen_base || "";
    var fis = unContadas(c), sap = unDeSap(c);

    if (l === "E") {
      return { verbo: "Ninguna · fuera del alcance", det:
        "El inventario relevado es de Farmacia. Su ausencia no permite concluir nada.",
        pend: false, un: 0, mag: "" };
    }
    if (l === "F") {
      var dep = accionDep(c.material_sap) || { accion: "" };
      if (!dep.accion) return { verbo: "PENDIENTE · decidir el registro del maestro",
        det: "El material " + mat + " está en el maestro con existencia cero. " +
             "Hay que decidir si se mantiene, se bloquea o se da de baja.",
        pend: true, un: 1, mag: "registro" };
      return { verbo: dep.accion === DP_BAJA
                 ? "Dar de baja del maestro" : dep.accion + " en el maestro",
        det: "Material " + mat + ", sin existencia. " + dep.accion + "." +
             (dep.motivo ? " Motivo: " + dep.motivo : ""),
        pend: false, un: 1, mag: "registro" };
    }
    if (e.aprobacion === "Rechazado") {
      return { verbo: "Ninguna · se rechazó la propuesta",
        det: "Se revisó y se decidió no hacer nada." +
             (e.observaciones ? " " + e.observaciones : ""), pend: false, un: 0, mag: "" };
    }

    if (l === "B") {
      if (!e.ruta_b && !e.verificacion) return { verbo: "PENDIENTE · decidir si se crea",
        det: "«" + (c.nombre_fisico || "") + "» está contado en " + c.base +
             " y ningún material del maestro le corresponde.",
        pend: true, un: fis, mag: "contadas" };
      if (e.ruta_b === RB_VERIF && !e.verificacion)
        return { verbo: "PENDIENTE · consultar en SAP",
          det: "Se eligió consultar en SAP antes de crear. Falta cargar el resultado.",
          pend: true, un: fis, mag: "contadas" };
      var ce = d.centro_alta || c.centro || "", al = d.almacen_alta || esp;
      /* Apareció en el maestro completo y sirve: no hay nada que crear. Lo que
         falta es la existencia en esa base, que es un ajuste de stock. */
      if (e.verificacion === VER_SIRVE)
        return { verbo: "Ajustar el stock",
          det: "El material existe en SAP como " + (e.codigo_maestro || mat) +
               " —se consultó el maestro completo— y no hay nada que crear. Cargar " +
               num(fis) + " unidades en el almacén " + (d.almacen_ajuste || al) +
               " (" + c.base + ").", pend: false, un: fis, mag: "contadas" };
      if (e.verificacion && e.verificacion.indexOf("baja y alta nueva") >= 0)
        return { verbo: "Dar de baja el código viejo y crear uno nuevo",
          det: "Dar de baja " + (e.codigo_maestro || "el código encontrado") +
               " y crear el material de «" + (c.nombre_fisico || "") + "» en el centro " +
               ce + ", almacén " + al + ".", pend: false, un: fis, mag: "contadas" };
      return { verbo: "Crear el material en SAP",
        det: "Crear «" + (c.nombre_fisico || "") + "» (" + (c.presentacion || "sin presentación") +
             ") en el centro " + ce + ", almacén " + al + ". " +
             num(fis) + " unidades contadas en " + c.base + ".",
        pend: false, un: fis, mag: "contadas" };
    }

    if (l === "C") {
      if (resueltoPorAgrupacion(c))
        return { verbo: "Ninguna · quedó identificado",
          det: "Se identificó al agrupar nomenclaturas: ya no es candidato a baja.",
          pend: false, un: 0, mag: "" };
      if (e.aprobacion === "Sin decidir") return { verbo: "PENDIENTE · decidir la baja",
        det: "SAP registra " + num(sap) + " unidades de " + mat + " en " +
             c.base + " y ningún inventario lo identificó." +
             (c.bloqueado_por_revision ? " Depende de un caso en revisión." : ""),
        pend: true, un: sap, mag: "sap" };
      return { verbo: "Dar de baja el stock",
        det: "Dar de baja " + num(sap) + " unidades de " + mat + " en " +
             c.base + (ub.length ? ", almacén " + ub.join(" y ") : "") + ".",
        pend: false, un: sap, mag: "sap" };
    }

    // Clase A y D: lo primero es tener el código; después, el almacén.
    if (!e.materiales.length) {
      return { verbo: "PENDIENTE · decidir a qué código corresponde",
        det: "«" + (c.nombre_fisico || "") + "» en " + c.base + ". " +
             (c.motivo || "") + ".", pend: true, un: fis, mag: "contadas" };
    }
    if (e.aprobacion === "Sin decidir") {
      return { verbo: "PENDIENTE · confirmar el código",
        det: "El análisis propone " + mat + " para «" + (c.nombre_fisico || "") +
             "». Falta confirmarlo.", pend: true, un: fis, mag: "contadas" };
    }
    if (c.material_sin_stock_en_base) {
      var alAj = d.almacen_ajuste || esp;
      if (!d.ajuste_stock && !e.almacen_decidido)
        return { verbo: "PENDIENTE · decidir el ajuste de stock",
          det: "Hay " + num(fis) + " unidades contadas en " + c.base +
               " y SAP no registra existencia de " + mat + " ahí.",
          pend: true, un: fis, mag: "contadas" };
      return { verbo: "Ajustar el stock",
        det: "Cargar " + num(fis) + " unidades de " + mat +
             " en el almacén " + alAj + " (" + c.base + "), que hoy figura sin existencia.",
        pend: false, un: fis, mag: "contadas" };
    }
    if (e.almacen_decidido) {
      if (/^Lo valida/.test(e.almacen_decidido))
        return { verbo: "PENDIENTE · lo valida la base",
          det: "El almacén quedó para que lo confirme el responsable de " + c.base + ".",
          pend: true, un: sap, mag: "sap" };
      if (/es el correcto/.test(e.almacen_decidido))
        return { verbo: "Ninguna · ya está bien",
          det: "El stock está en el almacén correcto; se corrige la propuesta del análisis.",
          pend: false, un: 0, mag: "" };
      return { verbo: "Mover de almacén",
        det: e.almacen_decidido + " · material " + mat + " en " + c.base + ".",
        pend: false, un: sap, mag: "sap" };
    }
    if (c.almacen_estado === "Almacén a cambiar" || c.almacen_estado === "Material en múltiples almacenes")
      return { verbo: "PENDIENTE · decidir el almacén",
        det: "El stock de " + mat + " figura en " + (ub.join(" y ") || "—") +
             " y el propuesto para " + c.base + " · " + c.tipo + " es " + (esp || "—") + ".",
        pend: true, un: sap, mag: "sap" };
    return { verbo: "Ninguna · ya está bien",
      det: "Identificado como " + mat + " y con el stock donde corresponde.",
      pend: false, un: 0, mag: "" };
  }

  /* Las acciones posibles, en orden, con el bloque y la familia a la que
     pertenece cada una. Esta tabla es la única lista: de acá salen el orden
     del Excel, los bloques de la pantalla y los del informe. */
  var ACCIONES = [
    ["Crear el material en SAP", "ejecutar", "altas"],
    ["Dar de baja el código viejo y crear uno nuevo", "ejecutar", "altas"],
    ["Ajustar el stock", "ejecutar", "existencias"],
    ["Mover de almacén", "ejecutar", "ubicacion"],
    ["Dar de baja el stock", "ejecutar", "bajas"],
    ["Dar de baja del maestro", "ejecutar", "maestro"],
    ["Bloquear en el maestro", "ejecutar", "maestro"],
    ["PENDIENTE · decidir a qué código corresponde", "falta", "traza", "revision"],
    ["PENDIENTE · confirmar el código", "falta", "traza", "identificados"],
    ["PENDIENTE · decidir si se crea", "falta", "altas", "altas"],
    ["PENDIENTE · consultar en SAP", "falta", "altas", "altas"],
    ["PENDIENTE · decidir el ajuste de stock", "falta", "existencias", "existencias"],
    ["PENDIENTE · decidir el almacén", "falta", "ubicacion", "almacenes"],
    ["PENDIENTE · lo valida la base", "falta", "ubicacion", "almacenes"],
    ["PENDIENTE · decidir el registro del maestro", "falta", "maestro", "depurar"],
    ["PENDIENTE · decidir la baja", "falta", "bajas", "bajas"],
    ["Mantener en el maestro", "nada", "maestro"],
    ["Ninguna · ya está bien", "nada", "resuelto"],
    ["Ninguna · quedó identificado", "nada", "resuelto"],
    ["Ninguna · se rechazó la propuesta", "nada", "resuelto"],
    ["Ninguna · fuera del alcance", "fuera", "fuera"],
  ];
  var ACC = {};
  ACCIONES.forEach(function (x, i) {
    ACC[x[0]] = { bloque: x[1], fam: x[2], seg: x[3] || "", i: i }; });

  /* Qué significa cada acción, en una frase. Va en el Excel y en el informe:
     el que ejecuta en SAP no tiene por qué saber de qué clasificación salió
     el caso, pero sí qué le están pidiendo exactamente. */
  var EXPLICA = {
    "Crear el material en SAP":
      "Dar de alta el material. Las unidades contadas son la existencia que hay " +
      "que cargar en el centro y el almacén indicados.",
    "Dar de baja el código viejo y crear uno nuevo":
      "Se consultó SAP: el material existe pero no sirve. Se da de baja ese " +
      "código y se crea uno nuevo.",
    "Ajustar el stock":
      "El material existe en SAP y hay mercadería contada, pero esa base no " +
      "registra existencia: hay que cargarla en el almacén indicado.",
    "Mover de almacén":
      "El material está bien identificado; el stock figura en un almacén que no " +
      "corresponde y se traslada dentro de la misma base.",
    "Dar de baja el stock":
      "SAP registra esas unidades y ningún inventario las encontró. Se da de baja " +
      "el stock de esa base, no el material.",
    "Dar de baja del maestro":
      "Material sin existencia: se decidió eliminar el registro del maestro.",
    "Bloquear en el maestro":
      "Material sin existencia: se decidió que no pueda usarse en documentos " +
      "nuevos, conservando el registro y su histórico.",
    "Mantener en el maestro":
      "Material sin existencia: se decidió dejar el registro como está. No hay " +
      "nada que hacer en SAP.",
    "PENDIENTE · decidir a qué código corresponde":
      "Falta decidir a qué material de SAP corresponde el ítem contado. Hasta " +
      "que no esté, no se puede hacer nada con el caso.",
    "PENDIENTE · confirmar el código":
      "El análisis propone un código y falta que una persona lo confirme.",
    "PENDIENTE · decidir si se crea":
      "Falta elegir entre consultar el maestro completo antes de crear, o crear " +
      "asumiendo el riesgo de duplicar un código que ya exista sin stock.",
    "PENDIENTE · consultar en SAP":
      "Se eligió consultar el maestro antes de crear y falta cargar el resultado " +
      "de esa consulta.",
    "PENDIENTE · decidir el ajuste de stock":
      "Hay existencia física y SAP no la registra en esa base: falta decidir el " +
      "ajuste y en qué almacén se carga.",
    "PENDIENTE · decidir el almacén":
      "El stock figura en un almacén distinto del propuesto: falta decidir si se " +
      "mueve o si la propuesta del análisis estaba mal.",
    "PENDIENTE · lo valida la base":
      "La decisión del almacén quedó para que la confirme el responsable de la base.",
    "PENDIENTE · decidir el registro del maestro":
      "Material sin existencia: falta decidir si se mantiene, se bloquea o se da " +
      "de baja del maestro.",
    "PENDIENTE · decidir la baja":
      "Falta aprobar o rechazar la baja del stock que ningún inventario encontró " +
      "en esa base.",
    "Ninguna · ya está bien":
      "Identificado, con existencia y con el stock en el almacén que corresponde.",
    "Ninguna · quedó identificado":
      "Era candidato a baja y al agrupar nomenclaturas resultó identificado: la " +
      "baja ya no corresponde.",
    "Ninguna · se rechazó la propuesta":
      "Se revisó y se decidió expresamente no hacer nada.",
    "Ninguna · fuera del alcance":
      "Indumentaria, equipamiento o repuestos. El inventario relevado es de " +
      "Farmacia, así que su ausencia no permite concluir nada.",
  };

  var BLOQUES = [
    { id: "ejecutar", titulo: "Hay que hacerlo en SAP",
      nota: "Decidido y listo para ejecutar. Nada de esto lo hizo el sistema: " +
            "es el pedido de trabajo." },
    { id: "falta", titulo: "Todavía no se pudo decidir",
      nota: "No se ejecuta nada de esto hasta que alguien lo decida. " +
            "Se decide en «Trabajar»." },
    { id: "nada", titulo: "Decidido, y no hay nada que hacer",
      nota: "Quedó resuelto sin que haya que tocar SAP. Está acá para que se " +
            "vea que se revisó, no para hacer algo con él." },
    { id: "fuera", titulo: "Fuera del alcance",
      nota: "El inventario relevado es de Farmacia. De estos materiales no se " +
            "concluye nada, ni alta ni baja." },
  ];

  /* Cada familia dice en qué se miden sus cantidades. El rótulo va siempre
     pegado al número: un «300» sin decir si son unidades contadas, unidades
     de SAP o registros del maestro es un número que invita a equivocarse. */
  var FAMILIAS = {
    altas: { titulo: "Altas de material", mag: "unidades contadas",
             nota: "Productos contados en el depósito a los que ningún material de " +
                   "SAP les corresponde. Hay que crear el material." },
    existencias: { titulo: "Ajustes de existencia", mag: "unidades contadas",
                   nota: "El código existe y la mercadería está: lo que falta es la " +
                         "existencia cargada en esa base." },
    ubicacion: { titulo: "Movimientos de almacén", mag: "unidades en SAP",
                 nota: "El material está bien identificado y tiene stock. Lo que no " +
                       "corresponde es el almacén donde figura." },
    bajas: { titulo: "Bajas de stock", mag: "unidades en SAP",
             nota: "Stock que SAP registra en una base y que ningún inventario " +
                   "encontró ahí." },
    maestro: { titulo: "Maestro de materiales", mag: "registros",
               nota: "Materiales sin existencia: no hay stock que dar de baja. Lo que " +
                     "se decide es qué pasa con el registro." },
    traza: { titulo: "Identificación", mag: "unidades contadas",
             nota: "Sin saber a qué código de SAP corresponde el ítem, no hay acción " +
                   "posible: es lo primero." },
    resuelto: { titulo: "Sin acción", mag: "",
                nota: "Revisado y cerrado sin trabajo en SAP." },
    fuera: { titulo: "Fuera del alcance", mag: "",
             nota: "Indumentaria, equipamiento y repuestos." },
  };

  /* El resumen consolidado: qué hay que aplicar en SAP, con sus cantidades,
     qué quedó sin decidir y qué está fuera del alcance. Es lo mismo que se ve
     en la pantalla, se baja en el Excel y se imprime en el informe. */
  function plan(lista) {
    var casos = lista || D.casos.filter(enAlcance);
    var pre = precios();
    var bls = BLOQUES.map(function (b) {
      return { id: b.id, titulo: b.titulo, nota: b.nota, n: 0, fams: [], _f: {} };
    });
    var porId = {};
    bls.forEach(function (b) { porId[b.id] = b; });
    var porBase = {}, codigos = {};

    casos.forEach(function (c) {
      var a = accionSap(c);
      var meta = ACC[a.verbo] || { bloque: "nada", fam: "resuelto", i: 99 };
      var b = porId[meta.bloque];
      var fam = b._f[meta.fam] || (b._f[meta.fam] = {
        id: meta.fam, titulo: FAMILIAS[meta.fam].titulo, mag: FAMILIAS[meta.fam].mag,
        nota: FAMILIAS[meta.fam].nota, n: 0, contadas: 0, sap: 0, registros: 0,
        importe: 0, sinImporte: 0, _a: {} });
      var acc = fam._a[a.verbo] || (fam._a[a.verbo] = {
        verbo: a.verbo, i: meta.i, seg: meta.seg, n: 0, contadas: 0, sap: 0,
        registros: 0, importe: 0, sinImporte: 0, casos: [] });

      var e = efectivo(c);
      var cod = e.materiales[0] || c.material_sap || "";
      var p = (typeof pre[cod] === "number" && isFinite(pre[cod])) ? pre[cod] : null;
      /* Sólo lo que ya se decidió tiene impacto económico: una decisión que
         todavía no se tomó no vale plata. Es el mismo criterio que economía(),
         y por eso las dos cifras cierran entre sí. */
      var vale = meta.bloque === "ejecutar" && a.un && a.mag !== "registro";
      var imp = (vale && p !== null) ? a.un * p : null;

      [b, fam, acc].forEach(function (x) { x.n++; });
      [fam, acc].forEach(function (x) {
        if (a.mag === "contadas") x.contadas += a.un;
        if (a.mag === "sap") x.sap += a.un;
        if (a.mag === "registro") x.registros += a.un;
        if (imp === null) { if (vale) x.sinImporte++; } else x.importe += imp;
      });
      acc.casos.push({ c: c, a: a, cod: cod, importe: imp });
      if (cod) codigos[cod] = 1;

      var pb = porBase[c.base] || (porBase[c.base] = { ejecutar: 0, falta: 0, nada: 0, fuera: 0 });
      pb[meta.bloque]++;
    });

    bls.forEach(function (b) {
      b.fams = Object.keys(b._f).map(function (k) { return b._f[k]; });
      b.fams.forEach(function (f) {
        f.acciones = Object.keys(f._a).map(function (k) { return f._a[k]; })
          .sort(function (x, y) { return x.i - y.i; });
        f.i = f.acciones[0].i;
        delete f._a;
      });
      b.fams.sort(function (x, y) { return x.i - y.i; });
      delete b._f;
    });

    var decidibles = casos.filter(function (c) { return L(c) !== "E"; });
    return { bloques: bls.filter(function (b) { return b.n > 0; }),
             todos: bls, porBase: porBase,
             casos: casos.length, materiales: Object.keys(codigos).length,
             decidibles: decidibles.length,
             falta: porId.falta.n, ejecutar: porId.ejecutar.n,
             pct: decidibles.length
               ? Math.round((decidibles.length - porId.falta.n) / decidibles.length * 100) : 0 };
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
  /* Acá se cuentan TRES cosas distintas y conviene no mezclarlas nunca:

       ítem      un producto contado en un inventario físico
       unidad    cada unidad de ese producto (un ítem puede ser 500 unidades)
       caso      una fila del análisis: un ítem físico, o un material de SAP
                 con stock que ningún inventario identificó

     Y hay una trampa más: las unidades CONTADAS en el depósito y las unidades
     de STOCK EN SAP no son la misma magnitud y no se suman. Por eso se
     devuelven por separado. */
  function magnitudes(lista) {
    var r = { casos: lista.length, items: 0, contadas: 0, enSap: 0, materiales: 0 };
    var mats = {};
    lista.forEach(function (c) {
      if (c.origen === "Inventario físico") {
        r.items++;
        r.contadas += c.cantidad_fisica || 0;
      } else {
        r.enSap += c.stock_sap || 0;
      }
      efectivo(c).materiales.forEach(function (m) { mats[m] = 1; });
    });
    r.materiales = Object.keys(mats).length;
    return r;
  }
  /* El renglón que acompaña a un número: dice de qué son esas unidades. */
  function detalleMagnitud(m) {
    var p = [], deSap = m.casos - m.items;
    if (m.items) p.push(num(m.items) + (m.items === 1 ? " ítem contado" : " ítems contados") +
                        " · " + num(m.contadas) + " unidades");
    // Un material de SAP con stock cero sigue siendo un caso: decir «de SAP»
    // y nada más dejaría la impresión de que no hay nada que contar.
    if (deSap) p.push(num(deSap) + (deSap === 1 ? " material de SAP · " : " materiales de SAP · ") +
                      (m.enSap ? num(m.enSap) + " unidades de stock" : "sin stock"));
    return p.join("  |  ");
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
  /* El mismo indicador, pero para mirar: no finge ser un botón. */
  function kpiFijo(color, titulo, n, det) {
    return '<div class="kpi fijo ' + color + '">' +
      '<div class="t"><i class="pt" style="background:var(--c' + color + ')"></i>' +
      esc(titulo) + '</div><div class="n">' + num(n) + '</div><div class="d">' +
      esc(det) + "</div></div>";
  }
  function barraProgreso(hechos, total, color) {
    var p = total ? Math.round(hechos / total * 100) : 100;
    return '<div class="prog"><div class="pbar"><i style="width:' + p + "%;background:var(--c" +
      (color || "A") + ')"></i></div><span>' + num(hechos) + " de " + num(total) +
      " · " + p + "%</span></div>";
  }

  // ------------------------------------------------------------- SESIÓN
  /* Dónde quedó el trabajo: la base, el grupo, los filtros, la página y el
     caso abierto. Sin esto, cerrar el navegador o recargar devuelve al
     principio y hay que volver a encontrar dónde se estaba, que sobre 1.991
     casos no es un detalle.

     Se guarda por revisor y aparte de las decisiones: una sesión es dónde
     estoy mirando, no lo que decidí. Perder la sesión no pierde nada del
     trabajo; mezclarlas haría que cada vez que alguien cambia de pantalla
     parezca que cambió algo. */
  var CLAVE_SESION = "invsap.sesion.v1";
  var guardando = null;
  function guardarSesion() {
    if (guardando) clearTimeout(guardando);
    guardando = setTimeout(function () {
      guardando = null;
      try {
        localStorage.setItem(CLAVE_SESION, JSON.stringify({
          v: 1, cuando: new Date().toISOString(), quien: revisorActual(),
          vista: estado.vista, modo: estado.modo, base: estado.base,
          seg: estado.seg, bpag: estado.bpag, bVer: estado.bVer, bf: estado.bf,
          mTab: estado.mTab, cola: estado.cola, motivo: estado.motivo,
          tIdx: estado.tIdx,
          triage: (estado.triage || []).map(function (c) { return c.id; }),
        }));
      } catch (e) { void e; }          // sin localStorage se trabaja igual
    }, 400);
  }
  function leerSesion() {
    try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || "null"); }
    catch (e) { return null; }
  }
  function retomarSesion(ss) {
    if (!ss || ss.v !== 1) return false;
    estado.base = ss.base || "";
    estado.seg = ss.seg || "revision";
    estado.bpag = ss.bpag || 1;
    estado.bVer = ss.bVer || "pend";
    estado.bf = ss.bf || estado.bf;
    estado.mTab = ss.mTab || "general";
    estado.modo = "bandeja";
    /* El caso que estaba abierto sólo se recupera si sigue existiendo y sigue
       pendiente: retomar en un caso que otro ya decidió sería hacerle contestar
       de nuevo algo que ya está contestado. */
    if (ss.modo === "foco" && ss.cola && colaPor(ss.cola) && (ss.triage || []).length) {
      var q = colaPor(ss.cola);
      var cs = ss.triage.map(caso).filter(function (c) {
        return c && pendienteCola(c, q); });
      if (cs.length) {
        estado.cola = ss.cola; estado.motivo = ss.motivo || null;
        estado.triage = cs;
        estado.tIdx = Math.min(ss.tIdx || 0, cs.length - 1);
        estado.modo = "foco";
      }
    }
    /* Se retoma la pantalla de trabajo o el maestro, no cualquiera. Volver y
       aparecer en «Cómo se usa» o en el informe —que además se rearma entero—
       porque fue lo último que se abrió, desorienta más de lo que ayuda. */
    if (ss.vista === "inicio" || ss.vista === "depurar" || ss.vista === "aplicar")
      estado.vista = ss.vista;
    else estado.vista = "inicio";
    return true;
  }
  function olvidarSesion() {
    try { localStorage.removeItem(CLAVE_SESION); } catch (e) { void e; }
  }

  // ------------------------------------------------------------- navegación
  var VISTAS = ["inicio", "casos", "ficha", "depurar", "aplicar", "informe", "ayuda"];
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
    if (vista === "casos") pintarCasos();
    if (vista === "ficha") { if (arg) estado.fichaId = arg; pintarFicha(); }
    if (vista === "depurar") pintarMaestro();
    if (vista === "aplicar") pintarAplicar();
    if (vista === "informe") document.getElementById("v-informe").innerHTML = Exportar.informeHtml();
    if (vista === "ayuda") pintarAyuda();
    guardarSesion();
    window.scrollTo(0, 0);
  }

  function abrirCola(id, motivo) {
    var q = colaPor(id);
    estado.cola = id; estado.motivo = motivo || null;
    estado.triage = deCola(id).filter(function (c) {
      return pendienteCola(c, q) && (!motivo || c.motivo === motivo);
    });
    estado.tIdx = 0; estado.selCand = {}; estado.selPar = {}; estado.unif = "";
    if (!estado.triage.length) { aviso("No quedan casos pendientes en este grupo."); return; }
    estado.modo = "foco"; guardarSesion();
    if (estado.vista !== "inicio") return ir("inicio");
    pintarInicio();
  }
  function salirDelFoco() {
    estado.modo = "bandeja"; estado.cola = null; estado.triage = [];
    guardarSesion();
    if (estado.vista !== "inicio") return ir("inicio");
    pintarInicio();
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

  // ------------------------------------------------------------- ALCANCE
  /* Todo lo que se ve y se decide respeta el alcance elegido: una base o las
     tres. No es un filtro más entre otros —por eso está arriba de todo y se
     conserva al cambiar de segmento—: es el encuadre del análisis. Una decisión
     tomada con el alcance en una base vale igual en el análisis integral,
     porque el caso es el mismo registro: lo que cambia es qué se ve, nunca
     dónde se guarda. */
  function enAlcance(c) { return !estado.base || c.base === estado.base; }

  // ------------------------------------------------------------- SEGMENTOS
  /* Los siete grupos de siempre, más los resueltos y lo que está fuera del
     alcance. Dejan de ser siete tarjetas grandes apiladas y pasan a ser
     solapas de una sola bandeja: la misma información, un solo lugar donde
     trabajar. */
  var SEG_HECHO = "hechos", SEG_FUERA = "fuera";

  /* A qué etapa de la hoja de ruta pertenece cada grupo. Sin esto las etapas
     son un adorno arriba de la pantalla y los grupos una lista aparte; con
     esto son la misma cosa vista dos veces. */
  var ETAPA_DE = { revision: "traza", altas: "traza", identificados: "traza",
                   existencias: "decidir", almacenes: "decidir",
                   depurar: "decidir", bajas: "decidir" };

  function pendDe(q) {
    return deCola(q.id).filter(function (c) {
      return enAlcance(c) && pendienteCola(c, q); });
  }
  function segmentos() {
    var out = COLAS.map(function (q, i) {
      var todos = deCola(q.id).filter(enAlcance);
      return { id: q.id, q: q, n: String(i + 1), titulo: q.titulo, corto: q.corto,
               que: q.que,
               pend: todos.filter(function (c) { return pendienteCola(c, q); }).length,
               total: todos.length, color: q.color };
    });
    var dec = D.casos.filter(function (c) {
      return enAlcance(c) && L(c) !== "E" && !pendiente(c); });
    out.push({ id: SEG_HECHO, n: "✓", titulo: "Ya decididos", corto: "Ya decididos",
               que: "Casos con la decisión tomada. Dicen qué hay que hacer con cada uno " +
                    "en SAP, y se pueden cambiar.",
               pend: dec.length, total: dec.length, color: "A", hecho: true });
    var fuera = D.casos.filter(function (c) { return enAlcance(c) && L(c) === "E"; });
    out.push({ id: SEG_FUERA, n: "—", titulo: "Sin acción · fuera del alcance",
               corto: "Fuera del alcance",
               que: "Indumentaria, equipamiento y repuestos. El inventario es de Farmacia: " +
                    "de su ausencia no se concluye nada.",
               pend: fuera.length, total: fuera.length, color: "E", fuera: true });
    return out;
  }
  function segPor(id) {
    var s = segmentos().filter(function (x) { return x.id === id; })[0];
    return s || segmentos()[0];
  }

  /* Qué casos entran en la bandeja con el segmento y los filtros actuales. */
  function bandeja() {
    var id = estado.seg, bf = estado.bf;
    var lista;
    if (id === SEG_HECHO) {
      lista = D.casos.filter(function (c) { return L(c) !== "E" && !pendiente(c); });
    } else if (id === SEG_FUERA) {
      lista = D.casos.filter(function (c) { return L(c) === "E"; });
    } else {
      var q = colaPor(id);
      lista = deCola(id).filter(function (c) {
        return estado.bVer === "todos" || pendienteCola(c, q); });
    }
    var txt = (bf.texto || "").trim().toLowerCase();
    return lista.filter(function (c) {
      if (!enAlcance(c)) return false;
      if (bf.tipo && c.tipo !== bf.tipo) return false;
      if (bf.motivo && c.motivo !== bf.motivo) return false;
      if (bf.almacen && !(c.almacenes || []).some(function (x) {
            return x.almacen === bf.almacen; })) return false;
      if (bf.obs === "con" && !efectivo(c).observaciones) return false;
      if (txt) {
        var e = efectivo(c);
        var heno = [c.nombre_fisico, c.texto_sap, c.codigo_fisico, c.material_sugerido,
                    e.material, c.presentacion, c.base].join(" ").toLowerCase();
        if (heno.indexOf(txt) === -1) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------- HOJA DE RUTA
  /* Seis etapas, calculadas del estado real: ninguna barra de avance inventada.
     Cada etapa sabe decir qué le falta y cuál es el próximo paso concreto. */
  /* Qué casos están pendientes en los grupos de una etapa, SIN contar dos
     veces al que está en varios. Es exactamente lo que queda en las tarjetas
     de esa etapa, y por eso la hoja de ruta y las tarjetas dicen lo mismo:
     antes la hoja contaba «tiene un código propuesto» y la tarjeta contaba
     «falta que alguien lo confirme», que no son la misma cosa. */
  function pendientesDeEtapa(etapa) {
    var ids = {};
    COLAS.forEach(function (q) {
      if (ETAPA_DE[q.id] !== etapa) return;
      deCola(q.id).forEach(function (c) {
        if (enAlcance(c) && pendienteCola(c, q)) ids[c.id] = 1; });
    });
    return Object.keys(ids).length;
  }

  /* TODO lo que cuenta la hoja de ruta respeta el alcance elegido. Antes no:
     con una base seleccionada, arriba se leían los totales de las tres y
     abajo los de la base, sin que nada dijera que eran universos distintos. */
  function hojaDeRuta() {
    var casos = D.casos.filter(enAlcance);
    var fisicos = casos.filter(function (c) { return c.origen === "Inventario físico"; });

    // 1 · carga: está completa cuando las fuentes cuadran con el dataset. Con
    // una base elegida, sus controles; con las tres, todos.
    var ctl = (D.control || []).filter(function (x) {
      return x.estado !== "Informativo" &&
             (!estado.base || x.control.indexOf("· " + estado.base) >= 0); });
    var ctrl = ctl.filter(function (x) { return x.estado === "Coincide"; });
    var e1 = { id: "carga", quien: "sistema", tit: "1 · Lo que entró",
               det: (estado.base ? "el inventario de " + estado.base
                     : num(D.meta.fuentes.length) + " inventarios físicos") +
                    " y la bajada de SAP",
               uni: "controles", hechos: ctrl.length, total: ctl.length || 1 };

    // 2 · trazabilidad: ítems del depósito que ya no esperan ninguna decisión
    // de esta etapa. Es el complemento exacto de sus tres tarjetas.
    var e2 = { id: "traza", quien: "vos", tit: "2 · Qué es cada cosa",
               det: "a qué código de SAP corresponde cada nombre del depósito",
               uni: "ítems del depósito",
               hechos: fisicos.length - pendientesDeEtapa("traza"), total: fisicos.length };

    // 3 · cruce: lo hace el análisis; queda hecho apenas hay dataset.
    var e3 = { id: "cruce", quien: "sistema", tit: "3 · El cruce",
               det: num(casos.length) + " casos clasificados contra los almacenes de SAP",
               hechos: 1, total: 1 };

    // 4 · decisiones: casos con la decisión tomada, sobre los que requieren una.
    var decidibles = casos.filter(function (c) { return L(c) !== "E"; });
    var listos = decidibles.filter(function (c) { return !pendiente(c); }).length;
    var e4 = { id: "decidir", quien: "vos", tit: "4 · Qué se hace",
               det: "crear, ajustar, mover de almacén o dar de baja",
               uni: "casos con decisión tomada",
               hechos: listos, total: decidibles.length };

    // 5 · economía: cuántas decisiones se pueden valorizar.
    var ec = economia();
    var e5 = { id: "economia", quien: "vos", tit: "5 · Cuánto representa",
               det: ec.conPrecio ? num(ec.conPrecio) + " materiales con importe de última compra"
                                 : "falta importar los importes de última compra",
               uni: "materiales con importe",
               hechos: ec.conPrecio, total: ec.materiales || 1 };

    // 6 · informe: se cierra cuando no queda nada pendiente.
    var e6 = { id: "informe", quien: "sistema", tit: "6 · El cierre",
               det: "qué aplicar en SAP y el informe de lo decidido",
               hechos: listos === decidibles.length ? 1 : 0, total: 1 };

    var et = [e1, e2, e3, e4, e5, e6];
    et.forEach(function (x) {
      x.pct = x.total ? Math.round(x.hechos / x.total * 100) : 0;
      x.listo = x.pct >= 100;
    });
    var actual = et.filter(function (x) { return !x.listo && x.quien === "vos"; })[0] ||
                 et.filter(function (x) { return !x.listo; })[0] || et[et.length - 1];
    et.forEach(function (x) { x.actual = x === actual; });
    return { etapas: et, actual: actual,
             pct: Math.round(et.reduce(function (s, x) { return s + x.pct; }, 0) / et.length) };
  }

  /* La próxima acción concreta: el primer segmento con pendientes, en el orden
     en que conviene trabajarlos. */
  function proximaAccion() {
    var ss = segmentos().filter(function (s) { return !s.hecho && !s.fuera && s.pend; });
    if (!ss.length) return null;
    return { seg: ss[0], txt: num(ss[0].pend) + " " +
             (ss[0].pend === 1 ? "caso pendiente" : "casos pendientes") + " · " + ss[0].titulo };
  }

  /* Por qué cada grupo está donde está, y qué destraba. Sin esto los siete
     grupos parecen siete listas igual de urgentes, y el orden —que es lo único
     que evita trabajo al pedo— queda librado a la intuición. */
  var PORQUE = {
    revision: { ahora: "Es por acá. Mientras un ítem no tenga código, no se puede " +
                       "saber si falta existencia, si está en el almacén equivocado ni " +
                       "si algo sobra.",
                destraba: "Cada caso que se resuelve acá puede sacar una baja de la lista " +
                          "del último grupo." },
    altas: { ahora: "Son pocos y de alto impacto: crear un material mal cuesta caro y " +
                    "cuesta más deshacerlo.",
             destraba: "Cierra la etapa 2 junto con el grupo anterior." },
    identificados: { ahora: "El análisis ya les encontró el código y lo verificó. Es el " +
                            "grupo que más rápido avanza.",
                     destraba: "Habilita decidir su almacén y su stock." },
    existencias: { ahora: "Requiere el código ya decidido: sin saber qué material es, no " +
                          "se puede ajustar su existencia.",
                   destraba: "Deja el stock de la base cuadrado contra lo contado." },
    almacenes: { ahora: "Requiere el código ya decidido. Es ubicación, no identificación: " +
                        "el material está bien, el lugar donde figura puede no estarlo.",
                 destraba: "Deja cada material en el almacén que le corresponde." },
    depurar: { ahora: "Es independiente del resto: se puede hacer en cualquier momento.",
               destraba: "Limpia el maestro de registros que ya no se usan." },
    bajas: { ahora: "Va último a propósito: la lista se achica sola a medida que se " +
                    "resuelven los códigos del primer grupo.",
             destraba: "Es el cierre: con esto el inventario queda conciliado." },
  };

  function pintarRuta() {
    var r = hojaDeRuta(), pa = proximaAccion();
    var sis = r.etapas.filter(function (x) { return x.quien === "sistema" && x.listo; });
    var h = '<section class="ruta2"><header class="r2cab">' +
      '<div><span class="k">Hoja de ruta · ' +
      esc(estado.base || "las tres bases") + '</span><b>' + r.pct + "% del proceso</b>" +
      (r.actual ? '<span class="r2donde">Estás en la etapa <b>' +
        esc(r.actual.tit.replace(/^(\d+) · /, "$1, ")) + "</b></span>" : "") +
      "</div>" +
      '<div class="r2acc">' +
      '<button class="btn chico" id="rGuia">¿Cómo se usa esto?</button>' +
      (pa ? '<button class="btn pri" id="rSig">Seguir acá: ' + esc(pa.txt) + "</button>"
          : '<span class="chip-ok">No queda nada pendiente</span>') +
      "</div></header>";

    /* Por qué el trabajo arranca en la 2 y no en la 1. Es la primera pregunta
       que se hace cualquiera que abre esto, y antes no estaba contestada. */
    if (sis.length) {
      h += '<p class="r2sis"><b>Las etapas ' +
        sis.map(function (x) { return x.tit.split(" ·")[0]; }).join(" y ") +
        " ya las hizo el sistema</b> —leer los inventarios, cruzarlos contra SAP y " +
        "clasificar las diferencias—. <b>Tu trabajo empieza en la etapa " +
        (r.actual ? r.actual.tit.split(" ·")[0] : "2") + "</b>.</p>";
    }

    h += '<ol class="r2pasos">';
    r.etapas.forEach(function (x, i) {
      h += '<li class="r2p' + (x.listo ? " listo" : "") + (x.actual ? " acá" : "") +
        (x.quien === "sistema" ? " auto" : "") + '">' +
        '<span class="r2n">' + (x.listo ? "✓" : i + 1) + "</span>" +
        '<div><b>' + esc(x.tit) + "</b>" +
        '<span class="r2quien">' + (x.quien === "sistema" ? "lo hace el sistema" : "lo decidís vos") +
        (x.actual ? " · acá estás" : "") + "</span>" +
        '<span class="r2d">' + esc(x.det) + "</span>" +
        '<div class="pbar"><i style="width:' + x.pct + '%"></i></div>' +
        '<span class="r2pct">' + (x.total > 1
          ? num(x.hechos) + " de " + num(x.total) +
            (x.uni ? " " + esc(x.uni) : "") + " · " : "") +
        x.pct + "%</span></div></li>";
    });
    h += "</ol></section>";
    return h;
  }

  /* La guía de arranque. Se abre sola la primera vez —cuando todavía no se
     decidió nada— y después queda a un clic. Explicar una vez y esconderse es
     mejor que un cartel permanente que nadie lee a partir del segundo día. */
  function guiaVista() {
    try { return localStorage.getItem("invsap.guia.v1") === "vista"; }
    catch (e) { return false; }
  }
  function marcarGuiaVista() {
    try { localStorage.setItem("invsap.guia.v1", "vista"); } catch (e) { void e; }
  }
  function modalGuia() {
    var pa = proximaAccion();
    var segs = segmentos().filter(function (x) { return !x.hecho && !x.fuera; });
    var h = '<div class="modalfondo"><div class="modal ancho">' +
      "<h2>Por dónde empezar</h2>" +
      '<p class="sub">El sistema ya leyó los tres inventarios, los cruzó contra SAP y ' +
      "clasificó las " + num(D.kpis.total_casos) + " diferencias. Lo que queda son " +
      "decisiones, y van en un orden.</p>";
    h += '<ol class="guia">' +
      "<li><b>Elegí el alcance.</b> Las tres bases o una sola. Todo lo de abajo lo " +
      "respeta: los contadores, los casos y las decisiones en lote.</li>" +
      "<li><b>Empezá por el primer grupo: «" + esc(segs[0] ? segs[0].corto : "") + "».</b> " +
      "Es el que destraba el resto. Mientras un ítem no tenga código de SAP, no se puede " +
      "saber si le falta existencia, si está en el almacén equivocado ni si algo sobra.</li>" +
      "<li><b>Contestá la pregunta de cada tarjeta.</b> Cada caso trae lo que dice el " +
      "depósito de un lado, lo que dice SAP del otro, por qué el sistema lo levantó, y las " +
      "respuestas como botones. Un clic y pasa al siguiente.</li>" +
      "<li><b>Cuando hay varios códigos posibles</b>, el botón te lleva al modo de a uno, " +
      "que es donde se elige entre ellos, se declaran equivalencias y se resuelven las " +
      "presentaciones que no dicen lo mismo.</li>" +
      "<li><b>Para muchos juntos</b>, tildalos y usá la barra de arriba. Antes de aplicar " +
      "se muestra a cuántos materiales, bases y almacenes alcanza.</li>" +
      "<li><b>Dejá las bajas para el final.</b> La lista se achica sola a medida que " +
      "resolvés los códigos: aprobarlas primero es el error más caro.</li>" +
      "<li><b>Para ejecutar, andá a «Aplicar en SAP».</b> Ahí está el resumen de lo " +
      "que se decidió, agrupado por lo que hay que hacer: qué crear, qué dar de baja, " +
      "con qué cantidades, qué quedó sin decidir y qué está fuera del alcance. Es la " +
      "misma información que la primera hoja del Excel.</li>" +
      "</ol>";
    h += '<div class="aviso info"><b>No hace falta terminar una etapa para pasar a la ' +
      "siguiente, y nada se pierde al cerrar.</b> El sistema guarda dónde quedaste —la " +
      "base, el grupo, los filtros y el caso abierto— y te devuelve ahí la próxima vez.</div>";
    h += '<div class="modalacc"><span class="mini">Se puede volver a abrir con ' +
      "«¿Cómo se usa esto?».</span>" +
      '<button class="btn" id="gCerrar">Cerrar</button>' +
      (pa ? '<button class="btn pri" id="gIr">Empezar: ' + esc(pa.seg.corto) + "</button>" : "") +
      "</div></div></div>";

    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");
    function cerrar() { marcarGuiaVista(); modal.remove(); }
    modal.querySelector("#gCerrar").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });
    var gi = modal.querySelector("#gIr");
    if (gi) gi.addEventListener("click", function () {
      cerrar();
      if (!pa) return;
      estado.seg = pa.seg.id; estado.bpag = 1; estado.sel = {};
      estado.modo = "bandeja"; guardarSesion(); pintarInicio();
    });
  }

  // ------------------------------------------------------------- INICIO
  /* Inicio es el panel de gestión, no un tablero que obliga a ir a otro lado.
     Arriba, dónde está parado el trabajo; abajo, lo que hay que decidir, con
     la decisión al alcance de un clic. Los siete grupos de siempre están: ya
     no como siete tarjetas apiladas sino como solapas de una sola bandeja. */
  /* Una sola pantalla. Arriba, siempre lo mismo: en qué etapa está el trabajo,
     sobre qué base y qué grupo. Abajo cambia el modo: la bandeja, para ver y
     decidir muchos; o el foco, un caso por pantalla, para lo que no se puede
     contestar con un clic. Antes eran dos solapas y había que saber a cuál ir. */
  function pintarInicio() {
    var el = document.getElementById("v-inicio");
    el.innerHTML = cabeceraTrabajo() + '<div id="zona"></div>';
    cablearCabecera(el);
    var zona = el.querySelector("#zona");
    if (estado.modo === "foco") return pintarTriage(zona);
    return pintarBandeja(zona);
  }

  function cabeceraTrabajo() {
    var segs = segmentos(), s = segPor(estado.seg);
    var decidibles = D.casos.filter(function (c) { return enAlcance(c) && L(c) !== "E"; });
    var hechos = decidibles.filter(function (c) { return !pendiente(c); }).length;
    var vistos = {};
    COLAS.forEach(function (q) {
      deCola(q.id).forEach(function (c) {
        if (enAlcance(c) && pendienteCola(c, q)) vistos[c.id] = 1; }); });
    var pend = Object.keys(vistos).length;
    var fuera = D.casos.filter(function (c) { return enAlcance(c) && L(c) === "E"; }).length;

    var h = pintarRuta();
    h += '<section class="franja"><div class="alc"><span class="k">Alcance del análisis</span>' +
      '<div class="alcbot">' +
      '<button class="abot' + (estado.base ? "" : " on") + '" data-base="">Las tres bases</button>' +
      D.meta.bases.map(function (b) {
        return '<button class="abot bs bs' + nBase(b) + (estado.base === b ? " on" : "") +
          '" data-base="' + esc(b) + '"><i></i>' + esc(b) + "</button>"; }).join("") +
      "</div></div>";
    var ex = explicaVisible();
    h += '<div class="inds' + (ex ? " conq" : "") + '">' +
      ind("pend", num(pend), "pendientes de decisión",
          "Casos distintos que esperan una decisión. El que espera en más de un " +
          "grupo se cuenta una sola vez.") +
      ind("ok", num(hechos), "ya decididos",
          "Con la decisión tomada y lista para aplicar en SAP.") +
      ind("", num(fuera), "fuera del alcance",
          "No son de Farmacia: no se concluye nada.") +
      ind("", (decidibles.length ? Math.round(hechos / decidibles.length * 100) : 0) + "%",
          "avance", "Sobre los casos que requieren una decisión.") +
      "</div></section>";

    /* Los grupos, agrupados por la etapa a la que pertenecen. Son tarjetas y
       no píldoras porque una píldora que dice «Dar de baja 359» obliga a
       adivinar qué es dar de baja y por qué hay 359. */
    function fila(etapa, titulo, sub, ss) {
      ss = ss || segs.filter(function (x) { return ETAPA_DE[x.id] === etapa; });
      return '<div class="segfila"><div class="segeta"><b>' + esc(titulo) + "</b>" +
        (ex && sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>" +
        '<div class="segs">' + ss.map(tarjetaSeg).join("") + "</div></div>";
    }
    function tarjetaSeg(x) {
      return '<button class="seg' + (x.id === estado.seg ? " on" : "") +
        (x.pend ? "" : " vacio") + '" data-seg="' + esc(x.id) +
        '" style="--cc:var(--c' + x.color + ');--cct:var(--c' + x.color +
        '-t);--ccf:var(--c' + x.color + '-f)">' +
        '<span class="segt">' + esc(x.corto) + "</span>" +
        '<span class="segc">' + num(x.pend) + "</span>" +
        (ex && x.que ? '<span class="segq">' + esc(x.que) + "</span>" : "") +
        "</button>";
    }
    /* Por qué las tarjetas no suman el total de pendientes. Un caso espera en
       más de un grupo cuando hay varias cosas que decidir de él, así que las
       cuentas se superponen a propósito. Decirlo es más barato que inventar un
       reparto que no existe. */
    var suma = segs.filter(function (x) { return !x.hecho && !x.fuera; })
                   .reduce(function (n, x) { return n + x.pend; }, 0);
    h += '<nav class="segzona" aria-label="Qué hay que decidir">' +
      '<div class="segtop"><h2>En qué trabajar</h2>' +
      '<button class="btn chico" id="bExplica">' +
      (ex ? "Ocultar las explicaciones" : "Mostrar qué es cada cosa") + "</button></div>" +
      (suma !== pend
        ? '<p class="segsuma">Las tarjetas suman <b>' + num(suma) + "</b> y los casos " +
          "distintos pendientes son <b>" + num(pend) + "</b>: <b>un caso espera en más de " +
          "un grupo</b> cuando hay varias cosas que decidir de él." +
          (ex ? " Un ítem sin código, por ejemplo, está en «" +
                esc((segs[0] || {}).corto || "") + "» y también en «" +
                esc((segs.filter(function (x) { return x.id === "almacenes"; })[0] || {}).corto ||
                    "") + "», porque las dos preguntas siguen abiertas. Al resolver la " +
                "primera, sale de ésa y queda en la otra." : "") + "</p>"
        : "") +
      fila("traza", "Etapa 2 · Qué es cada cosa",
           "Primero hay que saber a qué material de SAP corresponde cada ítem: hasta " +
           "que eso no esté, el resto no se puede decidir.") +
      fila("decidir", "Etapa 4 · Qué se hace",
           "Con el código ya decidido, qué hacer con el stock: ajustarlo, moverlo de " +
           "almacén, limpiar el maestro o darlo de baja.") +
      fila(null, "Lo que ya no requiere decisión",
           "Está acá para que se vea que se lo miró, no para hacer algo con ello.",
           segs.filter(function (x) { return x.hecho || x.fuera; })) +
      "</nav>";
    return h;
  }

  /* Las explicaciones de los grupos: se leen la primera semana y después
     estorban. Por eso se pueden apagar, y quedan apagadas. */
  function explicaVisible() {
    try { return localStorage.getItem("invsap.explica.v1") !== "no"; }
    catch (e) { return true; }
  }
  function alternarExplica() {
    try {
      localStorage.setItem("invsap.explica.v1", explicaVisible() ? "no" : "si");
    } catch (e) { void e; }
    pintarInicio();
  }

  function cablearCabecera(el) {
    el.querySelectorAll("[data-base]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.base = b.dataset.base; estado.bpag = 1; estado.sel = {};
        estado.modo = "bandeja"; guardarSesion(); pintarInicio(); }); });
    el.querySelectorAll("[data-seg]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.seg = b.dataset.seg; estado.bpag = 1; estado.sel = {};
        estado.bf.motivo = ""; estado.modo = "bandeja"; guardarSesion(); pintarInicio(); }); });
    var rg = el.querySelector("#rGuia");
    if (rg) rg.addEventListener("click", modalGuia);
    var bx = el.querySelector("#bExplica");
    if (bx) bx.addEventListener("click", alternarExplica);
    var rs = el.querySelector("#rSig");
    if (rs) rs.addEventListener("click", function () {
      var pa = proximaAccion(); if (!pa) return;
      estado.seg = pa.seg.id; estado.bpag = 1; estado.sel = {};
      estado.modo = "bandeja"; guardarSesion(); pintarInicio(); });
  }

  function pintarBandeja(el) {
    var s = segPor(estado.seg);

    // ---- cabecera del segmento: qué es y cómo se trabaja
    var lista = bandeja();
    var pq = PORQUE[s.id];
    /* La explicación larga y el porqué del orden se apagan con el mismo
       interruptor que las de las tarjetas: con las tres encendidas a la vez
       hay tres explicaciones del mismo grupo apiladas. */
    var ex = explicaVisible();
    var h = '<section class="segcab"><div><h1>' + esc(s.titulo) + "</h1>" +
      (ex ? '<p class="sub">' + esc(s.q ? s.q.desc : s.fuera
        ? "Indumentaria, equipamiento y repuestos. El inventario relevado es de Farmacia, " +
          "así que nunca iban a aparecer: su ausencia no prueba nada y no se propone ninguna baja."
        : "Casos que ya tienen una decisión tomada. Se pueden revisar y cambiar.") + "</p>" : "") +
      (ex && pq ? '<p class="segpq"><span class="k">Por qué este grupo ahora</span>' +
            esc(pq.ahora) + ' <b>' + esc(pq.destraba) + "</b></p>" : "") + "</div>" +
      '<div class="segacc">' +
      (s.q && !s.fuera && !s.hecho && s.pend
        ? '<button class="btn pri" id="bUnoAUno">Verlos de a uno</button>' : "") +
      (s.id === "depurar" ? '<button class="btn" id="bMaestroVer">Administrar el maestro</button>' : "") +
      "</div></section>";

    // ---- filtros de la bandeja
    h += '<div class="filtros chicos">' +
      '<input type="text" id="bfTexto" placeholder="Buscar por nombre, código SAP o nomenclatura…" value="' +
      esc(estado.bf.texto) + '">' +
      sel("bfTipo", "Tipo", estado.bf.tipo, D.meta.tipos) +
      (s.q && s.q.porMotivo ? sel("bfMotivo", "Motivo", estado.bf.motivo, D.meta.motivos_revision) : "") +
      sel("bfAlm", "Almacén", estado.bf.almacen,
          (D.meta.almacenes.por_base || {})[estado.base] || D.meta.almacenes.observados || []) +
      sel("bfObs", "Observaciones", estado.bf.obs, ["con"], function () { return "Con observación"; }) +
      (s.hecho || s.fuera ? "" :
        '<label>Mostrar<select id="bfVer"><option value="pend"' +
        (estado.bVer === "pend" ? " selected" : "") + ">Sólo pendientes</option>" +
        '<option value="todos"' + (estado.bVer === "todos" ? " selected" : "") +
        ">Todos los del grupo</option></select></label>") +
      '<button class="btn chico" id="bfLimpiar">Limpiar</button>' +
      '<span class="fcuenta">' + num(lista.length) + (lista.length === 1 ? " caso" : " casos") + "</span>" +
      "</div>";

    // ---- barra de lote
    var idsSeg = lista.map(function (c) { return c.id; });
    var nSel = idsSeg.filter(function (i) { return estado.sel[i]; }).length;
    h += '<div class="lotebar' + (nSel ? " activa" : "") + '">' +
      '<label class="ltodos"><input type="checkbox" id="selPag"' +
        (nSel && nSel === idsSeg.length ? " checked" : "") + '> Elegir los ' +
        num(idsSeg.length) + " del filtro</label>" +
      (nSel ? '<b>' + num(nSel) + " elegidos</b>" +
        '<button class="btn chico" id="selNada">Quitar la selección</button>' +
        '<span class="lsep"></span>' + botonesLote(s) : '<span class="lhint">Elegí casos para ' +
        "decidirlos todos juntos. Antes de aplicar se muestra a qué materiales, bases y " +
        "almacenes alcanza.</span>") +
      "</div>";

    // ---- la bandeja
    var porPag = 20;
    var paginas = Math.max(1, Math.ceil(lista.length / porPag));
    if (estado.bpag > paginas) estado.bpag = paginas;
    var pag = lista.slice((estado.bpag - 1) * porPag, (estado.bpag - 1) * porPag + porPag);
    h += '<div class="bandeja">';
    if (!pag.length) {
      /* Un grupo terminado no es el final del camino: es el momento exacto en
         que hay que decir cuál es el siguiente. Antes decía «no queda nada» y
         ahí se terminaba la conversación. */
      var sig = proximaAccion();
      h += '<div class="finito chico"><div class="ficono">✓</div><h2>' +
        (lista.length ? "No hay casos con estos filtros" :
         s.hecho ? "Todavía no hay decisiones tomadas" :
         estado.base ? "Terminaste este grupo en " + esc(estado.base)
                     : "Terminaste este grupo") + "</h2>" +
        (!lista.length && !s.hecho && !s.fuera && sig && sig.seg.id !== s.id
          ? '<p class="sub">Lo que sigue: <b>' + esc(sig.seg.titulo) + "</b> · " +
            num(sig.seg.pend) + " pendientes.</p>" +
            '<button class="btn pri" id="bSigue">Ir a «' + esc(sig.seg.corto) + "»</button>"
          : !lista.length && !s.hecho && !s.fuera && !sig
            ? '<p class="sub">No queda nada pendiente' +
              (estado.base ? " en " + esc(estado.base) : "") + ". " +
              "Lo que sigue ya no es decidir: es aplicarlo. El resumen de lo " +
              "decidido —qué dar de alta, qué dar de baja y con qué cantidades— " +
              'está en «Aplicar en SAP».</p>' +
              '<button class="btn pri" id="bAplicar">Ver qué aplicar en SAP</button>'
            : "") +
        "</div>";
    } else {
      pag.forEach(function (c) { h += tarjeta(c, estado.seg); });
    }
    h += "</div>";
    if (paginas > 1) {
      h += '<div class="pager"><button class="btn chico" id="bpPrev"' +
        (estado.bpag <= 1 ? " disabled" : "") + ">← Anterior</button>" +
        "<span>Página " + estado.bpag + " de " + paginas + " · " + num(lista.length) +
        " casos</span><button class=\"btn chico\" id=\"bpNext\"" +
        (estado.bpag >= paginas ? " disabled" : "") + ">Siguiente →</button></div>";
    }

    h += '<p class="pieaviso"><b>Nada de esto modifica SAP.</b> Cada decisión queda ' +
      "registrada con tu nombre y la fecha; la ejecución es un paso posterior, fuera de " +
      "esta herramienta. Las equivalencias de nomenclatura, la propuesta de almacén por base " +
      "y el maestro general se administran en <b>Maestro</b>.</p>";

    el.innerHTML = h;
    cablearBandeja(el, s, lista, idsSeg);
  }

  function ind(cls, n, txt, que) {
    return '<div class="indi ' + cls + '"><b>' + n + "</b><span>" + esc(txt) + "</span>" +
      (que && explicaVisible() ? '<span class="indq">' + esc(que) + "</span>" : "") +
      "</div>";
  }

  /* Qué decisiones se pueden aplicar en lote dentro de cada segmento. Son las
     mismas que en la tarjeta: no hay acciones que existan sólo en lote. */
  function botonesLote(s) {
    var L2 = [];
    function b(acc, txt, cls) {
      L2.push('<button class="btn ' + (cls || "") + ' chico" data-lt="' + acc + '">' +
              esc(txt) + "</button>");
    }
    switch (s.id) {
      case "revision": b("uno", "Confirmar el candidato único", "ok");
                       b("n", "Ninguno corresponde"); b("x", "Marcar pendientes"); break;
      case "altas":    b("b1", "Verificar el maestro primero", "ok");
                       b("r", "No dar de alta", "no"); break;
      case "existencias": b("aj", "Proponer el ajuste de stock", "ok");
                       b("r", "No ajustar", "no"); break;
      case "identificados": b("a", "Confirmar la correspondencia", "ok");
                       b("r", "No corresponde", "no"); break;
      case "almacenes": b("al1", "Solicitar el cambio al almacén propuesto", "ok");
                       b("al2", "Mantener la ubicación actual");
                       b("al4", "Que lo valide la base"); break;
      case "depurar":  b("dp0", "Mantener", "ok"); b("dp1", "Bloquear");
                       b("dp2", "Dar de baja del maestro", "no"); break;
      case "bajas":    b("a", "Aprobar las bajas", "ok"); b("r", "Rechazar", "no"); break;
      case SEG_HECHO:  b("re", "Reabrir para volver a decidir"); break;
      default: return '<span class="lhint">Estos casos no requieren decisión.</span>';
    }
    return L2.join("");
  }

  function cablearBandeja(el, s, lista, idsSeg) {
    function rp() { guardarSesion(); pintarInicio(); }
    var b1 = el.querySelector("#bUnoAUno");
    if (b1) b1.addEventListener("click", function () { abrirCola(estado.seg, estado.bf.motivo); });
    var bs = el.querySelector("#bSigue");
    if (bs) bs.addEventListener("click", function () {
      var sig = proximaAccion(); if (!sig) return;
      estado.seg = sig.seg.id; estado.bpag = 1; estado.sel = {};
      estado.modo = "bandeja"; guardarSesion(); pintarInicio(); });
    var b3 = el.querySelector("#bMaestroVer");
    if (b3) b3.addEventListener("click", function () { ir("depurar"); });
    var b4 = el.querySelector("#bAplicar");
    if (b4) b4.addEventListener("click", function () { ir("aplicar"); });

    var t = el.querySelector("#bfTexto");
    t.addEventListener("input", function (ev) {
      estado.bf.texto = ev.target.value; estado.bpag = 1;
      var p = ev.target.selectionStart; rp();
      var n2 = document.getElementById("bfTexto"); n2.focus(); n2.setSelectionRange(p, p); });
    [["bfTipo", "tipo"], ["bfMotivo", "motivo"], ["bfAlm", "almacen"],
     ["bfObs", "obs"]].forEach(function (par) {
      var n3 = el.querySelector("#" + par[0]);
      if (n3) n3.addEventListener("change", function (ev) {
        estado.bf[par[1]] = ev.target.value; estado.bpag = 1; rp(); }); });
    var bv = el.querySelector("#bfVer");
    if (bv) bv.addEventListener("change", function (ev) {
      estado.bVer = ev.target.value; estado.bpag = 1; rp(); });
    el.querySelector("#bfLimpiar").addEventListener("click", function () {
      estado.bf = { texto: "", tipo: "", motivo: "", almacen: "", obs: "" };
      estado.bVer = "pend"; estado.bpag = 1; rp(); });
    var pp = el.querySelector("#bpPrev"), pn = el.querySelector("#bpNext");
    if (pp) pp.addEventListener("click", function () { estado.bpag--; rp(); });
    if (pn) pn.addEventListener("click", function () { estado.bpag++; rp(); });

    el.querySelectorAll(".selUno").forEach(function (i) {
      i.addEventListener("change", function () {
        if (i.checked) estado.sel[i.dataset.id] = 1; else delete estado.sel[i.dataset.id];
        rp(); }); });
    var sp = el.querySelector("#selPag");
    if (sp) sp.addEventListener("change", function () {
      idsSeg.forEach(function (id) {
        if (sp.checked) estado.sel[id] = 1; else delete estado.sel[id]; });
      rp(); });
    var sn = el.querySelector("#selNada");
    if (sn) sn.addEventListener("click", function () { estado.sel = {}; rp(); });

    el.querySelectorAll("[data-ta]").forEach(function (b) {
      b.addEventListener("click", function () {
        accionTarjeta(b.dataset.id, b.dataset.ta); }); });
    el.querySelectorAll("[data-detalle]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.volverA = "inicio"; ir("ficha", b.dataset.detalle); }); });
    el.querySelectorAll("[data-lt]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ids = lista.map(function (c) { return c.id; })
                       .filter(function (i) { return estado.sel[i]; });
        modalLote(ids, b.dataset.lt, s); }); });
  }
  // ------------------------------------------------------------- TARJETAS
  /* Una situación no es una categoría: es una pregunta que alguien tiene que
     contestar. Cada tarjeta trae lo que hace falta para contestarla —qué dice
     el depósito, qué dice SAP, por qué el sistema la levantó— y las respuestas
     posibles como botones. Detectar una diferencia y decidir qué hacer con
     ella son dos cosas distintas, y acá sólo se hace la segunda. */

  function bloqueFisico(c) {
    if (c.origen !== "Inventario físico") {
      return '<div class="fte fis vacia"><span class="fteh">Inventario físico</span>' +
        '<p class="ftev">Ningún inventario físico declaró este material en ' +
        esc(c.base) + ".</p></div>";
    }
    return '<div class="fte fis"><span class="fteh">Inventario físico</span>' +
      '<div class="ftenom">' + esc(c.nombre_fisico || "—") + "</div>" +
      '<dl class="fted">' +
      ftd("Base", c.base + " · centro " + (c.centro || "—")) +
      ftd("Fuente", c.sistema_origen || "—") +
      ftd("Cantidad contada", num(c.cantidad_fisica || 0) + " unidades") +
      ftd("Presentación", c.presentacion || "no declara características") +
      (c.codigo_fisico ? ftd("Código del inventario", c.codigo_fisico) : "") +
      "</dl></div>";
  }

  function bloqueSap(c, e, conAlmacen) {
    var mats = e.materiales;
    if (!mats.length) {
      var cand = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });
      return '<div class="fte sap' + (cand.length ? "" : " vacia") + '">' +
        '<span class="fteh">SAP</span>' +
        (cand.length
          ? '<p class="ftev">' + num(cand.length) +
            (cand.length === 1 ? " código candidato, sin confirmar:" : " códigos candidatos, sin confirmar:") +
            "</p><dl class=\"fted\">" + cand.slice(0, 4).map(function (x) {
              return ftd(x.material, x.texto); }).join("") + "</dl>"
          : '<p class="ftev">No figura entre los materiales que HOY tienen stock en SAP. ' +
            "La bajada no es el maestro completo: puede existir con existencia cero.</p>") +
        "</div>";
    }
    var ubic = c.almacenes || [];
    return '<div class="fte sap"><span class="fteh">SAP</span>' +
      '<div class="ftenom">' + mats.map(esc).join(" · ") +
      (e.unificada ? ' <span class="mini">«' + esc(e.unificada) + "»</span>" : "") + "</div>" +
      '<dl class="fted">' +
      ftd("Nomenclatura SAP", c.texto_sap || "—") +
      ftd("Stock informado por SAP", c.origen === "Inventario físico"
          ? (sinStock(c) ? "sin stock en " + c.base : num(c.stock_sap_en_base || 0) + " unidades")
          : num(c.stock_sap || 0) + " unidades") +
      /* El almacén se muestra donde el almacén ES la decisión. En el paso de
         identificación sobra y confunde: dónde está el stock no dice qué
         material es. */
      (conAlmacen ? ftd("Almacén SAP", ubic.length
          ? ubic.map(function (x) { return x.almacen + " (" + num(x.stock) + " un.)"; }).join(" · ")
          : (c.almacen_base ? "sin stock · el propuesto para esta base es " + c.almacen_base
                            : "sin almacén")) : "") +
      (precioDe(mats[0]) != null
        ? ftd("Importe última compra", pesos(precioDe(mats[0])) + " por unidad")
        : "") +
      "</dl></div>";
  }
  function ftd(k, v) {
    return "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>";
  }

  /* Por qué el sistema levantó este caso, en una línea. */
  function porQue(c, seg) {
    var e = efectivo(c);
    switch (seg) {
      case "revision":
        return (c.motivo || "Falta verificar la correspondencia") + ". " +
          (c.justificacion || "El parecido del nombre genera el candidato; las " +
           "características deciden, y acá no alcanzaron para cerrar solo.");
      case "altas":
        return "Se contó en el depósito y ninguno de los materiales con stock en SAP " +
          "es compatible. Eso no prueba que no exista en el maestro: la bajada trae " +
          "sólo los que tienen stock.";
      case "existencias":
        return "La correspondencia con SAP está identificada, pero SAP no registra " +
          "stock de ese material en " + c.base + ". Hay existencia física sin respaldo " +
          "en el sistema.";
      case "identificados":
        return "El código quedó verificado por nomenclatura y características" +
          (c.atributos_verificados && c.atributos_verificados.length
            ? " (" + c.atributos_verificados.join(", ") + ")" : "") + ". Falta que una persona lo confirme.";
      case "almacenes":
        return c.almacen_estado === AL_MULT
          ? "El mismo material tiene stock repartido en " + (c.almacenes || []).length +
            " almacenes de " + c.base + "."
          : "El stock figura en un almacén distinto del propuesto para " + c.base +
            " · " + c.tipo + ". Es un problema de ubicación, no de identificación.";
      case "depurar":
        return "Figura en la bajada de SAP con existencia CERO. No hay stock que dar " +
          "de baja: lo que se decide es qué pasa con el registro del maestro.";
      case "bajas":
        return "SAP registra stock de este material en " + c.base + " y ningún " +
          "inventario físico lo identificó ahí." +
          (c.bloqueado_por_revision
            ? " Ojo: depende de un caso en revisión, que puede dejarlo sin efecto."
            : "");
      case SEG_FUERA:
        return "Es " + (c.tipo || "un rubro") + ": el inventario relevado es de Farmacia, " +
          "así que nunca iba a aparecer. Su ausencia no prueba nada.";
      default:
        return e.historial.length ? e.historial[e.historial.length - 1].que : "";
    }
  }

  /* La pregunta y sus respuestas. Cada respuesta es un clic: no hay que entrar
     a ningún lado para contestarla. */
  function preguntaY(c, seg) {
    var e = efectivo(c), b = [];
    var lim = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });
    function bt(acc, txt, cls) {
      b.push('<button class="btn ' + (cls || "") + ' chico" data-ta="' + acc +
             '" data-id="' + esc(c.id) + '">' + esc(txt) + "</button>");
    }
    var preg = "";
    switch (seg) {
      case "revision":
        if (lim.length === 1) {
          preg = "¿«" + (c.nombre_fisico || "este ítem") + "» del depósito es el material " +
                 lim[0].material + " de SAP?";
          bt("uno", "Sí, es " + lim[0].material, "ok");
          bt("n", "No corresponde ninguno");
        } else if (lim.length > 1) {
          preg = "Hay " + lim.length + " códigos de SAP posibles para este ítem. " +
                 "¿Cuál corresponde, o son varios el mismo producto?";
          bt("abrir", "Elegir entre los " + lim.length, "pri");
          bt("n", "No corresponde ninguno");
        } else {
          preg = "Ningún material con stock en SAP es compatible. " +
                 "¿Pasa a verificarse contra el maestro completo?";
          bt("n", "Sí, verificar en el maestro", "ok");
        }
        bt("x", "No puedo decidirlo ahora");
        break;
      case "altas":
        preg = "No apareció entre los materiales con stock. ¿Qué camino se toma " +
               "antes de proponer un alta?";
        bt("b1", "Verificar el maestro primero", "ok");
        bt("b2", "Crear sin verificar…");
        bt("r", "No se da de alta", "no");
        break;
      case "existencias":
        var alm = almacenParaAjuste(c);
        preg = "Hay " + num(c.cantidad_fisica || 0) + " unidades contadas en " + c.base +
               " y SAP no registra stock del material " + (e.material || "—") +
               " en esa base. ¿Se propone el ajuste de stock" +
               (alm ? " en el almacén " + alm : "") + "?";
        bt("aj", "Proponer el ajuste" + (alm ? " en " + alm : ""), "ok");
        bt("r", "No ajustar", "no");
        bt("x", "No puedo decidirlo ahora");
        break;
      case "identificados":
        preg = "¿Se confirma que «" + (c.nombre_fisico || "este ítem") + "» es el material " +
               (e.material || "—") + " de SAP?";
        bt("a", "Confirmar la correspondencia", "ok");
        bt("r", "No corresponde", "no");
        break;
      case "almacenes":
        var esp = c.almacen_esperado || c.almacen_base, ub = c.almacenes || [];
        var act = ub.length === 1 ? ub[0].almacen : null;
        if (c.almacen_estado === AL_MULT) {
          preg = "El stock está repartido en " + ub.length + " almacenes de " + c.base +
                 " (" + ub.map(function (x) { return x.almacen + ": " + num(x.stock); }).join(", ") +
                 "). ¿Se propone consolidarlo en uno solo o se deja como está?";
          b.push(selAlmacen(c, ub, esp, "¿En cuál?"));
          bt("al3", "Proponer la consolidación", "ok");
        } else {
          preg = "El stock figura en el almacén " + (act || "—") + " y para " + c.base +
                 " · " + c.tipo + " el propuesto es el " + (esp || "—") +
                 ". ¿Se pide el cambio de almacén o se deja donde está?";
          /* El destino es editable: el propuesto es una propuesta, y quien
             conoce la base puede saber que el correcto es otro. */
          b.push(selAlmacen(c, ub, esp, "Mover a"));
          bt("al1", "Pedir el cambio", "ok");
          if (act) bt("al2", "Dejarlo en " + act + " · corregir la propuesta");
        }
        bt("al4", "Que lo valide el responsable de la base");
        break;
      case "depurar":
        preg = "¿Qué se hace con el registro del material " + (c.material_sap || "—") +
               " en el maestro?";
        bt("dp0", "Mantener", "ok");
        bt("dp1", "Bloquear");
        bt("dp2", "Dar de baja del maestro", "no");
        break;
      case "bajas":
        preg = "¿Se aprueba la PROPUESTA de baja de " + num(c.stock_sap || 0) +
               " unidades del material " + (c.material_sap || "—") + " en " + c.base + "?";
        bt("a", "Aprobar la propuesta de baja", "ok");
        bt("r", "Rechazar · no dar de baja", "no");
        bt("x", "No puedo decidirlo ahora");
        break;
      case SEG_FUERA:
        preg = "No requiere ninguna decisión dentro de este análisis.";
        break;
      case SEG_HECHO:
        /* Lo que se decidió, y nada más. El nombre de quien decidió va abajo,
           con su rótulo: acá, pegado a la decisión, se leía como parte de
           ella. */
        preg = "Lo decidido: " + esc(e.aprobacion).toLowerCase() + ".";
        bt("re", "Cambiar la decisión");
        break;
      default:
        preg = "Lo decidido: " + esc(e.aprobacion).toLowerCase() + ".";
        bt("re", "Cambiar la decisión");
    }
    return { preg: preg, botones: b.join("") };
  }

  /* El almacén donde tiene que cuadrar un ajuste de stock. Si SAP ya registra
     stock del material en esa base, es ése; si no, el propuesto para la base y
     el tipo, que es una propuesta y se puede cambiar en la misma tarjeta. */
  function almacenParaAjuste(c) {
    var ub = c.almacenes || [];
    if (ub.length === 1) return ub[0].almacen;
    var d = dec(c.id) || {};
    return d.almacen_ajuste || c.almacen_esperado || c.almacen_base || null;
  }
  function selAlmacen(c, ub, esp, etiqueta) {
    var dis = (D.meta.almacenes.por_base || {})[c.base] || [];
    var opts = {};
    (ub || []).forEach(function (x) { opts[x.almacen] = num(x.stock) + " un."; });
    dis.forEach(function (a) { if (!(a in opts)) opts[a] = "sin stock de este material"; });
    if (esp && !(esp in opts)) opts[esp] = "el propuesto";
    return '<label class="tjsel2">' + esc(etiqueta || "Almacén") +
      '<select data-alm-sel="' + esc(c.id) + '">' +
      Object.keys(opts).sort().map(function (a) {
        return '<option value="' + esc(a) + '"' + (a === esp ? " selected" : "") + ">" +
          esc(a) + " · " + esc(opts[a]) + (a === esp ? " · el propuesto" : "") + "</option>";
      }).join("") + "</select></label>";
  }

  function tarjeta(c, seg) {
    var e = efectivo(c), l = L(c);
    var py = preguntaY(c, seg);
    var sel = !!estado.sel[c.id];
    var h = '<article class="tj' + (sel ? " elegida" : "") + '" data-tj="' + esc(c.id) + '">';
    h += '<label class="tjchk"><input type="checkbox" class="selUno" data-id="' + esc(c.id) +
      '"' + (sel ? " checked" : "") + (seg === SEG_FUERA ? " disabled" : "") +
      '><span class="sr">Elegir para decidir en lote</span></label>';
    h += '<div class="tjc"><header class="tjcab">' +
      '<b class="tjnom">' + esc(c.nombre_fisico || c.texto_sap || "—") + "</b>" +
      '<span class="et ' + l + '"><i class="pt" style="background:var(--c' + l + ')"></i>' +
      l + " · " + CORTO[l] + "</span>" +
      chipBase(c.base) + '<span class="tjb">' + esc(c.tipo || "—") + "</span>" +
      (e.observaciones ? '<span class="tjobs" title="' + esc(e.observaciones) + '">con observación</span>' : "") +
      "</header>";
    var conAlm = seg === "almacenes" || seg === "existencias" || seg === "bajas" ||
                 seg === SEG_HECHO;
    h += '<div class="fuentes">' + bloqueFisico(c) + bloqueSap(c, e, conAlm) + "</div>";
    h += '<p class="tjpor"><span class="k">Por qué aparece acá</span>' + esc(porQue(c, seg)) + "</p>";
    if (py.preg) h += '<p class="tjpreg">' + esc(py.preg) + "</p>";
    /* En una tarjeta ya decidida, lo que importa después de la decisión es qué
       queda para hacer en SAP, y si todavía falta decidir otra cosa del mismo
       caso —el almacén, el ajuste—, que es por lo que un caso «ya decidido»
       puede seguir apareciendo en otro grupo. Va antes del botón: primero se
       lee, después se cambia. */
    if (seg === SEG_HECHO) {
      var ac = accionSap(c);
      h += '<p class="tjsap' + (ac.pend ? " pend" : "") + '"><span class="k">' +
        (ac.pend ? "Todavía falta" : "Qué hay que hacer en SAP") + "</span>" +
        esc(ac.pend ? ac.verbo.replace(/^PENDIENTE · /, "") + ": " + ac.det : ac.det) +
        "</p>";
    }
    h += '<div class="tjacc">' + py.botones +
      '<button class="btn chico fant" data-detalle="' + esc(c.id) + '">Ver el detalle completo</button>' +
      "</div>";
    /* La firma, sin repetir qué se decidió: eso ya está arriba, en «por qué
       aparece acá». */
    if (seg === SEG_HECHO && e.actualizado) {
      var q = quienDecidio(e);
      h += '<p class="tjhist">' +
        (q ? "Lo decidió " + esc(q) : '<b class="sinfirma">Sin firmar</b>: no quedó ' +
             "registrado quién (escribí tu nombre arriba antes de decidir)") +
        " · " + esc(fecha(e.actualizado)) + "</p>";
    }
    h += "</div></article>";
    return h;
  }
  // ------------------------------------------------------------- DECISIONES
  /* Una sola implementación de cada decisión, usada igual desde la tarjeta de
     Inicio, desde el modo de a uno y desde el lote. Si la misma situación se
     resolviera en dos lugares con dos códigos distintos, tarde o temprano
     diría dos cosas distintas. Devuelve "pantalla" cuando la acción no se
     puede cerrar con un clic y necesita abrir algo. */
  function aplicar(c, a, ctx) {
    ctx = ctx || {};
    function d(cambios, txt) {
      if (ctx.obs) cambios.observaciones = ctx.obs;
      decidir(c.id, cambios, txt);
    }
    var e = efectivo(c);
    var lim = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });

    // ---- identificación
    if (a === "uno") {
      if (!lim.length) return "nada";
      d({ materiales: [lim[0].material], estado_revision: "Revisado",
          aprobacion: "Correspondencia confirmada" },
        "Se asignó el código SAP " + lim[0].material + " (único candidato compatible)");
      return "ok";
    }
    if (a === "a") {
      d({ aprobacion: L(c) === "A" ? "Correspondencia confirmada" : "Aprobado",
          estado_revision: "Revisado" },
        L(c) === "A" ? "Se confirmó la correspondencia con SAP"
        : L(c) === "C" ? "Se aprobó la PROPUESTA de baja (no ejecuta nada en SAP)"
        : "Se aprobó la propuesta (no ejecuta nada en SAP)");
      return "ok";
    }
    if (a === "r") {
      d({ aprobacion: "Rechazado", estado_revision: "Revisado" }, "Se rechazó la propuesta");
      return "ok";
    }
    if (a === "x") {
      d({ estado_revision: "Pendiente de validación" }, "Se marcó como pendiente de validación");
      return "ok";
    }
    if (a === "n") {
      d({ aprobacion: "Aprobado", estado_revision: "Revisado",
          reclasificado: "Candidato a alta" },
        "Ningún material con stock corresponde: pasa a verificar contra el maestro de SAP");
      return "ok";
    }
    if (a === "re") {                       // reabrir: vuelve a quedar pendiente
      d({ aprobacion: "Sin decidir", estado_revision: "En revisión" },
        "Se reabrió el caso para volver a decidirlo");
      return "ok";
    }

    // ---- clase B
    if (a === "b1") {
      d({ ruta_b: RB_VERIF, estado_revision: "Pendiente de validación",
          aprobacion: "Pendiente de verificación en el maestro" },
        "Alternativa 1 · se verifica el maestro completo de SAP antes de crear");
      return "ok";
    }
    if (a === "b2") return "pantalla";

    // ---- ajuste de stock: cuadra un almacén, no una existencia global
    if (a === "aj") {
      var alm = ctx.almacen || almacenParaAjuste(c);
      if (!alm) return "sinalmacen";
      d({ aprobacion: "Aprobado", estado_revision: "Revisado",
          ajuste_stock: num(c.cantidad_fisica || 0) + " un.",
          almacen_ajuste: alm, almacen_propuesto: alm },
        "AJUSTE DE STOCK en SAP: sumar " + num(c.cantidad_fisica || 0) +
        " unidades del material " + (e.material || "—") + " en el almacén " + alm +
        " de " + c.base + ". Es una propuesta de ajuste, no un movimiento ejecutado");
      return "ok";
    }

    // ---- ubicación: no toca el código SAP, decide el almacén
    if (a === "al1" || a === "al2" || a === "al3" || a === "al4") {
      var ub = c.almacenes || [];
      var act = ub.length === 1 ? ub[0].almacen : null;
      var esp = c.almacen_esperado || c.almacen_base;
      var elegido = ctx.almacen || esp;
      if (a === "al1" && !elegido) return "nada";
      if (a === "al2" && !act) return "nada";
      var destino = a === "al1" ? elegido : a === "al2" ? act
                  : a === "al3" ? elegido : null;
      var txt = { al1: "Pedir el cambio del stock al almacén " + destino +
                       (destino === esp ? " (el propuesto para esta base y tipo)"
                                        : " (elegido a mano; el propuesto era " + esp + ")"),
                  al2: "El almacén " + act + " es el correcto: se corrige la propuesta",
                  al3: "Consolidar el stock en el almacén " + destino,
                  al4: "Lo valida el responsable de la base" }[a];
      d({ almacen_decision: txt, almacen_propuesto: destino },
        "Ubicación · " + txt + " (propuesta, no mueve stock en SAP)");
      return "ok";
    }
    return "nada";
  }

  /* Las acciones de la tarjeta. Las que se cierran con un clic se cierran acá;
     las que necesitan elegir entre varias cosas abren la pantalla que
     corresponde, con el caso ya puesto. */
  function accionTarjeta(id, a) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    var c = caso(id);
    if (!c) return;
    if (a === "abrir") {                    // elegir entre varios códigos
      estado.cola = "revision"; estado.motivo = null;
      estado.triage = [c]; estado.tIdx = 0;
      estado.selCand = {}; estado.selPar = {}; estado.unif = "";
      estado.volverA = "inicio"; estado.modo = "foco";
      return pintarInicio();
    }
    if (a === "b2") return modalCrearSinVerificar([c], function () { ir("inicio"); });
    if (a === "dp0" || a === "dp1" || a === "dp2") {
      var cod = c.material_sap;
      if (!cod) return aviso("Este caso no tiene código de SAP.");
      decidirMaterial(cod, DP_ACCIONES[+a.slice(2)]);
      return pintarInicio();
    }
    var ctx = {};
    var s2 = document.querySelector('[data-alm-sel="' + CSS.escape(id) + '"]');
    if (s2) ctx.almacen = s2.value;
    var r = aplicar(c, a, ctx);
    if (r === "sinalmacen") return aviso("Elegí el almacén donde tiene que cuadrar el ajuste.");
    if (r === "nada") return;
    pintarInicio();
  }

  // ------------------------------------------------------------- LOTE
  /* Una decisión en lote tiene que decir, antes de ejecutarse, a qué alcanza:
     cuántos materiales, qué bases, qué almacenes, y cuáles de los elegidos no
     cumplen las condiciones y van a quedar afuera. Lo que no se ve no se puede
     controlar, y deshacer 300 decisiones de a una no es una opción. */
  function alcanceLote(ids, a, s) {
    var mats = {}, bases = {}, alms = {}, aptos = [], fuera = [];
    ids.forEach(function (id) {
      var c = caso(id); if (!c) return;
      var e = efectivo(c);
      var lim = (c.candidatos || []).filter(function (x) { return !x.conflictos.length; });
      var ok = true, pq = "";
      if (a === "uno" && lim.length !== 1) {
        ok = false; pq = lim.length ? "tiene " + lim.length + " candidatos: hay que elegir"
                                    : "no tiene ningún candidato compatible";
      }
      if (a === "al1" && !(c.almacen_esperado || c.almacen_base)) {
        ok = false; pq = "no hay almacén propuesto para " + c.base + " · " + c.tipo;
      }
      if (a === "al2" && (c.almacenes || []).length !== 1) {
        ok = false; pq = "el stock está en " + (c.almacenes || []).length + " almacenes";
      }
      if (a === "aj" && !almacenParaAjuste(c)) {
        ok = false; pq = "no se sabe en qué almacén cuadrar el ajuste";
      }
      if ((a === "dp0" || a === "dp1" || a === "dp2") && !c.material_sap) {
        ok = false; pq = "no tiene código de SAP";
      }
      if (!ok) { fuera.push({ c: c, pq: pq }); return; }
      aptos.push(c);
      var queda = a === "uno" ? [lim[0].material]
                : e.materiales.length ? e.materiales
                : [c.material_sap];
      queda.forEach(function (m) { if (m) mats[m] = 1; });
      bases[c.base] = 1;
      var dst = a === "al1" ? (c.almacen_esperado || c.almacen_base)
              : a === "aj" ? almacenParaAjuste(c)
              : null;
      (dst ? [dst] : (c.almacenes || []).map(function (x) { return x.almacen; }))
        .forEach(function (x) { if (x) alms[x] = 1; });
    });
    return { aptos: aptos, fuera: fuera, materiales: Object.keys(mats).sort(),
             bases: Object.keys(bases).sort(), almacenes: Object.keys(alms).sort() };
  }

  /* Cuánto riesgo tiene cada decisión. Las que sólo registran una propuesta
     reversible no merecen un cartel: avisar de todo es no avisar de nada. */
  function riesgoLote(seg, a) {
    if (a === "dp2") return "Dar de baja un registro del maestro es la decisión menos " +
      "reversible de todas, y el universo visible no es el maestro completo.";
    if (a === "b2") return "Crear un material sin verificar el maestro puede dejar un " +
      "código duplicado, con el stock y el histórico partidos en dos.";
    if (a === "aj") return "Un ajuste de stock cambia las existencias informadas de un " +
      "almacén. Si el almacén elegido no es el correcto, el ajuste descuadra otro.";
    if (seg === "bajas" && a === "a") return "Aprobar una baja propone sacar del sistema " +
      "stock que SAP hoy registra. Conviene haber resuelto antes los casos en revisión: " +
      "algunos pueden dejar de ser bajas.";
    return null;      // lo demás registra una propuesta reversible: no merece cartel
  }

  function modalLote(ids, a, s) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    if (!ids.length) return aviso("No hay casos elegidos.");
    var al = alcanceLote(ids, a, s);
    var nom = { uno: "Confirmar el candidato único",
                a: s.id === "bajas" ? "Aprobar la propuesta de baja"
                 : s.id === "identificados" ? "Confirmar la correspondencia con SAP"
                 : s.id === "altas" ? "Aprobar la propuesta de alta"
                 : "Confirmar / aprobar",
                r: "Rechazar", x: "Marcar como pendiente de validación",
                n: "Ninguno corresponde · verificar en el maestro",
                b1: "Verificar el maestro antes de crear",
                aj: "Proponer el ajuste de stock",
                al1: "Solicitar el cambio al almacén propuesto",
                al2: "Mantener la ubicación actual y corregir la propuesta",
                al4: "Que lo valide el responsable de la base",
                dp0: "Mantener en el maestro", dp1: "Bloquear en el maestro",
                dp2: "Dar de baja del maestro", re: "Reabrir para volver a decidir" }[a] || a;
    var grave = riesgoLote(s.id, a);

    var h = '<div class="modalfondo"><div class="modal ancho"><h2>' + esc(nom) + "</h2>" +
      '<p class="sub">Antes de aplicar, esto es a lo que alcanza.</p>' +
      '<div class="lalc">' +
      lalc(num(al.aptos.length), al.aptos.length === 1 ? "caso" : "casos") +
      lalc(num(al.materiales.length), "materiales de SAP") +
      lalc(num(al.bases.length), al.bases.length === 1 ? "base" : "bases") +
      lalc(num(al.almacenes.length), al.almacenes.length === 1 ? "almacén" : "almacenes") +
      "</div>";
    h += '<dl class="ldet">' +
      "<dt>Bases</dt><dd>" + (al.bases.map(esc).join(" · ") || "—") + "</dd>" +
      "<dt>Almacenes</dt><dd>" + (al.almacenes.map(esc).join(" · ") || "—") + "</dd>" +
      "<dt>Qué queda registrado</dt><dd>" + esc(nom) +
      ", con tu nombre y la fecha. No modifica SAP.</dd></dl>";
    if (al.fuera.length) {
      h += '<div class="aviso"><b>' + num(al.fuera.length) +
        (al.fuera.length === 1 ? " caso elegido no cumple las condiciones y queda afuera."
                               : " casos elegidos no cumplen las condiciones y quedan afuera.") +
        "</b><ul class=\"lfuera\">" + al.fuera.slice(0, 8).map(function (x) {
          return "<li>" + esc(x.c.nombre_fisico || x.c.texto_sap || x.c.id) +
            ' <span class="mini">' + esc(x.pq) + "</span></li>"; }).join("") +
        (al.fuera.length > 8 ? "<li class=\"mini\">y " + (al.fuera.length - 8) + " más</li>" : "") +
        "</ul></div>";
    }
    if (grave) {
      h += '<div class="aviso grave"><b>Esto conviene mirarlo dos veces.</b>' + esc(grave) +
        '<label class="mchk"><input type="checkbox" id="lOk"> Entiendo el alcance y ' +
        "quiero aplicarlo a los " + num(al.aptos.length) + " casos</label></div>";
    }
    h += '<div class="modalacc"><span style="flex:1"></span>' +
      '<button class="btn" id="lCancel">Cancelar</button>' +
      '<button class="btn pri" id="lGo"' + (grave ? " disabled" : "") + ">Aplicar a " +
      num(al.aptos.length) + (al.aptos.length === 1 ? " caso" : " casos") + "</button></div>";
    h += "</div></div>";

    var cap = document.createElement("div");
    cap.innerHTML = h; document.body.appendChild(cap);
    function cerrar() { cap.remove(); }
    cap.querySelector("#lCancel").addEventListener("click", cerrar);
    var chk = cap.querySelector("#lOk");
    if (chk) chk.addEventListener("change", function () {
      cap.querySelector("#lGo").disabled = !chk.checked; });
    cap.querySelector("#lGo").addEventListener("click", function () {
      if (a === "dp0" || a === "dp1" || a === "dp2") {
        al.aptos.forEach(function (c) {
          decidirMaterial(c.material_sap, DP_ACCIONES[+a.slice(2)], "",
            "Decisión en lote desde Inicio: " + nom); });
      } else {
        al.aptos.forEach(function (c) { aplicar(c, a, {}); });
      }
      estado.sel = {}; cerrar();
      aviso(nom + " · " + al.aptos.length + (al.aptos.length === 1 ? " caso" : " casos") +
            (al.fuera.length ? " · " + al.fuera.length + " quedaron afuera" : ""));
      pintarInicio();
    });
  }
  function lalc(n, t) {
    return '<div class="lalci"><b>' + n + "</b><span>" + esc(t) + "</span></div>";
  }

  // ------------------------------------------------------------- MODO REVISIÓN
  function pintarTriage(el) {
    el = el || document.getElementById("zona");
    if (!el) return pintarInicio();
    if (!estado.cola || !estado.triage.length) return salirDelFoco();
    if (estado.tIdx >= estado.triage.length) {
      var q0 = colaPor(estado.cola);
      el.innerHTML = '<div class="finito"><div class="ficono">✓</div>' +
        "<h1>Terminaste esta tanda</h1>" +
        '<p class="sub">Revisaste ' + num(estado.triage.length) + " casos de «" +
        esc(q0.titulo) + '».</p>' +
        (function () {
          var sg = proximaAccion();
          return sg && sg.seg.id !== estado.cola
            ? '<p class="sub">Lo que sigue: <b>' + esc(sg.seg.titulo) + "</b> · " +
              num(sg.seg.pend) + " pendientes.</p>" : "";
        }()) +
        '<button class="btn pri" id="bInicio">Volver a la bandeja</button> ' +
        '<button class="btn" id="bMas">Ver si quedaron pendientes</button></div>';
      el.querySelector("#bInicio").addEventListener("click", salirDelFoco);
      el.querySelector("#bMas").addEventListener("click", function () {
        abrirCola(estado.cola, estado.motivo); });
      return;
    }

    var c = estado.triage[estado.tIdx], e = efectivo(c), q = colaPor(estado.cola);
    var cant = c.origen === "Inventario físico" ? c.cantidad_fisica : c.stock_sap;

    var h = '<div class="tbarra">' +
      '<button class="btn chico" id="tSalir">← Volver a la bandeja</button>' +
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
    /* Un candidato descartado sólo por la presentación vuelve a ser elegible
       si alguien declaró que esa presentación es la misma. No se recupera
       solo: hace falta que una persona lo diga. */
    var limpios = (c.candidatos || []).filter(function (x) {
      return !x.conflictos.length || (soloChocaPresentacion(x) && presDeclarada(c, x.material)); });
    var sucios = (c.candidatos || []).filter(function (x) {
      return x.conflictos.length && !(soloChocaPresentacion(x) && presDeclarada(c, x.material)); });
    var nSel = Object.keys(estado.selCand).length;

    h += '<section class="sist sap"><header class="sh">' +
      '<span class="sico">▣</span><div><b>Lo que hoy tiene stock en SAP</b>' +
      "<small>bajada al 02/10 · no es el maestro completo · " +
      (limpios.length ? num(limpios.length) + (limpios.length === 1 ? " candidato" : " candidatos")
       : "ningún candidato compatible") + "</small></div></header><div class=\"sb\">";

    if (limpios.length) {
      h += '<p class="shint">Marcá el o los códigos que son este mismo producto. ' +
        "Si SAP lo tiene abierto en más de un código, marcalos todos. " +
        '<b>En qué almacén está el stock no importa acá</b>: un código puede ser el ' +
        "correcto y tener el stock en otro almacén, o no tener stock todavía. Eso se " +
        "decide después, en «Dónde está el stock».</p>";
      h += '<div class="cands">';
      limpios.forEach(function (x, i) {
        var m = estado.selCand[x.material];
        /* El almacén contra el que se compara es el que le corresponde a la base
           y el tipo. Al evaluar candidatos todavía no hay código asignado, así
           que `almacen_esperado` está vacío y hay que usar el de la base: si no,
           el verde y el naranja no aparecerían nunca justo acá, que es donde la
           ubicación forma parte de la decisión. Sigue siendo una propuesta
           pendiente de validación, y el título lo dice. */
        var esp = c.almacen_esperado || c.almacen_base;
        h += '<button class="cand' + (m ? " marcado" : "") + '" data-mat="' + esc(x.material) + '">' +
          '<span class="cmarca">' + (m ? "✓" : "") + "</span>" +
          '<span class="ckey">' + (i + 1) + "</span>" +
          '<span class="ctxt"><b>' + esc(x.material) + "</b> " + esc(x.texto) +
          (x.presentacion ? '<span class="cpres">' + esc(x.presentacion) + "</span>" : "") +
          "</span></span></button>";
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

    // ======== otros ítems del depósito que podrían ser lo mismo
    if (c.origen === "Inventario físico") h += panelPresentacion(c);
    if (c.origen === "Inventario físico") h += panelEquivalencias(c);

    // ======== decidir
    h += '<section class="decidir">';
    if (estado.cola === "altas") h += panelB(c, e);
    if (q.esAlmacen) h += panelAlmacen(c, e);
    if (estado.cola === "existencias") h += panelAjuste(c, e);
    /* La barra resume la equivalencia completa antes de confirmarla: cuántas
       nomenclaturas del depósito y cuántos códigos de SAP quedan declarados el
       mismo producto. Si hay más de uno de cualquiera de los dos lados, el
       grupo necesita un nombre. */
    var nPar = Object.keys(estado.selPar).length;
    if (limpios.length) {
      var agrupa = nSel > 1 || nPar > 0;
      h += '<div class="confbar' + (nSel ? " activa" : "") + '">';
      if (!nSel) {
        h += '<span class="cbhint">Marcá arriba con <kbd>1</kbd>…<kbd>' +
          Math.min(limpios.length, 9) + "</kbd> o con el mouse, y confirmá con <kbd>Enter</kbd>.</span>";
      } else if (!agrupa) {
        h += '<span class="cbtxt">Este ítem del depósito queda identificado con <b>' +
          esc(Object.keys(estado.selCand)[0]) + "</b> en SAP.</span>" +
          '<button class="btn pri" data-acc="confirmar">Confirmar <kbd>Enter</kbd></button>';
      } else {
        h += '<div class="cbgrupo"><div class="cbtxt">' +
          '<span class="cbcuenta">' +
            "<b>" + num(nPar + 1) + "</b> " + (nPar ? "nomenclaturas del depósito" : "nomenclatura del depósito") +
            '<i class="cbigual">=</i>' +
            "<b>" + num(nSel) + "</b> " + (nSel > 1 ? "códigos de SAP" : "código de SAP") +
          "</span>" +
          (nPar
            ? " Quedan declarados el mismo producto y se deciden juntos."
            : " SAP tiene este producto abierto en varios códigos.") + "</div>" +
          '<input type="text" id="unifNom" class="cod" value="' +
          esc(estado.unif || c.nombre_fisico || "") + '" placeholder="nombre que los unifica">' +
          '<div class="cbchips">' +
            '<span class="cbchip fis">' + esc(c.nombre_fisico) + "</span>" +
            Object.keys(estado.selPar).map(function (id) {
              var o = caso(id);
              return '<span class="cbchip fis">' + esc(o.nombre_fisico) + "</span>"; }).join("") +
            Object.keys(estado.selCand).map(function (m) {
              return '<span class="cbchip">' + esc(m) + "</span>"; }).join("") +
          "</div></div>" +
          '<button class="btn pri" data-acc="confirmar">' +
          (nPar ? "Declarar equivalentes" : "Agrupar los " + nSel) +
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
      var alAj = almacenParaAjuste(c);
      h += bot("ok", "aj", "Proponer el ajuste de stock" + (alAj ? " en " + alAj : ""), "A") +
           bot("no", "r", "No ajustar", "R");
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
    el.querySelector("#tSalir").addEventListener("click", salirDelFoco);
    el.querySelector("#tSaltar").addEventListener("click", function () { avanzar(); });
    el.querySelector("#tFicha").addEventListener("click", function () {
      estado.volverA = "inicio"; ir("ficha", c.id); });
    var pt = el.querySelector("#presTog");
    if (pt) pt.addEventListener("click", function () {
      estado.verPres = !(estado.verPres === true); pintarInicio(); });
    el.querySelectorAll("[data-pres]").forEach(function (b) {
      b.addEventListener("click", function () { declararPres(c, b.dataset.pres); }); });
    el.querySelectorAll(".cand").forEach(function (b) {
      b.addEventListener("click", function () { marcar(c, b.dataset.mat); }); });
    var tg = el.querySelector("#eqTog");
    if (tg) tg.addEventListener("click", function () {
      estado.verParientes = estado.verParientes === false; pintarTriage(); });
    el.querySelectorAll("[data-par]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.dataset.par;
        if (estado.selPar[id]) delete estado.selPar[id];
        else estado.selPar[id] = 1;
        if (Object.keys(estado.selPar).length && !estado.unif)
          estado.unif = c.nombre_fisico || "";
        pintarTriage();
      }); });
    var un = el.querySelector("#unifNom");
    if (un) un.addEventListener("input", function () { estado.unif = un.value; });
    el.querySelectorAll("[data-acc]").forEach(function (b) {
      b.addEventListener("click", function () { accionTriage(c, b.dataset.acc); }); });
  }
  /* La correspondencia entre el depósito y SAP no es uno a uno en ninguno de
     los dos sentidos. Este panel resuelve el sentido que faltaba: varios ítems
     del depósito que son el mismo material. Va plegado y en una sola línea
     cuando no hay nada que mirar, para no robarle pantalla a la decisión. */
  // -------------------------------------------- EQUIVALENCIAS DE PRESENTACIÓN
  /* El depósito y SAP no describen la presentación con el mismo detalle. El
     depósito escribe «Loratadina comp» y SAP «LORATADINA X 60 COMP»: no se
     contradicen, uno informa algo que el otro calla. El análisis, que no puede
     adivinar, lo deja como no verificado y manda el caso a revisión. Y como no
     guarda la respuesta, vuelve a preguntar lo mismo en la base siguiente.

     Acá se declara una vez: «estas dos presentaciones son la misma», con el
     factor cuando lo hay (1 envase = 60 comprimidos). Queda guardado contra el
     par (código de SAP + presentación del depósito), así que vale para
     cualquier base donde aparezca el mismo par.

     El factor NO cambia ninguna cantidad: las unidades contadas siguen siendo
     las contadas y las de SAP las de SAP. Se guarda para que quien compare
     después sepa por cuánto multiplicar, en vez de descubrirlo de nuevo. */

  function clavePres(material, presentacion) {
    return String(material || "") + "|" + A_base(presentacion || "");
  }
  /* Misma normalización que usa el análisis: minúsculas, sin tildes, sin
     espacios de más. Si acá fuera distinta, el mismo par no se reconocería. */
  function A_base(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  var CACHE_PRES = null;
  function invalidarPres() { CACHE_PRES = null; }
  function equivPres() {
    if (CACHE_PRES) return CACHE_PRES;
    var out = {};
    var ds = decisiones();
    Object.keys(ds).forEach(function (id) {
      var raw = ds[id] && ds[id].equiv_presentacion;
      if (!raw) return;
      var lista;
      try { lista = JSON.parse(raw); } catch (e) { return; }
      (Array.isArray(lista) ? lista : [lista]).forEach(function (x) {
        if (x && x.clave) out[x.clave] = x;
      });
    });
    CACHE_PRES = out;
    return out;
  }
  function presDeclarada(c, material) {
    return equivPres()[clavePres(material, c.presentacion)] || null;
  }

  /* Un candidato que sólo choca por la presentación es recuperable: la
     diferencia puede ser real o puede ser que uno no informe. Uno que choca
     por otra cosa —la concentración, la esterilidad— no se recupera desde acá:
     eso sería otro producto. */
  var PRES_FAMILIA = ["volumen / presentación", "cantidad o dosis sin unidad",
                      "forma farmacéutica"];
  function soloChocaPresentacion(x) {
    var cf = x.conflictos || [];
    return cf.length > 0 && cf.every(function (k) { return PRES_FAMILIA.indexOf(k) >= 0; });
  }

  /* El panel para declararlo, dentro del caso en foco. */
  /* Dónde tiene sentido ofrecer esto. Un candidato descartado por la
     presentación, siempre: es la única forma de recuperarlo. Uno limpio, sólo
     cuando la presentación es lo que trabó el caso; si el caso quedó abierto
     por el nombre, declarar la presentación no aporta nada y el panel sería
     una pregunta de más en una pantalla que ya tiene varias. */
  var MOTIVOS_PRES = ["Falta un atributo para confirmar la presentación",
                      "Conflicto de presentación",
                      "Nomenclatura insuficiente para decidir"];
  function panelPresentacion(c) {
    var recuperables = (c.candidatos || []).filter(soloChocaPresentacion);
    var lim = MOTIVOS_PRES.indexOf(c.motivo) >= 0
      ? (c.candidatos || []).filter(function (x) { return !x.conflictos.length; })
      : (c.candidatos || []).filter(function (x) {
          return !x.conflictos.length && presDeclarada(c, x.material); });
    if (!lim.length && !recuperables.length) return "";
    var abierto = estado.verPres === true;
    var ya = (c.candidatos || []).filter(function (x) { return presDeclarada(c, x.material); });

    var h = '<section class="pres' + (abierto ? " abierta" : "") + '">';
    h += '<header class="eqcab"><button class="eqtog" id="presTog">' +
      '<span class="eqflecha">' + (abierto ? "▾" : "▸") + "</span>" +
      "<b>La presentación no dice lo mismo de los dos lados</b>" +
      (ya.length ? '<span class="eqchip sel">' + num(ya.length) + " ya declarada" +
        (ya.length === 1 ? "" : "s") + "</span>" : "") +
      (recuperables.length ? '<span class="eqchip">' + num(recuperables.length) +
        " descartado" + (recuperables.length === 1 ? "" : "s") + " por presentación</span>" : "") +
      "</button></header>";
    if (!abierto) return h + "</section>";

    h += '<p class="eqnota">El depósito dice <b>' +
      esc(c.presentacion || "no declara características") + "</b>. Si para alguno de " +
      "estos códigos eso es <b>la misma presentación descrita de otra manera</b> " +
      "—«comprimidos» y «60 comprimidos»—, declaralo acá: se guarda contra ese par y no " +
      "se vuelve a preguntar en las otras bases.</p>";

    var todos = lim.concat(recuperables);
    h += '<div class="preslista">' + todos.map(function (x) {
      var d = presDeclarada(c, x.material);
      var choca = (x.conflictos || []).length > 0;
      return '<div class="presit' + (d ? " yaes" : "") + '">' +
        '<div class="presid"><b>' + esc(x.material) + "</b> " + esc(x.texto) +
        (choca ? '<span class="preschoca">descartado: difiere en ' +
          esc((x.conflictos || []).join(", ")) + "</span>" : "") +
        (d ? '<span class="presok">✓ declarada equivalente' +
          (d.factor ? " · 1 de SAP = " + num(d.factor) + " del depósito" : "") +
          (d.quien ? " · " + esc(d.quien) : "") + "</span>" : "") +
        "</div>" +
        (d ? "" :
          '<div class="presacc">' +
          '<label class="mini">Factor (opcional)<input type="number" min="0" step="any" ' +
          'class="presf" data-mat="' + esc(x.material) + '" placeholder="1"></label>' +
          '<button class="btn chico ok" data-pres="' + esc(x.material) + '">' +
          "Es la misma presentación</button></div>") +
        "</div>";
    }).join("") + "</div>";
    h += '<p class="eqnota">El factor no cambia ninguna cantidad: las unidades contadas ' +
      "siguen siendo las contadas y las de SAP las de SAP. Queda anotado para que quien " +
      "compare después sepa por cuánto multiplicar.</p>";
    return h + "</section>";
  }

  /* Declararla: queda en la decisión del caso, y desde ahí la lee cualquier
     otro caso con el mismo par. Si el candidato estaba descartado por la
     presentación, declararla lo vuelve elegible acá mismo. */
  function declararPres(c, material) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    var inp = document.querySelector('.presf[data-mat="' + CSS.escape(material) + '"]');
    var f = inp && inp.value ? parseFloat(inp.value) : null;
    if (f !== null && (!isFinite(f) || f <= 0))
      return aviso("El factor tiene que ser un número mayor que cero.");
    var cand = (c.candidatos || []).filter(function (x) { return x.material === material; })[0];
    var d = dec(c.id) || {};
    var lista = [];
    try { lista = JSON.parse(d.equiv_presentacion || "[]"); } catch (e) { lista = []; }
    if (!Array.isArray(lista)) lista = [lista];
    lista.push({
      clave: clavePres(material, c.presentacion),
      material: material, presentacion: c.presentacion || "",
      texto_sap: cand ? cand.texto : "", factor: f,
      quien: revisorActual() || "(sin identificar)", cuando: new Date().toISOString(),
    });
    decidir(c.id, { equiv_presentacion: JSON.stringify(lista) },
      "Presentación declarada equivalente: «" + (c.presentacion || "sin declarar") +
      "» del depósito y «" + (cand ? cand.texto : material) + "» de SAP son la misma" +
      (f ? ", con factor " + f : "") + ". Vale para el par en todas las bases");
    invalidarPres();
    aviso("Declarada. Ahora podés asignar ese código.");
    pintarInicio();
  }

  function panelEquivalencias(c) {
    var otros = parientes(c);
    if (!otros.length) return "";
    var abierto = estado.verParientes !== false;
    var nSel = Object.keys(estado.selPar).length;
    var pend = otros.filter(function (o) { return o.enRevision; }).length;

    var h = '<section class="equiv' + (abierto ? " abierta" : "") + '">';
    h += '<header class="eqcab"><button class="eqtog" id="eqTog">' +
      '<span class="eqflecha">' + (abierto ? "▾" : "▸") + "</span>" +
      "<b>" + num(otros.length) + (otros.length === 1
        ? " ítem más del depósito podría ser este mismo producto"
        : " ítems más del depósito podrían ser este mismo producto") + "</b>" +
      (pend ? '<span class="eqchip">' + num(pend) + " en revisión</span>" : "") +
      (nSel ? '<span class="eqchip sel">' + num(nSel) + " marcados</span>" : "") +
      "</button></header>";
    if (abierto) {
      h += '<p class="eqnota">Comparten candidato en SAP. Si son el mismo producto con ' +
        "otro nombre, marcalos: se deciden juntos y queda registrado que son equivalentes.</p>";
      h += '<div class="eqlista">' + otros.map(function (o) {
        var oc = o.caso, oe = efectivo(oc), l = L(oc);
        var marcado = estado.selPar[oc.id];
        return '<button class="eqitem' + (marcado ? " marcado" : "") +
          '" data-par="' + esc(oc.id) + '">' +
          '<span class="cmarca">' + (marcado ? "✓" : "") + "</span>" +
          '<span class="eqtxt"><b>' + esc(oc.nombre_fisico) + "</b>" +
          '<span class="eqmeta">' + esc(oc.base) + " · " + num(oc.cantidad_fisica) + " un." +
          (oe.materiales.length ? " · ya asignado a " + oe.materiales.map(esc).join(", ") : "") +
          "</span>" +
          '<span class="eqpor">' + (o.fuertes.length
            ? '<i class="eqok">coincide en ' + o.fuertes.map(esc).join(", ") + "</i>"
            : '<i class="eqdebil">mismo nombre, sin características que verificar</i>') +
          "</span></span>" +
          '<span class="et ' + l + '">' + l + "</span></button>";
      }).join("") + "</div>";
    }
    h += "</section>";
    return h;
  }

  /* ---- Clase B · crear o no crear ----------------------------------------
     El maestro que está cargado ES el maestro general: 1.038 códigos, con los
     que tienen existencia y con los que están en cero. Que un ítem no esté ahí
     ya no es «no lo pudimos verificar»: es que no está. Lo que queda por
     decidir es si se crea, y con qué centro y almacén.

     Igual se deja el camino de consultar en SAP antes: el maestro se armó de
     una bajada de stock por centro, y un material que nunca tuvo existencia en
     ninguno de los tres podría no figurar. Decirlo es más honesto que suponer
     que la lista es completa, y no cuesta nada dejar el camino abierto. */
  function panelB(c, e) {
    var et = etapaB(c);
    var h = '<div class="rutas">';
    if (et === "ruta") {
      h += '<div class="rpreg"><b>¿Se crea este material en SAP?</b> «' +
        esc(c.nombre_fisico || "—") + "» está contado en " + esc(c.base) +
        " y <b>ningún material del maestro cargado le corresponde</b> " +
        "(" + num(totalMaestro()) + " códigos, incluidos los que están en cero).</div>";
      h += '<div class="rgrid">';
      h += '<div class="ruta r1"><div class="rtit"><span class="rnum">1</span>' +
        "Consultar en SAP antes de crear</div>" +
        '<p class="rtxt">El maestro cargado salió de una bajada de stock por centro. Un ' +
        "material que nunca tuvo existencia en ninguno de los tres centros podría no " +
        "figurar. Si querés confirmarlo en SAP antes de crear, el caso queda abierto hasta " +
        "que cargues el resultado.</p>" +
        '<ul class="rlista"><li>Es el camino que <b>evita el código duplicado</b>.</li>' +
        "<li>Si aparece, se asigna ese código y no se crea nada.</li></ul>" +
        '<button class="btn pri grande" data-acc="b1" data-k="1">' +
        "<span>Consultar primero</span><kbd>1</kbd></button></div>";
      h += '<div class="ruta r2"><div class="rtit"><span class="rnum">2</span>' +
        "Crear el material</div>" +
        '<p class="rtxt">Se propone el alta con el centro y el almacén de abajo. Queda ' +
        "registrado quién lo decidió y cuándo. <b>No ejecuta nada en SAP</b>: es la " +
        "propuesta que después alguien carga.</p>" +
        '<div class="rriesgo"><b>Lo que hay que mirar</b>Si el material existía en SAP y no ' +
        "figuraba en la bajada, crear uno nuevo deja un <b>código duplicado</b>: el mismo " +
        "producto abierto dos veces, con el stock y el histórico partidos.</div>" +
        '<button class="btn grande" data-acc="b2" data-k="2">' +
        "<span>Crear el material</span><kbd>2</kbd></button></div>";
      /* El caso que faltaba: el que ya lo buscó y lo encontró. Obligarlo a
         elegir «consultar primero» para después cargar el resultado es
         hacerle contestar una pregunta que ya tiene contestada. */
      h += '<div class="ruta r3"><div class="rtit"><span class="rnum">3</span>' +
        "Ya lo busqué: existe con este código</div>" +
        '<p class="rtxt">Si ya lo consultaste en SAP y aparece con un código que sirve, ' +
        "escribilo acá: se le asigna como a cualquier otro ítem identificado y <b>no se " +
        "crea nada</b>. Queda registrado que el código lo trajiste vos.</p>" +
        '<input type="text" id="codB" class="cod" placeholder="código SAP que encontraste">' +
        '<div class="mini" id="avisoB"></div>' +
        '<button class="btn ok grande" data-acc="b3" data-k="3">' +
        "<span>Asignar este código</span><kbd>3</kbd></button></div>";
      h += "</div>";
      h += panelDestino(c, e);
    } else if (et === "verificacion") {
      h += '<div class="rok">✓ <b>Se consulta en SAP antes de crear</b> · ' +
        (quienDecidio(e) ? "lo decidió " + esc(quienDecidio(e)) : "sin firmar") +
        (e.actualizado ? " · " + esc(fecha(e.actualizado)) : "") +
        ". Falta el resultado de la consulta.</div>";
      h += '<div class="rres"><span class="k">¿Qué dijo SAP?</span>' +
        '<div class="tacc">' +
        bot("ok", "v2", "Existe y sirve · se le asigna ese código", "1") +
        bot("", "v1", "No existe · se crea", "2") +
        bot("", "v3", "Existe pero no sirve · baja y alta nueva", "3") +
        "</div>" +
        '<input type="text" id="codMaestro" class="cod" value="' + esc(e.codigo_maestro) +
        '" placeholder="código que encontraste, si apareció">' +
        '<div class="mini" id="avisoB"></div>' +
        '<p class="rnota">Las dos últimas necesitan el código sólo si apareció. Si todavía ' +
        "no pudiste consultarlo, salteá el caso: queda pendiente.</p></div>";
      h += panelDestino(c, e);
    }
    h += "</div>";
    return h;
  }

  /* Dónde va a vivir el material que se cree. Un alta sin centro ni almacén no
     se puede cargar: alguien va a tener que elegirlos igual, y el que conoce
     la base es quien está mirando esta pantalla, no quien carga después. */
  function panelDestino(c, e) {
    var d = dec(c.id) || {};
    var centro = d.centro_alta || c.centro || "";
    var esp = d.almacen_alta || c.almacen_esperado || c.almacen_base || "";
    var dis = (D.meta.almacenes.por_base || {})[c.base] || [];
    var cen = {};
    D.casos.forEach(function (x) { if (x.centro) cen[x.centro] = x.base; });
    return '<div class="destino"><span class="k">Dónde se da de alta</span>' +
      '<div class="destfila">' +
      '<label>Centro<select id="altaCentro">' +
      Object.keys(cen).sort().map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === centro ? " selected" : "") + ">" +
          esc(x) + " · " + esc(cen[x]) + "</option>"; }).join("") +
      "</select></label>" +
      '<label>Almacén<select id="altaAlmacen">' +
      dis.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === esp ? " selected" : "") + ">" +
          esc(x) + (x === (c.almacen_esperado || c.almacen_base) ? " · el propuesto" : "") +
          "</option>"; }).join("") +
      "</select></label></div>" +
      '<span class="mini">Propuesto a partir de la base del ítem (' + esc(c.base) +
      ") y del tipo (" + esc(c.tipo || "—") + "). Se puede cambiar: la correspondencia " +
      "base→almacén está observada, cuál debería tener el stock de farmacia es una " +
      "propuesta a validar.</span></div>";
  }

  /* Pregunta expresa antes de crear sin verificar. No se puede confirmar sin marcar
     que se entiende el riesgo: la decisión queda registrada con nombre y fecha. */
  function modalCrearSinVerificar(casos, alVolver) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    var uno = casos.length === 1;
    var h = '<div class="modalfondo"><div class="modal">' +
      "<h2>Crear " + (uno ? "este material" : num(casos.length) + " materiales") +
      " sin verificar el maestro</h2>" +
      '<p class="sub">Esta es la <b>alternativa 2</b>. El sistema no te lo impide, pero te lo ' +
      "pregunta expresamente porque tiene una consecuencia concreta.</p>";
    if (uno) h += '<div class="mcaso"><b>' + esc(casos[0].nombre_fisico) + "</b>" +
      '<span class="mini">' + esc(casos[0].base) + " · " + esc(casos[0].tipo) +
      (casos[0].codigo_fisico ? " · " + esc(casos[0].codigo_fisico) : "") + "</span></div>";
    h += '<div class="rriesgo grande"><b>Lo que hay que mirar</b>' +
      "El maestro cargado tiene <b>" + num(totalMaestro()) + " códigos</b>, con existencia y " +
      "en cero, y ninguno corresponde. Pero salió de una bajada de stock por centro: un " +
      "material que <b>nunca tuvo existencia en ninguno de los tres</b> podría no figurar. " +
      "Si existía y se crea uno nuevo, queda un <b>código duplicado</b>: el mismo producto " +
      "abierto dos veces, con el stock, los consumos y el histórico partidos.</div>";
    h += '<label class="chk1"><input type="checkbox" id="mkRiesgo"> ' +
      "<span>Entiendo el riesgo de generar un código duplicado y propongo crear el " +
      (uno ? "material" : "material") + " igual.</span></label>";
    if (uno) h += panelDestino(casos[0], efectivo(casos[0]));
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
        var dst = destinoAlta(c);
        var cam = { ruta_b: RB_CREAR, riesgo_duplicado: "Asumido expresamente",
                    aprobacion: "Aprobado", estado_revision: "Revisado",
                    centro_alta: dst.centro, almacen_alta: dst.almacen,
                    depuracion: dep ? "Ligado al plan de depuración" : null };
        if (obs) cam.observaciones = obs;
        decidir(c.id, cam, "Se propone crear el material en SAP, centro " + dst.centro +
                ", almacén " + dst.almacen + ", asumiendo expresamente el riesgo de " +
                "código duplicado" +
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
        ? bot("ok", "al1", "Solicitar el cambio al almacén " + esp, "1") : "") +
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

  /* ---- Ajuste de stock ---------------------------------------------------
     Hay dos cosas distintas que se confunden seguido: que un material NO ESTÉ
     en el maestro de SAP, y que esté en el maestro pero sin existencias
     registradas en esa base. Lo primero es un alta —y no se puede afirmar con
     una bajada que sólo trae los materiales con stock—. Lo segundo es un
     AJUSTE DE STOCK, y es lo que se decide acá: el código ya está
     identificado, lo que falta es la existencia. Un ajuste sin almacén no
     cuadra nada, así que el almacén es parte de la decisión. */
  function panelAjuste(c, e) {
    var alm = almacenParaAjuste(c);
    var esp = c.almacen_esperado || c.almacen_base;
    var dis = (D.meta.almacenes.por_base || {})[c.base] || [];
    var h = '<div class="rutas"><div class="rpreg"><b>Esto es un ajuste de stock, no un alta.</b> ' +
      "El material <b>" + esc(e.material || "—") + "</b> está identificado y existe en SAP: " +
      "lo que SAP no registra es <b>existencia en " + esc(c.base) + "</b>. Ajustar significa " +
      "proponer que el stock del almacén quede cuadrado con lo contado.</div>";
    h += '<div class="alcomp"><div class="alcol"><span class="k">Lo contado en el depósito</span>' +
      '<div class="alesp"><b>' + num(c.cantidad_fisica || 0) + " unidades</b>" +
      '<span class="mini">' + esc(c.sistema_origen || "—") + " · " + esc(c.base) + "</span></div></div>";
    h += '<div class="alcol"><span class="k">Lo que registra SAP en esa base</span>' +
      '<div class="alesp"><b>sin stock</b><span class="mini">material ' +
      esc(e.material || "—") + (c.stock_sap_otras_bases
        ? " · " + num(c.stock_sap_otras_bases) + " unidades en otras bases" : "") +
      "</span></div></div></div>";
    h += '<div class="alsel"><span class="k">¿En qué almacén tiene que cuadrar?</span>' +
      '<select id="almDest">' + dis.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === alm ? " selected" : "") + ">" +
          esc(x) + (x === esp ? " · el propuesto para " + esc(c.base) + " · " + esc(c.tipo) : "") +
          "</option>"; }).join("") + "</select>" +
      '<span class="mini">El ajuste se propone sobre ese almacén. La correspondencia ' +
      "base→almacén está observada; cuál debería tener el stock de farmacia es una " +
      "propuesta a validar.</span></div></div>";
    return h;
  }

  /* El centro y el almacén donde se daría de alta: lo que esté elegido en la
     pantalla y, si no hay pantalla, lo propuesto para la base y el tipo. */
  function destinoAlta(c) {
    var d = dec(c.id) || {};
    var ce = document.getElementById("altaCentro");
    var al = document.getElementById("altaAlmacen");
    var dis = (D.meta.almacenes.por_base || {})[c.base] || [];
    return {
      centro: (ce && ce.value) || d.centro_alta || c.centro || "",
      almacen: (al && al.value) || d.almacen_alta || c.almacen_esperado ||
               c.almacen_base || dis[0] || "",
    };
  }

  function dato(k, v) {
    return '<div class="td"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
  }
  /* La tecla va escrita en el botón, no deducida del nombre de la acción: si
     el orden en pantalla cambia, el número que se ve y el que funciona siguen
     siendo el mismo. */
  function bot(cls, acc, txt, tecla) {
    return '<button class="btn ' + (cls === "ok" ? "ok" : cls === "no" ? "no" : "") +
      ' grande" data-acc="' + acc + '" data-k="' + esc(tecla) + '"><span>' + esc(txt) +
      '</span><kbd>' + tecla + "</kbd></button>";
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
  function avanzar() {
    estado.tIdx++; estado.selCand = {}; estado.selPar = {}; estado.unif = "";
    guardarSesion();
    /* Si se entró a resolver UN caso desde una tarjeta de Inicio, al cerrarlo
       se vuelve ahí: mostrar «terminaste la tanda» por un solo caso es sacar a
       la persona de donde estaba trabajando. */
    if (estado.triage.length === 1 && estado.volverA === "inicio" &&
        estado.tIdx >= estado.triage.length) {
      estado.cola = null; estado.triage = []; estado.volverA = "casos";
      return ir("inicio");
    }
    pintarTriage();
  }

  function marcar(c, mat) {
    if (estado.selCand[mat]) delete estado.selCand[mat];
    else estado.selCand[mat] = 1;
    if (Object.keys(estado.selCand).length > 1 && !estado.unif)
      estado.unif = c.nombre_fisico || "";
    pintarTriage();
  }
  /* Una sola confirmación resuelve los dos sentidos de la equivalencia: los
     códigos de SAP marcados y los otros ítems del depósito marcados. Si hay
     más de un ítem o más de un código, el grupo necesita un nombre: ese nombre
     es lo que después los identifica como equivalentes. */
  function confirmarSeleccion(c) {
    if (Almacen.soloConsulta()) return avisarConsulta();
    var mats = Object.keys(estado.selCand);
    var pares = Object.keys(estado.selPar);
    if (!mats.length) return aviso("Marcá al menos un código de SAP.");
    var agrupa = mats.length > 1 || pares.length > 0;
    var nom = "";
    if (agrupa) {
      var el = document.getElementById("unifNom");
      nom = (el ? el.value : estado.unif || "").trim();
      if (!nom) return aviso("Poné un nombre para la nomenclatura unificada.");
    }
    function cambios(base) {
      var cam = { materiales: mats, estado_revision: "Revisado",
                  aprobacion: "Correspondencia confirmada" };
      if (agrupa) cam.nomenclatura_unificada = nom;
      return base ? conObs(cam) : cam;
    }
    var queHizo = mats.length > 1
      ? "Se agruparon " + mats.length + " códigos SAP (" + mats.join(", ") +
        ") bajo la nomenclatura unificada «" + nom + "»"
      : "Se asignó el código SAP " + mats[0];
    if (pares.length) {
      queHizo += ". Se declararon equivalentes " + (pares.length + 1) +
                 " nomenclaturas del depósito";
    }
    decidir(c.id, cambios(true), queHizo);
    // El mismo material y el mismo nombre para cada ítem equivalente: así la
    // misma pregunta no se contesta dos veces, ni distinto.
    pares.forEach(function (id) {
      var o = caso(id);
      decidir(id, cambios(false),
              "Equivalente a «" + (c.nombre_fisico || c.id) + "» (" + c.base + "): " +
              "misma nomenclatura unificada «" + nom + "» y mismo código SAP " +
              mats.join(", "));
      void o;
    });

    var liberadas = mats.filter(function (m) {
      return D.casos.some(function (x) {
        return x.base === c.base && x.material_sap === m && L(x) === "C"; });
    }).length;
    var msg = mats.length > 1 ? "Agrupados " + mats.length + " códigos."
                              : "Asignado " + mats[0] + ".";
    if (pares.length) msg += " " + (pares.length + 1) + " nomenclaturas del depósito " +
                             "quedaron declaradas equivalentes.";
    if (liberadas) msg += " " + liberadas +
      (liberadas === 1 ? " deja" : " dejan") + " de ser candidato a baja.";
    aviso(msg);
    avanzar();
  }
  function accionTriage(c, a) {
    if (a === "s") return avanzar();        // saltear no decide nada
    if (Almacen.soloConsulta()) return avisarConsulta();
    if (a === "confirmar") return confirmarSeleccion(c);
    if (a === "b2") return modalCrearSinVerificar([c], function () { avanzar(); });
    if (a === "ficha") { estado.volverA = "inicio"; return ir("ficha", c.id); }

    /* ---- clase B: el código que apareció al consultar SAP ----------------
       Se asigna con la misma mecánica que cualquier otra identificación —queda
       Revisado, con correspondencia confirmada, y el caso sale de la lista de
       altas—. Lo que NO se le exige es figurar en el maestro cargado: ese
       maestro es una bajada de stock, y si el material estuviera ahí el caso
       no sería de clase B. Por eso se avisa, no se bloquea. */
    if (a === "b3" || a === "v2") {
      var cb = document.getElementById(a === "b3" ? "codB" : "codMaestro");
      var cod3 = cb ? cb.value.trim() : "";
      var av3 = document.getElementById("avisoB");
      if (!cod3) {
        if (av3) av3.innerHTML = '<span style="color:var(--alerta)">Escribí el código de ' +
          "SAP que encontraste.</span>";
        return aviso("Escribí el código de SAP que encontraste.");
      }
      var enBajada = existeMaterial(cod3);
      decidir(c.id, conObs({
        materiales: [cod3], material_corregido: cod3,
        ruta_b: RB_VERIF, verificacion: VER_SIRVE, codigo_maestro: cod3,
        estado_revision: "Revisado", aprobacion: "Correspondencia confirmada",
      }), "Se consultó SAP: existe como " + cod3 + " y sirve. Se le asigna ese código, " +
          "cargado a mano" + (enBajada
            ? " (figura en la bajada de stock)"
            : " (no figura en la bajada de stock, que sólo trae los materiales con " +
              "existencia: el código viene del maestro completo)") + ". No se crea nada");
      aviso("Asignado a " + cod3 + ". El caso sale de las altas.");
      return avanzar();
    }

    // ---- clase B: registrar el resultado de la verificación contra el maestro
    if (a === "v1" || a === "v3") {
      var ci = document.getElementById("codMaestro");
      var cod = ci ? ci.value.trim() : "";
      if (a === "v3" && !cod)
        return aviso("Poné el código que encontraste en SAP.");
      var res = a === "v1" ? VER_NO : VER_NUEVO;
      var dst = destinoAlta(c);
      var cam = conObs({ verificacion: res, codigo_maestro: cod,
                         estado_revision: "Revisado", aprobacion: "Aprobado",
                         centro_alta: dst.centro, almacen_alta: dst.almacen });
      if (a === "v3") cam.depuracion = "Ligado al plan de depuración";
      decidir(c.id, cam, a === "v1"
        ? "Consultado en SAP: no existe. Se propone el alta en el centro " + dst.centro +
          ", almacén " + dst.almacen + " (no ejecuta nada en SAP)"
        : "Consultado en SAP: existe como " + cod + " y no sirve. Se propone darlo de baja " +
          "y crear uno nuevo en el centro " + dst.centro + ", almacén " + dst.almacen +
          ", ligado al plan de depuración");
      return avanzar();
    }

    /* Todo lo demás es la misma decisión que se toma desde la tarjeta de
       Inicio, y la toma el mismo código. La diferencia es qué pasa después:
       acá se avanza al caso siguiente. */
    var dst = document.getElementById("almDest");
    var r = aplicar(c, a, { obs: obsActual(), almacen: dst ? dst.value : null });
    if (r === "nada") return;
    if (a === "b1") {
      aviso("Alternativa 1 registrada. Cargá el resultado cuando lo tengas.");
      return pintarTriage();
    }
    if (a === "n") aviso("Pasa a verificación contra el maestro de SAP.");
    return avanzar();
  }

  function teclas(ev) {
    if (estado.vista !== "inicio" || estado.modo !== "foco") return;
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
        var br = document.querySelector('#zona [data-k="' + k + '"]');
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
    if (k === "f") { ev.preventDefault(); estado.volverA = "inicio"; ir("ficha", c.id); }
  }

  // ------------------------------------------------------------- LOTE

  /* La clase B no se decide con un «aprobar todo»: lo que se elige en lote es la
     alternativa de trabajo, y la alternativa 2 pasa igual por la pregunta expresa. */

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
      '<b>Inicio</b>; esta vista es para buscar algo puntual.</p>' +
      (function () {
        var m = magnitudes(lista), d = detalleMagnitud(m);
        return d ? '<p class="glosa">De esos: ' + d + ".</p>" : "";
      })() + "</div>" +
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
      th("cantidad", "Unidades") + th("aprobacion", "Estado") + "</tr></thead><tbody>";
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
        "<td>" + puntoBase(c.base) + '<div class="mini">' + esc(c.tipo) + "</div></td>" +
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
        '<td class="num">' + num(cant) +
          '<div class="mini">' + (c.origen === "Inventario físico"
            ? "contadas" : "en SAP") + "</div></td>" +
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
      l + " · " + CORTO[l] + "</span> &nbsp; " + chipBase(c.base) + " · " + esc(c.tipo) +
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
      (e.actualizado ? campo("Último cambio",
        (quienDecidio(e) ? "lo decidió " + quienDecidio(e) : "sin firmar: no quedó " +
         "registrado quién") + " · " + fecha(e.actualizado)) : "") + "</div>";
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
      (e.almacen_decidido ? ' <span class="mini">· ' +
        (quienDecidio(e) ? "lo decidió " + esc(quienDecidio(e)) : "sin firmar") + "</span>" : "") +
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
    if (Almacen.soloConsulta()) return avisarConsulta();
    var o = document.getElementById("obs") ? document.getElementById("obs").value : "";
    /* Las decisiones que también se pueden tomar desde Inicio las toma el mismo
       código, con el mismo texto en el historial. Si la ficha escribiera su
       propia versión, el mismo hecho quedaría contado de dos maneras. */
    var COMPARTIDAS = { confirmar: "a", aprobar: "a", rechazar: "r",
                        validar: "x", reabrir: "re" };
    if (COMPARTIDAS[a]) {
      aplicar(c, COMPARTIDAS[a], {});
      if (a === "confirmar") aviso("Confirmado.");
      if (a === "aprobar") aviso("Aprobado.");
      return pintarFicha();
    }
    switch (a) {
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
        Almacen.olvidar(c.id); invalidar();
        aviso("Restituida al análisis original."); break;
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
    var depu = depuObj();
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
    var depu = depuObj();
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

  var MTABS = [
    { id: "general", t: "Maestro general" },
    { id: "equiv", t: "Equivalencias de nomenclatura" },
    { id: "almacenes", t: "Almacenes por base" },
    { id: "depurar", t: "Materiales sin stock" },
  ];
  /* Maestro administra: el catálogo de materiales, cómo se llaman de cada
     lado, qué almacén le corresponde a cada base y qué pasa con los registros
     sin stock. No decide casos: eso es Inicio. La separación importa porque
     antes las mismas cosas se tocaban desde dos lados. */
  function pintarMaestro() {
    var el = document.getElementById("v-depurar");
    var h = '<div class="cabi"><div><h1>Maestro</h1>' +
      '<p class="sub">La administración del catálogo: qué materiales hay, cómo se llaman de ' +
      "cada lado, qué almacén le corresponde a cada base y qué se hace con los registros sin " +
      "stock. Las decisiones sobre cada caso se toman en <b>Inicio</b>.</p></div></div>";
    h += '<nav class="mtabs">' + MTABS.map(function (t) {
      return '<button class="mtab' + (estado.mTab === t.id ? " on" : "") +
        '" data-mtab="' + t.id + '">' + esc(t.t) + "</button>"; }).join("") + "</nav>";
    el.innerHTML = h + '<div id="mcuerpo"></div>';
    el.querySelectorAll("[data-mtab]").forEach(function (b) {
      b.addEventListener("click", function () { estado.mTab = b.dataset.mtab; pintarMaestro(); }); });
    var c = el.querySelector("#mcuerpo");
    if (estado.mTab === "general") return panelGeneral(c);
    if (estado.mTab === "equiv") return panelEquivTabla(c);
    if (estado.mTab === "almacenes") return panelAlmacenesTabla(c);
    return pintarDepurar();
  }

  /* ---- El maestro general unificado --------------------------------------
     Un material es un material: no se duplica por aparecer en tres bases ni
     por tener stock en dos almacenes. Esta lista reúne todo lo que se conoce
     de cada código —de la bajada de SAP, de los candidatos del análisis y del
     maestro importado— en una fila por código.

     No confundir con el universo que hay que analizar: acá pueden figurar
     materiales que el análisis no toca. Son dos cosas distintas y por eso
     están en dos lugares distintos. */
  var CACHE_UNI = null;
  function invalidarUni() { CACHE_UNI = null; }
  function maestroUnificado() {
    if (CACHE_UNI) return CACHE_UNI;
    var por = {};
    function pon(cod, texto, tipo, fuente) {
      if (!cod) return;
      var r = por[cod] || (por[cod] = { codigo: cod, texto: "", tipo: "",
                                        fuentes: {}, bases: {}, almacenes: {},
                                        stock: 0, fisicos: {} });
      if (texto && (!r.texto || r.texto.length < texto.length)) r.texto = texto;
      if (tipo && !r.tipo) r.tipo = tipo;
      r.fuentes[fuente] = 1;
      return r;
    }
    D.casos.forEach(function (c) {
      var e = efectivo(c);
      if (c.origen === "Stock SAP") {
        var r = pon(c.material_sap, c.texto_sap, c.tipo_sap || c.tipo, "Bajada de SAP");
        if (r) {
          r.bases[c.base] = 1; r.stock += c.stock_sap || 0;
          (c.almacenes || []).forEach(function (x) { r.almacenes[x.almacen] = 1; });
        }
      }
      (c.candidatos || []).forEach(function (x) {
        pon(x.material, x.texto, c.tipo, "Candidato del análisis"); });
      e.materiales.forEach(function (m) {
        var r2 = pon(m, c.texto_sap, c.tipo, "Identificado en el inventario físico");
        if (r2 && c.nombre_fisico) {
          r2.fisicos[c.nombre_fisico] = 1; r2.bases[c.base] = 1;
          (c.almacenes || []).forEach(function (x) { r2.almacenes[x.almacen] = 1; });
        }
      });
    });
    var m = depuObj().maestro;
    if (m && m.filas) m.filas.forEach(function (f) {
      pon(f.codigo, f.texto, f.tipo, "Maestro importado"); });

    var pre = precios();
    var filas = Object.keys(por).sort().map(function (k) {
      var r = por[k];
      r.bases = Object.keys(r.bases).sort();
      r.almacenes = Object.keys(r.almacenes).sort();
      r.fisicos = Object.keys(r.fisicos).sort();
      r.fuente = Object.keys(r.fuentes).sort().join(" · ");
      r.precio = (typeof pre[k] === "number" && isFinite(pre[k])) ? pre[k] : null;
      return r;
    });
    // Los ítems del depósito que todavía no tienen código no entran como
    // material de SAP: entran aparte, porque todavía no son uno.
    var sinCod = D.casos.filter(function (c) {
      return c.origen === "Inventario físico" && !efectivo(c).materiales.length; });
    CACHE_UNI = { filas: filas, sinCodigo: sinCod };
    return CACHE_UNI;
  }

  function panelGeneral(el) {
    var u = maestroUnificado(), ec = economia(D.casos);
    var conPrecio = u.filas.filter(function (f) { return f.precio != null; }).length;
    var q = (estado.mq || "").trim().toLowerCase();
    var vista = u.filas.filter(function (f) {
      if (estado.mSolo === "sinprecio" && f.precio != null) return false;
      if (estado.mSolo === "conprecio" && f.precio == null) return false;
      if (!q) return true;
      return (f.codigo + " " + f.texto + " " + f.fisicos.join(" ")).toLowerCase()
             .indexOf(q) !== -1;
    });

    var h = '<div class="panelito"><p class="pnota">Una fila por <b>código de SAP</b>, ' +
      "reuniendo todo lo que se sabe de él: la bajada de SAP, los candidatos del análisis, " +
      "lo que quedó identificado en los inventarios físicos y el maestro que se importe. " +
      "<b>No se duplica</b> por aparecer en varias bases ni en varios almacenes.</p>" +
      '<div class="lalc">' +
      lalc(num(u.filas.length), "códigos de SAP") +
      lalc(num(conPrecio), "con importe de última compra") +
      lalc(num(u.filas.length - conPrecio), "pendientes de valorizar") +
      lalc(num(u.sinCodigo.length), "ítems del depósito sin código aún") +
      "</div></div>";

    // ---- importar / exportar
    h += '<h2>Planilla de materiales e importes</h2><div class="panelito">' +
      '<p class="pnota">La planilla trae <b>Código SAP</b>, <b>Nomenclatura SAP</b> e ' +
      "<b>Importe última compra</b>. El importe sale vacío: se completa afuera —con el " +
      "cruce de compras— y se vuelve a importar el mismo archivo. La importación " +
      "<b>no toca ninguna decisión ni ninguna equivalencia</b>: sólo carga importes y " +
      "materiales nuevos.</p>" +
      '<div class="impfila">' +
      '<button class="btn pri" id="mExp">Descargar la planilla (Excel)</button>' +
      '<label class="btnarch">Importar la planilla' +
      '<input type="file" id="mImp" accept=".xlsx,.csv,.txt,.tsv"></label>' +
      (depuObj().maestro && depuObj().maestro.precios
        ? '<button class="btn chico" id="mQuitarPre">Quitar los importes importados</button>' : "") +
      "</div><div id=\"mMsg\" class=\"mini\"></div>" +
      '<p class="pnota" style="margin-top:9px">Se puede subir el <b>.xlsx</b> tal cual se ' +
      "descargó, o un <b>.csv</b> con las mismas columnas. El archivo se lee en esta misma " +
      "computadora: no se sube a ningún lado.</p></div>";

    // ---- impacto económico
    h += "<h2>Impacto económico de las decisiones</h2>";
    if (!conPrecio) {
      h += '<div class="aviso"><b>Todavía no hay ningún importe de última compra cargado.</b>' +
        "Ninguno de los archivos recibidos lo trae: se revisaron la bajada de SAP (tiene " +
        "valor de stock, no precio de compra), la homologación (declara que los costos " +
        "quedan fuera) y los tres PDF de inventario. Por eso <b>no se informa ninguna " +
        "valorización</b> y todos los casos figuran como pendientes de valorizar. " +
        "Apenas se importe la planilla con importes, el cálculo sale solo.</div>";
    } else {
      h += '<div class="panelito"><p class="pnota"><b>Cómo se calcula:</b> unidades del caso ' +
        "× importe de última compra del material decidido. Las unidades son las " +
        "<b>contadas en el depósito</b> para los ítems físicos y las de <b>stock en SAP</b> " +
        "para los materiales que ningún inventario identificó. Un caso sin importe " +
        "<b>no suma cero</b>: queda contado aparte como pendiente de valorizar.</p>" +
        '<table class="listalotes"><thead><tr><th>Decisión</th><th class="num">Casos</th>' +
        '<th class="num">Unidades</th><th class="num">Importe</th>' +
        '<th class="num">Sin valorizar</th></tr></thead><tbody>' +
        Object.keys(ec.porAccion).sort().map(function (a) {
          var g = ec.porAccion[a];
          return "<tr><td>" + esc(a) + '</td><td class="num">' + num(g.n) +
            '</td><td class="num">' + num(g.un) + '</td><td class="num">' +
            (g.val ? pesos(g.val) : "—") + '</td><td class="num">' +
            (g.sinPrecio ? num(g.sinPrecio) : "—") + "</td></tr>";
        }).join("") +
        '<tr class="tot"><td><b>Total valorizado</b></td><td class="num">' + num(ec.valorizados) +
        '</td><td class="num">—</td><td class="num"><b>' + pesos(ec.total) +
        '</b></td><td class="num">' + num(ec.pendientes) + "</td></tr>" +
        "</tbody></table></div>";
    }

    // ---- la tabla
    h += "<h2>Los materiales</h2>" +
      '<div class="filtros chicos"><input type="text" id="mBuscar" placeholder="Buscar por código o nomenclatura…" value="' +
      esc(estado.mq || "") + '">' +
      sel("mSolo", "Mostrar", estado.mSolo || "", ["sinprecio", "conprecio"], function (v) {
        return v === "sinprecio" ? "Sin importe" : "Con importe"; }) +
      '<span class="fcuenta">' + num(vista.length) + " de " + num(u.filas.length) + "</span></div>";
    h += '<div class="tablabox"><table><thead><tr><th>Código SAP</th>' +
      "<th>Nomenclatura SAP</th><th>Nomenclatura del depósito</th>" +
      '<th class="num">Importe última compra</th><th>De dónde sale</th>' +
      "</tr></thead><tbody>";
    vista.slice(0, 400).forEach(function (f) {
      h += '<tr><td><b class="dcod">' + esc(f.codigo) + "</b>" +
        (f.bases.length ? '<div class="mini">' + f.bases.map(esc).join(" · ") + "</div>" : "") +
        "</td><td>" + esc(f.texto || "—") + "</td>" +
        '<td class="cfis">' + (f.fisicos.length ? f.fisicos.map(esc).join(" · ")
          : '<span class="nohay">sin correspondencia confirmada</span>') + "</td>" +
        '<td class="num">' + (f.precio != null ? pesos(f.precio)
          : '<span class="nohay">pendiente</span>') + "</td>" +
        '<td class="mini">' + esc(f.fuente) + "</td></tr>";
    });
    h += "</tbody></table>" +
      (vista.length > 400 ? '<p class="pnota">Se muestran los primeros 400. ' +
        "La planilla completa sale con el botón de descargar.</p>" : "") + "</div>";

    el.innerHTML = h;
    el.querySelector("#mExp").addEventListener("click", function () {
      Exportar.maestroGeneral(maestroUnificado());
      aviso("Planilla descargada. Completá la columna del importe y volvé a importarla."); });
    el.querySelector("#mImp").addEventListener("change", function (ev) {
      importarPlanilla(ev.target); });
    var qp = el.querySelector("#mQuitarPre");
    if (qp) qp.addEventListener("click", function () {
      if (!confirm("Se quitan los importes importados. Las decisiones se conservan. ¿Seguir?")) return;
      guardarPrecios(null); aviso("Importes quitados."); pintarMaestro(); });
    var bq = el.querySelector("#mBuscar");
    bq.addEventListener("input", function (ev) {
      estado.mq = ev.target.value;
      var p = ev.target.selectionStart; panelGeneral(el);
      var n2 = document.getElementById("mBuscar"); n2.focus(); n2.setSelectionRange(p, p); });
    el.querySelector("#mSolo").addEventListener("change", function (ev) {
      estado.mSolo = ev.target.value; panelGeneral(el); });
  }

  /* Los importes van donde van las demás cosas del maestro: a la base
     compartida, junto al maestro importado, y no al archivo de datos, que es
     de sólo lectura y se regenera cuando se rehace el análisis. */
  function guardarPrecios(pre, nombre, resumen) {
    var m = depuObj().maestro || { nombre: "", total: 0, filas: [] };
    var nuevo = { nombre: nombre || m.nombre || "Maestro general",
                  total: m.total || 0, filas: m.filas || [],
                  precios: pre || null, resumen: resumen || null,
                  cuando: new Date().toISOString() };
    Almacen.fijarMaestro(nuevo);
    invalidarUni();
  }

  /* ---- Leer la planilla --------------------------------------------------
     Un .xlsx es un ZIP, y el navegador sabe descomprimir desde hace años con
     DecompressionStream. Así se puede subir el mismo archivo que se bajó, sin
     pedirle a nadie que lo convierta a CSV ni instalar ninguna librería. Si el
     navegador fuera viejo, el CSV sigue andando y se dice por qué. */
  function leerPlanilla(file) {
    var nom = (file.name || "").toLowerCase();
    if (nom.slice(-5) === ".xlsx") return leerXlsx(file);
    return file.text().then(function (t) { return filasCsv(t); });
  }
  function filasCsv(txt) {
    var sep = (txt.split("\n")[0].split(";").length > txt.split("\n")[0].split(",").length)
              ? ";" : ",";
    return txt.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); })
      .map(function (l) {
        var out = [], cur = "", q = false;
        for (var i = 0; i < l.length; i++) {
          var ch = l[i];
          if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
          else if (ch === sep && !q) { out.push(cur); cur = ""; }
          else cur += ch;
        }
        out.push(cur);
        return out.map(function (x) { return x.trim(); });
      });
  }
  function leerXlsx(file) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error(
        "Este navegador no puede abrir archivos .xlsx. Guardá la planilla como CSV " +
        "(Archivo → Guardar como → CSV) y subila así."));
    }
    return file.arrayBuffer().then(function (buf) {
      var z = descomprimirZip(new Uint8Array(buf));
      var sst = [], hoja = null;
      return Promise.all(Object.keys(z).map(function (n) {
        if (n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(n)) {
          return inflar(z[n]).then(function (t) {
            if (n.indexOf("shared") !== -1) sst = cadenasXlsx(t); else hoja = t; });
        }
        return null;
      })).then(function () {
        if (!hoja) throw new Error("El archivo no tiene ninguna hoja legible.");
        return filasXlsx(hoja, sst);
      });
    });
  }
  /* Lo mínimo del formato ZIP: dónde empieza cada archivo y con qué método. */
  function descomprimirZip(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = {}, i = 0;
    while (i < u8.length - 4) {
      if (dv.getUint32(i, true) !== 0x04034b50) { i++; continue; }
      var metodo = dv.getUint16(i + 8, true);
      var comp = dv.getUint32(i + 18, true);
      var nLen = dv.getUint16(i + 26, true), eLen = dv.getUint16(i + 28, true);
      var nombre = new TextDecoder().decode(u8.subarray(i + 30, i + 30 + nLen));
      var ini = i + 30 + nLen + eLen;
      if (comp) out[nombre] = { metodo: metodo, datos: u8.subarray(ini, ini + comp) };
      i = ini + comp;
    }
    return out;
  }
  function inflar(e) {
    if (e.metodo === 0) return Promise.resolve(new TextDecoder().decode(e.datos));
    var ds = new DecompressionStream("deflate-raw");
    return new Response(new Blob([e.datos]).stream().pipeThrough(ds)).text();
  }
  function cadenasXlsx(xml) {
    return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      return (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) {
        return t.replace(/<[^>]+>/g, ""); }).join("")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    });
  }
  function filasXlsx(xml, sst) {
    var filas = [];
    (xml.match(/<row[\s\S]*?<\/row>/g) || []).forEach(function (r) {
      var f = [];
      (r.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) || []).forEach(function (c) {
        var ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1] || "";
        var col = 0;
        for (var i = 0; i < ref.length; i++) col = col * 26 + (ref.charCodeAt(i) - 64);
        var v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var inl = (c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        var val = inl != null ? inl
                : v == null ? ""
                : / t="s"/.test(c) ? (sst[+v] != null ? sst[+v] : v) : v;
        f[Math.max(0, col - 1)] = String(val).trim();
      });
      for (var j = 0; j < f.length; j++) if (f[j] == null) f[j] = "";
      filas.push(f);
    });
    return filas;
  }

  /* Un número escrito por una persona en Excel puede venir como «1.234,50»,
     «1,234.50», «$ 1234,5» o «1234.5». Todo eso es el mismo importe. */
  function aNumero(x) {
    var t = String(x == null ? "" : x).replace(/[^\d.,-]/g, "").trim();
    if (!t) return null;
    var coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
    if (coma > punto) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  function importarPlanilla(input) {
    var f = input.files && input.files[0];
    var msg = document.getElementById("mMsg");
    if (!f) return;
    msg.textContent = "Leyendo " + f.name + "…";
    leerPlanilla(f).then(function (filas) {
      if (!filas.length) throw new Error("El archivo está vacío.");
      // Encabezado: se busca por nombre, no por posición, para que no importe
      // si alguien agregó o movió una columna.
      var cab = null, iCod = -1, iTxt = -1, iPre = -1;
      for (var r = 0; r < Math.min(filas.length, 12); r++) {
        var L2 = filas[r].map(function (x) {
          return String(x).toLowerCase().replace(/\s+/g, " ").trim(); });
        var a = L2.findIndex(function (x) {
          return /c[oó]digo\s*sap|^c[oó]digo$|^material$|n[uú]mero de material/.test(x); });
        var b2 = L2.findIndex(function (x) {
          return /nomenclatura sap|descripci|denominaci|texto breve/.test(x); });
        var c2 = L2.findIndex(function (x) {
          return /importe.*compra|precio.*compra|[uú]ltima compra/.test(x); });
        if (a >= 0) { cab = r; iCod = a; iTxt = b2; iPre = c2; break; }
      }
      if (cab === null) throw new Error(
        "No se encontró la columna del código de SAP. La planilla tiene que tener un " +
        "encabezado con «Código SAP» (y, si se cargan importes, «Importe última compra»).");
      if (iPre < 0) throw new Error(
        "No se encontró la columna «Importe última compra». Si todavía no tenés los " +
        "importes, descargá la planilla de nuevo y completá esa columna.");

      var u = maestroUnificado();
      var conocidos = {};
      u.filas.forEach(function (x) { conocidos[x.codigo] = 1; });
      var pre = {}, viejos = precios();
      Object.keys(viejos).forEach(function (k) { pre[k] = viejos[k]; });

      var nuevos = 0, actualizados = 0, iguales = 0, vacios = 0, malos = [], dup = {};
      var desconocidos = [];
      for (var i = cab + 1; i < filas.length; i++) {
        var fila = filas[i];
        var cod = String(fila[iCod] == null ? "" : fila[iCod]).trim();
        if (!cod) continue;
        if (dup[cod]) { malos.push(cod + " · repetido en la planilla"); continue; }
        dup[cod] = 1;
        if (!conocidos[cod]) desconocidos.push(cod);
        var crudo = fila[iPre];
        if (crudo == null || String(crudo).trim() === "") { vacios++; continue; }
        var v = aNumero(crudo);
        if (v == null) { malos.push(cod + " · «" + crudo + "» no es un importe"); continue; }
        if (v < 0) { malos.push(cod + " · importe negativo"); continue; }
        if (pre[cod] == null) { pre[cod] = v; nuevos++; }
        else if (pre[cod] !== v) { pre[cod] = v; actualizados++; }
        else iguales++;
      }
      var res = { archivo: f.name, cuando: new Date().toISOString(),
                  nuevos: nuevos, actualizados: actualizados, iguales: iguales,
                  vacios: vacios, rechazados: malos.length,
                  desconocidos: desconocidos.length };
      guardarPrecios(pre, "Planilla de materiales · " + f.name, res);
      msg.innerHTML = '<span class="ok">Importado.</span> ' +
        num(nuevos) + " importes nuevos · " + num(actualizados) + " actualizados · " +
        num(iguales) + " sin cambio · " + num(vacios) + " filas sin importe" +
        (malos.length ? " · <b>" + num(malos.length) + " rechazadas</b>" : "") +
        (desconocidos.length ? " · " + num(desconocidos.length) +
          " códigos que no figuran en el análisis" : "") +
        (malos.length ? "<br>" + esc(malos.slice(0, 6).join(" · ")) +
          (malos.length > 6 ? " …" : "") : "");
      aviso("Importes cargados: " + (nuevos + actualizados) + " materiales.");
      setTimeout(function () { pintarMaestro(); }, 1400);
    }).catch(function (e) {
      msg.innerHTML = '<span class="mal">No se pudo importar.</span> ' + esc(e.message);
    });
  }

  /* ---- Equivalencias, administradas ------------------------------------- */
  function panelEquivTabla(el) {
    var gs = grupos();
    var liberadas = D.casos.filter(function (c) { return resueltoPorAgrupacion(c); }).length;
    var h = '<div class="panelito"><p class="pnota">El depósito y SAP no nombran igual, y la ' +
      "correspondencia <b>no es uno a uno en ninguno de los dos sentidos</b>. Acá están los " +
      "grupos ya declarados: varias nomenclaturas del depósito que son el mismo producto, " +
      "varios códigos de SAP para un mismo producto, o las dos cosas a la vez. Se declaran " +
      "al resolver un caso, en <b>Inicio</b>; una vez confirmada, la equivalencia vale para " +
      "todas las bases y no hay que volver a resolverla.</p>";
    if (liberadas) h += '<div class="cnota ok">✓ ' + num(liberadas) +
      (liberadas === 1 ? " candidato a baja quedó resuelto" : " candidatos a baja quedaron resueltos") +
      " por una agrupación.</div>";
    h += "</div>";
    if (!gs.length) {
      h += '<div class="finito chico"><div class="ficono">—</div>' +
        "<h2>Todavía no se declaró ninguna equivalencia</h2></div>";
    } else {
      h += '<div class="tablabox"><table class="tequiv"><thead><tr>' +
        "<th>Nombre unificado</th><th>Nomenclaturas del depósito</th>" +
        "<th>Códigos de SAP</th><th>Sentido</th><th>Quién</th></tr></thead><tbody>" +
        gs.map(function (g) {
          var sen = g.items.length > 1 && g.materiales.length > 1
              ? "Varias del depósito = varios de SAP"
            : g.items.length > 1 ? "Varias del depósito = un código de SAP"
            : g.materiales.length > 1 ? "Una del depósito = varios códigos de SAP"
            : "Una a una";
          return "<tr><td><b>" + esc(g.nombre) + "</b>" +
            (g.bases.length ? '<div class="mini">' + g.bases.map(esc).join(" · ") + "</div>" : "") +
            "</td><td>" + (g.items.length
              ? g.items.map(function (c) {
                  return '<span class="cbchip fis">' + esc(c.nombre_fisico) + "</span>"; }).join(" ")
              : '<span class="nohay">—</span>') +
            "</td><td>" + g.materiales.map(function (m) {
              return '<span class="cbchip">' + esc(m) + "</span>"; }).join(" ") +
            '</td><td class="mini">' + esc(sen) + "</td>" +
            "<td>" + esc(g.revisor || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    el.innerHTML = h;
  }

  /* ---- Almacenes por base ------------------------------------------------
     Lo observado y lo propuesto, separados, y «Ambigua» explicado: una
     etiqueta que hay que interpretar para poder resolverla no sirve. */
  function panelAlmacenesTabla(el) {
    var al = D.kpis.almacen || {};
    var h = '<div class="aviso info"><b>La correspondencia almacén→base está observada; ' +
      "el almacén esperado es una propuesta.</b>En la bajada, cada código de almacén " +
      "aparece bajo un único centro: saber a qué base pertenece cada almacén <b>no es una " +
      "suposición</b>. Lo que no está en los archivos es qué almacén <i>debería</i> tener " +
      "el stock de farmacia. Eso se propuso a partir de la composición observada de cada " +
      "almacén y <b>hay que validarlo con cada base</b>. Tampoco viene la descripción de " +
      "los almacenes, sólo el código.</div>";
    h += '<div class="panelito"><table><thead><tr>' +
      "<th>Base</th><th>Tipo</th><th>Almacén propuesto</th><th>Confianza</th>" +
      "<th>Otros almacenes de la base con stock de ese tipo</th></tr></thead><tbody>" +
      (D.meta.almacenes.propuesta || []).map(function (p) {
        var otros = (p.alternativas || []).filter(function (a) { return a.almacen !== p.almacen; });
        return "<tr><td>" + esc(p.base) + "</td><td>" + esc(p.tipo) + "</td>" +
          "<td><b>" + esc(p.almacen || "—") + "</b></td>" +
          '<td><span class="estado ' + (p.confianza === "Clara" ? "ap" : "re") + '">' +
          esc(p.confianza) + "</span>" +
          '<div class="mini">' + esc(p.confianza === "Clara"
            ? "Un solo almacén concentra el stock de este tipo en la base: no hay duda de " +
              "cuál es el candidato."
            : "Hay más de un almacén con stock de este tipo en la base y ninguno concentra " +
              "claramente el conjunto, así que de los datos no sale cuál debería ser. " +
              "Lo ambiguo es el almacén, no el material ni su código.") + "</div>" +
          (p.nota ? '<div class="mini">' + esc(p.nota) + "</div>" : "") + "</td>" +
          '<td class="mini">' + (otros.length
            ? otros.map(function (a) { return esc(a.almacen) + " (" + num(a.unidades) + " un.)"; }).join(" · ")
            : "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<p class="pnota" style="margin:12px 0 0"><b>Falta para cerrar esta parte:</b> ' +
      (D.meta.almacenes.falta || []).map(esc).join(" · ") + ".</p></div>";

    h += "<h2>Cómo está hoy la ubicación del stock</h2>" +
      '<p class="pnota" style="max-width:92ch">Una cosa es que el material esté bien ' +
      "<b>identificado</b>, otra que tenga <b>stock</b>, y otra que ese stock esté en el " +
      "<b>almacén que corresponde</b>. Son tres cuestiones independientes. Las diferencias " +
      "de ubicación se deciden en <b>Inicio</b>, en la solapa <b>Almacenes</b>: detectar " +
      "una diferencia no implica cambiarla.</p>" +
      '<div class="kpis">' +
      kpiFijo("A", "Ubicación correcta", al[AL_OK] || 0, "casos · en el almacén propuesto") +
      kpiFijo("C", "Ubicación a cambiar", al[AL_CAMB] || 0, "casos · figuran en otro almacén") +
      kpiFijo("D", "En varios almacenes", al[AL_MULT] || 0, "casos · material repartido") +
      kpiFijo("E", "Pendiente de validar", (al[AL_VAL] || 0) + (al[AL_NOID] || 0),
              "casos · falta definir el almacén") +
      "</div>" +
      '<p class="glosa">Son <b>casos</b>: cada combinación de un material con una base. ' +
      "Un mismo material puede estar bien ubicado en una base y mal en otra, así que se " +
      "cuenta una vez por base.</p>";
    el.innerHTML = h;
  }

  function pintarDepurar() {
    var depu = depuObj();
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
          "<td>" + puntoBase(c.base) + "</td>" +
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

    var el = document.getElementById("mcuerpo") || document.getElementById("v-depurar");
    el.innerHTML = h;
    var arch = el.querySelector("#depArch");
    if (arch) arch.addEventListener("change", function () { importarMaestro(arch); });
    var q = el.querySelector("#depQuitar");
    if (q) q.addEventListener("click", function () {
      if (!confirm("Se quita el maestro importado. Las decisiones ya tomadas se conservan. ¿Seguir?")) return;
      Almacen.quitarMaestro(); pintarMaestro();
    });
    var bp = el.querySelector("#depPol");
    if (bp) bp.addEventListener("click", modalPolitica);
    var bn = el.querySelector("#depPolNo");
    if (bn) bn.addEventListener("click", function () {
      if (!confirm("Se quita la política masiva. Las decisiones individuales se conservan. ¿Seguir?")) return;
      Almacen.quitarPolitica(); aviso("Política quitada."); pintarDepurar();
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
    if (Almacen.soloConsulta()) return avisarConsulta();
    var depu = depuObj();
    if (acc === "__pol") {
      Almacen.decidirMaterial(cod, null, "",
        "El material " + cod + " vuelve a seguir la política masiva");
      pintarDepurar();
      return aviso(cod + " vuelve a la política masiva.");
    }
    var actual = depu.materiales[cod];
    if (actual && actual.accion === acc) {
      Almacen.decidirMaterial(cod, null, "", "Se quitó la decisión individual sobre " + cod);
      pintarDepurar(); return;
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
    Almacen.decidirMaterial(cod, acc, motivo,
      (esExc ? "Excepción · " : "") + cod + " → " + acc + (motivo ? " · " + motivo : ""));
    pintarDepurar();
    aviso(cod + " → " + acc + (esExc ? " (excepción registrada)" : ""));
  }

  function modalPolitica() {
    var p = depuObj().politica || {};
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
      if (Almacen.soloConsulta()) { cerrar(); return avisarConsulta(); }
      var r = modal.querySelector('input[name="polacc"]:checked');
      if (!r) return aviso("Elegí una acción.");
      var crit = modal.querySelector("#polCrit").value.trim();
      if (!crit) return aviso("Escribí el criterio: sin criterio la decisión no se puede defender.");
      Almacen.fijarPolitica({ accion: r.value, alcance: modal.querySelector("#polAlc").value,
                              criterio: crit, quien: revisorActual() || "(sin identificar)",
                              cuando: new Date().toISOString() });
      cerrar(); aviso("Política masiva registrada."); pintarDepurar();
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
      Almacen.fijarMaestro({ nombre: f.name, filas: r.filas,
                             cuando: new Date().toISOString(),
                             total: r.total, columnas: r.columnas });
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

  // ------------------------------------------------------------- APLICAR
  /* El resultado del trabajo, en una pantalla: qué se decidió y qué hay que
     hacer con cada decisión en SAP. Las otras pantallas sirven para decidir;
     ésta sirve para ejecutar. Sin ella, el que tiene que entrar a SAP tiene
     que deducir de 1.991 casos qué le toca hacer. */
  function cantidadesDe(x) {
    var p = [];
    if (x.contadas) p.push("<b>" + num(x.contadas) + "</b> unidades contadas");
    if (x.sap) p.push("<b>" + num(x.sap) + "</b> unidades en SAP");
    if (x.registros) p.push("<b>" + num(x.registros) + "</b> " +
      (x.registros === 1 ? "registro del maestro" : "registros del maestro"));
    return p.join(" · ");
  }
  /* El importe nunca se completa a ojo: lo que no tiene precio de última
     compra se informa como pendiente de valorización, no como cero. */
  function importeDe(x) {
    var p = [];
    if (x.importe) p.push("<b>" + pesos(x.importe) + "</b>");
    if (x.sinImporte) p.push('<span class="mini">' + num(x.sinImporte) +
      " sin importe de última compra</span>");
    return p.join(" · ");
  }

  function pintarAplicar() {
    var el = document.getElementById("v-aplicar");
    var p = plan();
    var h = '<section class="franja apcab">' +
      '<div class="alc"><span class="k">Alcance</span><div class="alcbot">' +
      '<button class="abot' + (estado.base ? "" : " on") + '" data-base="">Las tres bases</button>' +
      D.meta.bases.map(function (b) {
        return '<button class="abot bs bs' + nBase(b) + (estado.base === b ? " on" : "") +
          '" data-base="' + esc(b) + '"><i></i>' + esc(b) + "</button>"; }).join("") +
      "</div></div>" +
      '<div class="inds">' +
      ind("ok", num(p.ejecutar), "decisiones para aplicar en SAP") +
      ind("pend", num(p.falta), "todavía sin decidir") +
      ind("", num(p.casos), "casos en el alcance elegido") +
      ind("", p.pct + "%", "decidido") +
      "</div></section>";

    h += '<div class="apintro"><h2>Qué hay que hacer en SAP</h2>' +
      "<p>Esto es el resultado de las decisiones tomadas en «Trabajar», agrupadas por " +
      "lo que hay que hacer con cada una. <b>El sistema no modifica SAP y nunca lo " +
      "hizo:</b> es el pedido de trabajo para quien lo ejecute, y queda registrado " +
      "quién decidió cada cosa.</p>" +
      '<div class="aviso info"><b>Cómo leer las cantidades.</b> Las <b>unidades ' +
      "contadas</b> son las del recuento en el depósito; las <b>unidades en SAP</b> son " +
      "las que registra el sistema. Son dos recuentos distintos: van siempre separadas y " +
      "no se suman. El maestro se cuenta en <b>registros</b>, no en unidades.</div></div>";

    p.todos.forEach(function (b, i) {
      h += '<section class="apbl ' + b.id + '"><header><span class="apn">' + (i + 1) +
        "</span><div><h3>" + esc(b.titulo) + "</h3>" +
        '<span class="apnota">' + esc(b.nota) + "</span></div>" +
        '<span class="apcuenta">' + num(b.n) + " " +
        (b.n === 1 ? "caso" : "casos") + "</span></header>";
      if (!b.n) {
        h += '<p class="apvacio">' + (b.id === "ejecutar"
          ? "Todavía no hay ninguna decisión tomada que haya que aplicar en SAP."
          : b.id === "falta" ? "No queda nada sin decidir en este alcance."
          : "Ningún caso en este grupo.") + "</p></section>";
        return;
      }
      b.fams.forEach(function (f) {
        h += '<div class="apfam"><div class="apfamt"><b>' + esc(f.titulo) + "</b>" +
          (f.mag ? '<span class="apmag">se mide en ' + esc(f.mag) + "</span>" : "") +
          '<span class="apfamn">' + esc(f.nota) + "</span></div>";
        f.acciones.forEach(function (a) {
          var abierto = estado.apl[a.verbo];
          h += '<div class="apacc' + (abierto ? " abierta" : "") + '">' +
            '<div class="apfila">' +
            '<span class="apverbo">' + esc(a.verbo.replace(/^PENDIENTE · /, "")) + "</span>" +
            '<span class="apcasos">' + num(a.n) + " " + (a.n === 1 ? "caso" : "casos") + "</span>" +
            '<span class="apcant">' + (cantidadesDe(a) || "—") + "</span>" +
            '<span class="apimp">' + (importeDe(a) || "—") + "</span>" +
            '<span class="apbot">' +
            (a.seg ? '<button class="btn chico pri" data-apseg="' + esc(a.seg) +
                     '">Decidirlos</button>' : "") +
            '<button class="btn chico" data-apver="' + esc(a.verbo) + '">' +
            (abierto ? "Ocultar" : "Ver el detalle") + "</button></span></div>";
          if (abierto) h += detalleAccion(a);
          h += "</div>";
        });
        h += "</div>";
      });
      h += "</section>";
    });

    /* El desglose por base: el que ejecuta en SAP trabaja por centro, así que
       necesita saber cuánto le toca a cada uno. */
    var bases = D.meta.bases.filter(function (b) { return p.porBase[b]; });
    if (bases.length > 1) {
      h += '<section class="apbl"><header><span class="apn">·</span><div>' +
        "<h3>Cómo se reparte entre las bases</h3>" +
        '<span class="apnota">Cada base se ejecuta en su centro de SAP.</span></div>' +
        "</header><table class=\"apt\"><thead><tr><th>Base</th>" +
        "<th class=\"n\">Para aplicar en SAP</th><th class=\"n\">Sin decidir</th>" +
        "<th class=\"n\">Sin acción</th><th class=\"n\">Fuera del alcance</th>" +
        "</tr></thead><tbody>" +
        bases.map(function (b) {
          var x = p.porBase[b];
          return "<tr><td>" + puntoBase(b) + '</td><td class="num">' + num(x.ejecutar) +
            '</td><td class="num">' + num(x.falta) + '</td><td class="num">' + num(x.nada) +
            '</td><td class="num">' + num(x.fuera) + "</td></tr>";
        }).join("") + "</tbody></table></section>";
    }

    h += '<div class="apcierre"><p><b>El detalle completo, caso por caso, está en el ' +
      "Excel.</b> La hoja «Aplicar en SAP» es este mismo resumen; la hoja «Qué hacer en " +
      "SAP» trae una fila por caso con el código, la nomenclatura de los dos lados, el " +
      "almacén, las cantidades y quién lo decidió.</p>" +
      '<button class="btn pri" id="apExcel">Descargar el Excel</button>' +
      '<button class="btn" id="apInforme">Ver el informe</button></div>';

    el.innerHTML = h;
    el.querySelectorAll("[data-base]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.base = b.dataset.base; guardarSesion(); pintarAplicar(); }); });
    el.querySelectorAll("[data-apver]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.apver;
        if (estado.apl[k]) delete estado.apl[k]; else estado.apl[k] = 1;
        pintarAplicar(); }); });
    el.querySelectorAll("[data-apseg]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.seg = b.dataset.apseg; estado.bpag = 1; estado.sel = {};
        estado.bf.motivo = ""; estado.modo = "bandeja";
        if (estado.seg === "depurar") return ir("depurar");
        ir("inicio"); }); });
    el.querySelectorAll("[data-apcaso]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.volverA = "aplicar"; ir("ficha", b.dataset.apcaso); }); });
    var bx = el.querySelector("#apExcel");
    if (bx) bx.addEventListener("click", function () { Exportar.excel(); });
    var bi = el.querySelector("#apInforme");
    if (bi) bi.addEventListener("click", function () { ir("informe"); });
  }

  var TOPE_DET = 40;
  function detalleAccion(a) {
    var cs = a.casos.slice(0, TOPE_DET);
    var h = '<div class="apdet"><table class="apt"><thead><tr>' +
      "<th>Nº</th><th>Base</th><th>Código SAP</th><th>Material</th>" +
      '<th class="num">Cantidad</th><th>Qué hacer</th><th></th>' +
      "</tr></thead><tbody>";
    cs.forEach(function (x) {
      var c = x.c;
      h += "<tr><td>" + num(c.n) + "</td><td>" + puntoBase(c.base) + "</td><td>" +
        esc(x.cod || "—") + "</td><td>" +
        esc(c.nombre_fisico || c.texto_sap || "") + '</td><td class="num">' +
        (x.a.un ? num(x.a.un) + ' <span class="mini">' +
          (x.a.mag === "contadas" ? "contadas" : x.a.mag === "sap" ? "en SAP" : "registro") +
          "</span>" : "—") +
        "</td><td>" + esc(x.a.det) + "</td><td>" +
        '<button class="enlace" data-apcaso="' + esc(c.id) + '">ver la ficha</button>' +
        "</td></tr>";
    });
    h += "</tbody></table>";
    if (a.casos.length > TOPE_DET)
      h += '<p class="mini">Se muestran ' + TOPE_DET + " de " + num(a.casos.length) +
        ". La lista completa está en el Excel, hoja «Qué hacer en SAP», " +
        "filtrando esta misma acción en la primera columna.</p>";
    return h + "</div>";
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
      "<li>Andá a <b>Trabajar</b>: ahí se decide. Arriba está la <b>hoja de ruta</b>, que dice " +
      "en qué etapa está el proceso y cuál es el próximo paso.</li>" +
      "<li>Elegí el <b>alcance</b>: las tres bases o una sola. Todo lo de abajo lo respeta.</li>" +
      "<li>Elegí una <b>solapa</b> (son los siete grupos de siempre). Abajo aparece cada caso " +
      "como una pregunta, con lo que dice el depósito, lo que dice SAP, por qué se levantó y " +
      "las respuestas posibles. <b>Se contesta con un clic</b>, sin entrar a ningún lado.</li>" +
      "<li>Para decidir muchos juntos, tildá los que quieras y usá la barra de arriba: antes " +
      "de aplicar se muestra a qué materiales, bases y almacenes alcanza.</li>" +
      "<li>En <b>«Crear en SAP»</b>, si ya consultaste el maestro completo y el material " +
      "aparece, <b>escribí ese código</b>: se le asigna como a cualquier otra identificación " +
      "y no se crea nada. No hace falta que el código esté en la bajada de stock —si " +
      "estuviera, el caso no estaría en ese grupo—.</li>" +
      "<li>Cuando un caso tiene <b>varios códigos posibles</b>, el botón te lleva al modo de " +
      "a uno, que es donde se elige entre ellos y se declaran equivalencias.</li>" +
      "<li>Cuando tengas decisiones tomadas, andá a <b>Aplicar en SAP</b>: ahí está el " +
      "resumen de qué hay que hacer —qué crear, qué dar de baja, qué ajustar y qué mover— " +
      "con las cantidades de cada cosa.</li>" +
      "<li>Al terminar, <b>Excel ↓</b>: es tu respaldo y la forma de compartirlo.</li>" +
      "</ol></div>" +
      '<div class="bloque"><h3>Para qué es cada solapa de arriba</h3>' +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>Trabajar</b></td><td>Donde se decide: estado del ' +
      "análisis, filtros, decisiones de a una o en lote, por base o integral. Tiene dos modos: " +
      "la <b>bandeja</b>, para ver y decidir muchos, y el <b>modo de a uno</b>, un caso por " +
      "pantalla con el teclado, para lo que necesita elegir entre varios códigos.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Buscar</b></td><td>Encontrar un material puntual ' +
      "y ver su ficha. No es otro panel de gestión.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Maestro</b></td><td>La administración del ' +
      "catálogo: el maestro general con los importes de última compra, las equivalencias " +
      "declaradas, el almacén propuesto para cada base y los materiales sin stock. " +
      "<b>No se deciden casos acá.</b></td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Aplicar en SAP</b></td><td>El resultado: qué ' +
      "decisiones se tomaron y qué hay que hacer con cada una en SAP —qué dar de alta, qué " +
      "dar de baja, qué ajustar, qué mover— con sus cantidades, más lo que todavía no se " +
      "pudo decidir y lo que está fuera del alcance. <b>Es lo que se le pasa a quien ejecuta " +
      "en SAP.</b></td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Informe</b></td><td>El informe explicativo, con ' +
      "el estado actualizado. Contesta de cero qué es todo esto, y se guarda en PDF.</td></tr>" +
      "</tbody></table></div>" +
      '<div class="bloque"><h3>La hoja de ruta</h3>' +
      "<p>Seis etapas, en el orden en que conviene hacerlas. El avance <b>se calcula del " +
      "estado real</b> del sistema: no hay porcentajes puestos a mano.</p>" +
      '<p><b>Tres las hace el sistema y tres las decidís vos.</b> Por eso al abrir no estás ' +
      "en la etapa 1: leer los inventarios, cruzarlos contra SAP y clasificar las " +
      "diferencias ya está hecho. <b>Tu trabajo empieza en la etapa 2</b>, y la hoja de ruta " +
      "lo dice arriba de todo, con la próxima acción concreta al lado.</p>" +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>1 · Carga</b></td><td>Los tres inventarios ' +
      "físicos y la bajada de SAP, con los controles que tienen que cuadrar contra las " +
      "fuentes.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>2 · Trazabilidad</b></td><td>Qué código de SAP ' +
      "corresponde a cada nomenclatura del depósito. <b>Va antes del cruce definitivo:</b> " +
      "cruzar con una correspondencia dudosa es arrastrar la duda a todo lo que sigue. Una " +
      "equivalencia confirmada vale para todas las bases y no se vuelve a preguntar.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>3 · Cruce</b></td><td>Cada inventario contra los ' +
      "almacenes de SAP de su base, y la clasificación de las diferencias.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>4 · Decisiones</b></td><td>Lo que se hace en ' +
      "Inicio, de a una o en lote.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>5 · Economía</b></td><td>Con el importe de ' +
      "última compra cargado desde Maestro, cuánto representa cada decisión. Lo que no tiene " +
      "importe queda contado aparte, no en cero.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>6 · Informe</b></td><td>El cierre: estado, ' +
      "decisiones, pendientes e impacto económico.</td></tr>" +
      "</tbody></table>" +
      "<p><b>Ninguna etapa bloquea a la siguiente.</b> El maestro general se puede ir " +
      "completando mientras el análisis avanza con lo que ya hay.</p>" +
      "<p>Cada grupo explica <b>por qué va en ese momento y qué destraba</b>, y cuando lo " +
      "terminás te dice cuál es el siguiente. Si querés el recorrido completo de nuevo, el " +
      "botón <b>«¿Cómo se usa esto?»</b> está arriba, al lado de la hoja de ruta.</p></div>" +
      '<div class="bloque"><h3>Ítems, unidades y casos: tres cosas distintas</h3>' +
      "<p>Son tres maneras de contar lo mismo y dan números muy distintos. Donde hay una " +
      "cifra, el sistema dice siempre de cuál se trata.</p>" +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>ítem</b></td><td>Un producto contado en un ' +
      "inventario físico. Una fila del PDF de la base. Hay <b>" + num(D.kpis.items_fisicos) +
      "</b> en las tres bases.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>unidad</b></td><td>Cada unidad de ese producto. ' +
      "Un solo ítem puede ser 500 unidades. Se contaron <b>" + num(D.kpis.unidades_fisicas) +
      "</b> en total.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>caso</b></td><td>Una fila de este trabajo: un ' +
      "ítem del depósito, o un material de SAP con stock que ningún inventario identificó. " +
      "Hay <b>" + num(D.kpis.total_casos) + "</b>. Es lo que cuentan los grupos del inicio.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>material</b></td><td>Un código de SAP. Un mismo ' +
      "material aparece en varios casos si tiene stock en más de una base.</td></tr>" +
      "</tbody></table>" +
      "<p><b>Una trampa que conviene conocer:</b> las unidades <i>contadas en el depósito</i> " +
      "y las unidades de <i>stock en SAP</i> no son la misma magnitud y no se suman. Cuando " +
      "las dos aparecen juntas, el sistema las muestra por separado.</p></div>" +

      '<div class="bloque"><h3>Atajos del modo revisión</h3><p>' +
      "<kbd>1</kbd>…<kbd>9</kbd> elegir un candidato · <kbd>A</kbd> aprobar o confirmar · " +
      "<kbd>R</kbd> rechazar · <kbd>N</kbd> ninguno corresponde · <kbd>X</kbd> no puedo " +
      "decidirlo ahora · <kbd>→</kbd> saltear · <kbd>F</kbd> ver la ficha completa.</p>" +
      "<p>En el <b>grupo 2</b> los números eligen la alternativa (<kbd>1</kbd> verificar, " +
      "<kbd>2</kbd> crear igual) y después el resultado de la verificación. En el <b>grupo " +
      "5</b> eligen qué se hace con la ubicación.</p></div>" +

      '<div class="bloque"><h3>Cuando no se encuentra el material en SAP</h3>' +
      "<p>El maestro con el que se trabaja son los <b>" + num(totalMaestro()) + " códigos</b> " +
      "ya cargados: los que tienen existencia y los que están en cero. Que un ítem no esté " +
      "ahí es un dato fuerte, pero el maestro salió de una bajada de stock por centro, así " +
      "que un material que nunca tuvo existencia en ninguno de los tres podría no figurar. " +
      "Por eso se pregunta en vez de decidir solo.</p>" +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>Alternativa 1</b><br>Consultar primero</td>' +
      "<td>Se consulta en SAP antes de crear. Si aparece y sirve, se le asigna ese código " +
      "desde la ficha y listo. Es el camino que evita el código duplicado. El caso queda " +
      "abierto hasta que cargues el resultado.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Alternativa 2</b><br>Crear igual, sin verificar</td>' +
      "<td>El sistema <b>no te lo impide</b> por no tener el maestro. Te lo pregunta " +
      "expresamente, te muestra el riesgo —un código duplicado, con el stock y el histórico " +
      "partidos— y te pide que lo confirmes marcando que lo entendés. La decisión queda " +
      "registrada con tu nombre y se liga al plan de depuración del maestro.</td></tr>" +
      "</tbody></table></div>" +

      '<div class="bloque"><h3>Cuando una nomenclatura no corresponde a una sola</h3>' +
      "<p>El depósito y SAP no nombran igual, y la correspondencia <b>no es uno a uno en " +
      "ninguno de los dos sentidos</b>. El sistema deja declarar los dos.</p>" +
      '<table class="listalotes"><tbody>' +
      '<tr><td style="white-space:nowrap"><b>Una del depósito</b><br>= varios de SAP</td>' +
      "<td>SAP tiene el mismo producto abierto en más de un código. Marcás los códigos que " +
      "correspondan con <kbd>1</kbd>…<kbd>9</kbd>, le ponés el nombre que los unifica y " +
      "quedan agrupados. Los códigos agrupados <b>dejan de ser candidatos a baja</b>.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Varias del depósito</b><br>= uno de SAP</td>' +
      "<td>Cada base escribe el nombre a su manera. Cuando otro ítem del depósito podría " +
      "ser el mismo producto, aparece en el panel de equivalencias arriba de los candidatos: " +
      "lo marcás y se deciden juntos, con una sola respuesta.</td></tr>" +
      '<tr><td style="white-space:nowrap"><b>Las dos cosas</b><br>a la vez</td>' +
      "<td>Se pueden marcar varios ítems del depósito y varios códigos de SAP en la misma " +
      "pantalla. La barra de abajo dice siempre cuántos de cada lado quedan declarados el " +
      "mismo producto antes de confirmar.</td></tr>" +
      "</tbody></table>" +
      "<p><b>De dónde sale la sugerencia.</b> No del parecido del nombre: dos ítems se " +
      "proponen sólo si comparten un candidato en SAP <i>y además</i> no tienen ninguna " +
      "característica en conflicto y coinciden en alguna verificable —concentración, forma, " +
      "volumen, calibre, medidas, esterilidad—. Cuando ninguno declara características, se " +
      "exige que los nombres sean casi iguales. Una sugerencia falsa es peor que ninguna.</p>" +
      "<p><b>El almacén, en la misma pantalla.</b> Cada candidato muestra en qué almacén " +
      "tiene el stock y si es el almacén propuesto para esa base: en verde cuando coincide, " +
      "en naranja cuando está en otro, y en gris cuando ese código no tiene stock en esa " +
      "base. Parte de la decisión es si el código que estás por asignar tiene el stock " +
      "donde debería.</p>" +
      "<p>Los grupos declarados quedan a la vista en <b>Inicio</b> y en la hoja " +
      "<b>Equivalencias</b> del Excel, con los dos lados, el nombre unificado y quién lo " +
      "decidió.</p></div>" +

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
      'correspondencia, lo más probable es que haya que crearlo, pero <b>no está probado</b>: ' +
      'un material que nunca tuvo existencia en ninguno de los tres centros podría no estar ' +
      'en la bajada. Por eso el sistema ofrece consultarlo en SAP antes de proponer el ' +
      'alta, y deja elegir el centro y el almacén donde se daría.</p></div>' +
      '<div class="bloque"><h3>Cómo se decide una coincidencia</h3><p>El parecido del nombre ' +
      'genera el candidato; <b>las características deciden</b>: concentración, forma, volumen, ' +
      'calibre, medidas, talle, modelo, longitud, esterilidad y población. Si los dos lados ' +
      'declaran la misma característica con valores distintos, no son el mismo material. Si ' +
      'una se declara de un ' +
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

  /* La barra dice en qué modo se está trabajando y si quedó algo sin guardar.
     Nunca se da por guardado algo que no salió: si una escritura falla, se
     reintenta y mientras tanto el indicador lo dice. */
  function pintarEstadoAlmacen(st) {
    var caja = document.getElementById("sync");
    if (!caja) return;
    var h = "";
    if (st.modo === "servidor") {
      var u = st.usuario || {};
      /* En modo prueba la identidad no la puso Entra ID: la escribió quien
         lanzó el servidor. Tiene que verse, para que nadie confunda una
         prueba con el sistema de verdad. */
      if (st.modoServidor === "desarrollo") {
        h += '<span class="sest prueba" title="Arrancado sin autenticación: ' +
             'las decisiones no valen y la identidad no está verificada">PRUEBA</span>';
      }
      h += '<span class="quien" title="' + esc(u.upn || "") + '">' +
           esc(u.nombre || "") + "</span>";
      if (st.fallo) {
        h += '<span class="sest mal" title="' + esc(st.fallo) + '">⚠ sin guardar</span>';
      } else if (st.sincronizando) {
        h += '<span class="sest yendo">guardando…</span>';
      } else {
        h += '<span class="sest bien" title="Las decisiones se guardan en la base compartida">✓ guardado</span>';
      }
      if (st.conflictos && st.conflictos.length) {
        h += '<button class="sest choque" id="bChoque">' + st.conflictos.length +
             (st.conflictos.length === 1 ? " caso lo decidió otro" : " casos los decidió otro") +
             "</button>";
      }
      h += '<a class="salir" href="/auth/salir" title="Cerrar la sesión">Salir</a>';
    } else if (st.modo === "consulta") {
      h += '<span class="sest consulta">Copia para consulta · no se puede decidir</span>';
    } else {
      h += '<span class="sest local" title="Sin servidor, las decisiones quedan en este navegador. ' +
           'Exportá el Excel al terminar.">Sólo en este navegador</span>';
      if (st.fallo) h += '<span class="sest mal" title="' + esc(st.fallo) + '">⚠</span>';
    }
    caja.innerHTML = h;
    var bc = caja.querySelector("#bChoque");
    if (bc) bc.addEventListener("click", function () { modalConflictos(st.conflictos); });
    medirBarra();
  }

  /* Dos personas decidieron el mismo caso. No se pierde nada —el historial
     guarda las dos— pero quien llegó último tiene que enterarse de que pisó
     algo, y poder ir a mirarlo. */
  function modalConflictos(lista) {
    var h = '<div class="modalfondo"><div class="modal">' +
      "<h2>" + (lista.length === 1 ? "Otra persona ya había decidido este caso"
                                   : "Otras personas ya habían decidido estos casos") + "</h2>" +
      '<p class="sub">Tu decisión se guardó igual y quedó como la última. Nada se perdió: ' +
      "el historial de cada caso tiene las dos, con nombre y fecha. Conviene mirarlos por " +
      "si hace falta ponerse de acuerdo.</p>" +
      '<table class="listalotes" style="margin-top:16px"><thead><tr>' +
      "<th>Caso</th><th>Lo había decidido</th><th></th></tr></thead><tbody>" +
      lista.map(function (x) {
        var c = caso(x.casoId);
        return "<tr><td><b>" + esc(c ? (c.nombre_fisico || c.texto_sap) : x.casoId) + "</b>" +
          '<div class="mini">' + esc(c ? c.base : "") + "</div></td>" +
          "<td>" + esc(x.quien || "—") + "</td>" +
          '<td><button class="btn chico" data-ver="' + esc(x.casoId) + '">Ver la ficha</button></td></tr>';
      }).join("") + "</tbody></table>" +
      '<div class="modalacc"><button class="btn pri" id="chOk">Entendido</button></div>' +
      "</div></div>";
    var cont = document.createElement("div");
    cont.innerHTML = h; document.body.appendChild(cont.firstChild);
    var modal = document.querySelector(".modalfondo");
    function cerrar() { modal.remove(); Almacen.limpiarConflictos(); }
    modal.querySelector("#chOk").addEventListener("click", cerrar);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) cerrar(); });
    modal.querySelectorAll("[data-ver]").forEach(function (b) {
      b.addEventListener("click", function () {
        cerrar(); estado.volverA = estado.vista; ir("ficha", b.dataset.ver); }); });
  }

  function iniciar() {
    medirBarra();
    window.addEventListener("resize", medirBarra);
    document.addEventListener("keydown", teclas);
    Almacen.alCambiar(pintarEstadoAlmacen);
    pintarEstadoAlmacen(Almacen.estado());
    /* Cuando otro decide algo, se redibuja sola. Salvo en el modo revisión:
       ahí hay un caso abierto en la pantalla y cambiárselo a alguien en medio
       de una decisión sería peor que esperar. */
    Almacen.cuandoLleguenCambios(function () {
      invalidar();
      if (estado.modo === "foco" || document.querySelector(".modalfondo")) {
        aviso("Alguien más registró decisiones. Se actualiza al salir de acá.");
        return;
      }
      ir(estado.vista);
    });

    /* En modo servidor la identidad la pone Entra ID: el campo deja de ser
       texto libre, porque la gracia de entrar con la cuenta es justamente que
       «quién decidió» no dependa de lo que cada uno escriba. */
    var caja = document.getElementById("cajaRevisor");
    var inp = document.getElementById("revisor");
    if (Almacen.modo() === "servidor") {
      if (caja) caja.classList.add("oculto");
    } else if (inp) {
      inp.value = Almacen.revisor();
      inp.addEventListener("input", function () { Almacen.fijarRevisor(inp.value); });
    }
    document.querySelectorAll("#nav button").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.sel = {};
        ir(b.dataset.vista); }); });
    document.getElementById("bTema").addEventListener("click", function () {
      var r = document.documentElement, hay = r.getAttribute("data-theme");
      var osc = hay ? hay === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      r.setAttribute("data-theme", osc ? "light" : "dark"); });
    document.getElementById("bExcel").addEventListener("click", function () {
      Exportar.excel(); aviso("Excel generado con tus decisiones."); });
    document.getElementById("bPdf").addEventListener("click", function () {
      ir("informe"); setTimeout(function () { window.print(); }, 350); });
    /* Con varias personas trabajando a la vez, hay que poder ver lo que
       decidieron los demás sin recargar la página. */
    var bAct = document.getElementById("bActualizar");
    if (bAct) {
      if (Almacen.modo() !== "servidor") bAct.classList.add("oculto");
      else bAct.addEventListener("click", function () {
        Almacen.recargar().then(function () {
          invalidar(); ir(estado.vista); aviso("Actualizado con lo que decidieron los demás.");
        }).catch(function (e) { aviso("No se pudo actualizar: " + e.message); });
      });
    }

    /* Se retoma donde quedó el trabajo. Si la sesión guardada es de otra
       persona no se usa: dejarle a alguien la pantalla de otro, con su base y
       su caso abierto, confunde más de lo que ayuda. */
    var ss = leerSesion();
    var mia = ss && (!ss.quien || !revisorActual() || ss.quien === revisorActual());
    if (mia && retomarSesion(ss)) {
      ir(estado.vista || "inicio");
      avisoRetomada(ss);
    } else {
      if (ss && !mia) olvidarSesion();
      ir("inicio");
    }
    /* La primera vez se explica sin que haya que pedirlo. Después, sólo si se
       pide: un cartel que aparece todos los días deja de leerse al segundo. */
    if (!guiaVista()) setTimeout(modalGuia, 700);
  }

  /* Decirlo, y poder deshacerlo: retomar en un lugar al que no se pidió ir es
     desorientador si no se avisa. */
  function avisoRetomada(ss) {
    var s2 = segPor(estado.seg);
    var donde = (estado.base ? estado.base + " · " : "") + (s2 ? s2.corto : "");
    var cont = document.createElement("div");
    cont.className = "retomada";
    cont.innerHTML = "<b>Retomaste donde habías quedado.</b> " + esc(donde) +
      (ss.cuando ? ' <span class="mini">' + esc(fecha(ss.cuando)) + "</span>" : "") +
      ' <button class="enlace" id="reEmpezar">Empezar de cero</button>';
    document.body.appendChild(cont);
    cont.querySelector("#reEmpezar").addEventListener("click", function () {
      olvidarSesion();
      estado.base = ""; estado.seg = "revision"; estado.bpag = 1;
      estado.bVer = "pend"; estado.modo = "bandeja";
      estado.bf = { texto: "", tipo: "", motivo: "", almacen: "", obs: "" };
      estado.cola = null; estado.triage = [];
      cont.remove(); ir("inicio");
    });
    setTimeout(function () { cont.classList.add("yendose"); }, 9000);
    setTimeout(function () { cont.remove(); }, 9600);
  }

  return { iniciar: iniciar, ir: ir, esc: esc, num: num, pesos: pesos, fecha: fecha,
           efectivo: efectivo, filtrados: filtrados, conteos: conteos,
           universoDep: universoDep,
           accionDep: accionDep, ligadosDep: ligadosDep, etapaB: etapaB,
           RB: { VERIF: RB_VERIF, CREAR: RB_CREAR, NO: VER_NO, NUEVO: VER_NUEVO,
                 SIRVE: VER_SIRVE },
           DP: { MANT: DP_MANT, BLOQ: DP_BLOQ, BAJA: DP_BAJA, ACCIONES: DP_ACCIONES },
           depuracion: depuObj, datos: function () { return D; },
           decisiones: decisiones, revisor: revisorActual,
           precios: precios, maestroUnificado: maestroUnificado,
           resueltoPorAgrupacion: resueltoPorAgrupacion, equivPres: equivPres,
           grupos: grupos,
           accionSap: accionSap, plan: plan, ACCIONES: ACCIONES, ACC: ACC,
           FAMILIAS: FAMILIAS, EXPLICA: EXPLICA, BLOQUES: BLOQUES,
           economia: economia,
           LETRA: LETRA, CORTO: CORTO };
})();
