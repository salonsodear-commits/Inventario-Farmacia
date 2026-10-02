# -*- coding: utf-8 -*-
"""Genera el archivo corregido a partir de la bajada original de SAP.

Se parte del archivo SAP original para que las hojas de detalle conserven
formato, filas y formulas, y sobre eso se aplican las correcciones pedidas en
la revision.
"""
import collections, json, os, re, shutil, zipfile
import openpyxl
from openpyxl.styles import Alignment
import estilo as E
from estilo import L
import load, match, clasif, conciliar, paths
import gen_detalle, gen_hojas, gen_resumen, gen_control, gen_guia
import validar_ooxml

OUT = os.path.join(paths.RAIZ, "Stock SAP vs Inventario Fisico Avain - cruce.xlsx")
ORDEN = ["Guía paso a paso", "Resumen del cruce", "Conciliación",
         "Dar de baja en SAP",
         "Dar de alta en SAP", "Sin correspondencia SAP",
         "1120 SJ", "1060 NQN", "1130 Salta", "Control de cantidades",
         "Posibles duplicidades", "Fuera del Master", "Metodología"]


def main():
    sap = load.load_sap()
    filas, meta = conciliar.construir()
    # keep_links=False descarta el vinculo a un libro externo que traia la bajada
    # de SAP. Ese vinculo era la causa del aviso "no se puede actualizar" y de que
    # Excel reparase el archivo (sus valores en cache no sobreviven a openpyxl).
    wb = openpyxl.load_workbook(paths.dato(paths.STOCK_SAP), data_only=False,
                                keep_links=False)
    cuentas = _cuentas_en_cache()

    # ---------- hojas de detalle SAP
    geo = {}
    for sheet, (r0, r1) in conciliar.GEO.items():
        geo[sheet] = gen_detalle.escribir(wb[sheet], sheet, sap[sheet], filas, r0, r1)
        _fijar_cuenta(wb[sheet], sheet, cuentas, r0, r1)

    # ---------- hoja unificada de conciliacion
    conc = gen_hojas.conciliacion(wb, filas, geo)

    # ---------- hojas operativas
    bajas = [d for d in filas if d["accion"] == clasif.ACC_BAJA]
    altas = [d for d in filas if d["accion"] == clasif.ACC_ALTA]
    nuevos = [d for d in filas if d["accion"] == clasif.ACC_NUEVO]
    bajas.sort(key=lambda d: -(abs(d["dif"]) * (d["vu"] or 0)))
    altas.sort(key=lambda d: -(abs(d["dif"]) * (d["vu"] or 0)))
    nuevos.sort(key=lambda d: (d["base"], -d["cant_fis"]))

    r_baja = gen_hojas.operativa(
        wb, "Dar de baja en SAP", "Materiales a dar de baja en SAP",
        "Materiales con recuento físico donde SAP informa MÁS unidades que el "
        "recuento. La cantidad a ajustar es la diferencia y se valoriza al valor "
        "promedio ponderado. Ordenado por impacto económico.",
        bajas, "baja", pos=2)
    r_alta = gen_hojas.operativa(
        wb, "Dar de alta en SAP", "Materiales a dar de alta en SAP",
        "Materiales con recuento físico donde el recuento SUPERA lo informado en "
        "SAP. La cantidad a ajustar es la diferencia y se valoriza al valor "
        "promedio ponderado. Ordenado por impacto económico.",
        altas, "alta", pos=3)
    r_nuevo = gen_hojas.operativa(
        wb, "Sin correspondencia SAP",
        "Ítems del inventario físico sin correspondencia en SAP",
        "Ítems relevados por Avain que no tienen código SAP en este centro. "
        "Requieren alta de material o completar la homologación. No tienen valor "
        "unitario en SAP, por lo que la valorización no puede calcularse.",
        nuevos, "nuevo", pos=4)

    # ---------- resumen
    extra = {}
    for base in gen_resumen.BASES:
        fb = [d for d in filas if d["base"] == base]
        niv = collections.Counter()
        for d in fb:
            if d["origen"] != "Stock SAP":
                niv["Sin coincidencia"] += 1
            elif d["tiene_recuento"]:
                niv[d["nivel"]] += 1
        sapf = [d for d in fb if d["origen"] == "Stock SAP"]
        extra[base] = {
            "items_fisico": sum(1 for d in fb if d["origen"] != "Stock SAP")
                            + sum(1 for d in sapf if d["tiene_recuento"]),
            "Alta": niv["Alta"], "Media": niv["Media"], "Baja": niv["Baja"],
            "Sin coincidencia": niv["Sin coincidencia"],
            "materiales_sap": len(sapf),
            "materiales_con_recuento": sum(1 for d in sapf if d["tiene_recuento"]),
            "fuera_alcance": sum(1 for d in sapf
                                 if d["accion"] == clasif.ACC_FUERA),
            "sin_recuento": sum(1 for d in sapf
                                if d["accion"] == clasif.ACC_SIN_REC),
        }
    gen_resumen.escribir(wb, conc, extra, geo)

    # ---------- control de cantidades
    gen_control.escribir(wb, filas, sap, geo)

    # ---------- guia paso a paso (primera hoja)
    gen_guia.escribir(wb)

    # ---------- hojas de respaldo
    _lista(wb, "Posibles duplicidades",
           "Posibles duplicidades de código SAP",
           "El cruce identificó más de un código SAP como posible equivalente del "
           "mismo ítem de Avain. Se imputó al primero (lógica BUSCARV). Requiere "
           "validación.",
           [d for d in filas if d["duplicidad"]])
    _lista(wb, "Fuera del Master",
           "Materiales con recuento que no estaban en el Master de Seba",
           "Tienen recuento físico y código SAP, pero no figuran en el Master. La "
           "homologación cubre 284 ítems: el universo real del cruce es mayor.",
           [d for d in filas if d["origen"] == "Stock SAP" and d["tiene_recuento"]
            and not d["en_master"]])
    _metodologia(wb, geo, conc)

    # ---------- orden de hojas
    wb._sheets.sort(key=lambda s: ORDEN.index(s.title)
                    if s.title in ORDEN else len(ORDEN))
    vacias = _sanear(wb)
    wb.save(OUT)
    limpias = _limpiar_xml(OUT)
    print(f"  celdas de texto vacío normalizadas: {vacias:,}")
    print(f"  valores en caché vacíos y tipos sobrantes depurados: {limpias:,}")

    # control estructural del paquete: Excel rechaza el archivo ante cualquiera
    # de estos defectos, aunque LibreOffice lo abra sin quejarse
    problemas = validar_ooxml.validar(OUT, verbose=False)
    if problemas:
        print("  ATENCIÓN · el archivo tiene problemas estructurales:")
        for p_ in problemas:
            print("    -", p_)
        raise SystemExit(1)
    print("  control estructural del archivo: sin problemas")

    print("Generado:", OUT)
    print(f"  Conciliación: filas {conc['ini']}..{conc['fin']} "
          f"({conc['fin']-conc['ini']+1} registros)")
    for n, r in [("Dar de baja", r_baja), ("Dar de alta", r_alta),
                 ("Sin correspondencia", r_nuevo)]:
        print(f"  {n:<20} {r['n']:>4} filas · {r['cantidad']:>10,.0f} u · "
              f"$ {r['valor']:>16,.2f}")
    for sheet, g in geo.items():
        print(f"  {sheet:<12} SAP {g['r0']}..{g['r1']} · físico "
              f"{g['primera_fisico']}..{g['ultima']} · total fila {g['fila_total']}"
              f" · filtro A1:...{g['ultima']}")
    json.dump({"geo": geo, "conc": conc}, open(paths.salida("geo_v2.json"), "w"),
              ensure_ascii=False, indent=1)


