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
HTML = RAIZ + "Inventario fisico vs SAP - consulta.html"

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
conv = S + "audit/" + os.path.basename(XLSX)
if not os.path.exists(conv) or os.path.getmtime(conv) < os.path.getmtime(XLSX):
    os.makedirs(S + "audit", exist_ok=True)
    if os.path.exists(conv):
        os.remove(conv)
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

esperadas = ["Resumen", "Qué hacer en SAP", "Casos", "Maestro general", "Lotes",
             "Decisiones", "Control"]
ok(hojas == esperadas, "las 7 hojas, en orden", "%d hojas: %s" % (len(hojas), " · ".join(hojas)))

res = celdas("Resumen")
def buscar(etiqueta):
    for n in sorted(res):
        if res[n].get("A", "").strip() == etiqueta:
            return res[n].get("B", "")
    return None

def buscarPrefijo(pref):
    for n in sorted(res):
        if res[n].get("A", "").strip().startswith(pref):
            return res[n].get("B", "")
    return None
ok(buscarPrefijo("Casos totales") == str(len(d["casos"])),
   "«Casos totales» del Resumen coincide con el dataset", str(buscarPrefijo("Casos totales")))
ok(buscar("Ítems de los inventarios físicos") == str(k["items_fisicos"]),
   "«Ítems de los inventarios físicos» coincide")
for cl, n in sorted(clases.items()):
    v = buscar(cl)
    ok(v is not None and int(float(v)) == n, "clase «%s» en el Resumen" % cl[:1], "%s vs %d" % (v, n))
ok(buscar("Casos de clase B") == str(T["B"]), "«Casos de clase B» coincide")
ok(buscar("Sin alternativa elegida") == str(T["B"]),
   "sin decisiones, los %d casos B están sin alternativa elegida" % T["B"])
for est, n in al.items():
    if est == "Sin stock, sin almacén":
        continue
    v = buscar(est)
    ok(v is not None and int(float(v)) == n, "ubicación «%s» en el Resumen" % est, "%s vs %d" % (v, n))
ok(buscar("Materiales sin stock a la vista") == str(T["F"]),
   "«Materiales sin stock a la vista» coincide con la clase F")
ok(buscar("Ítem") is not None, "el Resumen abre con el glosario de magnitudes")
ok(buscar("Unidades físicas contadas") == str(int(k["unidades_fisicas"])),
   "«Unidades físicas contadas» coincide con el dataset")
ok(buscar("Materiales de SAP sin identificar (casos)") ==
   str(len(d["casos"]) - k["items_fisicos"]),
   "los casos de SAP cierran contra los ítems físicos")
cab_casos = celdas("Casos")[4]
ok(cab_casos.get("O") == "Unidades CONTADAS en el depósito",
   "la columna O dice que son unidades contadas")
ok(cab_casos.get("P") == "Unidades de STOCK EN SAP en esa base",
   "la columna P dice que son unidades de SAP")

# La hoja que dice qué hacer: es la que reemplazó a las seis por clasificación.
acc = celdas("Qué hacer en SAP")
cab_acc = [acc[4].get(c, "") for c in ("A", "B", "C", "D", "E", "F")]
ok(cab_acc[:5] == ["Qué hacer en SAP", "¿Falta decidirlo?", "Base", "Centro", "Almacén"],
   "«Qué hacer en SAP» abre con la acción, si falta decidirla y dónde",
   " | ".join(cab_acc))
filas_acc = [acc[n] for n in sorted(acc) if n >= 5 and acc[n].get("A")]
filas_acc = [f for f in filas_acc if f.get("A") != "TOTAL"]
ok(len(filas_acc) == len(d["casos"]),
   "hay una acción por caso, sin excepción", "%d de %d" % (len(filas_acc), len(d["casos"])))
ok(all(f.get("K") for f in filas_acc),
   "cada acción trae el detalle concreto para ejecutarla")
acciones = collections.Counter(f["A"] for f in filas_acc)
ok(all(a.startswith("PENDIENTE") or a.startswith("Ninguna") for a in acciones),
   "sin decisiones tomadas, toda acción está pendiente o no corresponde",
   " · ".join(sorted(acciones)))
