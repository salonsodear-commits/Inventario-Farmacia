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

const RAIZ = path.resolve(__dirname, "..");
const SISTEMA = path.join(RAIZ, "sistema");

// ------------------------------------------------------------- configuración
const cfg = {
  puerto: Number(process.env.INVSAP_PUERTO || 8080),
  host: process.env.INVSAP_HOST || "127.0.0.1",
  base: process.env.INVSAP_DB || path.join(RAIZ, "datos", "inventario.db"),
  horasSesion: Number(process.env.INVSAP_HORAS_SESION || 10),
  dominio: process.env.INVSAP_DOMINIO || "emergencias.com.ar",
  auth: (process.env.INVSAP_AUTH || "on").toLowerCase(),
  entra: {
    tenantId: process.env.INVSAP_TENANT_ID || "",
    clientId: process.env.INVSAP_CLIENT_ID || "",
    clientSecret: process.env.INVSAP_CLIENT_SECRET || "",
    redirectUri: process.env.INVSAP_REDIRECT_URI || "",
  },
};
const SEGURA = (process.env.INVSAP_COOKIE_SEGURA || "").toLowerCase() === "si" ||
               /^https:/i.test(cfg.entra.redirectUri);

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
const entra = cfg.auth === "on" ? new Entra({ ...cfg.entra, dominio: cfg.dominio }) : null;
const USUARIO_DEV = { oid: "dev-local", upn: "dev@" + cfg.dominio, nombre: "Modo desarrollo",
                      email: null };
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
      ...db.estado(),
    });
  }
  if (req.method === "GET" && r === "salud") {
    return json(res, 200, { ok: true, modo: cfg.auth, ...db.resumen() });
  }

  if (req.method !== "GET" && !pedidoPropio(req)) {
    return json(res, 400, { error: "Pedido sin la cabecera X-Invsap." });
  }

  if (req.method === "POST" && r === "decision") {
    const b = await leerCuerpo(req, 1 << 20);
    if (!b.casoId || !b.cambios) return json(res, 400, { error: "Falta casoId o cambios." });
    const d = db.guardarDecision(b.casoId, b.cambios, b.descripcion || "(sin descripción)", usuario);
    return json(res, 200, { ok: true, version: d.version, actualizado: d.actualizado });
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
    return json(res, 200, { ok: true, guardados: b.items.length });
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
        ponerCookie(res, "invsap_sesion", sid, cfg.horasSesion * 3600);
        res.writeHead(302, { location: volverA.startsWith("/") ? volverA : "/" });
        return res.end();
      } catch (e) {
        if (e instanceof ErrorIngreso) {
          db.anotarAcceso(null, null, "rechazo", e.message, ip(req));
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
      const volver = `${url.protocol}//${url.host}/`;
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

    if (p.startsWith("/api/")) return await api(req, res, url, usuario);
    if (p === "/" || p === "/index.html") return servirEstatico(res, "index.html");
    if (/^\/[A-Za-z0-9._-]+$/.test(p)) return servirEstatico(res, p.slice(1));
    return texto(res, 404, "No encontrado.");
  } catch (e) {
    console.error("[error]", req.method, p, "·", e.message);
    if (p.startsWith("/api/")) return json(res, 500, { error: e.message });
    return texto(res, 500, "Error del servidor.");
  }
});

setInterval(() => db.limpiarSesiones(), 15 * 60e3).unref();

servidor.listen(cfg.puerto, cfg.host, () => {
  const u = `http://${cfg.host}:${cfg.puerto}/`;
  console.log(`\n  Sistema de gestión · inventario físico vs SAP`);
  console.log(`  ${u}`);
  console.log(`  base de datos: ${cfg.base}`);
  if (cfg.auth === "on") {
    console.log(`  ingreso: Entra ID · sólo cuentas @${cfg.dominio}`);
    console.log(`  redirect URI registrada: ${cfg.entra.redirectUri}`);
  } else {
    console.log(`\n  *** SIN AUTENTICACIÓN (INVSAP_AUTH=off) ***`);
    console.log(`  Modo de desarrollo. Las decisiones se firman como «Modo desarrollo».`);
    console.log(`  No usar así con datos reales ni fuera de esta máquina.`);
  }
  console.log("");
});

process.on("SIGINT", () => { db.cerrar(); process.exit(0); });
process.on("SIGTERM", () => { db.cerrar(); process.exit(0); });
