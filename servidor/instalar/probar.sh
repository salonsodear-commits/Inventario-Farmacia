#!/usr/bin/env bash
# Arranca el sistema para probarlo en Mac o Linux.
#
#   bash probar.sh
#
# Usa el Node del sistema. Si no hay, lo dice: el paquete trae el Node
# portable sólo para Windows, porque es donde más falta hace.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

echo
echo "  ============================================================"
echo "   INVENTARIO FÍSICO VS SAP · versión de prueba"
echo "  ============================================================"
echo
echo "   Es una prueba en tu propia máquina:"
echo
echo "     · NO pide usuario y contraseña. Para eso hay que publicarla."
echo "     · Las decisiones van a datos/inventario.db, acá al lado."
echo "       Son de prueba: no van a ningún lado."
echo "     · Para empezar de cero, borrá esa carpeta."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  No hay Node instalado. Hace falta la versión 22.5 o superior:"
  echo "     https://nodejs.org/   (o: brew install node)"
  echo
  exit 1
fi
MAYOR=$(node -p "process.versions.node.split('.')[0]")
MENOR=$(node -p "process.versions.node.split('.')[1]")
if (( MAYOR < 22 )) || { (( MAYOR == 22 )) && (( MENOR < 13 )); }; then
  echo "  Hay Node $(node -v), pero hace falta 22.13 o superior."
  echo "  Antes de esa versión, la base de datos que usa el sistema"
  echo "  necesitaba un permiso especial para funcionar."
  echo
  exit 1
fi

printf "  ¿Con qué nombre querés que queden tus decisiones? "
read -r NOMBRE
[[ -z "${NOMBRE:-}" ]] && NOMBRE="Prueba"

PUERTO=${INVSAP_PUERTO:-8080}
echo
echo "  Arrancando en http://localhost:$PUERTO/"
echo "  PARA CERRAR: Ctrl+C acá."
echo "  ------------------------------------------------------------"
echo

# Abre el navegador cuando el servidor ya responde.
(
  for _ in $(seq 1 25); do
    sleep 1
    if curl -fs -H 'x-invsap: 1' "http://127.0.0.1:$PUERTO/api/salud" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:$PUERTO/"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PUERTO/" >/dev/null 2>&1
      fi
      break
    fi
  done
) &

INVSAP_AUTH=off INVSAP_PUERTO="$PUERTO" INVSAP_DEV_USUARIO="$NOMBRE" \
  exec node servidor/servidor.js
