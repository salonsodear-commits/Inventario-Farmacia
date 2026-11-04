/* Ingreso con Microsoft Entra ID (ex Azure AD), sin dependencias.

   Flujo: Authorization Code + PKCE, con la aplicación registrada como
   confidencial (tiene secreto). El secreto vive sólo en el servidor: el
   navegador nunca lo ve, y nunca recibe un token de Microsoft. Lo único que
   le llega es una cookie de sesión de esta aplicación.

   Por qué PKCE además del secreto: es defensa en profundidad y lo recomienda
   Microsoft. Si el código de autorización se filtrara, sin el verifier no
   sirve.

   La firma del id_token SE VERIFICA contra las claves públicas del tenant
   (JWKS). Podría omitirse —el token llega por un canal directo servidor a
   servidor, por TLS y autenticado con el secreto— pero verificarla deja el
   módulo correcto en cualquier flujo y no cuesta casi nada. Si las claves no
   se pueden obtener, el ingreso FALLA: nunca se degrada a no verificar. */
"use strict";
const crypto = require("node:crypto");

const b64url = b => Buffer.from(b).toString("base64url");

/* Lo que se guarda entre el «ir a Microsoft» y el «volver de Microsoft».
   En memoria y con vencimiento corto: son segundos de vida. */
class Pendientes {
  constructor(segundos = 600) { this.m = new Map(); this.ttl = segundos * 1000; }
  poner(k, v) {
    this.limpiar();
    this.m.set(k, { v, vence: Date.now() + this.ttl });
  }
  sacar(k) {
    const e = this.m.get(k);
    this.m.delete(k);
    if (!e || e.vence < Date.now()) return null;
    return e.v;
  }
  limpiar() {
    const t = Date.now();
    for (const [k, e] of this.m) if (e.vence < t) this.m.delete(k);
  }
}

class Entra {
  /* cfg: { tenantId, clientId, clientSecret, redirectUri, dominio } */
  constructor(cfg) {
    this.cfg = cfg;
    this.base = `https://login.microsoftonline.com/${cfg.tenantId}`;
    this.pendientes = new Pendientes();
    this.jwks = { claves: null, vence: 0 };
  }

