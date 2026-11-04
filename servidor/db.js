/* Persistencia en SQLite.
   Hasta acá las decisiones vivían en el localStorage del navegador: en esa
   computadora, sin compartir y sin respaldo. Con varias personas revisando las
   mismas bases eso no alcanza, y además el campo «Revisor» era texto libre que
   cada uno escribía a mano. Acá las decisiones pasan a una base compartida y
   quedan firmadas con la identidad real de quien entró.

   Sin dependencias: node:sqlite viene con Node. El dato del análisis (datos.js)
   sigue siendo de sólo lectura y no entra a la base: lo que se guarda son las
   DECISIONES que se le aplican encima.

   Dos reglas que el esquema hace cumplir:
     · el historial es append-only, no se edita ni se borra;
     · toda decisión guarda quién y cuándo, tomados de la sesión, nunca de algo
       que el navegador pueda escribir. */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const ESQUEMA = `
PRAGMA journal_mode = WAL;        -- lecturas concurrentes mientras alguien escribe
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS usuario (
  oid           TEXT PRIMARY KEY,          -- object id de Entra: estable, no cambia
  upn           TEXT NOT NULL,             -- usuario@emergencias.com.ar
  nombre        TEXT NOT NULL,
  email         TEXT,
  primer_acceso TEXT NOT NULL,
  ultimo_acceso TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesion (
  id         TEXT PRIMARY KEY,             -- aleatorio, 256 bits
  usuario    TEXT NOT NULL REFERENCES usuario(oid),
  creada     TEXT NOT NULL,
  vence      TEXT NOT NULL,
  ip         TEXT,
  agente     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sesion_usuario ON sesion(usuario);

/* Una fila por caso decidido. El análisis original nunca se pisa: esto es la
   capa de decisiones que se le aplica encima, igual que antes. */
CREATE TABLE IF NOT EXISTS decision (
  caso_id                TEXT PRIMARY KEY,
  materiales             TEXT,             -- JSON: puede ser más de un código SAP
  nomenclatura_unificada TEXT,
  estado_revision        TEXT,
  aprobacion             TEXT,
  observaciones          TEXT,
  almacen_decision       TEXT,
  almacen_propuesto      TEXT,
  ruta_b                 TEXT,             -- la alternativa elegida en la clase B
  verificacion           TEXT,
  codigo_maestro         TEXT,
  riesgo_duplicado       TEXT,
  depuracion             TEXT,
  reclasificado          TEXT,
  material_corregido     TEXT,
  version                INTEGER NOT NULL DEFAULT 1,   -- para detectar ediciones cruzadas
  usuario                TEXT NOT NULL REFERENCES usuario(oid),
  revisor                TEXT NOT NULL,    -- nombre mostrado al momento de decidir
  actualizado            TEXT NOT NULL
);

/* Append-only: nunca se edita ni se borra una fila de acá. */
CREATE TABLE IF NOT EXISTS decision_historial (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id   TEXT NOT NULL,
  que       TEXT NOT NULL,
  antes     TEXT,
  despues   TEXT,
  usuario   TEXT NOT NULL REFERENCES usuario(oid),
  revisor   TEXT NOT NULL,
  cuando    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hist_caso ON decision_historial(caso_id);

/* Depuración del maestro. La política masiva es una sola, vigente; las
   anteriores quedan en el historial. */
CREATE TABLE IF NOT EXISTS depuracion_politica (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  accion   TEXT NOT NULL,
  alcance  TEXT NOT NULL,
  criterio TEXT NOT NULL,
  usuario  TEXT NOT NULL REFERENCES usuario(oid),
  quien    TEXT NOT NULL,
  cuando   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS depuracion_material (
  codigo  TEXT PRIMARY KEY,
  accion  TEXT NOT NULL,
  motivo  TEXT,                            -- obligatorio cuando es excepción
  usuario TEXT NOT NULL REFERENCES usuario(oid),
  quien   TEXT NOT NULL,
  cuando  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS depuracion_historial (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  que     TEXT NOT NULL,
  usuario TEXT NOT NULL REFERENCES usuario(oid),
  quien   TEXT NOT NULL,
  cuando  TEXT NOT NULL
);

/* El maestro completo, cuando se consiga e importe. */
CREATE TABLE IF NOT EXISTS maestro (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  nombre  TEXT NOT NULL,
  total   INTEGER NOT NULL,
  usuario TEXT NOT NULL REFERENCES usuario(oid),
  quien   TEXT NOT NULL,
  cuando  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maestro_material (
  codigo TEXT PRIMARY KEY,
  texto  TEXT,
  tipo   TEXT
);

/* Quién entró y cuándo. Separado del historial de decisiones porque responde
   otra pregunta: no «qué se decidió» sino «quién tuvo acceso». */
CREATE TABLE IF NOT EXISTS acceso (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT REFERENCES usuario(oid),
  upn     TEXT,
  evento  TEXT NOT NULL,                   -- ingreso | salida | rechazo
  detalle TEXT,
  ip      TEXT,
  cuando  TEXT NOT NULL
);
`;

