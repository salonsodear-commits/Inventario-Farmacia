/* Dónde se guardan las decisiones.

   El sistema funciona de dos maneras y la diferencia importa:

   · SERVIDOR — se abre desde http://…, se entra con la cuenta de Emergencias y
     las decisiones van a una base SQLite compartida. Es el modo para trabajar
     de verdad: varias personas sobre las mismas bases, cada decisión firmada
     con la identidad real de quien la tomó.

   · CONSULTA — el archivo único abierto con doble clic. Sin servidor no hay
     login posible (Microsoft no admite file:// como dirección de retorno) ni
     base compartida. Antes acá se podía decidir, y eso era el problema: cada
     copia que circulaba por correo era un lugar donde alguien decidía sin que
     nadie se enterara, y esas decisiones no entraban en ningún lado. Ahora el
     archivo sirve para MIRAR —el análisis completo, las fichas, el informe—
     pero no para decidir. Para decidir hay que entrar a la aplicación.

   El modo se detecta solo. El resto del sistema no se entera: llama siempre a
   las mismas funciones.

   Una decisión de diseño que vale la pena explicar: las funciones de guardado
   NO son asíncronas. El modelo en memoria se actualiza al instante y la
   escritura sale por detrás, encolada. Si se hiciera al revés, cada tecla del
   modo revisión esperaría un ida y vuelta de red y el trabajo se volvería
   lento. Lo que sí hay es un indicador honesto: si una escritura falla, se
   reintenta y se avisa; nunca se da por guardado algo que no se guardó. */
