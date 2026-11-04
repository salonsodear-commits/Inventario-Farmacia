# Servidor · base de datos e ingreso con la cuenta de Emergencias

Hasta acá el sistema era un archivo HTML que se abría con doble clic y guardaba
las decisiones en el navegador de esa computadora. Eso alcanza para mirar, pero
no para trabajar entre varias personas: cada uno veía sólo lo suyo, el campo
«Revisor» era texto libre que cualquiera podía escribir, y un borrado de datos
del navegador se llevaba todo.

Este servidor cambia las dos cosas:

- las decisiones van a una **base SQLite compartida**;
- se entra con la **cuenta corporativa @emergencias.com.ar**, así que «quién
  decidió qué» deja de depender de lo que cada uno escriba.

**Sin dependencias.** Usa `node:http`, `node:sqlite` y `node:crypto`, que vienen
con Node. No hay `npm install`. Requiere **Node 22 o superior**.

---

## Lo primero: por qué hace falta un servidor

El archivo único **no puede** hacer login con Entra ID. Microsoft no admite
`file://` como dirección de retorno: exige `http://localhost` o `https://`. No
es una limitación de este sistema, es de cómo funciona OAuth.

Así que pedir login corporativo implica servir la aplicación. El archivo único
sigue funcionando como estaba, pero en modo local: sin login y guardando en el
navegador. El sistema detecta solo en cuál de los dos está y lo dice en la barra
de arriba.

---

## Registrar la aplicación en Azure

En el portal de Azure, **Microsoft Entra ID → Registros de aplicaciones → Nuevo
registro**. Esta es la pantalla «Registrar una aplicación»:

| Campo | Qué poner |
|---|---|
| **Nombre** | `Inventario físico vs SAP` |
| **Tipos de cuenta compatibles** | **Solo inquilino único: Emergencias** ← el valor que ya viene seleccionado |
| **URI de redirección · plataforma** | **Web** (no «SPA»: el secreto vive en el servidor, no en el navegador) |
| **URI de redirección · valor** | `http://localhost:8080/auth/callback` |

Y **Registrar**.

> **Por qué «Web» y no «SPA».** En SPA el navegador maneja los tokens. Acá no:
> el navegador nunca ve un token de Microsoft, sólo una cookie de sesión de esta
> aplicación. El secreto y los tokens quedan del lado del servidor, que es lo
> más seguro de los dos.

> **`http://localhost` está permitido.** Azure lo acepta como excepción para
> loopback, justamente para desarrollo. Para el servidor real hace falta
> `https://`.

### Después de registrar

**1. Anotar los dos identificadores.** En la pantalla «Información general» del
registro aparecen:

| En Azure | Variable |
|---|---|
| Id. de aplicación (cliente) | `INVSAP_CLIENT_ID` |
| Id. de directorio (inquilino) | `INVSAP_TENANT_ID` |

**2. Crear el secreto.** **Certificados y secretos → Secretos de cliente →
Nuevo secreto de cliente**. Descripción: `servidor inventario`. Vencimiento: el
que indique la política de la organización.

> Copiá el **Valor**, no el «Id. de secreto». El valor **se muestra una sola
> vez**: si se cierra la pantalla sin copiarlo, hay que generar otro.

Ese valor va en `INVSAP_CLIENT_SECRET`.

> **El secreto vence.** Anotá la fecha donde corresponda: el día que venza, nadie
> puede entrar hasta que se genere uno nuevo. Si la organización prefiere
> certificados en lugar de secretos, conviene coordinarlo con quien administra
> Entra antes de poner esto en producción.

**3. Permisos.** Con los predeterminados alcanza: `openid`, `profile`, `email`
y `User.Read` de Microsoft Graph, que Azure ya agrega al registrar. No hace
falta pedir nada más ni consentimiento de administrador.

**4. Para el servidor real**, en **Autenticación** agregar la URI de producción
junto a la de localhost:

```
https://inventario.emergencias.com.ar/auth/callback
```

La dirección tiene que terminar en `/auth/callback` y coincidir **exactamente**
con `INVSAP_REDIRECT_URI`: Azure compara carácter por carácter.

---

## Arrancarlo

