# -*- coding: utf-8 -*-
"""Audita que las cifras coincidan entre el dataset, el Excel y el PDF.

No alcanza con que los tres se generen: tienen que decir lo mismo. Acá se
compara el dato de origen contra lo que efectivamente quedó escrito en cada
entregable.
"""
import io, json, re, zipfile, subprocess, sys, os, hashlib, collections

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")) + os.sep
S = os.path.join(RAIZ, "salida", "auditoria") + os.sep
os.makedirs(S, exist_ok=True)
XLSX = RAIZ + "Inventario fisico vs SAP - analisis.xlsx"
PDF = RAIZ + "Inventario fisico vs SAP - informe integral.pdf"
HTML = RAIZ + "Sistema - Inventario fisico vs SAP.html"

fallos, avisos = [], []
def ok(c, titulo, detalle=""):
    print(("  OK   " if c else "  FALLA ") + titulo + (" · " + detalle if detalle else ""))
    if not c:
        fallos.append(titulo)

# ---------------------------------------------------------------- dataset
d = json.load(io.open(RAIZ + "sistema/datos.json", encoding="utf-8"))
k, m = d["kpis"], d["meta"]
clases = collections.Counter(c["clasificacion"] for c in d["casos"])
T = {c[0]: n for c, n in clases.items()}
al = k["almacen"]

print("\n=== 1. EL DATASET ===")
ok(len(d["casos"]) == 1991, "1.991 casos en total", str(len(d["casos"])))
ok(sum(T.values()) == len(d["casos"]), "las clases suman el total",
   " ".join("%s=%d" % (x, T[x]) for x in sorted(T)))
ok(k["items_fisicos"] == 687, "687 ítems físicos", str(k["items_fisicos"]))
ok(sum(f["items"] for f in m["fuentes"]) == k["items_fisicos"],
   "los ítems por base suman el total de ítems físicos")
ok(abs(sum(f["unidades"] for f in m["fuentes"]) - k["unidades_fisicas"]) < 0.01,
   "las unidades por base suman el total")
ok(T.get("F", 0) == 30, "30 materiales de SAP con existencia cero (clase F)", str(T.get("F")))
ok(all(c.get("almacen_estado") for c in d["casos"] if (c.get("stock_sap") or 0) > 0),
   "todo caso con stock en SAP tiene estado de ubicación")
ok(sum(al.values()) == sum(1 for c in d["casos"] if c.get("almacen_estado")),
   "el recuento de ubicación cubre todos los casos con ubicación")
ok(len(m["almacenes"]["propuesta"]) == 6, "6 propuestas de almacén (3 bases x 2 tipos)")
ok(all(p["confianza"] in ("Clara", "Ambigua") for p in m["almacenes"]["propuesta"]),
   "cada propuesta declara su confianza")
amb = [p for p in m["almacenes"]["propuesta"] if p["confianza"] == "Ambigua"]
ok(all(p["nota"] for p in amb), "toda propuesta ambigua explica por qué",
   "%d ambigua(s)" % len(amb))
# cada almacén pertenece a una sola base: eso es lo OBSERVADO
porbase = m["almacenes"]["por_base"]
todos = [a for v in porbase.values() for a in v]
ok(len(todos) == len(set(todos)), "ningún almacén aparece en dos bases (está observado)")
ok(m["sap"]["es_maestro_completo"] is False,
   "el dataset declara que la bajada NO es el maestro completo")
ok(k["pendientes_valorizacion"] == len(d["casos"]),
   "todos los casos quedan pendientes de valorización (no hay precio de última compra)")
ok(m["valorizacion"]["disponible"] is False,
   "el dataset declara que el precio de última compra no está disponible")

# ---------------------------------------------------------------- Excel
print("\n=== 2. EL EXCEL ===")
# recalcular con LibreOffice para leer los valores de las fórmulas
if not os.path.exists(S + "audit/" + os.path.basename(XLSX)):
    os.makedirs(S + "audit", exist_ok=True)
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir",
                    S + "audit", XLSX], check=True, capture_output=True, timeout=600)
z = zipfile.ZipFile(S + "audit/" + os.path.basename(XLSX))
sst = []
if "xl/sharedStrings.xml" in z.namelist():
    x = z.read("xl/sharedStrings.xml").decode("utf-8")
    sst = [re.sub(r"<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", x, re.S)]
wb = z.read("xl/workbook.xml").decode("utf-8")
hojas = [h for h in re.findall(r'<sheet name="([^"]+)"', wb)]
idx = {h: i + 1 for i, h in enumerate(hojas)}