def _cuentas_en_cache():
    """Valores que la columna Cuenta (N) tenia calculados en la bajada de SAP.

    En la hoja 1120 SJ esa columna es un VLOOKUP contra un libro externo que no
    se distribuye con el archivo. Se toman sus valores ya calculados para poder
    quitar el vinculo sin perder informacion.
    """
    wv = openpyxl.load_workbook(paths.dato(paths.STOCK_SAP), data_only=True)
    out = {}
    for sheet, (r0, r1) in conciliar.GEO.items():
        ws = wv[sheet]
        out[sheet] = {r: ws.cell(r, 14).value for r in range(r0, r1 + 1)}
    return out


def _fijar_cuenta(ws, sheet, cuentas, r0, r1):
    """Reemplaza la formula externa de la columna Cuenta por su valor."""
    n = 0
    for r in range(r0, r1 + 1):
        v = ws.cell(r, 14).value
        if isinstance(v, str) and v.startswith("="):
            ws.cell(r, 14, cuentas[sheet].get(r))
            n += 1
    return n


def _sanear(wb):
    """Convierte las cadenas vacias en celdas realmente vacias.

    openpyxl marca una celda con valor "" como de tipo texto y la escribe como
    <c t="inlineStr"/>, sin el elemento <is> que ese tipo exige. Excel considera
    invalido el archivo y ofrece repararlo (LibreOffice lo tolera en silencio).
    Se normaliza al final, cuando el libro ya esta armado, para cubrir tambien
    los valores que vienen de la bajada original de SAP.
    """
    n = 0
    for ws in wb.worksheets:
        for fila in ws.iter_rows():
            for c in fila:
                if isinstance(c.value, str) and not c.value.strip():
                    c.value = None
                    n += 1
    return n


