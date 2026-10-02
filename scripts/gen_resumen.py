# -*- coding: utf-8 -*-
"""Hoja de indicadores. Responde a los comentarios dejados en la revision:

  * 'Stock SAP (Libre utilizacion)'  -> dejar.
  * 'Inventario fisico Avain'        -> debe contabilizar TODO el inventario,
                                        no solo lo que tiene codigo SAP.
  * 'Diferencia (SAP - fisico)'      -> dejar, contabilizando todo.
  * desde ahi                        -> describir cuanto dar de baja, cuanto dar
                                        de alta y cuanto no esta en SAP.
  * agregar                          -> diferencia economica.
  * el resto                         -> se retira del tablero principal; el
                                        desglose por certeza queda documentado
                                        mas abajo, no se elimina la informacion.

Todos los indicadores son formulas SUMIFS/COUNTIFS contra la hoja Conciliacion.
"""
import collections
from openpyxl.styles import Font, Alignment, Border, Side
import estilo as E
from estilo import L
import clasif

KPI = [
    ("Base / Centro", 15),
    ("1. Stock SAP · Libre utilización\nUNIDADES", 15),
    ("2. Inventario físico Avain · todo el inventario\nUNIDADES", 16),
    ("3. Diferencia = 1 − 2\nUNIDADES", 15),
    ("4. Stock SAP de los materiales que SÍ se contaron\nUNIDADES", 16),
    ("5. Diferencia neta de esos materiales contados (= 6 − 7)\nUNIDADES", 17),
    ("6. A DAR DE BAJA en SAP (sobra en SAP)\nUNIDADES", 15),
    ("7. A DAR DE ALTA en SAP (falta en SAP)\nUNIDADES", 15),
    ("8. Ítems sin correspondencia en SAP\nCANTIDAD DE ÍTEMS", 15),
    ("9. Unidades sin correspondencia en SAP\nUNIDADES", 15),
    ("10. Diferencia económica (total de la columna S)\nIMPORTE $", 19),
    ("11. Diferencia económica de los materiales contados\nIMPORTE $", 19),
    ("12. De 11, con alerta de valorización\nIMPORTE $", 19),
    ("13. Diferencia económica confiable (11 − 12)\nIMPORTE $", 19),
]
BASES = ["San Juan", "Neuquén", "Salta"]


