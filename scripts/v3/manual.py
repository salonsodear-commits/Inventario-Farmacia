# -*- coding: utf-8 -*-
"""Arma el manual en HTML a partir del LEEME.

El LEEME es la fuente —se edita ahí y en ningún otro lado—, pero un .md no se
le manda a nadie: no se abre, no se imprime y en el correo llega como texto
plano con asteriscos. Esto lo convierte en una página que abre cualquier
navegador, se imprime a PDF y se puede adjuntar.

No usa librerías: el subconjunto de Markdown que tiene el LEEME —títulos,
tablas, listas, negrita, código, citas y reglas— entra en doscientas líneas y
no justifica una dependencia que después hay que instalar en otra máquina.
"""
import io, os, re, html

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")) + os.sep
ORIGEN = RAIZ + "LEEME - sistema de gestion.md"
SALIDA = RAIZ + "Manual - sistema de inventario fisico vs SAP.html"

ESTILO = """
:root{--ia:#1F4E78;--tx:#15140f;--tx2:#4a4842;--tx3:#78766d;--lin:#e2e1db;
  --sup:#faf9f6;--ok:#0f7f58;--al:#b8431f}
*{box-sizing:border-box}
body{margin:0;background:#edecE8;color:var(--tx);
  font:11pt/1.6 "Segoe UI",Calibri,Helvetica,Arial,sans-serif}
.hoja{max-width:940px;margin:0 auto;background:#fff;padding:52px 60px 70px;
  box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:26pt;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px;color:var(--tx)}
h1+p{color:var(--tx2);font-size:12pt;margin:0 0 26px}
h2{font-size:16pt;color:var(--ia);margin:38px 0 10px;padding-bottom:6px;
  border-bottom:2px solid var(--ia);letter-spacing:-.01em}
h3{font-size:13pt;margin:26px 0 7px;color:var(--tx)}
h4{font-size:11.5pt;margin:18px 0 5px;color:var(--ia)}
p{margin:0 0 11px}
ul,ol{margin:0 0 12px;padding-left:22px}
li{margin-bottom:5px}
strong{color:var(--tx)}
code{background:var(--sup);border:1px solid var(--lin);border-radius:4px;
  padding:1px 5px;font:10pt "Cascadia Mono",Consolas,monospace;color:#8a3f1f}
pre{background:var(--sup);border:1px solid var(--lin);border-left:3px solid var(--ia);
  border-radius:6px;padding:12px 15px;overflow:auto;margin:0 0 14px}
pre code{background:none;border:0;padding:0;color:var(--tx)}
blockquote{margin:0 0 14px;padding:10px 15px;background:#fdf6ee;
  border-left:3px solid #d98b3a;border-radius:0 6px 6px 0;color:var(--tx2)}
blockquote p:last-child{margin-bottom:0}
table{border-collapse:collapse;width:100%;margin:6px 0 16px;font-size:10pt}
th{background:var(--ia);color:#fff;text-align:left;padding:7px 9px;
  font-size:9pt;letter-spacing:.03em;text-transform:uppercase;font-weight:600;
  vertical-align:bottom}
td{padding:7px 9px;border-bottom:1px solid var(--lin);vertical-align:top}
tr:nth-child(even) td{background:#fafaf8}
hr{border:0;border-top:1px solid var(--lin);margin:30px 0}
a{color:#2873cd}
.pie{margin-top:44px;padding-top:14px;border-top:1px solid var(--lin);
  color:var(--tx3);font-size:9.5pt}
@media print{
  body{background:#fff}
  .hoja{box-shadow:none;max-width:none;padding:0}
  h2{page-break-after:avoid} table,pre,blockquote{page-break-inside:avoid}
  @page{size:A4;margin:16mm 14mm}
}
"""