  // ---------------------------------------------------------------- ida
  /* Devuelve la URL a la que mandar el navegador. `volverA` es la vista de la
     aplicación a la que se vuelve después de entrar. */
  urlIngreso(volverA) {
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(64).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    this.pendientes.poner(state, { nonce, verifier, volverA: volverA || "/" });
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: "code",
      redirect_uri: this.cfg.redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state, nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      // Que Microsoft muestre el selector de cuenta: en una máquina compartida
      // entrar con la sesión de otro sería demasiado fácil.
      prompt: "select_account",
    });
    return `${this.base}/oauth2/v2.0/authorize?${q}`;
  }

  // ---------------------------------------------------------------- vuelta
  async procesarVuelta(query) {
    if (query.error) {
      throw new ErrorIngreso(
        `Microsoft rechazó el ingreso: ${query.error_description || query.error}`);
    }
    const { code, state } = query;
    if (!code || !state) throw new ErrorIngreso("La respuesta de Microsoft vino incompleta.");
    const p = this.pendientes.sacar(state);
    if (!p) {
      throw new ErrorIngreso(
        "El ingreso venció o ya se usó. Volvé a intentarlo desde la pantalla de inicio.");
    }

    const r = await fetch(`${this.base}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
        code_verifier: p.verifier,
        scope: "openid profile email",
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) {
      throw new ErrorIngreso(
        `No se pudo canjear el código: ${tok.error_description || tok.error || r.status}`);
    }

    const claims = await this.verificarIdToken(tok.id_token, p.nonce);
    const usuario = this.usuarioDeClaims(claims);
    this.verificarDominio(usuario);
    return { usuario, volverA: p.volverA };
  }

  // ---------------------------------------------------------------- token
  async verificarIdToken(jwt, nonceEsperado) {
    const partes = jwt.split(".");
    if (partes.length !== 3) throw new ErrorIngreso("El token recibido no es un JWT.");
    const cab = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));

    // --- firma
    const clave = await this.clavePublica(cab.kid);
    if (!clave) throw new ErrorIngreso("No se encontró la clave pública que firmó el token.");
    const algoritmo = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512" }[cab.alg];
    if (!algoritmo) throw new ErrorIngreso(`Algoritmo de firma no admitido: ${cab.alg}`);
    const ok = crypto.verify(algoritmo, Buffer.from(`${partes[0]}.${partes[1]}`),
                             clave, Buffer.from(partes[2], "base64url"));
    if (!ok) throw new ErrorIngreso("La firma del token no es válida.");

    // --- contenido
    const seg = Math.floor(Date.now() / 1000);
    const esperado = `https://login.microsoftonline.com/${claims.tid}/v2.0`;
    if (claims.iss !== esperado) throw new ErrorIngreso("El emisor del token no es el esperado.");
    if (claims.tid !== this.cfg.tenantId) {
      throw new ErrorIngreso("El token viene de otra organización.");
    }
    if (claims.aud !== this.cfg.clientId) {
      throw new ErrorIngreso("El token no fue emitido para esta aplicación.");
    }
    if (claims.nonce !== nonceEsperado) {
      throw new ErrorIngreso("El token no corresponde a este intento de ingreso.");
    }
    if (typeof claims.exp !== "number" || claims.exp < seg) {
      throw new ErrorIngreso("El token está vencido.");
    }
    if (typeof claims.nbf === "number" && claims.nbf > seg + 300) {
      throw new ErrorIngreso("El token todavía no es válido.");
    }
    return claims;
  }

  async clavePublica(kid) {
    if (!this.jwks.claves || this.jwks.vence < Date.now()) {
      const r = await fetch(`${this.base}/discovery/v2.0/keys`);
      if (!r.ok) throw new ErrorIngreso("No se pudieron obtener las claves públicas de Microsoft.");
      const j = await r.json();
      this.jwks = { claves: j.keys || [], vence: Date.now() + 6 * 3600e3 };
    }
    const jwk = this.jwks.claves.find(k => k.kid === kid);
    if (!jwk) {
      // Puede ser una clave nueva: se refresca una vez y se vuelve a buscar.
      this.jwks.vence = 0;
      const r = await fetch(`${this.base}/discovery/v2.0/keys`);
      if (!r.ok) return null;
      const j = await r.json();
      this.jwks = { claves: j.keys || [], vence: Date.now() + 6 * 3600e3 };
      const otra = this.jwks.claves.find(k => k.kid === kid);
      if (!otra) return null;
      return crypto.createPublicKey({ key: otra, format: "jwk" });
    }
    return crypto.createPublicKey({ key: jwk, format: "jwk" });
  }

  // ---------------------------------------------------------------- usuario
  usuarioDeClaims(c) {
    return {
      oid: c.oid || c.sub,
      upn: (c.preferred_username || c.upn || c.email || "").toLowerCase(),
      nombre: c.name || c.preferred_username || "(sin nombre)",
      email: (c.email || "").toLowerCase() || null,
    };
  }

  /* El registro «Solo inquilino único» ya deja afuera a otras organizaciones,
     pero no alcanza: un tenant puede tener varios dominios verificados y, sobre
     todo, usuarios INVITADOS de afuera. Un invitado es del tenant y no es de la
     empresa. Por eso se exige además el dominio y se rechaza explícitamente a
     los invitados, que en Entra llevan #EXT# en el nombre de usuario. */
  verificarDominio(u) {
    const d = this.cfg.dominio.toLowerCase();
    if (!u.upn) throw new ErrorIngreso("La cuenta no informa nombre de usuario.");
    if (u.upn.includes("#ext#")) {
      throw new ErrorIngreso(
        `Esa es una cuenta invitada. El sistema es sólo para cuentas @${d}.`);
    }
    if (!u.upn.endsWith("@" + d)) {
      throw new ErrorIngreso(
        `La cuenta ${u.upn} no es del dominio @${d}. El sistema es sólo para cuentas @${d}.`);
    }
  }

  urlSalida(volverA) {
    const q = new URLSearchParams({ post_logout_redirect_uri: volverA });
    return `${this.base}/oauth2/v2.0/logout?${q}`;
  }
}

class ErrorIngreso extends Error {}

module.exports = { Entra, ErrorIngreso, b64url };
