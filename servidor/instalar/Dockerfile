# Imagen del sistema de inventario físico vs SAP.
#
# No hay etapa de compilación ni `npm install`: la aplicación no tiene
# dependencias, usa sólo lo que viene con Node.
#
#   docker build -f servidor/instalar/Dockerfile -t inventario .
#   docker run -d --name inventario -p 8080:8080 \
#     --env-file /etc/inventario.env \
#     -v inventario-datos:/app/datos \
#     inventario

FROM node:22-alpine

# No corre como root: si algo sale mal, que tenga el menor alcance posible.
RUN addgroup -S inventario && adduser -S -G inventario inventario

WORKDIR /app

# Sólo lo que hace falta para correr. Los insumos del análisis, los
# entregables y los scripts de Python no van a la imagen.
COPY --chown=root:root servidor ./servidor
COPY --chown=root:root sistema ./sistema
COPY --chown=root:root package.json ./

# La base vive en un volumen: el contenedor es descartable, los datos no.
RUN mkdir -p /app/datos/respaldos && chown -R inventario:inventario /app/datos
VOLUME ["/app/datos"]

ENV INVSAP_HOST=0.0.0.0 \
    INVSAP_PUERTO=8080 \
    INVSAP_DB=/app/datos/inventario.db \
    INVSAP_RESPALDOS=/app/datos/respaldos \
    NODE_ENV=production

USER inventario
EXPOSE 8080

# Docker reinicia el contenedor si deja de estar sano.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.INVSAP_PUERTO||8080)+'/api/salud',{headers:{'x-invsap':'1'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Sin shell de por medio, para que SIGTERM llegue al proceso y la base se
# cierre ordenada.
CMD ["node", "servidor/servidor.js"]