def celdas(nombre):
    x = z.read("xl/worksheets/sheet%d.xml" % idx[nombre]).decode("utf-8")
    out = {}
    for c in re.finditer(r'<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)</c>', x, re.S):
        col, row, attrs, body = c.group(1), int(c.group(2)), c.group(3), c.group(4)
        v = re.search(r"<v>(.*?)</v>", body, re.S)
        if not v:
            continue
        val = v.group(1)
        if 't="s"' in attrs:
            val = sst[int(val)] if int(val) < len(sst) else val
        out.setdefault(row, {})[col] = val
    return out

esperadas = ["Resumen", "Casos", "A Identificados", "B Verificar en el maestro",
             "C Propuestas de baja", "D A revisar", "E Fuera del alcance",
             "F Maestro sin stock", "Almacenes", "Depuración del maestro", "Lotes",
             "Nomenclaturas unificadas", "Decisiones", "Control", "Metodología"]
ok(hojas == esperadas, "las 15 hojas, en orden", "%d hojas" % len(hojas))

res = celdas("Resumen")
def buscar(etiqueta):
    for n in sorted(res):
        if res[n].get("A", "").strip() == etiqueta:
            return res[n].get("B", "")
    return None

ok(buscar("Casos totales") == str(len(d["casos"])),
   "«Casos totales» del Resumen coincide con el dataset", str(buscar("Casos totales")))
ok(buscar("Ítems de los inventarios físicos") == str(k["items_fisicos"]),
   "«Ítems de los inventarios físicos» coincide")
for cl, n in sorted(clases.items()):
    v = buscar(cl)
    ok(v is not None and int(float(v)) == n, "clase «%s» en el Resumen" % cl[:1], "%s vs %d" % (v, n))
ok(buscar("Casos de clase B") == str(T["B"]), "«Casos de clase B» coincide")
ok(buscar("Sin alternativa elegida") == str(T["B"]),
   "sin decisiones, los 58 casos B están sin alternativa elegida")
for est, n in al.items():
    if est == "Sin stock, sin almacén":
        continue
    v = buscar(est)
    ok(v is not None and int(float(v)) == n, "ubicación «%s» en el Resumen" % est, "%s vs %d" % (v, n))
ok(buscar("Materiales sin stock a la vista") == str(T["F"]),
   "«Materiales sin stock a la vista» coincide con la clase F")

ctl = celdas("Control")
estados = [ctl[n].get("E", "") for n in sorted(ctl) if ctl[n].get("E", "")]
estados = [e for e in estados if e != "Estado"]
ok(all(e in ("Coincide", "Informativo") for e in estados),
   "todos los controles del Excel cierran",
   " ".join(sorted(set(estados))))
ok(len(estados) >= 10, "hay al menos 10 controles", "%d controles" % len(estados))

casos = celdas("Casos")
cab = casos[4]
ncols = len(cab)
ok(ncols == 50, "la hoja Casos tiene 50 columnas", str(ncols))
ok(cab.get("AN", "").startswith("Almacén donde"), "AN es el almacén donde figura el stock")
ok(cab.get("AQ", "") == "Estado de la ubicación", "AQ es el estado de la ubicación")
ok(cab.get("AT", "").startswith("Alternativa elegida"), "AT es la alternativa de clase B")
ok(cab.get("AX", "").startswith("Ligado a la depuración"), "AX es el ligado a la depuración")
ok(len([n for n in casos if n >= 5 and casos[n].get("B")]) == len(d["casos"]),
   "una fila por caso en la hoja Casos")

alm = celdas("Almacenes")
txt_alm = " ".join(v for n in alm for v in alm[n].values())
ok("PENDIENTE" in txt_alm, "la hoja Almacenes marca la validación como PENDIENTE")
ok("no es una suposición" in txt_alm or "NO es una suposición" in txt_alm,
   "la hoja Almacenes distingue lo observado de la propuesta")
for p in m["almacenes"]["propuesta"]:
    hay = any(alm[n].get("A") == p["base"] and alm[n].get("B") == p["tipo"]
              and alm[n].get("C") == p["almacen"] and alm[n].get("D") == p["confianza"]
              for n in alm)
    ok(hay, "propuesta %s/%s = %s (%s) en el Excel" % (p["base"], p["tipo"], p["almacen"], p["confianza"]))

dep = celdas("Depuración del maestro")
txt_dep = " ".join(v for n in dep for v in dep[n].values())
ok("punta visible" in txt_dep, "la hoja de depuración dice que es la punta visible")
ok("No hay política masiva definida" in txt_dep,
   "sin decisiones, no hay política masiva")
