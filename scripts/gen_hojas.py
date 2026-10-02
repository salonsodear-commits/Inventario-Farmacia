# -*- coding: utf-8 -*-
"""Hoja unificada de conciliacion, hojas operativas y resumen de indicadores."""
import collections
from openpyxl.styles import Font, Alignment, Border, Side
import estilo as E
from estilo import L
import clasif

# ---------------------------------------------------------------- Conciliación
CONC = [
    ("Base", 11), ("Centro", 8), ("Origen del registro", 24),
    ("Clasificación SAP", 15), ("Tipo material SAP", 11),
    ("Alcance del inventario físico", 15),
    ("Código SAP (Material)", 13), ("Nomenclatura SAP", 42),
    ("Código Avain", 13), ("Nombre en inventario físico Avain", 42),
    ("Cantidad SAP (Libre utilización) · UNIDADES", 14),
    ("Cantidad física Avain · UNIDADES", 13),
    ("Diferencia (SAP − físico) · UNIDADES", 13),
    ("VU promedio ponderado · IMPORTE $ por unidad", 15),
    ("Valor SAP · IMPORTE $", 15),
    ("Valor del recuento físico · IMPORTE $", 15),
    ("Diferencia económica · IMPORTE $", 17),
    ("Alerta de valorización", 52),
    ("Nivel de coincidencia", 15),
    ("Estado de homologación / validación", 46),
    ("Acción en SAP", 22),
    ("Método de cruce", 30),
    ("¿Posible duplicidad SAP?", 11),
    ("Códigos SAP posibles equivalentes", 22),
    ("¿Informado en Master de Seba?", 12),
    ("ID común (Master)", 12),
    ("Observaciones", 100),
]
HDR_ROW = 5
# indices 1-based de las columnas que se usan en formulas
cK, cL, cM, cN, cO, cP, cQ, cU = 11, 12, 13, 14, 15, 16, 17, 21


def conciliacion(wb, filas, geo):
    ws = wb.create_sheet("Conciliación", 1)
    f = E.titulo(ws, 2,
                 "Conciliación unificada · una fila por material",
                 "Permite tomar un material y verificar cantidad SAP, cantidad "
                 "física, diferencia, valorización y estado de homologación. "
                 "Filtrable por base, clasificación, código SAP, acción y estado. "
                 "Las cantidades se traen por SUMIF de las hojas de detalle, de "
                 "modo que todo queda trazable hasta la fila de SAP.")
    assert f == HDR_ROW, f
    f = E.encabezados(ws, HDR_ROW, CONC)
    fila0 = f
    for d in filas:
        hoja, r0, r1 = d["hoja"], geo[d["hoja"]]["r0"], geo[d["hoja"]]["r1"]
        q = f"'{hoja}'"
        rng_a = f"{q}!$A${r0}:$A${r1}"
        vals = [
            d["base"], d["centro"], d["origen"], d["clasificacion"],
            d["tipo"], d["alcance"], d["material"], d["texto_sap"],
            d["codigo_avain"], d["nombre_avain"],
        ]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
        if d["origen"] == "Stock SAP":
            # cantidades por SUMIF contra la hoja de detalle
            ws.cell(f, cK, f"=SUMIF({rng_a},$G{f},{q}!$I${r0}:$I${r1})")
            ws.cell(f, cL, f"=SUMIF({rng_a},$G{f},{q}!$Q${r0}:$Q${r1})")
            ws.cell(f, cN, f"=IFERROR(SUMIF({rng_a},$G{f},"
                           f"{q}!$M${r0}:$M${r1})/$K{f},0)")
        else:
            # item fisico sin codigo: referencia directa a su fila de detalle
            fd = d["fila_detalle_fisico"]
            ws.cell(f, cK, 0)
            ws.cell(f, cL, f"={q}!$Q${fd}")
            ws.cell(f, cN, None)
        ws.cell(f, cM, f"=$K{f}-$L{f}")
        ws.cell(f, cO, f"=IFERROR($K{f}*$N{f},\"\")")
        ws.cell(f, cP, f"=IFERROR($L{f}*$N{f},\"\")")
        # diferencia economica = diferencia de unidades x VU promedio ponderado.
        # Se calcula en toda fila con VU, de modo que el total de esta columna
        # coincide exactamente con el total de la columna S de las hojas de detalle.
        if d["origen"] == "Stock SAP":
            ws.cell(f, cQ, f'=$M{f}*$N{f}')
        else:
            ws.cell(f, cQ, None)      # sin VU en SAP: no es calculable
        resto = [d["alerta"], d["nivel"] if d["tiene_recuento"] else "",
                 d["estado"], d["accion"], d["metodo"],
                 ("Sí" if d["duplicidad"] else "No") if d["tiene_recuento"] else "",
                 ", ".join(d["dup_codigos"]),
                 ("Sí" if d["en_master"] else "No") if d["tiene_recuento"] else "",
                 d["id_master"], d["observaciones"]]
        for i, v in enumerate(resto, start=18):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
        for cc in (cK, cL, cM):
            ws.cell(f, cc).number_format = E.NUM
            ws.cell(f, cc).font = E.F_BASE
        for cc in (cN, cO, cP, cQ):
            ws.cell(f, cc).number_format = E.MON
            ws.cell(f, cc).font = E.F_BASE
        ws.cell(f, 19).fill = E.NIVEL_FILL.get(resto[1], E.FILL_EXTRA)
        ws.cell(f, cU).fill = E.ACCION_FILL.get(d["accion"], E.FILL_EXTRA)
        if d["alerta"]:
            ws.cell(f, 18).fill = E.FILL_ALERTA
        if d["origen"] != "Stock SAP":
            ws.cell(f, 3).fill = E.FILL_NUEVA
        f += 1
    ultima = f - 1
    # fila de totales
    ws.cell(f, 1, "TOTAL")
    for cc in (cK, cL, cM):
        ws.cell(f, cc, f"=SUBTOTAL(109,{L(cc)}{fila0}:{L(cc)}{ultima})")
        ws.cell(f, cc).number_format = E.NUM
    ws.cell(f, cQ, f"=SUBTOTAL(109,{L(cQ)}{fila0}:{L(cQ)}{ultima})")
    ws.cell(f, cQ).number_format = E.MON
    for cc in range(1, len(CONC) + 1):
        ws.cell(f, cc).fill = E.FILL_TOTAL
        ws.cell(f, cc).font = E.F_BOLD
        ws.cell(f, cc).border = Border(top=Side(style="medium", color=E.AZUL))
    ws.cell(f, 2, "(los totales responden al filtro aplicado)")
    ws.cell(f, 2).font = E.F_NOTA
    ws.auto_filter.ref = f"A{HDR_ROW}:{L(len(CONC))}{ultima}"
    ws.freeze_panes = f"C{HDR_ROW + 1}"
    ws.sheet_view.showGridLines = False
    return {"hdr": HDR_ROW, "ini": fila0, "fin": ultima, "total": f}


