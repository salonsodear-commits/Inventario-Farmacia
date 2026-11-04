# -*- coding: utf-8 -*-
"""Empaqueta el sistema en UN solo archivo .html para CONSULTA.

El sistema es una aplicación servida: ahí se entra con la cuenta de Emergencias
y las decisiones van a una base compartida. Este archivo es otra cosa: una
copia autocontenida para mirar el análisis sin levantar nada —mostrarlo en una
reunión, mandárselo a alguien que sólo quiere verlo— y por eso sale marcada
como de sólo consulta.

Esa marca no es decorativa. Antes el archivo dejaba decidir, y cada copia que
circulaba por correo era un lugar donde alguien tomaba decisiones que no
entraban en ningún lado. El archivo ya no deja: muestra todo y explica dónde
se decide.
"""
import io, os, re, json, datetime

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(RAIZ, "sistema")
SALIDA = os.path.join(RAIZ, "Inventario fisico vs SAP - consulta.html")


def leer(nombre):
    with io.open(os.path.join(DIR, nombre), encoding="utf-8") as fh:
        return fh.read()


def empaquetar():
    html = leer("index.html")

    # El CSS pasa a un <style> en línea
    css = leer("estilos.css")
    html = html.replace('<link rel="stylesheet" href="estilos.css">',
                        "<style>\n" + css + "\n</style>")

    # Cada <script src> se reemplaza por su contenido, respetando el orden
    def meter(m):
        archivo = m.group(1)
        codigo = leer(archivo)
        # salvaguarda: una cadena con </script> cerraría la etiqueta antes de tiempo
        codigo = codigo.replace("</script", "<\\/script")
        return ("<script>\n/* ---- " + archivo + " ---- */\n" + codigo + "\n</script>")

    html = re.sub(r'<script src="([^"]+)"></script>', meter, html)

    assert "src=" not in html, "quedó una referencia externa"
    assert 'href="estilos' not in html, "quedó el CSS externo"

    # La marca de sólo consulta se inyecta acá, no en el código fuente: el
    # sistema servido nunca la lleva, así que no hay forma de quedar en modo
    # consulta por accidente.
    donde = os.environ.get("INVSAP_URL", "")
    marca = ("<script>window.INVSAP_SOLO_CONSULTA = true;" +
             (f' window.INVSAP_URL = {json.dumps(donde)};' if donde else "") +
             "</script>\n")
    html = html.replace("<script>\n/* ---- almacen.js ---- */", marca +
                        "<script>\n/* ---- almacen.js ---- */")

    nota = ("<!--\n  Inventario físico vs SAP · COPIA PARA CONSULTA\n"
            "  Muestra el análisis completo, pero no se puede decidir acá: las\n"
            "  decisiones se toman en la aplicación, donde quedan en una base\n"
            "  compartida y firmadas con la cuenta de cada uno.\n"
            "  Generado el " + datetime.date.today().isoformat() + "\n-->\n")
    html = html.replace("<!doctype html>", "<!doctype html>\n" + nota)

    with io.open(SALIDA, "w", encoding="utf-8") as fh:
        fh.write(html)
    return SALIDA


if __name__ == "__main__":
    p = empaquetar()
    print(f"{p}\n{os.path.getsize(p)/1024/1024:.1f} MB · copia para consulta, sin dependencias")
