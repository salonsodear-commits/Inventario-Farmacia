# -*- coding: utf-8 -*-
"""Validacion estricta del paquete xlsx, pensada para los controles de Excel."""
import zipfile, re, sys
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def validar(path, verbose=True):
    """Devuelve la lista de problemas estructurales del paquete xlsx."""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    problemas = []

    def chk(cond, msg):
        if verbose:
            print(("  OK    " if cond else "  FALLA ") + msg)
        if not cond:
            problemas.append(msg)

    def pr(*a):
        if verbose:
            print(*a)


    pr("=== 1. XML bien formado")
    malos = []
    for n in names:
        if n.endswith(('.xml', '.rels')):
            try:
                ET.fromstring(z.read(n))
            except Exception as e:
                malos.append(f"{n}: {e}")
    chk(not malos, f"todas las partes XML parsean ({len(names)} partes){'' if not malos else ' -> ' + str(malos[:3])}")

    pr("\n=== 2. Celdas de texto sin contenido (lo que rompe Excel)")
    tot = 0
    for n in sorted(names):
        if not re.match(r'xl/worksheets/sheet\d+\.xml$', n):
            continue
        d = z.read(n).decode('utf-8', 'ignore')
        cells = re.findall(r'<c [^>]*?/>|<c [^>]*?>.*?</c>', d)
        mal = [c for c in cells if 't="inlineStr"' in c and '<is>' not in c]
        mal += [c for c in cells if 't="s"' in c and '<v>' not in c]
        if mal:
            print(f"     {n}: {len(mal)}")
        tot += len(mal)
    chk(tot == 0, f"celdas de texto declaradas sin valor: {tot}")

    pr("\n=== 3. Celdas numericas con valor no numerico")
    mal = 0
    for n in sorted(names):
        if not re.match(r'xl/worksheets/sheet\d+\.xml$', n):
            continue
        d = z.read(n).decode('utf-8', 'ignore')
        for c in re.findall(r'<c [^>]*?>.*?</c>', d):
            if 't=' in c or '<f' in c:
                continue
            m = re.search(r'<v>([^<]*)</v>', c)
            if m:
                try:
                    float(m.group(1))
                except ValueError:
                    mal += 1
    chk(mal == 0, f"celdas numericas con texto: {mal}")

    pr("\n=== 4. Content types y relaciones")
    ct = z.read('[Content_Types].xml').decode()
    ov = set(re.findall(r'PartName="([^"]+)"', ct))
    df = set(re.findall(r'Extension="([^"]+)"', ct))
    sin = [n for n in names if n != '[Content_Types].xml'
           and '/' + n not in ov and n.rsplit('.', 1)[-1].lower() not in df]
    chk(not sin, f"todas las partes tienen content-type{'' if not sin else ' -> ' + str(sin)}")
    rotas = []
    for rels in [n for n in names if n.endswith('.rels')]:
        base = rels.rsplit('_rels/', 1)[0]
        for r in ET.fromstring(z.read(rels)):
            if r.get('TargetMode') == 'External':
                continue
            t = r.get('Target')
            p = t[1:] if t.startswith('/') else base + t
            while '/../' in p:
                p = re.sub(r'[^/]+/\.\./', '', p, count=1)
            if p not in names:
                rotas.append(f"{rels} -> {t}")
    chk(not rotas, f"relaciones con destino existente{'' if not rotas else ' -> ' + str(rotas)}")

    pr("\n=== 5. Ids de relacion duplicados")
    dup = []
    for rels in [n for n in names if n.endswith('.rels')]:
        ids = [r.get('Id') for r in ET.fromstring(z.read(rels))]
        if len(ids) != len(set(ids)):
            dup.append(rels)
    chk(not dup, f"sin Ids duplicados{'' if not dup else ' -> ' + str(dup)}")

    pr("\n=== 6. definedNames y localSheetId")
    wbx = z.read('xl/workbook.xml').decode()
    hojas = re.findall(r'<sheet name="([^"]+)"', wbx)
    mal = []
    for dn in re.findall(r'<definedName name="([^"]+)" localSheetId="(\d+)"[^>]*>([^<]*)</definedName>', wbx):
        nombre, idx, ref = dn
        i = int(idx)
        if i >= len(hojas):
            mal.append(f"{nombre} localSheetId={i} fuera de rango")
            continue
        h = hojas[i]
        if h.replace("'", "''") not in ref:
            mal.append(f"{nombre} localSheetId={i} ({h}) pero apunta a {ref}")
    chk(not mal, f"localSheetId coherentes ({len(hojas)} hojas){'' if not mal else ' -> ' + str(mal)}")

    pr("\n=== 7. Limites de Excel")
    excesos = []
    for n in sorted(names):
        if not re.match(r'xl/worksheets/sheet\d+\.xml$', n):
            continue
        d = z.read(n).decode('utf-8', 'ignore')
        for h in re.findall(r'<row[^>]*ht="([\d.]+)"', d):
            if float(h) > 409.5:
                excesos.append(f"{n}: alto de fila {h}")
        for w in re.findall(r'<col[^>]*width="([\d.]+)"', d):
            if float(w) > 255:
                excesos.append(f"{n}: ancho de columna {w}")
        for t in re.findall(r'<t[^>]*>([^<]{32768,})</t>', d):
            excesos.append(f"{n}: texto de {len(t)} caracteres")
    chk(not excesos, f"alto/ancho/largo dentro de limites{'' if not excesos else ' -> ' + str(excesos[:4])}")

    pr("\n=== 8. Comentarios con ancla valida")
    mal = []
    for n in [x for x in names if re.match(r'xl/comments/comment\d+\.xml$', x)]:
        x = ET.fromstring(z.read(n))
        for c in x.iter(NS + 'comment'):
            if not re.match(r'^[A-Z]{1,3}\d{1,7}$', c.get('ref') or ''):
                mal.append(f"{n}: ref {c.get('ref')}")
    chk(not mal, f"referencias de comentario validas{'' if not mal else ' -> ' + str(mal)}")


    if verbose:
        print("\n" + ("SIN PROBLEMAS" if not problemas
                      else f"{len(problemas)} PROBLEMA(S)"))
    return problemas


if __name__ == "__main__":
    import os
    import paths
    destino = (sys.argv[1] if len(sys.argv) > 1 else
               os.path.join(paths.RAIZ,
                            "Stock SAP vs Inventario Fisico Avain - cruce.xlsx"))
    sys.exit(1 if validar(destino) else 0)
