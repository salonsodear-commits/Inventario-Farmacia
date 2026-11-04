/* Servidor del sistema de gestión · inventario físico vs SAP.

   Sin dependencias: node:http, node:sqlite y node:crypto vienen con Node. En un
   entorno corporativo eso importa, porque instalar paquetes suele ser un
   trámite aparte.

   Qué hace:
     · sirve la aplicación (la carpeta sistema/),
     · exige ingresar con una cuenta @emergencias.com.ar vía Entra ID,
     · guarda las decisiones en SQLite, firmadas con la identidad real de
       quien entró, no con un nombre escrito a mano.

   Arrancarlo:  node servidor/servidor.js
   La configuración sale del entorno; ver servidor/README.md. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Base } = require("./db.js");
const { Entra, ErrorIngreso } = require("./entra.js");
const { Registro, Respaldo } = require("./operacion.js");

const RAIZ = path.resolve(__dirname, "..");
const SISTEMA = path.join(RAIZ, "sistema");
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")).version; }
  catch (e) { return "desconocida"; }
})();
const ARRANQUE = new Date();

// ------------------------------------------------------------- configuración
const cfg = {
  // En un hosting gestionado (Azure App Service, Fly, Render) el puerto lo
  // asigna la plataforma y llega en PORT; escuchar en otro deja la aplicación
  // andando pero inalcanzable.
  /* 8673 y no 8080 a propósito. El 8080 es el puerto más usado del mundo para
     desarrollo: la probabilidad de encontrarlo ocupado por otra cosa en la
     máquina de cualquiera es alta, y hay un problema peor que el choque. Si lo
     que estaba antes en localhost:8080 respondió alguna vez un redirect 301,
     el navegador lo cachea de forma permanente para ese origen, y entonces ni
     siquiera consulta a esta aplicación: redirige al sitio viejo. Un puerto
     poco común evita las dos cosas. */
  puerto: Number(process.env.INVSAP_PUERTO || process.env.PORT || 8673),
  puertoFijo: !!(process.env.INVSAP_PUERTO || process.env.PORT),
  abrirNavegador: (process.env.INVSAP_ABRIR || "").toLowerCase() === "si",
  host: process.env.INVSAP_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
  base: process.env.INVSAP_DB || path.join(RAIZ, "datos", "inventario.db"),
  horasSesion: Number(process.env.INVSAP_HORAS_SESION || 10),
  dominio: process.env.INVSAP_DOMINIO || "emergencias.com.ar",
  auth: (process.env.INVSAP_AUTH || "on").toLowerCase(),
  registro: process.env.INVSAP_LOG || "",
  respaldos: process.env.INVSAP_RESPALDOS || path.join(RAIZ, "datos", "respaldos"),
  respaldosCuantos: Number(process.env.INVSAP_RESPALDOS_CUANTOS || 14),
  respaldoHora: Number(process.env.INVSAP_RESPALDO_HORA || 3),
  entra: {
    tenantId: process.env.INVSAP_TENANT_ID || "",
    clientId: process.env.INVSAP_CLIENT_ID || "",
    clientSecret: process.env.INVSAP_CLIENT_SECRET || "",
    redirectUri: process.env.INVSAP_REDIRECT_URI || "",
  },
};
/* La cookie de sesión tiene que ir marcada Secure cuando la conexión del
   usuario es HTTPS. Detrás de un proxy —que es lo normal en cualquier
   hosting— el servidor ve HTTP aunque el usuario esté en HTTPS, así que no
   alcanza con mirar la conexión: se mira la URI registrada, que es la que el
   usuario realmente usa. */
const SEGURA = (process.env.INVSAP_COOKIE_SEGURA || "").toLowerCase() === "si" ||
               /^https:/i.test(cfg.entra.redirectUri);

const reg = new Registro(cfg.registro);
function salirCon(msg) { console.error("\n  " + msg + "\n"); process.exit(1); }

