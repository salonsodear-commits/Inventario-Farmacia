# -*- coding: utf-8 -*-
"""Control de cantidades contra las fuentes originales (PDF de Avain y SAP)."""
import json, collections
from openpyxl.styles import Border, Side
import estilo as E
from estilo import L
import paths

COLS = [("Fuente", 26), ("Base", 12), ("Concepto", 46),
        ("Total en la fuente original", 17), ("Total usado en el análisis", 17),
        ("Diferencia", 13), ("Estado", 14), ("Detalle", 95)]


def _avain():
    """Totales de los PDF, recalculados desde la extraccion."""
    out = {}
    for base, f in [("San Juan", "avain_San_Juan.json"),
                    ("Salta", "avain_Salta.json")]:
        d = json.load(open(paths.salida(f), encoding="utf-8"))
        out[base] = {
            "suma_stock_pdf": round(sum(r["stock"] for r in d["lotes"]), 2),
            "renglones": d["control"]["filas_lote"],
            "renglones_declarados": d["control"].get("total_declarado"),
            "items": len(d["items"]),
            "suma_items": round(sum(i["stock"] for i in d["items"]), 2),
        }
    d = json.load(open(paths.salida("avain_Neuquen.json"), encoding="utf-8"))
    con = d["conciliacion"]
    out["Neuquén"] = {
        "suma_stock_pdf": round(sum(r["stock_actual"] for r in con), 2),
        "suma_totales_seccion": round(sum(r["stock_actual"] for r in d["totales"]), 2),
        "suma_saldos_lote": round(sum(r["saldo_lote"] for r in d["detalle"]), 2),
        "items": len(con),
        "con_stock": sum(1 for r in con if r["stock_actual"] > 0),
        "declarado_con_stock": d["meta"].get("con_stock_declarado"),
        "suma_items": round(sum(r["stock_actual"] for r in con), 2),
    }
    return out


def escribir(wb, filas_conc, sap):
    ws = wb.create_sheet("Control de cantidades")
    f = E.titulo(ws, 2, "Control de cantidades contra las fuentes originales",
                 "Compara los totales de los archivos originales (PDF de Avain y "
                 "bajada de SAP) con los totales usados en el análisis. Ninguna "
                 "cantidad fue reemplazada: las diferencias quedan señaladas.")
    f = E.encabezados(ws, f, COLS)
    ini = f
    av = _avain()
    SH = {"San Juan": "1120 SJ", "Neuquén": "1060 NQN", "Salta": "1130 Salta"}

    def linea(fuente, base, concepto, orig, usado, detalle):
        nonlocal f
        dif = None if (orig is None or usado is None) else round(orig - usado, 2)
        estado = "Sin fuente" if dif is None else ("Coincide" if abs(dif) < 0.005
                                                   else "A revisar")
        for i, v in enumerate([fuente, base, concepto, orig, usado, dif, estado,
                               detalle], start=1):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
            if i in (4, 5, 6):
                c.number_format = E.NUM
        ws.cell(f, 7).fill = (E.FILL_TOTAL if estado == "Coincide"
                              else E.FILL_ALERTA)
        f += 1

    # ---- inventarios fisicos
    for base in ("San Juan", "Salta"):
        a = av[base]
        usado = sum(d["cant_fis"] for d in filas_conc if d["base"] == base)
        linea(f"PDF Avain · {base}", base,
              "Suma de la columna Stock del PDF (todos los renglones de lote)",
              a["suma_stock_pdf"], usado,
              f"{a['renglones']} renglones de lote agrupados en {a['items']} ítems "
              f"(código + denominación). El rótulo «TOTAL: "
              f"{a['renglones_declarados']:.0f}» del PDF es la cantidad de "
              f"renglones, no la suma de stock: ambos coinciden.")
    a = av["Neuquén"]
    usado = sum(d["cant_fis"] for d in filas_conc if d["base"] == "Neuquén")
    linea("PDF Avain · Neuquén", "Neuquén",
          "Stock actual de la sección Conciliación del informe IHSA",
          a["suma_stock_pdf"], usado,
          f"{a['items']} ítems, {a['con_stock']} con stock, que coincide con el "
          f"encabezado del informe («Con stock: {a['declarado_con_stock']} "
          f"medicamentos»).")
    linea("PDF Avain · Neuquén", "Neuquén",
          "Stock actual según las filas TOTAL MEDICAMENTO (sección de detalle)",
          a["suma_totales_seccion"], usado,
          "Control cruzado: las dos secciones del informe de Avain informan el "
          "mismo total.")
    linea("PDF Avain · Neuquén", "Neuquén",
          "Suma de los saldos por lote del informe",
          a["suma_saldos_lote"], usado,
          "Diferencia propia del informe de Avain, no del cruce: Adrenalina "
          "1mg/mL (15) y Metronidazol 500mg (20) tienen diferencia entre el stock "
          "actual y el saldo de movimientos. Se conservó el stock actual, que es "
          "el que el informe declara como total.")

    # ---- stock SAP
    for base, sh in SH.items():
        orig = sum(r["libre"] or 0 for r in sap[sh])
        usado = sum(d["cant_sap"] for d in filas_conc if d["base"] == base)
        linea(f"Bajada SAP · hoja {sh}", base,
              "Suma de la columna Libre utilización",
              orig, usado,
              f"{len(sap[sh])} filas de SAP (material / lote / almacén) agrupadas "
              f"en {len({r['material'] for r in sap[sh]})} materiales. La hoja de "
              f"detalle conserva las filas originales sin modificar.")
    for base, sh in SH.items():
        orig = sum(r["vlibre"] or 0 for r in sap[sh])
        usado = sum(d["cant_sap"] * d["vu"] for d in filas_conc
                    if d["base"] == base and d["vu"])
        linea(f"Bajada SAP · hoja {sh}", base,
              "Suma de la columna Valor libre util.",
              round(orig, 2), round(usado, 2),
              "Control de la valorización: el valor reconstruido como cantidad × "
              "VU promedio ponderado debe reproducir el valor informado por SAP.")
    fin = f - 1
    for cc in range(1, len(COLS) + 1):
        ws.cell(f, cc).border = Border(top=Side(style="medium", color=E.AZUL))
    ws.auto_filter.ref = f"A{ini-1}:{L(len(COLS))}{fin}"
    ws.freeze_panes = f"A{ini}"
    ws.sheet_view.showGridLines = False
    return av