def _limpiar_xml(path):
    """Deja el XML de las hojas con la misma forma que escribe Excel.

    openpyxl emite dos construcciones que Excel considera defectuosas y que el
    archivo original de SAP no tiene:
      * <f>...</f><v/>  : la celda declara un valor numerico en cache pero vacio.
      * <c ... t="n"/>  : celda vacia declarada de tipo numerico.
    Ambas hacen que Excel ofrezca reparar el libro y, al reparar, descarte
    contenido. Se eliminan reescribiendo el paquete, sin tocar los datos.
    """
    tmp = path + ".tmp"
    n = 0
    with zipfile.ZipFile(path) as zin, \
         zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"xl/worksheets/sheet\d+\.xml$", item.filename):
                x = data.decode("utf-8")
                x, a = re.subn(r"<v\s*/>|<v></v>", "", x)
                x, b = re.subn(r"(<c\b[^>]*?)\s+t=\"n\"(\s*/>)", r"\1\2", x)
                n += a + b
                data = x.encode("utf-8")
            zout.writestr(item, data)
    shutil.move(tmp, path)
    return n


def _lista(wb, nombre, titulo, sub, filas):
    ws = wb.create_sheet(nombre)
    cols = [("Base", 11), ("Clasificación SAP", 15), ("Código SAP", 12),
            ("Nomenclatura SAP", 42), ("Código Avain", 13),
            ("Nombre en inventario físico Avain", 42), ("Cantidad SAP", 12),
            ("Cantidad física", 12), ("Diferencia", 12),
            ("Códigos SAP posibles equivalentes", 22),
            ("Nivel", 14), ("Estado de homologación / validación", 44),
            ("Observaciones", 100)]
    f = E.titulo(ws, 2, titulo, sub)
    f = E.encabezados(ws, f, cols)
    ini = f
    for d in sorted(filas, key=lambda z: (z["base"], -abs(z["dif"]))):
        vals = [d["base"], d["clasificacion"], d["material"], d["texto_sap"],
                d["codigo_avain"], d["nombre_avain"], d["cant_sap"],
                d["cant_fis"], d["dif"], ", ".join(d["dup_codigos"]),
                d["nivel"], d["estado"], d["observaciones"]]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
            if i in (7, 8, 9):
                c.number_format = E.NUM
        ws.cell(f, 11).fill = E.NIVEL_FILL.get(d["nivel"], E.FILL_EXTRA)
        f += 1
    if f > ini:
        ws.auto_filter.ref = f"A{ini-1}:{L(len(cols))}{f-1}"
    ws.freeze_panes = f"C{ini}"
    ws.sheet_view.showGridLines = False