if (cfg.auth === "on") {
  const faltan = Object.entries(cfg.entra).filter(([, v]) => !v).map(([k]) => k);
  if (faltan.length) {
    salirCon(
      "Falta configurar Entra ID. Variables sin definir: " + faltan.join(", ") +
      "\n  Ver servidor/README.md. Para probar sin autenticación en tu propia" +
      "\n  máquina: INVSAP_AUTH=off node servidor/servidor.js");
  }
} else {
  // Sin autenticación cualquiera que llegue al puerto entra. Sólo se admite
  // contra la máquina propia, y nunca en silencio.
  if (!["127.0.0.1", "localhost", "::1"].includes(cfg.host)) {
    salirCon("INVSAP_AUTH=off sólo se admite escuchando en 127.0.0.1. " +
             "Es un modo de desarrollo, no de uso.");
  }
}

const db = new Base(cfg.base);
const respaldo = new Respaldo(db.db, cfg.respaldos, cfg.respaldosCuantos, reg)
  .programar(cfg.respaldoHora);
const entra = cfg.auth === "on" ? new Entra({ ...cfg.entra, dominio: cfg.dominio }) : null;
/* En desarrollo se puede dar un nombre para simular personas distintas:
   dos servidores con INVSAP_DEV_USUARIO distinto, puertos distintos y la MISMA
   INVSAP_DB alcanzan para probar el trabajo entre varios. Sólo aplica con
   INVSAP_AUTH=off, que ya exige escuchar en localhost. */
const DEV_NOMBRE = process.env.INVSAP_DEV_USUARIO || "Modo desarrollo";
const USUARIO_DEV = {
  oid: "dev-" + DEV_NOMBRE.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  upn: DEV_NOMBRE.toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@" + cfg.dominio,
  nombre: DEV_NOMBRE, email: null };
if (cfg.auth !== "on") db.registrarUsuario(USUARIO_DEV);