const CAMPOS = ["materiales", "nomenclatura_unificada", "estado_revision", "aprobacion",
  "observaciones", "almacen_decision", "almacen_propuesto", "ruta_b", "verificacion",
  "codigo_maestro", "riesgo_duplicado", "depuracion", "reclasificado", "material_corregido"];

function ahora() { return new Date().toISOString(); }

class Base {
  constructor(archivo) {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    this.db = new DatabaseSync(archivo);
    this.db.exec(ESQUEMA);
  }
  cerrar() { this.db.close(); }

  // ------------------------------------------------------------- usuarios
  registrarUsuario(u) {
    const t = ahora();
    this.db.prepare(`INSERT INTO usuario (oid, upn, nombre, email, primer_acceso, ultimo_acceso)
                     VALUES (?,?,?,?,?,?)
                     ON CONFLICT(oid) DO UPDATE SET
                       upn = excluded.upn, nombre = excluded.nombre,
                       email = excluded.email, ultimo_acceso = excluded.ultimo_acceso`)
      .run(u.oid, u.upn, u.nombre, u.email || null, t, t);
    return this.db.prepare("SELECT * FROM usuario WHERE oid = ?").get(u.oid);
  }
  anotarAcceso(oid, upn, evento, detalle, ip) {
    this.db.prepare(`INSERT INTO acceso (usuario, upn, evento, detalle, ip, cuando)
                     VALUES (?,?,?,?,?,?)`).run(oid, upn, evento, detalle || null, ip || null, ahora());
  }

  // ------------------------------------------------------------- sesiones
  crearSesion(id, oid, horas, ip, agente) {
    const v = new Date(Date.now() + horas * 3600e3).toISOString();
    this.db.prepare(`INSERT INTO sesion (id, usuario, creada, vence, ip, agente)
                     VALUES (?,?,?,?,?,?)`).run(id, oid, ahora(), v, ip || null, agente || null);
  }
  sesion(id) {
    if (!id) return null;
    const s = this.db.prepare(
      `SELECT s.id, s.vence, u.oid, u.upn, u.nombre, u.email
         FROM sesion s JOIN usuario u ON u.oid = s.usuario
        WHERE s.id = ?`).get(id);
    if (!s) return null;
    if (new Date(s.vence) < new Date()) { this.borrarSesion(id); return null; }
    return s;
  }
  borrarSesion(id) { this.db.prepare("DELETE FROM sesion WHERE id = ?").run(id); }
  limpiarSesiones() {
    this.db.prepare("DELETE FROM sesion WHERE vence < ?").run(ahora());
  }