ok(acciones.get("Ninguna · fuera del alcance") == T["E"],
   "los casos fuera del alcance se declaran como tales")
ok(acciones.get("PENDIENTE · decidir la baja") == T["C"],
   "las bajas aparecen como decisión pendiente")

# El formato: lo que estiraba una fila a media pantalla era el ajuste
# automático de alto sobre una nota larga envuelta en una columna angosta.
import xml.etree.ElementTree as ET
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
for hoja in esperadas:
    x = z.read("xl/worksheets/sheet%d.xml" % idx[hoja]).decode("utf-8")
    raiz = ET.fromstring(x)
    altos = {}
    for fila in raiz.iter(NS + "row"):
        if fila.get("ht"):
            altos[int(fila.get("r"))] = float(fila.get("ht"))
    ok(altos.get(1) and altos.get(2),
       "«%s» fija el alto del título y de la nota" % hoja,
       "título=%s nota=%s" % (altos.get(1), altos.get(2)))
    ok(all(v <= 40 for v in altos.values()),
       "«%s» no tiene ninguna fila desbordada" % hoja,
       "máximo %s" % (max(altos.values()) if altos else 0))
zo = zipfile.ZipFile(XLSX)
est = zo.read("xl/styles.xml").decode("utf-8")
ok(est.count('wrapText="1"') == 1,
   "sólo el encabezado envuelve el texto; los datos no",
   "%d estilos con wrapText" % est.count('wrapText="1"'))
zo.close()

mg = celdas("Maestro general")
cab_mg = [mg[4].get(c, "") for c in ("A", "B", "C")]
ok(cab_mg == ["Código SAP", "Nomenclatura SAP", "Importe última compra"],
   "el maestro general trae código, nomenclatura e importe", " | ".join(cab_mg))
cods_mg = [mg[n]["A"] for n in sorted(mg) if re.fullmatch(r"\d+", mg[n].get("A", ""))]
ok(len(cods_mg) == len(set(cods_mg)),
   "sin duplicar un material por base ni por almacén", "%d códigos" % len(cods_mg))

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

# La propuesta de almacén, las equivalencias y la metodología dejaron de ser
# hojas sueltas y están en el Resumen, junto a las cifras que condicionan.
txt_res = " ".join(v for n in res for v in res[n].values())
ok("PENDIENTE DE VALIDACIÓN" in txt_res,
   "el Resumen marca la propuesta de almacén como pendiente de validación")
ok("no es una suposición" in txt_res,
   "y distingue lo observado de lo propuesto")
for p in m["almacenes"]["propuesta"]:
    hay = any(res[n].get("A") == p["base"] and res[n].get("B") == p["tipo"]
              and res[n].get("C") == p["almacen"] and res[n].get("D") == p["confianza"]
              for n in res)
    ok(hay, "propuesta %s/%s = %s (%s) en el Excel" % (p["base"], p["tipo"], p["almacen"], p["confianza"]))
ok("Lo ambiguo es el" in txt_res, "«Ambigua» explica qué es lo ambiguo")
ok("EQUIVALENCIAS DE NOMENCLATURA DECLARADAS" in txt_res,
   "el Resumen trae las equivalencias declaradas")
ok("VARIAS nomenclaturas del depósito" in txt_res and "VARIOS códigos de SAP" in txt_res,
   "y explica los dos sentidos")
ok("CÓMO SE DECIDE UNA CORRESPONDENCIA" in txt_res,
   "y la metodología, en vez de una hoja aparte")
ok("esterilidad" in txt_res, "la metodología nombra la esterilidad entre las características")
ok("nunca tuvo existencia en ninguno de los tres" in txt_res,
   "y dice honestamente de dónde salió el maestro")

# Los materiales del maestro sin existencia ya no tienen hoja propia: su
# decisión está en «Qué hacer en SAP», que es donde hay que leerla.
dep_acc = [f for f in filas_acc if "maestro" in f.get("A", "")]
ok(len(dep_acc) == T["F"],
   "los %d materiales sin existencia tienen su acción" % T["F"], str(len(dep_acc)))