// ------------------------------------------------------------- utilidades
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || "").split(";")) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function ponerCookie(res, nombre, valor, segundos) {
  const t = [`${nombre}=${encodeURIComponent(valor)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (SEGURA) t.push("Secure");
  t.push(segundos === 0 ? "Max-Age=0" : `Max-Age=${segundos}`);
  const ya = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", (ya ? [].concat(ya) : []).concat(t.join("; ")));
}
function json(res, codigo, cuerpo) {
  const b = Buffer.from(JSON.stringify(cuerpo), "utf8");
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8",
                          "content-length": b.length, "cache-control": "no-store" });
  res.end(b);
}
function texto(res, codigo, cuerpo, tipo) {
  const b = Buffer.from(cuerpo, "utf8");
  res.writeHead(codigo, { "content-type": tipo || "text/html; charset=utf-8",
                          "content-length": b.length, "cache-control": "no-store" });
  res.end(b);
}
function leerCuerpo(req, maxBytes) {
  return new Promise((ok, mal) => {
    const trozos = []; let n = 0;
    req.on("data", c => {
      n += c.length;
      if (n > maxBytes) { mal(new Error("El cuerpo del pedido es demasiado grande.")); req.destroy(); return; }
      trozos.push(c);
    });
    req.on("end", () => {
      if (!trozos.length) return ok({});
      try { ok(JSON.parse(Buffer.concat(trozos).toString("utf8"))); }
      catch (e) { mal(new Error("El cuerpo del pedido no es JSON válido.")); }
    });
    req.on("error", mal);
  });
}
function ip(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
         req.socket.remoteAddress || null;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ------------------------------------------------------------- pantallas
function paginaIngreso(aviso) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingresar · Inventario físico vs SAP</title>
<style>
:root{color-scheme:light;--bg:#f5f5f3;--sup:#fff;--tinta:#13120f;--tinta2:#55534d;
  --tinta3:#8b8980;--linea:#e6e5e0;--acento:#1F4E78;--alerta:#b8431f;--cC-f:#fdeee7;--cC:#eb6834}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#101010;--sup:#1a1a19;
  --tinta:#f3f2ef;--tinta2:#c3c2b7;--tinta3:#8c8b82;--linea:#32312c;--acento:#8ab4e8;
  --alerta:#f08359;--cC-f:#331f0f;--cC:#d95926}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);
  color:var(--tinta);padding:24px;
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.caja{background:var(--sup);border:1px solid var(--linea);border-radius:16px;
  padding:38px 40px;max-width:520px;width:100%;box-shadow:0 1px 3px rgba(20,18,12,.06),
  0 12px 34px -16px rgba(20,18,12,.2)}
h1{font-size:23px;letter-spacing:-.02em;margin:0 0 6px}
.sub{color:var(--tinta2);font-size:14.5px;margin:0 0 26px}
.btn{display:flex;gap:11px;align-items:center;justify-content:center;width:100%;
  background:var(--acento);color:#fff;border:0;border-radius:10px;padding:14px 18px;
  font-size:15px;font-weight:650;cursor:pointer;text-decoration:none}
.btn:hover{filter:brightness(1.1)}
.nota{font-size:12.5px;color:var(--tinta3);margin-top:22px;line-height:1.6}
.nota b{color:var(--tinta2)}
.aviso{background:var(--cC-f);border:1px solid var(--cC);border-radius:10px;
  padding:13px 15px;font-size:13.5px;color:var(--alerta);margin-bottom:22px;line-height:1.55}
svg{flex:none}
</style></head><body>
<div class="caja">
  <h1>Inventario físico vs SAP</h1>
  <p class="sub">San Juan · Neuquén · Salta — gestión de identificación y cursos de acción</p>
  ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ""}
  <a class="btn" href="/auth/ingresar">
    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f25022" d="M0 0h11v11H0z"/><path fill="#7fba00" d="M12 0h11v11H12z"/>
      <path fill="#00a4ef" d="M0 12h11v11H0z"/><path fill="#ffb900" d="M12 12h11v11H12z"/>
    </svg>
    Ingresar con mi cuenta de Emergencias
  </a>
  <p class="nota">Se ingresa con la cuenta corporativa <b>@${esc(cfg.dominio)}</b>.
  Las decisiones quedan firmadas con tu nombre real, así que el registro de quién
  decidió qué es confiable. El sistema <b>no modifica SAP</b>.</p>
</div></body></html>`;
}

// ------------------------------------------------------------- API
function usuarioDe(req) {
  if (cfg.auth !== "on") return USUARIO_DEV;
  const s = db.sesion(cookies(req).invsap_sesion);
  return s ? { oid: s.oid, upn: s.upn, nombre: s.nombre, email: s.email } : null;
}

/* Las mutaciones exigen una cabecera propia. Un formulario de otro sitio puede
   mandar un POST, pero no puede poner cabeceras sin pasar por un preflight CORS
   que este servidor no responde. Junto con SameSite=Lax alcanza. */
function pedidoPropio(req) { return req.headers["x-invsap"] === "1"; }

async function api(req, res, url, usuario) {
  const r = url.pathname.slice(5);           // saco "/api/"

  if (req.method === "GET" && r === "estado") {
    return json(res, 200, {
      usuario: { nombre: usuario.nombre, upn: usuario.upn, oid: usuario.oid },
      modo: cfg.auth === "on" ? "entra" : "desarrollo",
      marca: db.marcaDeCambio(),
      ...db.estado(),
    });
  }
  if (req.method === "GET" && r === "salud") {
    return json(res, 200, {
      ok: true, version: VERSION, modo: cfg.auth,
      desde: ARRANQUE.toISOString(),
      segundos_activa: Math.round((Date.now() - ARRANQUE) / 1000),
      ultimo_respaldo: respaldo.ultimo(),
      ...db.resumen(),
    });
  }
  /* «¿Decidió algo alguien más?», en una consulta barata. El navegador
     pregunta esto cada tanto en lugar de traerse todo el estado. */
  if (req.method === "GET" && r === "cambios") {
    const marca = db.marcaDeCambio();
    return json(res, 200, { marca: marca, hay: marca > (url.searchParams.get("desde") || "") });
  }

  if (req.method !== "GET" && !pedidoPropio(req)) {
    return json(res, 400, { error: "Pedido sin la cabecera X-Invsap." });
  }

  if (req.method === "POST" && r === "decision") {
    const b = await leerCuerpo(req, 1 << 20);
    if (!b.casoId || !b.cambios) return json(res, 400, { error: "Falta casoId o cambios." });
    /* Si otra persona decidió este mismo caso mientras éste lo tenía abierto,
       se guarda igual —nada se pierde, el historial guarda las dos— pero se
       avisa. Pisar en silencio el trabajo de otro sería lo peor de los dos
       mundos: ni se entera quien pisó ni quien fue pisado. */
    const previo = db.db.prepare(
      "SELECT version, revisor, usuario FROM decision WHERE caso_id = ?").get(b.casoId);
    const conflicto = !!(previo && b.versionConocida !== undefined &&
                         previo.version > b.versionConocida &&
                         previo.usuario !== usuario.oid);
    const d = db.guardarDecision(b.casoId, b.cambios, b.descripcion || "(sin descripción)", usuario);
    return json(res, 200, { ok: true, version: d.version, actualizado: d.actualizado,
                            marca: db.marcaDeCambio(), conflicto: conflicto,
                            conflictoCon: conflicto ? previo.revisor : undefined });
  }

  /* Los lotes deciden cientos de casos de una vez: van en un solo pedido y en
     una sola transacción, para que no queden a medias si se corta la red. */
  if (req.method === "POST" && r === "decision/lote") {
    const b = await leerCuerpo(req, 8 << 20);
    if (!Array.isArray(b.items) || !b.items.length) {
      return json(res, 400, { error: "El lote vino vacío." });
    }
    if (b.items.length > 5000) return json(res, 400, { error: "El lote es demasiado grande." });
    db.db.exec("BEGIN IMMEDIATE");
    try {
      for (const it of b.items) {
        db.guardarDecisionEnTransaccion(it.casoId, it.cambios,
          it.descripcion || b.descripcion || "(sin descripción)", usuario);
      }
      db.db.exec("COMMIT");
    } catch (e) { db.db.exec("ROLLBACK"); throw e; }
    return json(res, 200, { ok: true, guardados: b.items.length, marca: db.marcaDeCambio() });
  }

  if (req.method === "DELETE" && r.startsWith("decision/")) {
    db.borrarDecision(decodeURIComponent(r.slice(9)), usuario);
    return json(res, 200, { ok: true });
  }

  if (r === "depuracion/politica") {
    if (req.method === "PUT") {
      const b = await leerCuerpo(req, 1 << 20);
      if (!b.accion || !b.criterio) {
        return json(res, 400, { error: "La política necesita acción y criterio." });
      }
      db.guardarPolitica(b, usuario);
      return json(res, 200, { ok: true });
    }
    if (req.method === "DELETE") { db.quitarPolitica(usuario); return json(res, 200, { ok: true }); }
  }

  if (req.method === "PUT" && r === "depuracion/material") {
    const b = await leerCuerpo(req, 1 << 20);
    if (!b.codigo) return json(res, 400, { error: "Falta el código de material." });
    db.decidirMaterial(b.codigo, b.accion ?? null, b.motivo || "", usuario);
    return json(res, 200, { ok: true });
  }

  if (r === "maestro") {
    if (req.method === "PUT") {
      const b = await leerCuerpo(req, 25 << 20);
      if (!b.nombre || !Array.isArray(b.filas)) {
        return json(res, 400, { error: "Falta el nombre del archivo o las filas." });
      }
      db.guardarMaestro(b.nombre, Number(b.total) || b.filas.length, b.filas, usuario);
      return json(res, 200, { ok: true, materiales: b.filas.length });
    }
    if (req.method === "DELETE") { db.quitarMaestro(usuario); return json(res, 200, { ok: true }); }
  }

  return json(res, 404, { error: "No existe esa ruta de la API." });
}

// ------------------------------------------------------------- estáticos
function servirEstatico(res, rel) {
  const destino = path.join(SISTEMA, rel);
  // path.join resuelve ".." antes de llegar acá, así que se compara el
  // resultado: nada fuera de sistema/ se sirve.
  if (!destino.startsWith(SISTEMA + path.sep) && destino !== SISTEMA) {
    return texto(res, 403, "Prohibido.");
  }
  fs.readFile(destino, (e, buf) => {
    if (e) return texto(res, 404, "No encontrado.");
    res.writeHead(200, {
      "content-type": TIPOS[path.extname(destino).toLowerCase()] || "application/octet-stream",
      "content-length": buf.length,
      // datos.js son varios MB y no cambia entre pedidos de una misma sesión.
      "cache-control": rel === "datos.js" ? "private, max-age=3600" : "no-cache",
    });
    res.end(buf);
  });
}

// ------------------------------------------------------------- servidor
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  try {
    // ---- autenticación
    if (p === "/auth/ingresar") {
      if (cfg.auth !== "on") { res.writeHead(302, { location: "/" }); return res.end(); }
      res.writeHead(302, { location: entra.urlIngreso(url.searchParams.get("volver") || "/") });
      return res.end();
    }
    if (p === "/auth/callback") {
      if (cfg.auth !== "on") { res.writeHead(302, { location: "/" }); return res.end(); }
      try {
        const q = Object.fromEntries(url.searchParams);
        const { usuario, volverA } = await entra.procesarVuelta(q);
        db.registrarUsuario(usuario);
        const sid = crypto.randomBytes(32).toString("base64url");
        db.crearSesion(sid, usuario.oid, cfg.horasSesion, ip(req), req.headers["user-agent"]);
        db.anotarAcceso(usuario.oid, usuario.upn, "ingreso", null, ip(req));
        reg.info("ingreso", { usuario: usuario.upn, ip: ip(req) });
        ponerCookie(res, "invsap_sesion", sid, cfg.horasSesion * 3600);
        res.writeHead(302, { location: volverA.startsWith("/") ? volverA : "/" });
        return res.end();
      } catch (e) {
        if (e instanceof ErrorIngreso) {
          db.anotarAcceso(null, null, "rechazo", e.message, ip(req));
          reg.aviso("ingreso_rechazado", { motivo: e.message, ip: ip(req) });
          return texto(res, 403, paginaIngreso(e.message));
        }
        throw e;
      }
    }
    if (p === "/auth/salir") {
      const c = cookies(req).invsap_sesion;
      const s = db.sesion(c);
      if (s) db.anotarAcceso(s.oid, s.upn, "salida", null, ip(req));
      if (c) db.borrarSesion(c);
      ponerCookie(res, "invsap_sesion", "", 0);
      // url.protocol es el de la conexión al proxy, no el del usuario. El
      // esquema real llega en X-Forwarded-Proto.
      const esquema = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
                      (SEGURA ? "https" : "http");
      const volver = `${esquema}://${url.host}/`;
      res.writeHead(302, {
        location: cfg.auth === "on" ? entra.urlSalida(volver) : "/" });
      return res.end();
    }

    // ---- todo lo demás necesita sesión
    const usuario = usuarioDe(req);
    if (!usuario) {
      if (p.startsWith("/api/")) return json(res, 401, { error: "Sesión vencida o inexistente." });
      return texto(res, 200, paginaIngreso(null));
    }

    if (p.startsWith("/api/") && req.method !== "GET") {
      reg.info("api", { metodo: req.method, ruta: p, usuario: usuario.upn });
    }
    if (p.startsWith("/api/")) return await api(req, res, url, usuario);
    if (p === "/" || p === "/index.html") return servirEstatico(res, "index.html");
    if (/^\/[A-Za-z0-9._-]+$/.test(p)) return servirEstatico(res, p.slice(1));
    return texto(res, 404, "No encontrado.");
  } catch (e) {
    reg.error("pedido_fallido", { metodo: req.method, ruta: p, motivo: e.message });
    if (p.startsWith("/api/")) return json(res, 500, { error: e.message });
    return texto(res, 500, "Error del servidor.");
  }
});