var Almacen = (function () {
  "use strict";

  var CLAVE = "invsap.decisiones.v1";
  var CLAVE_DEP = "invsap.depuracion.v1";
  var CLAVE_REV = "invsap.revisor";

  var modo = "local";          // "servidor" | "local" | "consulta"
  var usuario = null;          // sólo en modo servidor
  var modoServidor = "";       // "entra" o "desarrollo", lo dice el servidor
  var decisiones = {};
  var depu = { politica: null, materiales: {}, maestro: null, historial: [] };
  var revisorLocal = "";

  var cola = [];               // decisiones esperando salir
  var enVuelo = false;
  var pendientesOtros = 0;     // pedidos que no son de decisiones
  var fallo = null;
  var oyentes = [];
  var alLlegarCambios = null;   // lo pone app.js: qué hacer cuando otro decidió algo
  var marca = "";               // marca del último cambio que este navegador conoce
  var conflictos = [];          // casos que otro decidió mientras los teníamos abiertos

  // ------------------------------------------------------------- estado
  function estado() {
    return { modo: modo, usuario: usuario,
             sincronizando: enVuelo || cola.length > 0 || pendientesOtros > 0,
             pendientes: cola.length, fallo: fallo, conflictos: conflictos.slice(),
             modoServidor: modoServidor };
  }
  function limpiarConflictos() { conflictos = []; avisar(); }
  function alCambiar(fn) { oyentes.push(fn); }
  function avisar() { oyentes.forEach(function (f) { try { f(estado()); } catch (e) {} }); }

  // ------------------------------------------------------------- red
  function pedir(metodo, ruta, cuerpo) {
    return fetch(ruta, {
      method: metodo,
      headers: cuerpo ? { "content-type": "application/json", "x-invsap": "1" }
                      : { "x-invsap": "1" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      if (r.status === 401) {
        // La sesión venció mientras se trabajaba. Avisar y mandar a entrar de
        // nuevo es mejor que seguir perdiendo escrituras en silencio.
        fallo = "Se cerró la sesión. Volvé a ingresar para seguir guardando.";
        avisar();
        throw new Error("sesión vencida");
      }
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ("El servidor respondió " + r.status));
        });
      }
      return r.json().catch(function () { return {}; });
    });
  }

  /* Cualquier escritura que no sea una decisión: se cuenta para el indicador
     y, si falla, lo dice. No se reintenta sola porque son acciones puntuales
     que la persona puede repetir viendo el error. */
  function escribir(metodo, ruta, cuerpo, alFallar) {
    if (modo !== "servidor") return Promise.resolve();
    pendientesOtros++; avisar();
    return pedir(metodo, ruta, cuerpo).then(function (r) {
      pendientesOtros--; fallo = null; avisar(); return r;
    }).catch(function (e) {
      pendientesOtros--; fallo = e.message; avisar();
      if (alFallar) alFallar(e);
      throw e;
    });
  }

  // ------------------------------------------------------------- cola
  /* Las decisiones salen agrupadas: en el modo revisión se decide de a una,
     pero un lote decide cientos. Juntarlas en un pedido evita cientos de
     idas y vueltas y, del lado del servidor, entran en una sola transacción:
     o se guardan todas o no se guarda ninguna. */
  function encolar(item) {
    if (modo !== "servidor") { guardarLocal(); return; }
    cola.push(item);
    avisar();
    if (!enVuelo) setTimeout(vaciar, 0);
  }
  function vaciar() {
    if (enVuelo || !cola.length) return;
    enVuelo = true;
    var lote = cola.splice(0, cola.length);
    avisar();
    var envio = lote.length === 1
      ? pedir("POST", "/api/decision", lote[0])
      : pedir("POST", "/api/decision/lote", { items: lote });
    envio.then(function (r) {
      enVuelo = false; fallo = null;
      // El servidor avisa si alguien más había decidido ese caso. Se guarda
      // igual —el historial guarda las dos— pero la persona se entera.
      if (r && r.conflicto) {
        conflictos.push({ casoId: lote[0].casoId, quien: r.conflictoCon });
      }
      if (r && r.marca) marca = r.marca;
      avisar();
      if (cola.length) setTimeout(vaciar, 0);
    }).catch(function (e) {
      // Se devuelven al principio de la cola y se reintenta: una caída de red
      // no puede hacer desaparecer una decisión ya tomada.
      enVuelo = false;
      cola = lote.concat(cola);
      fallo = e.message;
      avisar();
      setTimeout(vaciar, 4000);
    });
  }

  function guardarLocal() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(decisiones));
      localStorage.setItem(CLAVE_DEP, JSON.stringify(depu));
      fallo = null;
    } catch (e) {
      fallo = "El navegador bloqueó el almacenamiento: las decisiones no se están guardando.";
    }
    avisar();
  }

  // ------------------------------------------------------------- arranque
  /* Intenta hablar con el servidor. Si no hay (archivo único, o servidor
     caído), sigue con el almacenamiento del navegador. */
  function iniciar(listo) {
    var local = location.protocol === "http:" || location.protocol === "https:";
    if (!local) return arrancarLocal(listo);
    fetch("/api/estado", { headers: { "x-invsap": "1" }, credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("sin servidor");
        return r.json();
      })
      .then(function (d) {
        modo = "servidor";
        usuario = d.usuario;
        modoServidor = d.modo || "";
        decisiones = d.decisiones || {};
        depu = d.depuracion || depu;
        if (!depu.materiales) depu.materiales = {};
        if (!depu.historial) depu.historial = [];
        marca = d.marca || "";
        vigilar();
        avisar();
        listo();
      })
      .catch(function () { arrancarLocal(listo); });
  }
  /* `consulta` lo escribe el empaquetador en el archivo único. Un archivo
     servido desde la aplicación nunca lo trae, así que no hay manera de
     quedar en modo consulta por accidente. */
  function soloConsulta() {
    return typeof window.INVSAP_SOLO_CONSULTA !== "undefined" && window.INVSAP_SOLO_CONSULTA;
  }
  function arrancarLocal(listo) {
    modo = soloConsulta() ? "consulta" : "local";
    try { decisiones = JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; }
    catch (e) { decisiones = {}; }
    try {
      var d = JSON.parse(localStorage.getItem(CLAVE_DEP) || "null");
      if (d) depu = { politica: d.politica || null, materiales: d.materiales || {},
                      maestro: d.maestro || null, historial: d.historial || [] };
    } catch (e) {}
    try { revisorLocal = localStorage.getItem(CLAVE_REV) || ""; } catch (e) {}
    avisar();
    listo();
  }

  // ------------------------------------------------------------- lectura
  function todas() { return decisiones; }
  function depuracion() { return depu; }
  function revisor() {
    return modo === "servidor" ? (usuario ? usuario.nombre : "") : revisorLocal;
  }
  function fijarRevisor(v) {
    if (modo === "servidor") return;      // en servidor lo pone la identidad real
    revisorLocal = v;
    try { localStorage.setItem(CLAVE_REV, v); } catch (e) {}
  }

  // ------------------------------------------------------------- escritura
  /* El modelo en memoria se actualiza acá, para que el sistema sea igual de
     rápido en los dos modos. La persistencia sale por detrás. */
  function decidir(casoId, cambios, descripcion) {
    if (modo === "consulta") return null;    // acá no se decide; lo dice la interfaz
    var d = decisiones[casoId] || { historial: [] };
    // 0 = «cuando lo leí no había ninguna decisión». Mandarlo como undefined
    // hacía que el servidor no pudiera distinguir «no sé» de «no había nada»,
    // y el aviso de conflicto nunca saltaba en el caso más común.
    var versionConocida = d.version || 0;
    var antes = {};
    Object.keys(cambios).forEach(function (k) {
      antes[k] = d[k] === undefined ? null : d[k];
      d[k] = cambios[k];
    });
    d.historial = d.historial || [];
    d.historial.push({ cuando: new Date().toISOString(), quien: revisor() || "(sin identificar)",
                       que: descripcion, antes: antes, despues: cambios });
    d.revisor = revisor() || "(sin identificar)";
    d.actualizado = new Date().toISOString();
    decisiones[casoId] = d;
    encolar({ casoId: casoId, cambios: cambios, descripcion: descripcion,
              versionConocida: versionConocida });
    return d;
  }

  function olvidar(casoId) {
    delete decisiones[casoId];
    if (modo === "servidor") {
      escribir("DELETE", "/api/decision/" + encodeURIComponent(casoId));
    } else guardarLocal();
  }

  function fijarPolitica(p) {
    depu.politica = p;
    anotarDep("Política masiva: " + p.accion + " · " + p.alcance + " · " + p.criterio);
    if (modo === "servidor") escribir("PUT", "/api/depuracion/politica", p);
    else guardarLocal();
  }
  function quitarPolitica() {
    depu.politica = null;
    anotarDep("Se quitó la política masiva");
    if (modo === "servidor") escribir("DELETE", "/api/depuracion/politica");
    else guardarLocal();
  }
  function decidirMaterial(codigo, accion, motivo, textoHistorial) {
    if (accion === null) delete depu.materiales[codigo];
    else depu.materiales[codigo] = { accion: accion, motivo: motivo || "",
                                     quien: revisor() || "(sin identificar)",
                                     cuando: new Date().toISOString() };
    anotarDep(textoHistorial);
    if (modo === "servidor") {
      escribir("PUT", "/api/depuracion/material",
               { codigo: codigo, accion: accion, motivo: motivo || "" });
    } else guardarLocal();
  }
  function fijarMaestro(m) {
    depu.maestro = m;
    var nPre = m.precios ? Object.keys(m.precios).length : 0;
    anotarDep(m.precios === null ? "Se quitaron los importes de última compra"
      : nPre ? "Se importó «" + m.nombre + "»: " + nPre +
               " materiales con importe de última compra"
      : "Se importó el maestro «" + m.nombre + "»: " + m.total +
        " filas leídas, " + m.filas.length + " materiales sin stock");
    if (modo === "servidor") {
      escribir("PUT", "/api/maestro",
               { nombre: m.nombre, total: m.total, filas: m.filas, precios: m.precios });
    } else guardarLocal();
  }
  function quitarMaestro() {
    depu.maestro = null;
    anotarDep("Se quitó el maestro importado");
    if (modo === "servidor") escribir("DELETE", "/api/maestro");
    else guardarLocal();
  }
  /* El historial local es sólo para mostrar: el que vale, en modo servidor, es
     el que escribe la base dentro de la misma transacción que el cambio. */
  function anotarDep(que) {
    if (!que) return;
    depu.historial = depu.historial || [];
    depu.historial.push({ cuando: new Date().toISOString(),
                          quien: revisor() || "(sin identificar)", que: que });
  }

  /* Vuelve a traer todo del servidor. Lo usa el refresco automático y el
     botón de actualizar. */
  function recargar() {
    if (modo !== "servidor") return Promise.resolve();
    return pedir("GET", "/api/estado").then(function (d) {
      decisiones = d.decisiones || {};
      depu = d.depuracion || depu;
      if (!depu.materiales) depu.materiales = {};
      if (!depu.historial) depu.historial = [];
      marca = d.marca || marca;
      avisar();
    });
  }

  /* Trabajar entre varias personas sin ver lo que hacen las demás es la
     mitad del problema que esto vino a resolver. Cada tanto se pregunta si
     hubo cambios —una consulta barata, no el estado entero— y recién si los
     hubo se trae todo.

     No se pregunta mientras hay escrituras propias en vuelo, para no traerse
     un estado viejo justo antes de que entre el propio. */
  var VIGILA_MS = 20000;
  function vigilar() {
    setInterval(function () {
      if (modo !== "servidor") return;
      if (document.hidden) return;             // pestaña en segundo plano: no molesta
      if (enVuelo || cola.length) return;
      fetch("/api/cambios?desde=" + encodeURIComponent(marca),
            { headers: { "x-invsap": "1" }, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.hay) return;
          return recargar().then(function () {
            if (alLlegarCambios) alLlegarCambios();
          });
        })
        .catch(function () { /* una consulta perdida no es noticia: se reintenta sola */ });
    }, VIGILA_MS);
  }
  function cuandoLleguenCambios(fn) { alLlegarCambios = fn; }

  return {
    iniciar: iniciar, estado: estado, alCambiar: alCambiar,
    soloConsulta: function () { return modo === "consulta"; },
    modo: function () { return modo; }, usuario: function () { return usuario; },
    todas: todas, depuracion: depuracion, revisor: revisor, fijarRevisor: fijarRevisor,
    decidir: decidir, olvidar: olvidar, recargar: recargar,
    cuandoLleguenCambios: cuandoLleguenCambios, limpiarConflictos: limpiarConflictos,
    fijarPolitica: fijarPolitica, quitarPolitica: quitarPolitica,
    decidirMaterial: decidirMaterial, fijarMaestro: fijarMaestro, quitarMaestro: quitarMaestro,
  };
})();