# ---------------------------------------------------------------- PDF
print("\n=== 3. EL PDF ===")
txt = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True,
                     check=True).stdout.decode("utf-8")
paginas = txt.count("\f")
# Dos lecturas del mismo PDF: con -layout se respetan las columnas (sirve para
# ver la maqueta), y sin -layout se respeta el orden de lectura. Una frase dentro
# de una celda de tabla sólo queda entera en la segunda, porque con -layout la
# parte el texto de la columna de al lado. Se buscan las frases en las dos.
crudo = subprocess.run(["pdftotext", PDF, "-"], capture_output=True,
                       check=True).stdout.decode("utf-8")
plano = re.sub(r"\s+", " ", txt) + " \u2016 " + re.sub(r"\s+", " ", crudo)
ok(paginas == 22, "22 páginas", str(paginas))
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
    ("tres maneras de contar lo mismo", "el PDF fija el vocabulario antes de los resultados"),
    ("no son la misma magnitud", "el PDF advierte que las unidades contadas y las de SAP no se suman"),
    ("dos alternativas", "el PDF explica las dos alternativas de la clase B"),
    ("Código duplicado", "el PDF nombra el riesgo de código duplicado"),
    ("Depuración del maestro", "el PDF tiene la sección de depuración del maestro"),
    ("punta visible", "el PDF aclara que lo visible no es todo el universo"),
    ("no es el maestro completo", "el PDF aclara el alcance de la bajada de SAP"),
    ("nunca por parecido de nombres", "el PDF dice que la propuesta no sale de los nombres"),
    ("modifica SAP", "el PDF aclara que nada modifica SAP"),
    ("no ejecuta ninguna modificación sobre SAP",
     "el PDF lo dice ya en la primera página"),
    ("no es uno a uno en ninguno de los dos sentidos",
     "el PDF dice que la correspondencia no es uno a uno en ninguno de los dos sentidos"),
    ("Una del depósito = varios de SAP",
     "el PDF explica el sentido «una del depósito = varios de SAP»"),
    ("Varias del depósito = uno de SAP",
     "el PDF explica el sentido «varias del depósito = uno de SAP»"),
    ("no por el parecido del nombre",
     "el PDF aclara que una equivalencia no se propone por el nombre"),
    ("en qué almacén está su stock",
     "el PDF dice que el almacén se ve donde se decide"),
    ("la confirma una persona",
     "el PDF deja claro que la equivalencia la confirma una persona"),
]:
    ok(frase.lower() in plano.lower(), titulo)

# ---------------------------------------------------------------- sistema
print("\n=== 4. EL SISTEMA ===")
h = io.open(HTML, encoding="utf-8").read()
ok("<script src=" not in h and 'href="estilos' not in h,
   "la copia de consulta es un archivo único, sin referencias externas")
ok(len(h) > 3_000_000, "la copia lleva los datos adentro", "%.1f MB" % (len(h) / 1024 / 1024))
ok("INVSAP_SOLO_CONSULTA = true" in h,
   "la copia viene marcada como de sólo consulta")
for frase, titulo in [
    ("ítems, unidades y casos", "el sistema distingue las tres magnitudes"),
    ("Unidades CONTADAS en el depósito", "el Excel rotula las unidades contadas"),
    ("Unidades de STOCK EN SAP", "el Excel rotula las unidades de SAP"),
    ("no son la misma magnitud", "el sistema advierte que no se suman"),
]:
    ok(frase.lower() in h.lower(), titulo)
ok("Esta copia es para consultar" in h,
   "la copia explica dónde se decide")
ok('data-vista="revisar"' not in h and ">Trabajar<" in h,
   "Inicio y Revisar son una sola pantalla")
ap0 = io.open(RAIZ + "sistema/app.js", encoding="utf-8").read()
sin_coment = re.sub(r"/\*[\s\S]*?\*/", "", re.sub(r"(?m)^\s*//.*$", "", ap0))
ok("VER_REUSA" not in sin_coment and "reutiliza" not in sin_coment,
   "«existe sin stock · reutilizar ese código» ya no es una opción")