setInterval(() => db.limpiarSesiones(), 15 * 60e3).unref();

/* Abrir el navegador es cosa del servidor, no de quien lo lanza: es el único
   que sabe cuándo está realmente escuchando y en qué puerto terminó. El
   lanzador que abría el navegador a los pocos segundos, a ciegas, mandaba a
   la gente a lo que hubiera en ese puerto, que podía ser cualquier cosa. */
function abrirEnNavegador(url) {
  const { spawn } = require("node:child_process");
  const [cmd, args] = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); }
  catch (e) { reg.aviso("no_se_pudo_abrir_navegador", { motivo: e.message }); }
}

function anunciar() {
  const u = `http://${cfg.host === "0.0.0.0" ? "localhost" : cfg.host}:${cfg.puerto}/`;
  console.log(`\n  Sistema de gestión · inventario físico vs SAP  v${VERSION}`);
  console.log(`  ${u}`);
  console.log(`  base de datos: ${cfg.base}`);
  console.log(`  respaldos: ${cfg.respaldos} (uno por día, se guardan ${cfg.respaldosCuantos})`);
  if (cfg.auth === "on") {
    console.log(`  ingreso: Entra ID · sólo cuentas @${cfg.dominio}`);
    console.log(`  redirect URI registrada: ${cfg.entra.redirectUri}`);
  } else {
    console.log(`\n  *** SIN AUTENTICACIÓN (INVSAP_AUTH=off) ***`);
    console.log(`  Modo de prueba. Las decisiones se firman como «${USUARIO_DEV.nombre}».`);
    console.log(`  No usar así con datos reales ni fuera de esta máquina.`);
  }
  console.log("");
  if (cfg.abrirNavegador) abrirEnNavegador(u);
}

