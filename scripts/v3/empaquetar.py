# -*- coding: utf-8 -*-
"""Empaqueta el sistema en UN solo archivo .html autocontenido.

El sistema vive en varios archivos para poder trabajarlo, pero para usarlo
conviene que sea uno solo: se abre con doble clic, se manda por correo y no se
rompe si alguien mueve una carpeta. Acá se inserta el CSS y todo el JavaScript
dentro del HTML, sin ninguna referencia externa.
"""
import io, os, re, datetime

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(RAIZ, "sistema")
SALIDA = os.path.join(RAIZ, "Sistema - Inventario fisico vs SAP.html")


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

    nota = ("<!--\n  Sistema de gestión · Inventario físico vs SAP\n"
            "  Archivo único y autocontenido: no necesita internet, ni instalación,\n"
            "  ni ningún otro archivo al lado. Se abre con doble clic.\n"
            "  Generado el " + datetime.date.today().isoformat() + "\n-->\n")
    html = html.replace("<!doctype html>", "<!doctype html>\n" + nota)

    with io.open(SALIDA, "w", encoding="utf-8") as fh:
        fh.write(html)
    return SALIDA


if __name__ == "__main__":
    p = empaquetar()
    print(f"{p}\n{os.path.getsize(p)/1024/1024:.1f} MB · un solo archivo, sin dependencias")
