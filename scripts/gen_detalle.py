# -*- coding: utf-8 -*-
"""Hojas de detalle SAP: formato original + cruce, en un bloque contiguo filtrable.

Correcciones respecto de la version anterior:
  * El bloque de datos no se interrumpe: no hay filas vacias, de etiqueta ni de
    totales en medio, y el autofiltro cubre TODAS las filas, tambien las del
    inventario fisico sin codigo SAP (antes quedaban fuera del filtro).
  * La columna O deja de depender de la celda de totales.
  * La columna P (VU) ya no devuelve #DIV/0! cuando la cantidad es 0.
  * La columna S 'Diferencia economica' valoriza la DIFERENCIA (VU x Diferencia Q);
    el calculo anterior (VU x cantidad fisica) se conserva como 'Valor del
    recuento fisico'.
  * El origen de cada fila se identifica por columna, no por su posicion.
"""
import collections
from openpyxl.styles import Font, Alignment, Border, Side
import estilo as E
from estilo import L
import clasif

C_MAT, C_TXT, C_CENTRO, C_UM, C_LIBRE = 1, 2, 6, 8, 9
C_VU, C_QFIS, C_DIFQ, C_DIFE, C_COM = 16, 17, 18, 19, 20
U0 = 21

EXTRA = [
    ("Origen del registro", 24),
    ("Clasificación SAP", 16),
    ("Alcance del inventario físico", 16),
    ("Nivel de coincidencia SAP–Avain", 18),
    ("Estado de homologación / validación", 46),
    ("Acción en SAP", 22),
    ("Código Avain", 13),
    ("Nombre en inventario físico Avain", 40),
    ("Método de cruce", 32),
    ("¿Posible duplicidad SAP?", 11),
    ("Códigos SAP posibles equivalentes", 22),
    ("¿Informado en Master de Seba?", 12),
    ("ID común (Master)", 12),
    ("Cantidad SAP del material · UNIDADES", 15),
    ("Inventario físico Avain del material · UNIDADES", 15),
    ("Diferencia del material (SAP − físico) · UNIDADES", 15),
    ("VU promedio ponderado del material · IMPORTE $ por unidad", 16),
    ("Diferencia económica del material · IMPORTE $", 17),
    ("Valor del recuento físico (VU × cantidad física) · IMPORTE $", 17),
    ("Alerta de valorización", 60),
    ("Observaciones del cruce", 100),
]