# El servidor: lo que convierte esto en una aplicación y no en un archivo.
print("\n=== 4b. LA APLICACIÓN ===")
for n in ["servidor/servidor.js", "servidor/db.js", "servidor/entra.js",
          "servidor/operacion.js", "servidor/README.md", "package.json",
          "servidor/instalar/inventario.service", "servidor/instalar/Dockerfile",
          "servidor/instalar/instalar.sh", "servidor/instalar/inventario.env.ejemplo"]:
    ok(os.path.exists(RAIZ + n), "existe %s" % n)
srv = io.open(RAIZ + "servidor/servidor.js", encoding="utf-8").read()
ok("INVSAP_AUTH" in srv and "127.0.0.1" in srv,
   "el modo sin autenticación exige escuchar en localhost")
ent = io.open(RAIZ + "servidor/entra.js", encoding="utf-8").read()
for frase, titulo in [
    ("code_challenge_method", "el ingreso usa PKCE"),
    ("crypto.verify", "se verifica la firma del id_token"),
    ("#ext#", "se rechaza a los usuarios invitados"),
    ("claims.nonce !== nonceEsperado", "se verifica el nonce"),
    ("claims.tid !== this.cfg.tenantId", "se verifica el inquilino"),
]:
    ok(frase in ent, titulo)
ok("client_secret" not in ent.split("urlIngreso")[1].split("}")[0],
   "el secreto no viaja en la URL de autorización")
dbjs = io.open(RAIZ + "servidor/db.js", encoding="utf-8").read()
ok("BEGIN IMMEDIATE" in dbjs, "las escrituras van en transacción")
ok("decision_historial" in dbjs, "hay historial de decisiones")
for frase, titulo in [
    ("Crear sin verificar el maestro", "el sistema tiene la alternativa 2"),
    ("riesgo de generar un código duplicado", "el sistema explica el riesgo al preguntar"),
    ("Depuración del maestro de materiales", "el sistema tiene el módulo de depuración"),
    ("Dar de baja del maestro", "el sistema ofrece las tres acciones de depuración"),
    ("excepción a la política masiva", "el sistema registra excepciones a la política masiva"),
    ("v-depurar", "el sistema tiene la vista del maestro"),
    ("Almacén a cambiar", "el sistema clasifica la ubicación"),
    ("no es una suposición", "el sistema distingue lo observado de la propuesta"),
    ("podrían ser este mismo producto",
     "el sistema propone qué otros ítems del depósito serían el mismo producto"),
    ("Comparten candidato en SAP",
     "el sistema explica de dónde sale la propuesta de equivalencia"),
    ("nomenclaturas del depósito",
     "el sistema cuenta las nomenclaturas del depósito que se declaran equivalentes"),
    ("códigos de SAP",
     "el sistema cuenta los códigos de SAP del grupo"),
    ("Declarar equivalentes",
     "el sistema tiene la acción de declarar equivalentes"),
    ("En qué almacén está el stock no importa acá",
     "el almacén sale del paso de identificar: no dice qué material es"),
    ("propuesta a validar",
     "el sistema recuerda que la correspondencia base-almacén está sin validar"),
    ("¿En qué almacén tiene que cuadrar?",
     "el ajuste de stock elige el almacén donde cuadra"),
    ("Dónde se da de alta",
     "al crear un material se propone centro y almacén"),
    ("La presentación no dice lo mismo de los dos lados",
     "se puede declarar que dos presentaciones son la misma"),
    ("Vale para el par en todas las bases",
     "y esa declaración no se vuelve a preguntar en otra base"),
    ("Retomaste donde habías quedado",
     "el sistema retoma la sesión donde quedó"),
    ("Etapa 2 · Qué es cada cosa",
     "los grupos cuelgan de la etapa a la que pertenecen"),
    ("sin stock en ",
     "el sistema avisa cuando el candidato no tiene stock en esa base"),
]:
    ok(frase in h, titulo)

