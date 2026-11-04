# Inventario físico vs SAP · aplicación

Esto es la aplicación: se instala en un servidor, se entra con la cuenta
**@emergencias.com.ar** y las decisiones quedan en una base compartida.

**Requisito único: Node 22.5 o superior.** No hay `npm install`: la aplicación
no tiene dependencias, usa sólo lo que viene con Node.

```bash
node --version      # tiene que decir v22.5.0 o más
```

---

## 1. Probarla ahora mismo, sin Azure

Para ver que anda antes de pedir nada a nadie:

```bash
INVSAP_AUTH=off node servidor/servidor.js
```

y abrir **http://localhost:8673/**. Todo funciona y las decisiones se guardan,
pero **sin login**: por eso sólo acepta conexiones de la propia máquina y firma
todo como «Modo desarrollo». No sirve para usar en serio.

---

## 2. Registrar la aplicación en Azure

Lo tiene que hacer alguien con permisos sobre Entra ID. En
**Microsoft Entra ID → Registros de aplicaciones → Nuevo registro**:

| Campo | Qué poner |
|---|---|
| **Nombre** | `Inventario físico vs SAP` |
| **Tipos de cuenta compatibles** | **Solo inquilino único: Emergencias** |
| **Plataforma** | **Web** (no «SPA») |
| **URI de redirección** | `https://inventario.emergencias.com.ar/auth/callback` |

Después del registro hacen falta tres datos:

1. **Id. de aplicación (cliente)** — está en «Información general»
2. **Id. de directorio (inquilino)** — está en «Información general»
3. **Un secreto de cliente** — *Certificados y secretos → Nuevo secreto*.
   Copiar el **Valor**, no el Id. **Se muestra una sola vez.**

Los permisos que Azure agrega por defecto alcanzan. No hace falta consentimiento
de administrador.

> El detalle completo, con el porqué de cada opción, está en
> `servidor/README.md`.

---

## 3. Instalarla

### Linux con systemd (lo habitual)

```bash
sudo bash servidor/instalar/instalar.sh
sudo nano /etc/inventario.env       # completar con los tres datos de Azure
sudo systemctl start inventario
systemctl status inventario
```

Queda andando como servicio y arranca sola con la máquina.

### Docker

```bash
cp servidor/instalar/inventario.env.ejemplo .env     # y completarlo
docker compose -f servidor/instalar/compose.yaml up -d
```

---

## 4. Comprobar que quedó bien

```bash
curl -s -H 'x-invsap: 1' http://127.0.0.1:8673/api/salud
```

Tiene que devolver `"ok": true` con la versión y el último respaldo.

---

## Lo que conviene saber antes de ponerla en producción

- **HTTPS no es opcional.** Sin TLS la cookie de sesión viaja en claro. Lo
  normal es poner nginx o IIS adelante y dejar la aplicación escuchando en
  `127.0.0.1`.
- **El secreto de Azure vence.** Anotar la fecha: el día que venza, nadie puede
  entrar hasta que se genere uno nuevo.
- **La base se respalda sola** todos los días en `datos/respaldos`, y se
  conservan los últimos 14. Igual conviene que entre en el esquema de respaldo
  de la organización.
- **Quién puede entrar:** sólo cuentas `@emergencias.com.ar`. Los usuarios
  invitados quedan afuera aunque sean del inquilino, porque un invitado es del
  inquilino y no es de la empresa.

---

## Qué hay en cada carpeta

| | |
|---|---|
| `servidor/` | La aplicación: HTTP, base SQLite, ingreso con Entra ID |
| `servidor/instalar/` | Servicio systemd, Dockerfile, script de instalación |
| `sistema/` | Lo que se ve en el navegador, y `datos.js` con el análisis |
| `servidor/README.md` | Documentación completa |
| `LEEME - sistema de gestion.md` | Cómo se usa el sistema, para quien lo va a usar |

**`datos.js` es de sólo lectura.** Contiene el análisis de los 1.991 casos. Las
decisiones no se guardan ahí: van a la base. Esa separación permite rehacer el
análisis sin perder lo decidido.