/* Si el puerto está ocupado, en modo prueba se busca el siguiente libre: a
   quien quiere ver cómo funciona no le sirve un error de red. Si el puerto lo
   pidió alguien expresamente —o esto es un despliegue— no se cambia por las
   suyas: se dice qué pasó y se termina. */
let intentos = 0;
servidor.on("error", (e) => {
  if (e.code !== "EADDRINUSE") { reg.error("error_del_servidor", { motivo: e.message }); apagar(e.message, 1); return; }
  const ocupado = cfg.puerto;
  if (cfg.puertoFijo || cfg.auth === "on" || ++intentos > 20) {
    console.error(`\n  El puerto ${ocupado} ya está ocupado por otro programa.`);
    console.error(`  Probá con otro:  INVSAP_PUERTO=${ocupado + 1}\n`);
    reg.error("puerto_ocupado", { puerto: ocupado });
    apagar("puerto ocupado", 1);
    return;
  }
  cfg.puerto = ocupado + 1;
  console.log(`  El puerto ${ocupado} está ocupado; probando el ${cfg.puerto}…`);
  servidor.listen(cfg.puerto, cfg.host);
});
servidor.listen(cfg.puerto, cfg.host, anunciar);

/* Un error no capturado no puede dejar la base a medias ni el proceso colgado:
   se registra, se cierra ordenado y el supervisor —systemd o Docker— levanta
   de nuevo. */
function apagar(motivo, codigo) {
  reg.info("apagando", { motivo });
  try { servidor.close(); } catch (e) {}
  try { db.cerrar(); } catch (e) {}
  reg.cerrar();
  process.exit(codigo || 0);
}
process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("uncaughtException", e => {
  reg.error("error_no_capturado", { motivo: e.message, pila: (e.stack || "").split("\n")[1] });
  apagar("error no capturado", 1);
});
process.on("unhandledRejection", e => {
  reg.error("promesa_sin_capturar", { motivo: (e && e.message) || String(e) });
});