# ------------------------------------------------------------ hojas operativas
OPER = [
    ("Base", 11), ("Centro", 8), ("Clasificación SAP", 15),
    ("Código SAP (Material)", 13), ("Nomenclatura SAP", 44),
    ("Código Avain", 13), ("Nombre en inventario físico Avain", 42),
    ("Cantidad SAP · UNIDADES", 13), ("Cantidad física · UNIDADES", 13),
    ("Cantidad a ajustar · UNIDADES", 14),
    ("VU promedio ponderado · IMPORTE $ por unidad", 15),
    ("Valor económico del ajuste · IMPORTE $", 17),
    ("Nivel de coincidencia", 15),
    ("Estado de homologación / validación", 46),
    ("Alerta de valorización", 52), ("Observaciones", 100),
]


def operativa(wb, nombre, titulo, sub, filas, cm, pos=None):
    """cm: 'baja' | 'alta' | 'nuevo'. Hoja con referencias a Conciliación."""
    ws = wb.create_sheet(nombre) if pos is None else wb.create_sheet(nombre, pos)
    f = E.titulo(ws, 2, titulo, sub)
    f = E.encabezados(ws, f, OPER)
    ini = f
    tot_q = tot_v = 0.0
    for d in filas:
        ajuste = abs(d["dif"])
        vu = d["vu"]
        valor = (ajuste * vu) if vu else None
        vals = [d["base"], d["centro"], d["clasificacion"], d["material"],
                d["texto_sap"], d["codigo_avain"], d["nombre_avain"],
                d["cant_sap"], d["cant_fis"], ajuste, vu, None,
                d["nivel"] if d["tiene_recuento"] else "", d["estado"],
                d["alerta"], d["observaciones"]]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
            if i in (8, 9, 10):
                c.number_format = E.NUM
            if i == 11:
                c.number_format = E.MON
        if vu:
            ws.cell(f, 12, f"=$J{f}*$K{f}")
        else:
            ws.cell(f, 12, "sin VU en SAP (dato faltante)")
            ws.cell(f, 12).font = E.F_NOTA
        ws.cell(f, 12).number_format = E.MON
        ws.cell(f, 13).fill = E.NIVEL_FILL.get(vals[12], E.FILL_EXTRA)
        if d["alerta"]:
            ws.cell(f, 15).fill = E.FILL_ALERTA
        tot_q += ajuste
        tot_v += valor or 0.0
        f += 1
    fin = f - 1
    ws.cell(f, 1, "TOTAL")
    ws.cell(f, 10, f"=SUBTOTAL(109,J{ini}:J{fin})" if fin >= ini else 0)
    ws.cell(f, 10).number_format = E.NUM
    ws.cell(f, 12, f"=SUBTOTAL(109,L{ini}:L{fin})" if fin >= ini else 0)
    ws.cell(f, 12).number_format = E.MON
    for cc in range(1, len(OPER) + 1):
        ws.cell(f, cc).fill = E.FILL_TOTAL
        ws.cell(f, cc).font = E.F_BOLD
        ws.cell(f, cc).border = Border(top=Side(style="medium", color=E.AZUL))
    ws.cell(f, 2, "(responde al filtro)")
    ws.cell(f, 2).font = E.F_NOTA
    if fin >= ini:
        ws.auto_filter.ref = f"A{ini-1}:{L(len(OPER))}{fin}"
    ws.freeze_panes = f"C{ini}"
    ws.sheet_view.showGridLines = False
    return {"n": len(filas), "cantidad": tot_q, "valor": tot_v,
            "ini": ini, "fin": fin}
