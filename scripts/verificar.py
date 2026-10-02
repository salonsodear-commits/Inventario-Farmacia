# -*- coding: utf-8 -*-
"""Verificacion del archivo generado: estructura, formulas, totales e igualdades.

Comprueba tambien, por separado, que el paquete xlsx sea estructuralmente valido
para Excel (validar_ooxml.py).
"""
import json, re, collections, sys, os
import openpyxl
import load, paths, conciliar, validar_ooxml

ARCH = os.path.join(paths.RAIZ, "Stock SAP vs Inventario Fisico Avain - cruce.xlsx")
BASE = {"1120 SJ": "San Juan", "1060 NQN": "Neuquén", "1130 Salta": "Salta"}
C_LIBRE, C_QFIS, C_DIFQ, C_DIFE = 9, 17, 18, 19
C_SAPMAT, C_FISMAT = 34, 35          # columnas de nivel material
HOJAS = ["Guía paso a paso", "Resumen del cruce", "Conciliación",
         "Dar de baja en SAP", "Dar de alta en SAP", "Sin correspondencia SAP",
         "1120 SJ", "1060 NQN", "1130 Salta", "Control de cantidades",
         "Posibles duplicidades", "Fuera del Master", "Metodología"]

ok_all = True


def chk(cond, msg):
    global ok_all
    print(("  OK    " if cond else "  FALLA ") + msg)
    if not cond:
        ok_all = False


def main():
    geo = json.load(open(paths.salida("geo_v2.json"), encoding="utf-8"))["geo"]
    sap = load.load_sap()
    filas, _ = conciliar.construir()
    wb = openpyxl.load_workbook(ARCH, data_only=False)

    print("=== Hojas")
    chk(wb.sheetnames == HOJAS, f"las 13 hojas en orden: {wb.sheetnames}")

    for sheet, g in geo.items():
        print(f"\n=== {sheet}")
        ws = wb[sheet]
        rows = sap[sheet]
        r0, r1, ult, tg = g["r0"], g["r1"], g["ultima"], g["fila_total"]

        # la base de SAP no se toco
        difs = sum(1 for r in rows
                   if str(ws.cell(r["row"], 1).value).strip() != r["material"]
                   or (ws.cell(r["row"], C_LIBRE).value or 0) != (r["libre"] or 0))
        chk(difs == 0, f"Material y Libre utilización intactos en {len(rows)} filas")
        chk(ws.cell(2, C_DIFQ).value == "=I2-Q2",
            "fórmula original de Diferencia Q conservada")
        chk(str(ws.cell(2, 15).value).startswith(f"=M2/SUM($M${r0}:$M${r1})"),
            "columna O no depende de la fila de totales")
        chk(str(ws.cell(2, 16).value).startswith("=IFERROR("),
            "columna P (VU) protegida contra división por cero")

        # bloque contiguo y filtro que lo cubre entero
        chk(ws.auto_filter.ref.endswith(str(ult)),
            f"el autofiltro llega hasta la última fila de datos ({ult})")
        vacias = [r for r in range(r0, ult + 1)
                  if all(ws.cell(r, c).value in (None, "") for c in range(1, 21))]
        chk(not vacias, f"sin filas vacías dentro del bloque de datos")

        # una sola imputacion de cantidad fisica por material
        filas_mat = collections.defaultdict(list)
        for r in rows:
            filas_mat[r["material"]].append(r["row"])
        fis = {f["material"]: f["cant_fis"] for f in filas
               if f["hoja"] == sheet and f["origen"] == "Stock SAP"
               and f["tiene_recuento"]}
        malos = [m for m, q in fis.items()
                 if [ws.cell(x, C_QFIS).value for x in filas_mat[m]
                     ].count(q) != 1]
        chk(not malos, f"cantidad física imputada una sola vez por material "
                       f"({len(fis)} materiales)")

        # columnas de nivel material: una vez por material -> totales coherentes
        rep = [m for m in filas_mat
               if sum(1 for x in filas_mat[m]
                      if ws.cell(x, C_FISMAT).value is not None) > 1]
        chk(not rep, "las columnas de nivel material se completan una sola vez")
        chk(ws.cell(filas_mat[rows[0]["material"]][0], C_FISMAT).value
            == f"=Q{filas_mat[rows[0]['material']][0]}",
            "«Inventario físico del material» se calcula con =Q de su fila")

        # filas del inventario fisico sin codigo
        nuevas = list(range(g["primera_fisico"], ult + 1))
        chk(all(ws.cell(r, 1).value in (None, "") for r in nuevas),
            f"las {len(nuevas)} filas sin código SAP no llevan material")
        chk(all(ws.cell(r, C_DIFQ).value == f"=I{r}-Q{r}" for r in nuevas),
            "las filas sin código llevan la fórmula de diferencia")

        # S valoriza al VU promedio ponderado del material
        chk(ws.cell(2, C_DIFE).value == "=$AK2*R2",
            "columna S valoriza la diferencia al VU promedio ponderado")
        chk(ws.cell(tg, C_DIFE).value == f"=SUM(S{r0}:S{ult})",
            f"fila de totales (fila {tg}) suma la columna S")

    # ---- igualdades pedidas, sobre el libro recalculado
    print("\n=== Igualdades (valores recalculados)")
    try:
        wv = openpyxl.load_workbook(paths.salida("recalc.xlsx"), data_only=True)
    except Exception:
        wv = None
    if wv is None:
        print("  (sin libro recalculado disponible: se omiten las igualdades)")
    else:
        for sheet, g in geo.items():
            ws = wv[sheet]
            r0, ult = g["r0"], g["ultima"]
            q = sum(ws.cell(r, C_QFIS).value or 0 for r in range(r0, ult + 1))
            m = sum(ws.cell(r, C_FISMAT).value or 0 for r in range(r0, ult + 1))
            chk(abs(q - m) < 1e-6,
                f"{sheet}: suma de Cantidad física = suma del material ({q:,.0f})")

    # ---- estructura del paquete
    print("\n=== Estructura del archivo (controles de Excel)")
    problemas = validar_ooxml.validar(ARCH, verbose=False)
    chk(not problemas, f"paquete xlsx válido{'' if not problemas else ': ' + str(problemas)}")

    print("\n" + ("TODAS LAS VERIFICACIONES OK" if ok_all
                  else "HAY VERIFICACIONES EN FALLA"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