  // ------------------------------------------------------------- decisiones
  /* Guarda una decisión y su entrada de historial en una sola transacción: o
     quedan las dos, o no queda ninguna. Un historial sin su decisión, o al
     revés, sería peor que no guardar nada. */
  guardarDecision(casoId, cambios, descripcion, usuario) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const d = this.guardarDecisionEnTransaccion(casoId, cambios, descripcion, usuario);
      this.db.exec("COMMIT");
      return d;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* El mismo guardado, pero sin abrir transacción: lo usa el lote, que mete
     cientos de decisiones bajo una sola. No llamar desde afuera sin una
     transacción abierta. */
  guardarDecisionEnTransaccion(casoId, cambios, descripcion, usuario) {
    const t = ahora();
    const previo = this.db.prepare("SELECT * FROM decision WHERE caso_id = ?").get(casoId);
    const antes = {}, despues = {};
    for (const k of Object.keys(cambios)) {
      if (!CAMPOS.includes(k)) continue;
      antes[k] = previo ? (previo[k] === undefined ? null : previo[k]) : null;
      despues[k] = cambios[k] === undefined ? null : cambios[k];
    }
    const fila = {};
    for (const c of CAMPOS) {
      fila[c] = c in cambios
        ? (cambios[c] === undefined ? null
           : (c === "materiales" && Array.isArray(cambios[c]) ? JSON.stringify(cambios[c]) : cambios[c]))
        : (previo ? previo[c] : null);
    }
    this.db.prepare(
        `INSERT INTO decision (caso_id, ${CAMPOS.join(", ")}, version, usuario, revisor, actualizado)
         VALUES (?, ${CAMPOS.map(() => "?").join(", ")}, 1, ?, ?, ?)
         ON CONFLICT(caso_id) DO UPDATE SET
           ${CAMPOS.map(c => `${c} = excluded.${c}`).join(", ")},
           version = decision.version + 1,
           usuario = excluded.usuario, revisor = excluded.revisor,
           actualizado = excluded.actualizado`)
        .run(casoId, ...CAMPOS.map(c => fila[c]), usuario.oid, usuario.nombre, t);
    this.db.prepare(
        `INSERT INTO decision_historial (caso_id, que, antes, despues, usuario, revisor, cuando)
         VALUES (?,?,?,?,?,?,?)`)
        .run(casoId, descripcion, JSON.stringify(antes), JSON.stringify(despues),
             usuario.oid, usuario.nombre, t);
    return this.db.prepare("SELECT * FROM decision WHERE caso_id = ?").get(casoId);
  }