def en_linea(t):
    """Negrita, itálica, código y enlaces.

    El código sale primero y deja una marca en su lugar: adentro de un `code`
    los asteriscos son asteriscos, pero una negrita puede envolver un código
    —**`archivo.md`**— y partir el texto en pedazos haría que esa negrita no se
    reconozca, porque los dos asteriscos quedan en pedazos distintos.
    """
    guardados = []

    def guardar(m):
        guardados.append("<code>" + html.escape(m.group(1)) + "</code>")
        return "\x00%d\x00" % (len(guardados) - 1)

    t = re.sub(r"`([^`]+)`", guardar, t)
    t = html.escape(t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", t)
    return re.sub(r"\x00(\d+)\x00", lambda m: guardados[int(m.group(1))], t)


def fila(l):
    celdas = l.strip().strip("|").split("|")
    return [c.strip() for c in celdas]


def convertir(md):
    ls = md.split("\n")
    out, i = [], 0
    pila = []          # listas abiertas: "ul" / "ol"

    def cerrar_listas(hasta=0):
        while len(pila) > hasta:
            out.append("</%s>" % pila.pop())

    while i < len(ls):
        l = ls[i]

        if l.startswith("```"):                       # bloque de código
            cerrar_listas()
            i += 1
            cod = []
            while i < len(ls) and not ls[i].startswith("```"):
                cod.append(ls[i]); i += 1
            i += 1
            out.append("<pre><code>" + html.escape("\n".join(cod)) + "</code></pre>")
            continue

        if re.match(r"^\s*\|.*\|\s*$", l) and i + 1 < len(ls) \
                and re.match(r"^\s*\|[\s:|-]+\|\s*$", ls[i + 1]):
            cerrar_listas()
            cab = fila(l)
            i += 2
            cuerpo = []
            while i < len(ls) and re.match(r"^\s*\|.*\|\s*$", ls[i]):
                cuerpo.append(fila(ls[i])); i += 1
            out.append("<table><thead><tr>" +
                       "".join("<th>" + en_linea(c) + "</th>" for c in cab) +
                       "</tr></thead><tbody>")
            for f in cuerpo:
                out.append("<tr>" + "".join("<td>" + en_linea(c) + "</td>" for c in f) + "</tr>")
            out.append("</tbody></table>")
            continue

        if re.match(r"^\s*(---|___|\*\*\*)\s*$", l):
            cerrar_listas(); out.append("<hr>"); i += 1; continue

        m = re.match(r"^(#{1,6})\s+(.*)$", l)
        if m:
            cerrar_listas()
            n = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (n, en_linea(m.group(2)), n))
            i += 1; continue

        if l.startswith(">"):
            cerrar_listas()
            cita = []
            while i < len(ls) and ls[i].startswith(">"):
                cita.append(ls[i].lstrip(">").strip()); i += 1
            txt = " ".join(x for x in cita if x)
            out.append("<blockquote><p>" + en_linea(txt) + "</p></blockquote>")
            continue

        m = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", l)
        if m:
            nivel = len(m.group(1)) // 2 + 1
            tipo = "ol" if m.group(2)[0].isdigit() else "ul"
            while len(pila) > nivel:
                out.append("</%s>" % pila.pop())
            if len(pila) < nivel:
                while len(pila) < nivel:
                    out.append("<%s>" % tipo); pila.append(tipo)
            elif pila and pila[-1] != tipo:
                out.append("</%s>" % pila.pop()); out.append("<%s>" % tipo); pila.append(tipo)
            # Un renglón que sigue al de la viñeta, sin viñeta propia, es la
            # misma viñeta partida por el ancho del archivo. Tratarlo como
            # párrafo aparte corta las negritas por la mitad.
            texto = [m.group(3)]
            i += 1
            while i < len(ls) and ls[i].strip() and not re.match(
                    r"^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|```|\s*\|)", ls[i]) \
                    and not re.match(r"^\s*(---|___|\*\*\*)\s*$", ls[i]):
                texto.append(ls[i].strip()); i += 1
            out.append("<li>" + en_linea(" ".join(texto)) + "</li>")
            continue

        if not l.strip():
            cerrar_listas(); i += 1; continue

        cerrar_listas()
        par = [l.strip()]
        i += 1
        while i < len(ls) and ls[i].strip() and not re.match(
                r"^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|```|\s*\|)", ls[i]) \
                and not re.match(r"^\s*(---|___|\*\*\*)\s*$", ls[i]):
            par.append(ls[i].strip()); i += 1
        out.append("<p>" + en_linea(" ".join(par)) + "</p>")

    cerrar_listas()
    return "\n".join(out)


def construir():
    md = io.open(ORIGEN, encoding="utf-8").read()
    cuerpo = convertir(md)
    pagina = (
        "<!doctype html>\n<html lang=\"es\">\n<head><meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>Manual · sistema de inventario físico vs SAP</title>\n"
        "<style>" + ESTILO + "</style></head>\n<body><div class=\"hoja\">\n"
        + cuerpo +
        "\n<p class=\"pie\">Manual del sistema de inventario físico vs SAP · "
        "San Juan, Neuquén y Salta. Se imprime a PDF desde el navegador "
        "(Archivo → Imprimir → Guardar como PDF).</p>\n"
        "</div></body></html>\n")
    io.open(SALIDA, "w", encoding="utf-8").write(pagina)
    return SALIDA, len(pagina)


if __name__ == "__main__":
    ruta, n = construir()
    print("%s  (%d KB)" % (ruta, n // 1024))
