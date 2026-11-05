# -*- coding: utf-8 -*-
"""Arma los dos paquetes que se entregan, desde el árbol tal como está.

Hay dos porque hacen falta dos cosas distintas:

  · «aplicación» — lo que se instala en un servidor. Liviano: el código, los
    datos del análisis y las instrucciones. Node lo pone el servidor.

  · «PRUEBA» — para abrir con doble clic en una máquina con Windows y ver que
    anda, sin instalar nada y sin pedirle nada a nadie. Lleva node.exe adentro,
    y por eso pesa 32 MB y no va al repositorio.

El node.exe no se baja acá: tiene que estar ya en la carpeta de apoyo que indica
NODE_WIN. Si no está, el paquete de prueba se saltea y se avisa, porque bajar
87 MB en cada corrida no es parte de armar un paquete.
"""
import io, os, shutil, sys, zipfile

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")) + os.sep
NODE_WIN = os.environ.get("INVSAP_NODE_WIN", "")

# Lo que lleva la aplicación. El orden no importa; la lista, sí: si algo falta
# acá, falta en el servidor de quien la instale.
APP = [
    "servidor/instalar/EMPEZAR-ACA.md",
    "servidor/instalar/DESPLEGAR.md",
    "servidor/db.js", "servidor/servidor.js", "servidor/README.md",
    "servidor/entra.js", "servidor/operacion.js",
    "servidor/instalar/LEEME PRIMERO.txt",
    "servidor/instalar/PROBAR CON DOS PERSONAS.bat",
    "servidor/instalar/inventario.env.ejemplo",
    "servidor/instalar/compose.yaml", "servidor/instalar/probar.sh",
    "servidor/instalar/Dockerfile", "servidor/instalar/_arrancar.bat",
    "servidor/instalar/PROBAR.bat", "servidor/instalar/inventario.service",
    "servidor/instalar/instalar.sh",
    "sistema/almacen.js", "sistema/xlsxmin.js", "sistema/app.js",
    "sistema/estilos.css", "sistema/informe.js", "sistema/index.html",
    "sistema/exportar.js", "sistema/datos.js",
    "package.json", "fly.toml",
    "LEEME - sistema de gestion.md",
    ".github/workflows/desplegar.yml",
]
# Los dos documentos de arranque van también en la raíz del zip: quien lo
# descomprime tiene que encontrarlos sin entrar en ninguna carpeta.
APP_RAIZ = {"EMPEZAR-ACA.md": "servidor/instalar/EMPEZAR-ACA.md",
            "DESPLEGAR.md": "servidor/instalar/DESPLEGAR.md"}

# La carpeta de prueba: los .bat arriba, y el servidor abajo. Sin fly.toml ni
# workflow de despliegue, que ahí no sirven para nada.
PRUEBA = {
    "LEEME PRIMERO.txt": "servidor/instalar/LEEME PRIMERO.txt",
    "PROBAR.bat": "servidor/instalar/PROBAR.bat",
    "PROBAR CON DOS PERSONAS.bat": "servidor/instalar/PROBAR CON DOS PERSONAS.bat",
    "_arrancar.bat": "servidor/instalar/_arrancar.bat",
    "probar.sh": "servidor/instalar/probar.sh",
    "DESPLEGAR.md": "servidor/instalar/DESPLEGAR.md",
    "servidor/README.md": "servidor/README.md",
    "package.json": "package.json",
    "servidor/db.js": "servidor/db.js",
    "servidor/servidor.js": "servidor/servidor.js",
    "servidor/entra.js": "servidor/entra.js",
    "servidor/operacion.js": "servidor/operacion.js",
    "sistema/almacen.js": "sistema/almacen.js",
    "sistema/xlsxmin.js": "sistema/xlsxmin.js",
    "sistema/app.js": "sistema/app.js",
    "sistema/estilos.css": "sistema/estilos.css",
    "sistema/informe.js": "sistema/informe.js",
    "sistema/index.html": "sistema/index.html",
    "sistema/exportar.js": "sistema/exportar.js",
    "sistema/datos.js": "sistema/datos.js",
}
NODE_LEEME = ("Este node.exe es el de nodejs.org, sin modificar. Está acá para que\n"
              "la prueba arranque con doble clic, sin instalar nada.\n")


def falta(rel):
    return not os.path.exists(RAIZ + rel)


def aplicacion():
    faltan = [r for r in APP if falta(r)]
    if faltan:
        sys.exit("faltan archivos de la aplicación: " + ", ".join(faltan))
    destino = RAIZ + "Inventario fisico vs SAP - aplicacion.zip"
    tmp = destino + ".nuevo"          # el zip viejo no se toca hasta que el nuevo esté
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for nombre, rel in APP_RAIZ.items():
            z.write(RAIZ + rel, nombre)
        for rel in APP:
            z.write(RAIZ + rel, rel)
    os.replace(tmp, destino)
    return destino


def prueba():
    if not NODE_WIN or not os.path.exists(NODE_WIN):
        print("  (sin node.exe: INVSAP_NODE_WIN no apunta a ninguno, "
              "el paquete de prueba queda como estaba)")
        return None
    faltan = [r for r in PRUEBA.values() if falta(r)]
    if faltan:
        sys.exit("faltan archivos de la prueba: " + ", ".join(faltan))
    carpeta = "Inventario fisico vs SAP - PRUEBA"
    destino = RAIZ + carpeta + ".zip"
    tmp = destino + ".nuevo"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for nombre, rel in PRUEBA.items():
            z.write(RAIZ + rel, carpeta + "/" + nombre)
        z.write(NODE_WIN, carpeta + "/node/node.exe")
        z.writestr(carpeta + "/node/LEEME.txt", NODE_LEEME)
    os.replace(tmp, destino)
    return destino


if __name__ == "__main__":
    for d in (aplicacion(), prueba()):
        if d:
            print("  %s · %.2f MB" % (os.path.basename(d),
                                      os.path.getsize(d) / 1024 / 1024))