  borrarDecision(casoId, usuario) {
    const t = ahora();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM decision WHERE caso_id = ?").run(casoId);
      this.db.prepare(
        `INSERT INTO decision_historial (caso_id, que, antes, despues, usuario, revisor, cuando)
         VALUES (?,?,?,?,?,?,?)`)
        .run(casoId, "Se descartaron las decisiones de esta ficha", null, null,
             usuario.oid, usuario.nombre, t);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /* Todas las decisiones, con su historial, en la forma que ya espera el
     front: así el navegador no tiene que aprender un formato nuevo. */
  decisiones() {
    const out = {};
    for (const d of this.db.prepare("SELECT * FROM decision").all()) {
      const o = { revisor: d.revisor, actualizado: d.actualizado, version: d.version,
                  historial: [] };
      for (const c of CAMPOS) {
        if (d[c] === null || d[c] === undefined) continue;
        o[c] = c === "materiales" ? JSON.parse(d[c]) : d[c];
      }
      out[d.caso_id] = o;
    }
    for (const h of this.db.prepare(
        "SELECT * FROM decision_historial ORDER BY id").all()) {
      if (!out[h.caso_id]) continue;
      out[h.caso_id].historial.push({
        cuando: h.cuando, quien: h.revisor, que: h.que,
        antes: h.antes ? JSON.parse(h.antes) : {},
        despues: h.despues ? JSON.parse(h.despues) : {},
      });
    }
    return out;
  }

  // ------------------------------------------------------------- depuración
  politica() {
    return this.db.prepare("SELECT * FROM depuracion_politica WHERE id = 1").get() || null;
  }
  guardarPolitica(p, usuario) {
    const t = ahora();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO depuracion_politica (id, accion, alcance, criterio, usuario, quien, cuando)
         VALUES (1,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET accion = excluded.accion, alcance = excluded.alcance,
           criterio = excluded.criterio, usuario = excluded.usuario,
           quien = excluded.quien, cuando = excluded.cuando`)
        .run(p.accion, p.alcance, p.criterio, usuario.oid, usuario.nombre, t);
      this.anotarDep(`Política masiva: ${p.accion} · ${p.alcance} · ${p.criterio}`, usuario, t);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  quitarPolitica(usuario) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM depuracion_politica WHERE id = 1").run();
      this.anotarDep("Se quitó la política masiva", usuario);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  materialesDep() {
    const out = {};
    for (const m of this.db.prepare("SELECT * FROM depuracion_material").all()) {
      out[m.codigo] = { accion: m.accion, motivo: m.motivo || "",
                        quien: m.quien, cuando: m.cuando };
    }
    return out;
  }
  decidirMaterial(codigo, accion, motivo, usuario) {
    const t = ahora();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (accion === null) {
        this.db.prepare("DELETE FROM depuracion_material WHERE codigo = ?").run(codigo);
        this.anotarDep(`El material ${codigo} vuelve a seguir la política masiva`, usuario, t);
      } else {
        this.db.prepare(
          `INSERT INTO depuracion_material (codigo, accion, motivo, usuario, quien, cuando)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(codigo) DO UPDATE SET accion = excluded.accion, motivo = excluded.motivo,
             usuario = excluded.usuario, quien = excluded.quien, cuando = excluded.cuando`)
          .run(codigo, accion, motivo || null, usuario.oid, usuario.nombre, t);
        this.anotarDep(`${motivo ? "Excepción · " : ""}${codigo} → ${accion}` +
                       (motivo ? ` · ${motivo}` : ""), usuario, t);
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  anotarDep(que, usuario, cuando) {
    this.db.prepare(
      `INSERT INTO depuracion_historial (que, usuario, quien, cuando) VALUES (?,?,?,?)`)
      .run(que, usuario.oid, usuario.nombre, cuando || ahora());
  }
  historialDep() {
    return this.db.prepare(
      "SELECT que, quien, cuando FROM depuracion_historial ORDER BY id").all();
  }

  // ------------------------------------------------------------- maestro
  maestro() {
    const m = this.db.prepare("SELECT * FROM maestro WHERE id = 1").get();
    if (!m) return null;
    const filas = this.db.prepare(
      "SELECT codigo, texto, tipo FROM maestro_material ORDER BY codigo").all();
    return { nombre: m.nombre, total: m.total, cuando: m.cuando, quien: m.quien, filas };
  }
  guardarMaestro(nombre, total, filas, usuario) {
    const t = ahora();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM maestro_material").run();
      const ins = this.db.prepare(
        "INSERT OR REPLACE INTO maestro_material (codigo, texto, tipo) VALUES (?,?,?)");
      for (const f of filas) ins.run(String(f.codigo), f.texto || null, f.tipo || null);
      this.db.prepare(
        `INSERT INTO maestro (id, nombre, total, usuario, quien, cuando) VALUES (1,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, total = excluded.total,
           usuario = excluded.usuario, quien = excluded.quien, cuando = excluded.cuando`)
        .run(nombre, total, usuario.oid, usuario.nombre, t);
      this.anotarDep(`Se importó el maestro «${nombre}»: ${total} filas leídas, ` +
                     `${filas.length} materiales sin stock`, usuario, t);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  quitarMaestro(usuario) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM maestro_material").run();
      this.db.prepare("DELETE FROM maestro WHERE id = 1").run();
      this.anotarDep("Se quitó el maestro importado", usuario);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  // ------------------------------------------------------------- estado
  /* Todo lo que el front necesita para arrancar, en una sola llamada. */
  estado() {
    return {
      decisiones: this.decisiones(),
      depuracion: {
        politica: (() => {
          const p = this.politica();
          return p ? { accion: p.accion, alcance: p.alcance, criterio: p.criterio,
                       quien: p.quien, cuando: p.cuando } : null;
        })(),
        materiales: this.materialesDep(),
        maestro: this.maestro(),
        historial: this.historialDep(),
      },
    };
  }
  resumen() {
    const n = s => this.db.prepare(s).get().n;
    return {
      decisiones: n("SELECT COUNT(*) n FROM decision"),
      historial: n("SELECT COUNT(*) n FROM decision_historial"),
      usuarios: n("SELECT COUNT(*) n FROM usuario"),
      materiales_depuracion: n("SELECT COUNT(*) n FROM depuracion_material"),
      sesiones_activas: n("SELECT COUNT(*) n FROM sesion WHERE vence > datetime('now')"),
    };
  }
}

module.exports = { Base, CAMPOS };