codigos_dep = [dep[n]["A"] for n in sorted(dep) if re.fullmatch(r"\d+", dep[n].get("A", ""))]
ok(len(codigos_dep) == T["F"], "los %d materiales sin stock están listados" % T["F"],
   str(len(codigos_dep)))

# ---------------------------------------------------------------- PDF
print("\n=== 3. EL PDF ===")
txt = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True,
                     check=True).stdout.decode("utf-8")
paginas = txt.count("\f")
ok(paginas == 20, "20 páginas", str(paginas))
ok(paginas < 30, "es un informe ejecutivo, no un listado")

def miles(n):
    return "{:,}".format(int(n)).replace(",", ".")

for etiqueta, n in [("casos", len(d["casos"])), ("ítems físicos", k["items_fisicos"]),
                    ("unidades", int(k["unidades_fisicas"]))]:
    ok(miles(n) in txt, "la cifra de %s (%s) está en el PDF" % (etiqueta, miles(n)))
for cl in "ABCDEF":
    ok(miles(T[cl]) in txt, "el recuento de la clase %s (%s) está en el PDF" % (cl, miles(T[cl])))
for est in ("Almacén correcto", "Almacén a cambiar"):
    ok(miles(al[est]) in txt, "la cifra de «%s» (%s) está en el PDF" % (est, miles(al[est])))

# que NO haya vuelto el listado general
ok("Detalle de los materiales identificados" not in txt,
   "el PDF ya no trae el listado de identificados")
ok("Detalle de los materiales propuestos para baja" not in txt,
   "el PDF ya no trae el listado de bajas")
ok("Dónde está el detalle" in txt, "el PDF dice dónde está el detalle")

for frase, titulo in [
    ("dos alternativas", "el PDF explica las dos alternativas de la clase B"),
    ("Código duplicado", "el PDF nombra el riesgo de código duplicado"),
    ("Depuración del maestro", "el PDF tiene la sección de depuración del maestro"),
    ("punta visible", "el PDF aclara que lo visible no es todo el universo"),
    ("no es el maestro completo", "el PDF aclara el alcance de la bajada de SAP"),
    ("nunca por parecido de nombres", "el PDF dice que la propuesta no sale de los nombres"),
    ("modifica SAP", "el PDF aclara que nada modifica SAP"),
    ("no ejecuta ninguna modificación sobre SAP",
     "el PDF lo dice ya en la primera página"),
]:
    ok(frase in txt, titulo)

# ---------------------------------------------------------------- sistema
print("\n=== 4. EL SISTEMA ===")
h = io.open(HTML, encoding="utf-8").read()
ok("<script src=" not in h and 'href="estilos' not in h,
   "el sistema es un archivo único, sin referencias externas")
ok(len(h) > 3_000_000, "el sistema lleva los datos adentro", "%.1f MB" % (len(h) / 1024 / 1024))
for frase, titulo in [
    ("Crear sin verificar el maestro", "el sistema tiene la alternativa 2"),
    ("riesgo de generar un código duplicado", "el sistema explica el riesgo al preguntar"),
    ("Depuración del maestro de materiales", "el sistema tiene el módulo de depuración"),
    ("Dar de baja del maestro", "el sistema ofrece las tres acciones de depuración"),
    ("excepción a la política masiva", "el sistema registra excepciones a la política masiva"),
    ("v-depurar", "el sistema tiene la vista del maestro"),
    ("Almacén a cambiar", "el sistema clasifica la ubicación"),
    ("no es una suposición", "el sistema distingue lo observado de la propuesta"),
]:
    ok(frase in h, titulo)

# ---------------------------------------------------------------- originales
print("\n=== 5. LOS ORIGINALES ===")
for n, md5 in [("Stock SAP vs Inventario Fisico Avain - cruce.xlsx",
                "1948e8f3f5f1350995d90ed83e97422a")]:
    v = hashlib.md5(io.open(RAIZ + n, "rb").read()).hexdigest()
    ok(v == md5, "«%s» sigue intacto" % n, v)
for n in ["RV__Bajadas_Stock_Bases_Op_Complejas_SAP.zip",
          "Homologacion_Farmacia_AVAIN_con_SAP.xlsx"]:
    ok(os.path.exists(RAIZ + n), "«%s» sigue en su lugar" % n)

print("\n" + "=" * 60)
print("FALLAS: %d" % len(fallos))
for f in fallos:
    print("   - " + f)
sys.exit(1 if fallos else 0)
