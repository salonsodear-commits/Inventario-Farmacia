/* Lo que una aplicación necesita y un script corrido a mano no tiene:
   respaldo automático, registro de actividad y una forma de saber si está
   viva y qué versión está corriendo.

   Sin dependencias, como el resto. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

// ------------------------------------------------------------- registro
/* Una línea por evento, legible por una persona y parseable por una máquina.
   Va a la salida estándar para que systemd o Docker la recojan, y opcionalmente
   a un archivo cuando se corre sin ninguno de los dos. */
class Registro {
  constructor(archivo) {
    this.archivo = archivo || null;
    if (this.archivo) {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      this.fh = fs.createWriteStream(this.archivo, { flags: "a" });
    }
  }
  escribir(nivel, evento, datos) {
    const t = new Date().toISOString();
    const extra = datos && Object.keys(datos).length
      ? " " + Object.entries(datos)
          .map(([k, v]) => `${k}=${typeof v === "string" && v.includes(" ") ? JSON.stringify(v) : v}`)
          .join(" ")
      : "";
    const linea = `${t} ${nivel.padEnd(5)} ${evento}${extra}`;
    if (nivel === "ERROR") console.error(linea); else console.log(linea);
    if (this.fh) this.fh.write(linea + "\n");
  }
  info(evento, datos) { this.escribir("info", evento, datos); }
  aviso(evento, datos) { this.escribir("AVISO", evento, datos); }
  error(evento, datos) { this.escribir("ERROR", evento, datos); }
  cerrar() { if (this.fh) this.fh.end(); }
}

// ------------------------------------------------------------- respaldo
/* VACUUM INTO es la forma que SQLite soporta para copiar la base EN CALIENTE:
   con el servidor andando y en modo WAL, copiar el archivo con `cp` puede dejar
   una copia inconsistente, porque parte de los datos están en el -wal. Esto
   escribe un archivo nuevo, completo y ya compactado.

   Se guarda uno por día y se conservan los últimos N. */
class Respaldo {
  constructor(db, carpeta, cuantos, registro) {
    this.db = db;
    this.carpeta = carpeta;
    this.cuantos = cuantos;
    this.reg = registro;
  }
  hacer() {
    try {
      fs.mkdirSync(this.carpeta, { recursive: true });
      const dia = new Date().toISOString().slice(0, 10);
      const destino = path.join(this.carpeta, `inventario-${dia}.db`);
      // VACUUM INTO falla si el archivo ya existe, así que el del día se rehace.
      if (fs.existsSync(destino)) fs.unlinkSync(destino);
      this.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
      const tam = fs.statSync(destino).size;
      this.podar();
      this.reg.info("respaldo", { archivo: path.basename(destino), bytes: tam });
      return destino;
    } catch (e) {
      // Un respaldo que falla no puede voltear la aplicación, pero tampoco
      // puede pasar en silencio: alguien tiene que enterarse.
      this.reg.error("respaldo_fallido", { motivo: e.message });
      return null;
    }
  }
  podar() {
    const viejos = fs.readdirSync(this.carpeta)
      .filter(n => /^inventario-\d{4}-\d{2}-\d{2}\.db$/.test(n))
      .sort();
    while (viejos.length > this.cuantos) {
      const n = viejos.shift();
      try { fs.unlinkSync(path.join(this.carpeta, n)); this.reg.info("respaldo_borrado", { archivo: n }); }
      catch (e) { this.reg.aviso("respaldo_no_borrado", { archivo: n, motivo: e.message }); }
    }
  }
  /* Todos los días a la hora indicada, más uno al arrancar: si la aplicación
     se reinicia seguido y el respaldo sólo fuera a las 3, podría pasar días
     sin ninguno. El del arranque va con unos segundos de retraso para no
     demorar el momento en que el servidor empieza a responder. */
  programar(hora) {
    const proximo = () => {
      const ahora = new Date();
      const d = new Date(ahora);
      d.setHours(hora, 0, 0, 0);
      if (d <= ahora) d.setDate(d.getDate() + 1);
      return d - ahora;
    };
    const ciclo = () => {
      this.hacer();
      this.t = setTimeout(ciclo, proximo());
      this.t.unref();
    };
    setTimeout(() => this.hacer(), 3000).unref();
    this.t = setTimeout(ciclo, proximo());
    this.t.unref();
    return this;
  }
  ultimo() {
    try {
      const l = fs.readdirSync(this.carpeta)
        .filter(n => /^inventario-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();
      if (!l.length) return null;
      const n = l[l.length - 1];
      const s = fs.statSync(path.join(this.carpeta, n));
      return { archivo: n, bytes: s.size, cuando: s.mtime.toISOString() };
    } catch (e) { return null; }
  }
}

module.exports = { Registro, Respaldo };