# Las equivalencias se calculan en Python con comparación de atributos, no en el
# navegador por parecido de nombres: es el arreglo de un falso positivo real.
eqpy = io.open(RAIZ + "scripts/v3/equivalencias.py", encoding="utf-8").read()
ok("UMBRAL_SIN_ATRIBUTOS" in eqpy and "DEBILES" in eqpy,
   "las equivalencias exigen características verificables, no sólo nombre")
ok("equivalencias" in m, "el dataset trae las equivalencias calculadas")
eq = m.get("equivalencias", {})
ok(len(eq) > 0, "hay equivalencias propuestas", "%d ítems" % len(eq))
ok(all(x["fuertes"] or x["parecido"] >= 0.72 for v in eq.values() for x in v),
   "ninguna propuesta se sostiene sólo en un atributo débil")
ok(all(x["id"] in eq and any(y["id"] == a for y in eq[x["id"]])
       for a, v in eq.items() for x in v),
   "las equivalencias son simétricas: valen en los dos sentidos")
# El panel de gestión: que Inicio sea donde se decide y no un tablero que
# obliga a entrar a otro lado.
for frase, titulo in [
    ("Hoja de ruta", "Inicio abre con la hoja de ruta"),
    ("Alcance del análisis", "se puede acotar el análisis a una base"),
    ("Por qué aparece acá", "cada caso dice por qué el sistema lo levantó"),
    ("tjpreg", "cada caso se presenta como una pregunta concreta"),
    ("Antes de aplicar, esto es a lo que alcanza",
     "una decisión en lote muestra su alcance antes de ejecutarse"),
    ("no cumplen las condiciones y quedan afuera",
     "y dice qué registros quedan afuera"),
    ("Entiendo el alcance", "las decisiones de riesgo piden confirmación expresa"),
    ("Volver a la bandeja",
     "el modo de a uno es un modo de la pantalla de trabajo, no otra pantalla"),
    ("Maestro general", "Maestro tiene el maestro general unificado"),
    ("Importe última compra", "con el importe de última compra"),
    ("Equivalencias de nomenclatura", "y las equivalencias declaradas"),
    ("Almacenes por base", "y la propuesta de almacén por base"),
    ("Lo ambiguo es el almacén", "«Ambigua» explica qué es lo ambiguo"),
    ("ajuste de stock, no un alta",
     "el sistema distingue el ajuste de stock del alta de un material"),
    ("¿En qué almacén tiene que cuadrar?",
     "y el ajuste contempla el almacén donde tiene que cuadrar"),
    ("pendiente de valorizar",
     "lo que no tiene importe se informa como pendiente, no como cero"),
    ("INVENTARIO FÍSICO", "los bloques distinguen el inventario físico"),
]:
    ok(frase.lower() in h.lower(), titulo)

# El modo oscuro: que ninguna pieza se defina con texto blanco fijo sobre un
# color que en oscuro es claro.
css = io.open(RAIZ + "sistema/estilos.css", encoding="utf-8").read()
ok("--sobreAcento" in css and "--sobreColor" in css,
   "el texto sobre un color se calcula, no se fija en blanco")
ok(css.count("prefers-color-scheme: dark") >= 3,
   "el modo oscuro redefine la paleta completa")
ok("#v-informe{color-scheme:light" in css.replace(" ", ""),
   "el informe se imprime en blanco con tinta negra en los dos temas")
import re as _re
pri = _re.search(r"\.btn\.pri\{[^}]*\}", css)
ok(bool(pri) and "color:#fff" not in (pri.group(0) if pri else ""),
   "el botón primario no lleva blanco fijo")

# Una sola implementación de cada decisión.
ap = io.open(RAIZ + "sistema/app.js", encoding="utf-8").read()
ok("function aplicar(c, a, ctx)" in ap, "las decisiones tienen una sola implementación")
ok(ap.count("almacen_decision:") == 1,
   "la decisión de ubicación se escribe en un solo lugar",
   "%d lugares" % ap.count("almacen_decision:"))
ok("COMPARTIDAS[a]" in ap, "la ficha usa esa misma implementación")

ubic = m["almacenes"].get("ubicacion", {})
ok(len(ubic) > 0, "el dataset dice en qué almacén figura cada material por base",
   "%d pares base|material" % len(ubic))

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