def _metodologia(wb, geo, conc):
    ws = wb.create_sheet("Metodología")
    f = E.titulo(ws, 2, "Metodología, criterios y correcciones aplicadas")
    bloques = [
        ("Correcciones de esta versión", [
            "El bloque de datos de cada hoja SAP quedó contiguo: se quitaron la "
            "fila en blanco, la fila de rótulo y la fila de totales que lo "
            "cortaban, y el AUTOFILTRO ahora cubre todas las filas, también las "
            "del inventario físico sin código SAP. Antes el filtro terminaba en la "
            "última fila de SAP y esas filas quedaban fuera.",
            "El origen de cada fila se identifica por la columna «Origen del "
            "registro» y no por su posición en la hoja, así el filtro alcanza para "
            "separar stock SAP de inventario físico sin código.",
            "La columna O (%) ya no depende de la celda de totales: usa "
            "SUM($M$2:$M$n) sobre el bloque de SAP.",
            "La columna P (VU) se envolvió en IFERROR: antes devolvía #DIV/0! en "
            "160 filas con cantidad 0 (en todas ellas el valor en SAP también es 0).",
            "La columna S «Diferencia económica» calculaba VU × cantidad física, "
            "que es el valor del recuento y no una diferencia. Ahora calcula "
            "VU × Diferencia Q. El cálculo anterior se conserva en la columna "
            "«Valor del recuento físico».",
            "Se agregó la hoja Conciliación: una fila por material, con todo lo "
            "necesario para validar un material de punta a punta.",
            "Se agregaron las hojas operativas Dar de baja en SAP, Dar de alta en "
            "SAP y Sin correspondencia SAP.",
            "Se agregó la hoja Control de cantidades, que compara los totales de "
            "los archivos originales con los usados en el análisis.",
        ]),
        ("Clasificaciones de SAP y alcance del inventario físico", [
            "Se contempla todo el inventario de SAP, no sólo medicamentos y "
            "descartables. Las clasificaciones presentes son: Medicamentos "
            "(ZMED), Descartables (ZDES), Uniformes (ZUNI), Equipos (ZEQI) y "
            "Repuestos (ZERS).",
            "Los inventarios físicos de Avain son de Farmacia y cubren "
            "medicamentos y descartables. Uniformes, equipos y repuestos quedan "
            "FUERA DEL ALCANCE del recuento: no se interpretan como falta de "
            "coincidencia. La acción de esas filas es «Fuera del alcance del "
            "inventario físico».",
            "Un material de medicamentos o descartables sin recuento queda como "
            "«Sin recuento físico», que es distinto de no tener homologación.",
            "El estado de homologación distingue: homologado (con su nivel de "
            "confianza), pendiente de validación, sin homologación, sin "
            "correspondencia confirmada y fuera del alcance.",
        ]),
        ("Diferencias y signo", [
            "Diferencia = Libre utilización (SAP) − Cantidad física (recuento). Es "
            "la fórmula que ya traía el archivo de SAP en la columna R.",
            "Diferencia POSITIVA: SAP informa más que el recuento → DAR DE BAJA.",
            "Diferencia NEGATIVA: el recuento supera a SAP → DAR DE ALTA.",
            "Los ítems del inventario físico sin código SAP tienen cantidad SAP 0, "
            "de modo que su diferencia es negativa: son altas de material.",
            "La diferencia global de una base incluye materiales que el recuento no "
            "cubrió; ésos no son faltantes. El ajuste operativo son las cantidades "
            "a dar de baja y a dar de alta, que sólo consideran materiales con "
            "recuento.",
        ]),
        ("Valorización: valor promedio ponderado", [
            "VU promedio ponderado del material = suma de Valor libre util. / suma "
            "de Libre utilización de todas las filas del material.",
            "Diferencia económica = diferencia de cantidades × VU promedio "
            "ponderado. Se calcula sólo donde hay recuento y la diferencia es real.",
            "Los ítems sin código SAP no tienen valor unitario: su diferencia "
            "económica no puede calcularse y queda identificada como dato faltante. "
            "No se estimó ningún valor.",
            "ALERTA DE VALORIZACIÓN: se marcan las filas cuyo VU supera 20 veces la "
            "mediana de la base con una diferencia mayor a 10 unidades, o cuya "
            "relación de cantidades entre SAP y recuento supera 50 a 1. Sugieren "
            "distinta unidad de medida (SAP por caja y recuento por unidad).",
            "El caso más relevante es ELECTRODOS C/CONECTOR PARA DESFIBRILADOR "
            "(2001077, Neuquén): 5 unidades en SAP por $1.047.361 (VU $209.472) "
            "contra 1.465 contadas. Por sí solo mueve la diferencia económica de "
            "Neuquén de +$89,9 M a −$215 M. El resumen muestra la diferencia "
            "económica con y sin las filas marcadas.",
        ]),
        ("Imputación de la cantidad física en las hojas de detalle", [
            "Un material puede ocupar varias filas en SAP (lote y almacén). La "
            "cantidad física se imputa en la PRIMERA fila del material y las demás "
            "quedan en blanco, para que el total de la columna sea el inventario "
            "físico real y no se duplique.",
            "Para leer a nivel material están las columnas «Cantidad SAP del "
            "material», «Inventario físico Avain del material» y «Diferencia del "
            "material», y sobre todo la hoja Conciliación, que ya trae una fila por "
            "material.",
        ]),
        ("Orden de precedencia del cruce", [
            "1. Homologación (Catálogo común): código o nombre de Avain → ítem del "
            "Master → código SAP. La confianza resultante es la más débil de los "
            "dos tramos.",
            "2. Nomenclatura: comparación del nombre de Avain con el texto breve de "
            "material de SAP del mismo centro, con control de dosis, volumen y "
            "calibre o talle.",
            "3. Sin correspondencia: se conserva la línea y el código SAP queda "
            "vacío.",
            "Control de consistencia: si el código de Avain está homologado a un "
            "ítem del Master cuyo nombre no se parece al del inventario, el vínculo "
            "por código se descarta y se cruza por nomenclatura. Son 29 casos, "
            "todos en Neuquén.",
        ]),
        ("Trazabilidad de las fórmulas", [
            "En la hoja Conciliación, Cantidad SAP, Cantidad física y VU se traen "
            "por SUMIF desde la hoja de detalle de cada centro, así que cualquier "
            "corrección en el detalle se refleja automáticamente.",
            "Diferencia, Valor SAP, Valor del recuento y Diferencia económica son "
            "fórmulas sobre esas columnas.",
            "Los indicadores del Resumen son SUMIFS y COUNTIFS sobre la hoja "
            "Conciliación: no hay valores fijos.",
            "Los totales de Conciliación y de las hojas operativas usan SUBTOTAL, "
            "de modo que responden al filtro aplicado.",
        ]),
        ("Pendientes de validación", [
            "29 códigos de Neuquén cuya homologación no coincide con el producto "
            "del inventario físico.",
            "17 códigos de Neuquén que identifican dos productos distintos cada "
            "uno: el cruce se hace por código + denominación.",
            "Posibles duplicidades de código SAP y materiales que reciben varias "
            "denominaciones de Avain.",
            "Diferencias internas del informe de Avain en Neuquén: Adrenalina "
            "1mg/mL (15) y Metronidazol 500mg (20).",
            "89 ítems del Master con más de un código SAP candidato y 17 sin "
            "candidato.",
            "Filas con alerta de valorización: posible diferencia de unidad de "
            "medida entre SAP y el recuento.",
        ]),
    ]
    for titulo, puntos in bloques:
        f += 1
        f = E.subtitulo(ws, f, titulo)
        for p in puntos:
            c = ws.cell(f, 1, "• " + p)
            c.font = E.F_BASE
            c.alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[f].height = max(14, 13 * (1 + len(p) // 100))
            f += 1
    ws.column_dimensions["A"].width = 120
    ws.sheet_view.showGridLines = False


if __name__ == "__main__":
    main()
