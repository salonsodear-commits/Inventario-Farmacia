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
from openpyxl.comments import Comment
import estilo as E
from estilo import L
import clasif

KPI = [
    ("Base / Centro", 15),
    ("Stock SAP (Libre utilización)", 15),
    ("Inventario físico Avain (todo el inventario)", 16),
    ("Diferencia (SAP − físico)", 15),
    ("Stock SAP de materiales contados", 15),
    ("Diferencia sobre lo contado", 15),
    ("Cantidad a dar de baja en SAP", 15),
    ("Cantidad a dar de alta en SAP", 15),
    ("Ítems sin correspondencia en SAP", 14),
    ("Cantidad sin correspondencia en SAP", 15),
    ("Diferencia económica", 18),
    ("De la cual con alerta de valorización", 18),
    ("Diferencia económica sin filas con alerta", 18),
]
BASES = ["San Juan", "Neuquén", "Salta"]


def escribir(wb, conc, resumen_extra):
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
        # 11. diferencia economica
        ws.cell(f, 11, f'=SUMIFS({rQ},{rb},{b})')
        # 12. porcion con alerta de valorizacion
        ws.cell(f, 12, f'=SUMIFS({rQ},{rb},{b},{rr},"?*")')
        # 13. sin esas filas
        ws.cell(f, 13, f"=$K{f}-$L{f}")
        for cc in range(2, 11):
            ws.cell(f, cc).number_format = E.NUM
            ws.cell(f, cc).font = E.F_BASE
        for cc in (11, 12, 13):
            ws.cell(f, cc).number_format = E.MON
            ws.cell(f, cc).font = E.F_BASE
        f += 1
    fin = f - 1
    ws.cell(f, 1, "TOTAL").font = E.F_BOLD
    for cc in range(2, 14):
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
    ws.cell(ini - 1, 4).comment = Comment(
        "Diferencia = Stock SAP − Inventario físico, contabilizando todo el "
        "inventario físico (también los ítems sin código SAP).\n"
        "POSITIVA: SAP informa más de lo contado.\n"
        "NEGATIVA: el recuento supera lo informado en SAP.", "Revisión")
    ws.cell(ini - 1, 5).comment = Comment(
        "Stock SAP de los materiales que el inventario físico efectivamente contó. "
        "El resto del stock de SAP no fue contado (o es de una clasificación que "
        "el inventario de Farmacia no releva) y por eso no genera ajuste.",
        "Revisión")
    ws.cell(ini - 1, 11).comment = Comment(
        "Diferencia económica = diferencia de cantidades × VU promedio ponderado "
        "(Valor libre util. / Libre utilización del material).\n"
        "Se calcula sólo sobre las filas con recuento físico y diferencia real.",
        "Revisión")

    f = E.subtitulo(ws, f, "Cómo leer estos indicadores")
    for t in [
        "Diferencia = Stock SAP (Libre utilización) − Inventario físico Avain, "
        "con el inventario físico completo: los ítems con código SAP y los que "
        "todavía no lo tienen.",
        "Diferencia POSITIVA: SAP informa más unidades que el recuento → "
        "cantidad a DAR DE BAJA en SAP.",
        "Diferencia NEGATIVA: el recuento supera lo informado en SAP → "
        "cantidad a DAR DE ALTA en SAP.",
        "La diferencia global incluye materiales que el inventario físico no "
        "contó; ésos no son faltantes. El ajuste operativo son las columnas "
        "«a dar de baja» y «a dar de alta», que sólo consideran materiales con "
        "recuento.",
        "Los ítems sin correspondencia en SAP no tienen valor unitario, así que "
        "su diferencia económica no puede calcularse: figuran como dato faltante.",
        "La diferencia económica usa el valor promedio ponderado. Las filas con "
        "alerta de valorización se muestran por separado porque su valor unitario "
        "o la relación de cantidades sugiere distinta unidad de medida entre SAP "
        "y el recuento.",
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
