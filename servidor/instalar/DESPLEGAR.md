# Publicarla en la web

Se puede, y gratis. Pero hay **dos cosas que conviene decidir antes**, porque
cambian cuál es la opción correcta.

---

## 1. Esto son datos de la empresa

La aplicación lleva adentro el inventario completo: 1.991 materiales con sus
cantidades por base, los valores de stock de SAP y las decisiones de cada
revisor con nombre y apellido.

Publicarlo en un hosting gratuito de un tercero significa que esa información
sale de la organización. **Esa decisión no es técnica**: la tiene que tomar
quien corresponda en Emergencias. Lo que sí es técnico es la consecuencia, y
por eso está escrito acá.

La opción que evita el problema de raíz es **Azure App Service**: es gratis en
el plan F1 y los datos quedan en el inquilino de Emergencias, el mismo donde ya
está registrada la aplicación en Entra ID.

## 2. «Gratis» casi siempre significa disco que se borra

Esto importa más de lo que parece. La aplicación guarda las decisiones en un
archivo SQLite. En la mayoría de los planes gratuitos el disco es **efímero**:
se borra en cada despliegue y cuando la plataforma recicla el contenedor.

Con disco efímero, **se pierden todas las decisiones** — que es exactamente el
problema que esta aplicación vino a resolver.

| Dónde | Gratis | ¿El disco sobrevive? |
|---|---|---|
| **Azure App Service F1** | Sí | **Sí**, `/home` es almacenamiento persistente |
| **Fly.io** | Sí, con volumen de 3 GB | **Sí**, en un volumen |
| **Render** plan free | Sí | **No.** El disco persistente es pago |
| **Railway** | Crédito mensual | Sí, con volumen |
| **Vercel / Netlify** | Sí | **No sirven**: no corren un proceso Node con estado |

Las dos primeras están preparadas acá.

---

## Opción A · Azure App Service, plan F1 (recomendada)

Los datos no salen de Emergencias y Entra ID ya está en el mismo inquilino.

### Crearla

```bash
az login
az group create --name inventario --location brazilsouth

az appservice plan create \
  --name inventario-plan --resource-group inventario \
  --sku F1 --is-linux

az webapp create \
  --name inventario-emergencias \
  --resource-group inventario --plan inventario-plan \
  --runtime "NODE:22-lts"
```

El nombre tiene que ser único en todo Azure: la dirección queda
`https://inventario-emergencias.azurewebsites.net`.

### Configurarla

```bash
az webapp config appsettings set \
  --name inventario-emergencias --resource-group inventario --settings \
  INVSAP_TENANT_ID="…" \
  INVSAP_CLIENT_ID="…" \
  INVSAP_CLIENT_SECRET="…" \
  INVSAP_REDIRECT_URI="https://inventario-emergencias.azurewebsites.net/auth/callback" \
  INVSAP_DB="/home/datos/inventario.db" \
  INVSAP_RESPALDOS="/home/datos/respaldos" \
  INVSAP_COOKIE_SEGURA="si" \
  WEBSITE_NODE_DEFAULT_VERSION="~22"
```

> **`/home` es lo que hace que esto funcione.** En App Service es
> almacenamiento de red persistente: sobrevive a los reinicios y a los
> despliegues. Cualquier otra ruta se borra. Si la base queda fuera de `/home`,
> se pierden las decisiones.

### Publicar

```bash
zip -r app.zip servidor sistema package.json
az webapp deploy --name inventario-emergencias \
  --resource-group inventario --src-path app.zip --type zip
```

### Y en Azure, agregar la URI de redirección

En el registro de la aplicación, **Autenticación → Agregar URI**:

```
https://inventario-emergencias.azurewebsites.net/auth/callback
```

### Lo que hay que saber del plan F1

- **60 minutos de CPU por día.** Pasado eso, la aplicación se detiene hasta el
  día siguiente. Para revisar casos de a ratos alcanza; para varias personas
  trabajando horas seguidas, no.
- **Se duerme** tras un rato sin uso, y la primera visita después tarda unos
  segundos.
- **No admite dominio propio con certificado.** La dirección es
  `*.azurewebsites.net`, que ya viene con HTTPS.
- Si queda chico, el plan **B1** levanta los tres límites por unos 13 dólares
  al mes. El cambio es un comando y no hay que tocar nada más.

---

## Opción B · Fly.io

Gratis con un volumen persistente de 3 GB. Los datos quedan en un tercero: vale
lo dicho más arriba.

```bash
fly launch --no-deploy --name inventario-emergencias --region gru
fly volumes create datos --size 1 --region gru

fly secrets set \
  INVSAP_TENANT_ID="…" \
  INVSAP_CLIENT_ID="…" \
  INVSAP_CLIENT_SECRET="…" \
  INVSAP_REDIRECT_URI="https://inventario-emergencias.fly.dev/auth/callback" \
  INVSAP_COOKIE_SEGURA="si"

fly deploy
```

El `fly.toml` de este repositorio ya monta el volumen en `/app/datos`, que es
donde la aplicación guarda la base y los respaldos.

Y en Azure, agregar la URI `https://inventario-emergencias.fly.dev/auth/callback`.

---

## Publicar automáticamente desde GitHub

Hay un flujo de trabajo en `.github/workflows/desplegar.yml` que publica en
Azure cada vez que se sube algo a la rama principal. Para activarlo hace falta
cargar un secreto en el repositorio:

1. En Azure: *App Service → Obtener perfil de publicación* (descarga un XML).
2. En GitHub: *Settings → Secrets → Actions → New secret*, con nombre
   `AZURE_WEBAPP_PUBLISH_PROFILE` y el contenido del XML.

Desde ahí, cada `git push` publica la versión nueva. La base no se toca: vive
en `/home`, fuera de lo que el despliegue reemplaza.

---

## Antes de abrirla a todos

- [ ] La URI de redirección está cargada en el registro de Entra ID
- [ ] `INVSAP_DB` apunta a disco persistente (`/home/datos/…` en Azure)
- [ ] `INVSAP_COOKIE_SEGURA=si`
- [ ] Entra con una cuenta `@emergencias.com.ar` y **rechaza** otra
- [ ] `/api/salud` responde y muestra el último respaldo
- [ ] Alguien de la organización aprobó dónde van a vivir estos datos