def escribir(wb, conc, resumen_extra, geo):
    """conc: dict con hdr/ini/fin de la hoja Conciliación."""
    ws = wb.create_sheet("Resumen del cruce", 0)
    i, n = conc["ini"], conc["fin"]
    C = f"'Conciliación'!"
    rb = f"{C}$A${i}:$A${n}"          # base
    ro = f"{C}$C${i}:$C${n}"          # origen
    ru = f"{C}$U${i}:$U${n}"          # accion
    rr = f"{C}$R${i}:$R${n}"          # alerta
    rK = f"{C}$K${i}:$K${n}"          # cantidad SAP
    rL = f"{C}$L${i}:$L${n}"          # cantidad fisica
    rM = f"{C}$M${i}:$M${n}"          # diferencia
    rQ = f"{C}$Q${i}:$Q${n}"          # diferencia economica

    f = E.titulo(ws, 2, "Stock SAP vs inventario físico Avain · indicadores",
                 "La base es el stock de SAP. El inventario físico se cruzó sobre "
                 "esa base. Todos los valores son fórmulas sobre la hoja "
                 "Conciliación, de modo que respetan cualquier corrección que se "
                 "haga allí.")
    f = E.encabezados(ws, f, KPI)
    ws.row_dimensions[f - 1].height = 62
    ini = f
    CON_REC = (f'"{clasif.ACC_BAJA}"', f'"{clasif.ACC_ALTA}"', '"Sin diferencia"')
    for base in BASES:
        b = f'"{base}"'
        ws.cell(f, 1, base).font = E.F_BASE
        # 2. Stock SAP: solo filas de origen SAP
        ws.cell(f, 2, f'=SUMIFS({rK},{rb},{b},{ro},"Stock SAP")')
        # 3. Inventario fisico COMPLETO: todas las filas de la base
        ws.cell(f, 3, f'=SUMIFS({rL},{rb},{b})')
        # 4. Diferencia contabilizando todo
        ws.cell(f, 4, f"=$B{f}-$C{f}")
        # 5. Stock SAP de materiales efectivamente contados
        ws.cell(f, 5, "=" + "+".join(
            f'SUMIFS({rK},{rb},{b},{ru},{a})' for a in CON_REC))
        # 6. Diferencia sobre lo contado
        ws.cell(f, 6, "=" + "+".join(
            f'SUMIFS({rM},{rb},{b},{ru},{a})' for a in CON_REC))
        # 7. a dar de baja
        ws.cell(f, 7, f'=SUMIFS({rM},{rb},{b},{ru},"{clasif.ACC_BAJA}")')
        # 8. a dar de alta (la diferencia es negativa: se invierte el signo)
        ws.cell(f, 8, f'=-SUMIFS({rM},{rb},{b},{ru},"{clasif.ACC_ALTA}")')
        # 9/10. sin correspondencia en SAP
        ws.cell(f, 9, f'=COUNTIFS({rb},{b},{ro},"{_ORIG_FIS}")')
        ws.cell(f, 10, f'=SUMIFS({rL},{rb},{b},{ro},"{_ORIG_FIS}")')
        # 10. diferencia economica: suma de la columna S de la hoja de detalle
        g = geo[_HOJA[base]]
        ws.cell(f, 11, f"=SUM('{_HOJA[base]}'!$S${g['r0']}:$S${g['ultima']})")
        # 11. diferencia economica solo de los materiales contados (ajuste operativo)
        ws.cell(f, 12, "=" + "+".join(
            f'SUMIFS({rQ},{rb},{b},{ru},"{a}")'
            for a in (clasif.ACC_BAJA, clasif.ACC_ALTA)))
        # 12. de esa, la porcion con alerta de valorizacion
        ws.cell(f, 13, "=" + "+".join(
            f'SUMIFS({rQ},{rb},{b},{ru},"{a}",{rr},"?*")'
            for a in (clasif.ACC_BAJA, clasif.ACC_ALTA)))
        # 13. diferencia economica confiable
        ws.cell(f, 14, f"=$L{f}-$M{f}")
        for cc in range(2, 11):
            ws.cell(f, cc).number_format = E.NUM
            ws.cell(f, cc).font = E.F_BASE
        for cc in (11, 12, 13, 14):
            ws.cell(f, cc).number_format = E.MON
            ws.cell(f, cc).font = E.F_BASE
        f += 1
    fin = f - 1
    ws.cell(f, 1, "TOTAL").font = E.F_BOLD
    for cc in range(2, 15):
        ws.cell(f, cc, f"=SUM({L(cc)}{ini}:{L(cc)}{fin})")
        ws.cell(f, cc).number_format = E.NUM if cc <= 10 else E.MON
        ws.cell(f, cc).font = E.F_BOLD
    for cc in range(1, len(KPI) + 1):
        ws.cell(f, cc).fill = E.FILL_TOTAL
        ws.cell(f, cc).font = E.F_BOLD
        ws.cell(f, cc).border = Border(top=Side(style="medium", color=E.AZUL))
    ftot = f
    f += 2

    # ---- notas de lectura

    f = E.subtitulo(ws, f, "Cómo leer estos indicadores")
    f = E.nota(ws, f, "Para una explicación desde cero, ver la hoja "
                      "«Guía paso a paso».")
    for t in [
        "Las columnas 1 a 9 están en UNIDADES. Las columnas 10 a 13 son IMPORTES "
        "en pesos y se muestran con el signo $.",
        "Columna 3, diferencia = Stock SAP − inventario físico, con el inventario "
        "físico completo: los ítems con código SAP y los que todavía no lo tienen.",
        "Diferencia POSITIVA: SAP informa más unidades que el recuento → "
        "cantidad a DAR DE BAJA en SAP (columna 6).",
        "Diferencia NEGATIVA: el recuento supera lo informado en SAP → "
        "cantidad a DAR DE ALTA en SAP (columna 7).",
        "Columna 5: es el ajuste NETO en unidades de los materiales que SÍ se "
        "contaron, es decir la columna 6 menos la columna 7. En Salta da −1.027 "
        "porque se contó más de lo que SAP informa.",
        "La diferencia de la columna 3 incluye materiales que el inventario no "
        "contó; ésos no son faltantes. El ajuste operativo son las columnas 6 y 7, "
        "que sólo consideran materiales con recuento.",
        "Columna 10: es la suma de la columna S «Diferencia economica» de las hojas "
        "de detalle. Incluye los materiales sin recuento.",
        "Columna 11: la misma valorización, pero sólo de los materiales contados. "
        "Es el importe del ajuste.",
        "Columnas 12 y 13: de ese importe, cuánto cae en filas con alerta de "
        "valorización (posible distinta unidad de medida entre SAP y el recuento) y "
        "cuánto queda como importe confiable. Mientras la alerta no se valide, usar "
        "la columna 13.",
        "Los ítems sin correspondencia en SAP no tienen valor unitario, así que su "
        "diferencia económica no puede calcularse: figuran como dato faltante.",
    ]:
        f = E.nota(ws, f, "• " + t)
    f += 1

    # ---- desglose por nivel de certeza (no se elimina: se reubica)
    f = E.subtitulo(ws, f, "Desglose por nivel de certeza del cruce "
                           "(ítems del inventario físico)")
    f = E.nota(ws, f, "Se mantiene como información de respaldo del estado de la "
                      "homologación. No forma parte del tablero principal.")
    cols = [("Base", 15), ("Ítems del inventario físico", 14),
            ("Alta", 10), ("Media", 10), ("Baja", 10),
            ("Sin correspondencia en SAP", 14),
            ("Materiales SAP", 12), ("Materiales con recuento", 14),
            ("Materiales fuera del alcance", 14),
            ("Materiales sin recuento (dentro del alcance)", 16)]
    f = E.encabezados(ws, f, cols, fill=E.FILL_HDR2)
    for base in BASES:
        d = resumen_extra[base]
        vals = [base, d["items_fisico"], d["Alta"], d["Media"], d["Baja"],
                d["Sin coincidencia"], d["materiales_sap"],
                d["materiales_con_recuento"], d["fuera_alcance"],
                d["sin_recuento"]]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
            if isinstance(v, (int, float)):
                c.number_format = E.NUM
        f += 1
    ws.column_dimensions["A"].width = 17
    ws.sheet_view.showGridLines = False
    return ftot


_ORIG_FIS = "Inventario físico sin código SAP"
_HOJA = {"San Juan": "1120 SJ", "Neuquén": "1060 NQN", "Salta": "1130 Salta"}