```bash
export INVSAP_TENANT_ID="…"          # Id. de directorio (inquilino)
export INVSAP_CLIENT_ID="…"          # Id. de aplicación (cliente)
export INVSAP_CLIENT_SECRET="…"      # el Valor del secreto de cliente
export INVSAP_REDIRECT_URI="http://localhost:8080/auth/callback"

node servidor/servidor.js
```

Y abrir `http://localhost:8080/`.

### Todas las variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `INVSAP_TENANT_ID` | — | Id. de directorio (inquilino) |
| `INVSAP_CLIENT_ID` | — | Id. de aplicación (cliente) |
| `INVSAP_CLIENT_SECRET` | — | Valor del secreto de cliente |
| `INVSAP_REDIRECT_URI` | — | Tiene que coincidir exacto con la registrada en Azure |
| `INVSAP_DOMINIO` | `emergencias.com.ar` | Dominio admitido |
| `INVSAP_PUERTO` | `8080` | Puerto |
| `INVSAP_HOST` | `127.0.0.1` | `0.0.0.0` para aceptar desde la red |
| `INVSAP_DB` | `datos/inventario.db` | Archivo de la base |
| `INVSAP_HORAS_SESION` | `10` | Duración de la sesión |
| `INVSAP_COOKIE_SEGURA` | según la URI | `si` fuerza cookie `Secure` |
| `INVSAP_AUTH` | `on` | `off` desactiva el login (ver abajo) |

### Probar sin Azure

```bash
INVSAP_AUTH=off node servidor/servidor.js
```

Sirve para ver la persistencia funcionando antes de tener el registro listo.
**Cualquiera que llegue al puerto entra**, así que el servidor se niega a
arrancar así si no está escuchando en `127.0.0.1`, y las decisiones quedan
firmadas como «Modo desarrollo» para que no se confundan con reales.

---

## Quién puede entrar

Dos filtros, y los dos hacen falta:

1. **«Solo inquilino único»** en el registro de Azure deja afuera a otras
   organizaciones.
2. **El servidor verifica el dominio** de todas formas, porque lo anterior no
   alcanza: un inquilino puede tener varios dominios verificados y, sobre todo,
   **usuarios invitados** de afuera. Un invitado es del inquilino y no es de la
   empresa.

Por eso se exige que el nombre de usuario termine en `@emergencias.com.ar` y se
rechaza explícitamente a los invitados, que en Entra llevan `#EXT#`. Quien no
cumpla ve el motivo en pantalla y el intento queda anotado en la tabla `acceso`.

---

## Qué guarda la base

| Tabla | Qué hay |
|---|---|
| `usuario` | Quién entró alguna vez: identificador de Entra, nombre de usuario, nombre |
| `sesion` | Sesiones abiertas, con vencimiento |
| `decision` | Una fila por caso decidido: el estado actual |
| `decision_historial` | Todos los cambios, **sólo se agrega**: no se edita ni se borra |
| `depuracion_politica` | La política masiva vigente |
| `depuracion_material` | Las decisiones individuales y las excepciones, con su motivo |
| `depuracion_historial` | Historial de la depuración |
| `maestro` / `maestro_material` | El maestro completo, si se importó |
| `acceso` | Ingresos, salidas y rechazos |

**Lo que NO está en la base:** el análisis. Los 1.991 casos siguen viniendo de
`datos.js`, que es de sólo lectura y se regenera con `scripts/v3/dataset.py`.
Acá sólo viven las decisiones que se le aplican encima. Esa separación es la
que permite rehacer el análisis sin perder lo decidido.

### Respaldo

El archivo de la base es uno solo. Para copiarlo con el servidor andando, hay
que usar el comando de SQLite, no `cp`, porque en modo WAL hay escrituras en un
archivo aparte:

```bash
sqlite3 datos/inventario.db ".backup respaldo-$(date +%F).db"
```

Si no hay `sqlite3` instalado, parar el servidor y copiar los tres archivos
(`inventario.db`, `-wal` y `-shm`).

---

## Si se pone en un servidor de verdad

- **HTTPS obligatorio.** Sin TLS, la cookie de sesión viaja en claro. Lo normal
  es poner nginx o IIS adelante; en ese caso el servidor confía en
  `X-Forwarded-For` para registrar la dirección de origen.
- `INVSAP_HOST=0.0.0.0` para aceptar conexiones de la red.
- El secreto por variable de entorno o por el almacén de secretos que use la
  organización, **nunca** en un archivo del repositorio.
- La base en un disco con respaldo.
