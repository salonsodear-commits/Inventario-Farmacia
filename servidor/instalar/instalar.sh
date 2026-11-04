#!/usr/bin/env bash
# Instala el sistema como servicio en una máquina Linux con systemd.
#
#   sudo ./servidor/instalar/instalar.sh
#
# Qué hace: crea el usuario de servicio, copia la aplicación a /opt/inventario,
# deja el archivo de configuración en /etc/inventario.env y habilita el
# servicio. NO lo arranca: antes hay que completar la configuración.
#
# Es idempotente: se puede correr de nuevo para actualizar la aplicación.
set -euo pipefail

DESTINO=${DESTINO:-/opt/inventario}
USUARIO=${USUARIO:-inventario}
ENTORNO=/etc/inventario.env
ORIGEN=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { rojo "Hay que correrlo con sudo."; exit 1; }

paso "Comprobando Node"
command -v node >/dev/null || { rojo "No hay node instalado."; exit 1; }
MAYOR=$(node -p "process.versions.node.split('.')[0]")
MENOR=$(node -p "process.versions.node.split('.')[1]")
if (( MAYOR < 22 )) || { (( MAYOR == 22 )) && (( MENOR < 5 )); }; then
  rojo "Hace falta Node 22.5 o superior (hay $(node -v)): antes no existe node:sqlite."
  exit 1
fi
verde "Node $(node -v)"

paso "Usuario de servicio"
if id "$USUARIO" &>/dev/null; then
  echo "ya existe: $USUARIO"
else
  useradd --system --home-dir "$DESTINO" --shell /usr/sbin/nologin "$USUARIO"
  verde "creado: $USUARIO"
fi

paso "Copiando la aplicación a $DESTINO"
mkdir -p "$DESTINO"
# Sólo lo que la aplicación necesita para correr. Los insumos del análisis y
# los entregables no van al servidor.
for d in servidor sistema package.json; do
  cp -r "$ORIGEN/$d" "$DESTINO/"
done
mkdir -p "$DESTINO/datos/respaldos"
chown -R "$USUARIO:$USUARIO" "$DESTINO/datos"
# El código es de root y la aplicación sólo lo lee: si algo la compromete, no
# puede reescribirse a sí misma.
chown -R root:root "$DESTINO/servidor" "$DESTINO/sistema" "$DESTINO/package.json"
chmod -R go-w "$DESTINO/servidor" "$DESTINO/sistema"
verde "aplicación copiada"

paso "Configuración"
if [[ -f $ENTORNO ]]; then
  echo "ya existe $ENTORNO, no se toca"
else
  cp "$ORIGEN/servidor/instalar/inventario.env.ejemplo" "$ENTORNO"
  chown root:"$USUARIO" "$ENTORNO"
  chmod 640 "$ENTORNO"
  verde "creado $ENTORNO (hay que completarlo)"
fi

paso "Servicio"
cp "$ORIGEN/servidor/instalar/inventario.service" /etc/systemd/system/
sed -i "s#/opt/inventario#$DESTINO#g" /etc/systemd/system/inventario.service
systemctl daemon-reload
systemctl enable inventario >/dev/null
verde "servicio habilitado"

cat <<FIN

$(verde "Instalado.")  Falta un paso que no puede hacer este script:

  1. Completar $ENTORNO con los datos del registro de Azure
     (ver servidor/README.md para saber de dónde sale cada uno).

  2. Arrancarlo:

       sudo systemctl start inventario
       systemctl status inventario
       journalctl -u inventario -f

  3. Comprobar que responde:

       curl -s -H 'x-invsap: 1' http://127.0.0.1:8080/api/salud

Para actualizar la aplicación más adelante, volver a correr este script y
reiniciar el servicio. La base de datos y la configuración no se tocan.
FIN