def escribir(ws, sheet, rows_sap, filas_conc, r0, r1):
    """Completa una hoja SAP ya cargada con el cruce y las columnas nuevas."""
    conc_mat = {f["material"]: f for f in filas_conc
                if f["origen"] == "Stock SAP" and f["hoja"] == sheet}
    sin_cod = [f for f in filas_conc
               if f["origen"] != "Stock SAP" and f["hoja"] == sheet]

    filas_mat = collections.defaultdict(list)
    for r in rows_sap:
        filas_mat[r["material"]].append(r["row"])

    # ---------- encabezados nuevos
    for i, (t, w) in enumerate(EXTRA):
        c = ws.cell(1, U0 + i, t)
        c.font = E.F_HDR
        c.fill = E.FILL_HDR
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        c.border = Border(bottom=E.THIN)
        ws.column_dimensions[L(U0 + i)].width = w
    ws.row_dimensions[1].height = 60

    # nota al pie de los encabezados corregidos

    # ---------- filas SAP
    for r in rows_sap:
        fila, m = r["row"], r["material"]
        f = conc_mat.get(m)
        primera = filas_mat[m][0] == fila
        tiene = bool(f and f["tiene_recuento"])

        # correccion de formulas originales
        ws.cell(fila, 15, f"=M{fila}/SUM($M${r0}:$M${r1})")      # O: % sin fila total
        ws.cell(fila, C_VU, f"=IFERROR(M{fila}/I{fila},0)")       # P: sin #DIV/0!
        ws.cell(fila, C_DIFQ, f"=I{fila}-Q{fila}")                # R
        # S valoriza la diferencia al VU promedio ponderado del material (AK), no
        # al VU de la fila: asi la suma de S de un material da exactamente su
        # diferencia economica y los totales cierran con el resumen.
        if f:
            ws.cell(fila, C_DIFE, f"=${L(U0+16)}{fila}*R{fila}")
        else:
            ws.cell(fila, C_DIFE, None)

        if tiene and primera:
            ws.cell(fila, C_QFIS, f["cant_fis"])
            ws.cell(fila, C_QFIS).number_format = E.NUM
        # unidades e importes bien diferenciados en las columnas originales
        for cc in (C_LIBRE, 10, C_QFIS, C_DIFQ):
            ws.cell(fila, cc).number_format = E.NUM
        for cc in (12, 13, C_VU, C_DIFE):
            ws.cell(fila, cc).number_format = E.MON

        obs = f["observaciones"] if f else ""
        if f and tiene and not primera:
            obs = (f"La cantidad física del material se imputó en la fila "
                   f"{filas_mat[m][0]} (primera fila del material). "
                   + obs)
        vals = [
            "Stock SAP",
            f["clasificacion"] if f else clasif.clasificacion(r["tipo"]),
            f["alcance"] if f else "",
            (f["nivel"] if tiene else "") if f else "",
            f["estado"] if f else "",
            f["accion"] if f else "",
            f["codigo_avain"] if f else "",
            f["nombre_avain"] if f else "",
            f["metodo"] if f else "",
            ("Sí" if f["duplicidad"] else "No") if tiene else "",
            ", ".join(f["dup_codigos"]) if f else "",
            ("Sí" if f["en_master"] else "No") if tiene else "",
            f["id_master"] if f else "",
            # aditivas: solo en la primera fila del material (ver nota del encabezado)
            (f["cant_sap"] if f else 0) if primera else None,
            None,            # inventario fisico del material: formula = Q
            None,            # diferencia del material: formula
            f["vu"] if f else 0,          # VU: tasa, se repite en todas las filas
            None,            # diferencia economica del material: formula
            None,            # valor del recuento fisico: formula
            # la alerta es del material, no de la fila: se escribe una sola vez
            # para que filtrar la columna devuelva un renglon por material
            (f["alerta"] if f else "") if primera else "",
            obs,
        ]
        for i, v in enumerate(vals):
            c = ws.cell(fila, U0 + i, v)
            c.font = E.F_BASE
            c.fill = E.FILL_EXTRA
            if i in (13, 14, 15):
                c.number_format = E.NUM
            if i in (16, 17, 18):
                c.number_format = E.MON
        # formulas a nivel material, solo en la primera fila del material
        cAH, cAI, cAJ, cAK = U0 + 13, U0 + 14, U0 + 15, U0 + 16
        cAL, cAM = U0 + 17, U0 + 18
        if f and primera:
            # el inventario fisico del material ES la cantidad del recuento (Q)
            ws.cell(fila, cAI, f"=Q{fila}")
            ws.cell(fila, cAJ, f"=${L(cAH)}{fila}-${L(cAI)}{fila}")
            ws.cell(fila, cAL, f"=${L(cAJ)}{fila}*${L(cAK)}{fila}")
            ws.cell(fila, cAM, f"=${L(cAI)}{fila}*${L(cAK)}{fila}")
        for cc in (cAH, cAI, cAJ):
            ws.cell(fila, cc).number_format = E.NUM
        for cc in (cAK, cAL, cAM):
            ws.cell(fila, cc).font = E.F_BASE
            ws.cell(fila, cc).fill = E.FILL_EXTRA
            ws.cell(fila, cc).number_format = E.MON
        ws.cell(fila, U0 + 3).fill = E.NIVEL_FILL.get(
            vals[3], E.FILL_EXTRA)
        ws.cell(fila, U0 + 5).fill = E.ACCION_FILL.get(vals[5], E.FILL_EXTRA)
        if f and f["alerta"] and primera:
            ws.cell(fila, U0 + 19).fill = E.FILL_ALERTA

    # ---------- filas del inventario fisico sin codigo SAP, contiguas
    fila = r1 + 1
    for f in sin_cod:
        ws.cell(fila, C_MAT, None)                 # sin codigo de material
        ws.cell(fila, C_TXT, f["nombre_avain"])
        ws.cell(fila, C_CENTRO, f["centro"])
        ws.cell(fila, C_UM, "C/U")
        ws.cell(fila, C_LIBRE, 0)
        ws.cell(fila, C_QFIS, f["cant_fis"])
        ws.cell(fila, C_DIFQ, f"=I{fila}-Q{fila}")
        ws.cell(fila, C_COM,
                "Ítem del inventario físico de Avain sin código SAP en este centro. "
                "Se mantiene la línea sin código de material: la diferencia indica "
                "una cantidad a dar de alta en SAP.")
        for cc in (C_MAT, C_TXT, C_CENTRO, C_UM, C_LIBRE, C_QFIS, C_DIFQ, C_COM):
            ws.cell(fila, cc).font = E.F_BASE
        for cc in (C_LIBRE, C_QFIS, C_DIFQ):
            ws.cell(fila, cc).number_format = E.NUM
        vals = [f["origen"], f["clasificacion"], f["alcance"], f["nivel"],
                f["estado"], f["accion"], f["codigo_avain"], f["nombre_avain"],
                f["metodo"], "No", "", "Sí" if f["en_master"] else "No",
                f["id_master"], 0, f["cant_fis"], f["dif"], None, None, None,
                f["alerta"], f["observaciones"]]
        for i, v in enumerate(vals):
            c = ws.cell(fila, U0 + i, v)
            c.font = E.F_BASE
            c.fill = E.FILL_NUEVA
            if i in (13, 14, 15):
                c.number_format = E.NUM
        ws.cell(fila, U0 + 3).fill = E.NIVEL_FILL["Sin coincidencia"]
        ws.cell(fila, U0 + 5).fill = E.ACCION_FILL[clasif.ACC_NUEVO]
        f["fila_detalle_fisico"] = fila
        fila += 1
    ultima = fila - 1

    # ---------- fila de totales, fuera del rango del filtro
    tg = ultima + 1
    ws.cell(tg, C_TXT, "TOTAL — Stock SAP + inventario físico sin código SAP")
    ws.cell(tg, C_LIBRE, f"=SUM(I{r0}:I{ultima})")
    ws.cell(tg, C_QFIS, f"=SUM(Q{r0}:Q{ultima})")
    ws.cell(tg, C_DIFQ, f"=I{tg}-Q{tg}")
    ws.cell(tg, C_DIFE, f"=SUM(S{r0}:S{ultima})")
    ws.cell(tg, 13, f"=SUM(M{r0}:M{r1})")        # Valor libre util. del bloque SAP
    ws.cell(tg, 13).number_format = E.MON
    ws.cell(tg, U0 + 17, f"=SUM({L(U0+17)}{r0}:{L(U0+17)}{ultima})")
    ws.cell(tg, U0, "TOTAL")
    # el total de S valoriza la diferencia de TODAS las filas, incluidas las que
    # no tuvieron recuento: no es el ajuste economico operativo
    for cc in range(1, U0 + len(EXTRA)):
        c = ws.cell(tg, cc)
        c.fill = E.FILL_TOTAL
        c.font = E.F_BOLD
        c.border = Border(top=Side(style="medium", color=E.AZUL))
    for cc in (C_LIBRE, C_QFIS, C_DIFQ):
        ws.cell(tg, cc).number_format = E.NUM
    for cc in (C_DIFE, U0 + 17):
        ws.cell(tg, cc).number_format = E.MON

    # ---------- filtro sobre TODO el bloque de datos y encabezado congelado
    ws.auto_filter.ref = f"A1:{L(U0 + len(EXTRA) - 1)}{ultima}"
    ws.freeze_panes = "C2"
    return {"r0": r0, "r1": r1, "primera_fisico": r1 + 1,
            "ultima": ultima, "fila_total": tg}
