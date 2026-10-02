# -*- coding: utf-8 -*-
"""Hoja 'Guia paso a paso': explica el archivo desde cero, sin dar nada por sabido."""
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
import estilo as E
from estilo import L

ANCHO = [4, 30, 34, 34, 30]
VERDE = PatternFill("solid", fgColor="FFC6EFCE")
NARANJA = PatternFill("solid", fgColor="FFFCD5B4")
ROJO = PatternFill("solid", fgColor="FFFFC7CE")
GRIS = PatternFill("solid", fgColor="FFEDEDED")
AMAR = PatternFill("solid", fgColor="FFFFF2CC")


def _h1(ws, f, texto):
    c = ws.cell(f, 1, texto)
    c.font = Font(name="Arial", sz=14, b=True, color="FFFFFFFF")
    c.fill = E.FILL_HDR
    c.alignment = Alignment(vertical="center", indent=1)
    ws.merge_cells(start_row=f, start_column=1, end_row=f, end_column=5)
    ws.row_dimensions[f].height = 26
    return f + 2


def _p(ws, f, texto, col=2, ancho=4, neg=False):
    c = ws.cell(f, col, texto)
    c.font = E.F_BOLD if neg else E.F_BASE
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=f, start_column=col, end_row=f,
                   end_column=min(col + ancho - 1, 5))
    largo = sum(ANCHO[col - 1:col - 1 + ancho])
    ws.row_dimensions[f].height = max(15, 13 * (1 + len(texto) // max(largo, 20)))
    return f + 1


def _paso(ws, f, n, texto):
    c = ws.cell(f, 1, n)
    c.font = Font(name="Arial", sz=11, b=True, color=E.AZUL)
    c.alignment = Alignment(horizontal="center", vertical="top")
    return _p(ws, f, texto)


def _tabla(ws, f, cols, filas, fills=None):
    for i, (t, w) in enumerate(cols, start=2):
        c = ws.cell(f, i, t)
        c.font = E.F_HDR
        c.fill = E.FILL_HDR2
        c.alignment = Alignment(wrap_text=True, vertical="center")
        if ws.column_dimensions[L(i)].width or 0 < w:
            ws.column_dimensions[L(i)].width = max(
                ws.column_dimensions[L(i)].width or 0, w)
    ws.row_dimensions[f].height = 30
    f += 1
    for j, fila in enumerate(filas):
        for i, v in enumerate(fila, start=2):
            c = ws.cell(f, i, v)
            c.font = E.F_BASE
            c.alignment = Alignment(wrap_text=True, vertical="top")
            c.border = Border(bottom=Side(style="thin", color="FFD9D9D9"))
        if fills and fills[j]:
            ws.cell(f, 2).fill = fills[j]
        largo = max(len(str(v)) for v in fila)
        ws.row_dimensions[f].height = max(15, 13 * (1 + largo // 34))
        f += 1
    return f + 1


def escribir(wb):
    ws = wb.create_sheet("Guía paso a paso", 0)
    for i, w in enumerate(ANCHO, start=1):
        ws.column_dimensions[L(i)].width = w
    ws.sheet_view.showGridLines = False

    f = 2
    c = ws.cell(f, 1, "Guía paso a paso")
    c.font = Font(name="Arial", sz=20, b=True, color=E.AZUL)
    f += 1
    f = _p(ws, f, "Cómo usar este archivo, explicado desde cero. No hace falta "
                  "conocer el proceso: cada paso dice qué mirar y en qué hoja.",
           col=1, ancho=5)
    f += 1

    # ---------------------------------------------------------------- qué es
    f = _h1(ws, f, "1 · ¿Qué hace este archivo?")
    f = _p(ws, f, "Compara DOS listas de lo mismo y muestra en qué no coinciden:",
           col=1, ancho=5)
    f = _tabla(ws, f, [("La lista", 30), ("De dónde sale", 34), ("Qué dice", 34)], [
        ["1) Stock SAP", "Bajada del sistema SAP al 02/10",
         "Las unidades que SAP cree que hay en cada base"],
        ["2) Inventario físico", "Lo que Avain contó a mano, en los PDF",
         "Las unidades que realmente hay en el depósito"],
    ])
    f = _p(ws, f, "Cuando los dos números no coinciden, hay que corregir SAP: "
                  "sacarle lo que sobra o agregarle lo que falta. Este archivo dice "
                  "exactamente qué y cuánto.", col=1, ancho=5)
    f += 1
    f = _p(ws, f, "Hay un problema en el medio: SAP y Avain le ponen nombres "
                  "distintos al mismo producto. SAP dice «JERINGA 10 ML» y Avain "
                  "dice «Jeringas 10 cc». Emparejar esos nombres es lo que llamamos "
                  "HOMOLOGAR. Por eso cada fila trae un nivel de confianza: dice "
                  "cuán seguro es que esos dos nombres sean el mismo producto.",
           col=1, ancho=5)
    f += 1

    # ------------------------------------------------- las dos reglas básicas
    f = _h1(ws, f, "2 · Dos reglas para no confundirse nunca")
    f = _p(ws, f, "REGLA 1 — Unidades o pesos: el encabezado siempre lo aclara.",
           col=1, ancho=5, neg=True)
    f = _tabla(ws, f, [("Si el encabezado dice…", 30), ("Entonces el número es…", 34),
                       ("Se ve así", 34)], [
        ["UNIDADES", "una cantidad de cosas: frascos, comprimidos, jeringas",
         "2.367"],
        ["IMPORTE $", "plata, pesos argentinos", "$ 137.512,84"],
    ], fills=[GRIS, AMAR])
    f = _p(ws, f, "Todos los importes se muestran con el signo $ adelante. Si no "
                  "tiene $, son unidades.", col=1, ancho=5)
    f += 1
    f = _p(ws, f, "REGLA 2 — El signo de la diferencia dice qué hacer.",
           col=1, ancho=5, neg=True)
    f = _p(ws, f, "La cuenta es siempre la misma:  Diferencia = lo que dice SAP − "
                  "lo que se contó.", col=1, ancho=5)
    f = _tabla(ws, f, [("Si la diferencia es…", 30), ("Significa que…", 34),
                       ("Hay que…", 34)], [
        ["POSITIVA (ej. 1.449)", "SAP tiene más de lo que hay en el depósito",
         "DAR DE BAJA en SAP esas unidades"],
        ["NEGATIVA (ej. −350)", "hay más en el depósito de lo que SAP registra",
         "DAR DE ALTA en SAP esas unidades"],
        ["CERO", "SAP y el depósito coinciden", "no hacer nada"],
    ], fills=[NARANJA, VERDE, GRIS])
    f += 1

    # ----------------------------------------------------------- las hojas
    f = _h1(ws, f, "3 · Qué hay en cada hoja")
    f = _tabla(ws, f, [("Hoja", 30), ("Para qué sirve", 34),
                       ("Cuándo la uso", 34)], [
        ["Resumen del cruce", "Los números grandes de cada base, en una sola fila",
          "Para contar el resultado en una reunión"],
        ["Conciliación", "UNA FILA POR MATERIAL. El corazón del archivo",
          "Para buscar un material y ver todo junto"],
        ["Dar de baja en SAP", "Los materiales a los que hay que restar unidades",
          "Para hacer los ajustes de baja"],
        ["Dar de alta en SAP", "Los materiales a los que hay que sumar unidades",
          "Para hacer los ajustes de alta"],
        ["Sin correspondencia SAP", "Lo que Avain contó y no existe en SAP",
          "Para dar de alta materiales nuevos"],
        ["1120 SJ · 1060 NQN · 1130 Salta", "El detalle fino de SAP, fila por lote "
          "y almacén. Es el archivo de SAP original con el cruce agregado",
          "Para Contabilidad y para auditar una fila"],
        ["Control de cantidades", "Prueba de que los totales coinciden con los "
          "archivos originales", "Para verificar que nada se perdió"],
        ["Posibles duplicidades", "Casos donde dos códigos de SAP podrían ser el "
          "mismo producto", "Para que alguien decida cuál es el correcto"],
        ["Fuera del Master", "Materiales contados que no estaban en el Master de Seba",
          "Para completar el Master"],
        ["Metodología", "El detalle técnico de cómo se hizo todo",
          "Si alguien pregunta «¿cómo lo calcularon?»"],
    ])
    f = _p(ws, f, "Si sólo vas a abrir una hoja, abrí CONCILIACIÓN.", col=1, ancho=5,
           neg=True)
    f += 1

    # ----------------------------------------- paso a paso: revisar un material
    f = _h1(ws, f, "4 · Paso a paso: quiero revisar UN material")
    f = _p(ws, f, "Ejemplo real del archivo: las jeringas de 10 ml de San Juan.",
           col=1, ancho=5)
    f += 1
    for n, t in [
        ("1", "Abrí la hoja CONCILIACIÓN."),
        ("2", "Apretá Ctrl+B (Buscar) y escribí lo que conozcas: el código de SAP "
              "«2000028», o el nombre «JERINGA», o el nombre que usa Avain "
              "«Jeringas 10 cc». Cualquiera de los tres te lleva a la misma fila."),
        ("3", "Mirá las tres columnas del medio, que son las que importan:"),
    ]:
        f = _paso(ws, f, n, t)
    f = _tabla(ws, f, [("Columna", 30), ("Dice", 34), ("En el ejemplo", 34)], [
        ["Cantidad SAP · UNIDADES", "lo que SAP cree que hay", "2.367"],
        ["Cantidad física Avain · UNIDADES", "lo que Avain contó", "918"],
        ["Diferencia (SAP − físico) · UNIDADES", "cuánto no coincide", "1.449"],
    ], fills=[GRIS, GRIS, NARANJA])
    for n, t in [
        ("4", "Leé la columna ACCIÓN EN SAP. En el ejemplo dice «Dar de baja en "
              "SAP»: sobran 1.449 jeringas en el sistema."),
        ("5", "Leé ESTADO DE HOMOLOGACIÓN. En el ejemplo dice «Homologado – "
              "confianza Alta»: estamos seguros de que «JERINGA 10 ML» de SAP y "
              "«Jeringas 10 cc» de Avain son el mismo producto, así que la "
              "diferencia es confiable."),
        ("6", "Mirá la DIFERENCIA ECONÓMICA: $ 137.512,84. Es cuánta plata "
              "representa esa diferencia de 1.449 unidades."),
        ("7", "Si la columna ALERTA DE VALORIZACIÓN tiene texto, el importe NO es "
              "confiable todavía. Está explicado en el punto 7 de esta guía."),
    ]:
        f = _paso(ws, f, n, t)
    f += 1

    # ------------------------------------- paso a paso: qué ajustar en SAP
    f = _h1(ws, f, "5 · Paso a paso: quiero saber qué ajustar en SAP")
    for n, t in [
        ("1", "Abrí DAR DE BAJA EN SAP. Son los materiales a los que SAP les "
              "tiene de más. Vienen ordenados por plata, así que los primeros son "
              "los que más importan."),
        ("2", "Abrí DAR DE ALTA EN SAP. Son los materiales a los que SAP les tiene "
              "de menos."),
        ("3", "Abrí SIN CORRESPONDENCIA SAP. Son productos que Avain contó y que "
              "SAP no tiene en esa base: no hay nada que corregir, hay que CREAR el "
              "material. Ejemplo del archivo: «Barbijos quirúrgicos x 1 ud», 350 "
              "unidades contadas en San Juan, sin código de SAP."),
        ("4", "En las tres hojas, la columna CANTIDAD A AJUSTAR es cuántas unidades "
              "mover, y VALOR ECONÓMICO DEL AJUSTE es cuánta plata es."),
        ("5", "Los totales de abajo responden al filtro: si filtrás una base, el "
              "total se recalcula solo para esa base."),
    ]:
        f = _paso(ws, f, n, t)
    f += 1

    # ------------------------------------------------- los estados posibles
    f = _h1(ws, f, "6 · Los seis estados posibles (columna «Acción en SAP»)")
    f = _p(ws, f, "Todo material cae en uno de estos seis casos. Los dos últimos NO "
                  "son errores ni faltantes.", col=1, ancho=5)
    f = _tabla(ws, f, [("Dice", 30), ("Significa", 34), ("Qué hacer", 34)], [
        ["Dar de baja en SAP", "Se contó y hay menos de lo que dice SAP",
         "Restar unidades en SAP"],
        ["Dar de alta en SAP", "Se contó y hay más de lo que dice SAP",
         "Sumar unidades en SAP"],
        ["Sin diferencia", "Se contó y coincide exacto", "Nada"],
        ["Alta de material en SAP (sin código)", "Avain lo contó pero SAP no tiene "
         "ese material en la base", "Crear el material en SAP"],
        ["Sin recuento físico", "Es un medicamento o descartable que SAP tiene, "
         "pero el inventario no lo contó", "Averiguar si no se contó o no está. "
         "NO es un faltante"],
        ["Fuera del alcance del inventario físico", "Es un uniforme, un equipo o un "
         "repuesto. El inventario de Avain es de Farmacia y no los releva",
         "Nada. No es una falta de coincidencia"],
    ], fills=[NARANJA, VERDE, GRIS, ROJO, AMAR, GRIS])
    f += 1

    # ------------------------------------------------------ las cuentas
    f = _h1(ws, f, "7 · Las cuentas, con el ejemplo de las jeringas")
    f = _tabla(ws, f, [("Qué se calcula", 30), ("Cómo", 34), ("En el ejemplo", 34)], [
        ["Diferencia en unidades", "Cantidad SAP − Cantidad física",
         "2.367 − 918 = 1.449"],
        ["VU promedio ponderado",
         "Valor total del material en SAP ÷ unidades totales del material en SAP. "
         "Es el precio promedio de una unidad",
         "$ 94,90 por jeringa"],
        ["Diferencia económica", "Diferencia en unidades × VU promedio ponderado",
         "1.449 × $ 94,90 = $ 137.512,84"],
    ])
    f = _p(ws, f, "Por qué «promedio ponderado»: el mismo material entra a SAP en "
                  "distintas compras, a distintos precios. El promedio ponderado "
                  "pesa cada compra por su cantidad, así que es el criterio "
                  "correcto y es el que se definió para este análisis.",
           col=1, ancho=5)
    f += 1
    f = _p(ws, f, "Un material puede ocupar varias filas en las hojas de SAP, una "
                  "por lote y almacén. Las jeringas del ejemplo ocupan las filas 8 "
                  "y 73 de la hoja 1120 SJ. La cantidad contada se escribe UNA SOLA "
                  "VEZ, en la primera fila del material, para no contarla dos "
                  "veces. Por eso en la hoja Conciliación hay una sola fila por "
                  "material: es más fácil de leer.", col=1, ancho=5)
    f += 1

    # ------------------------------------------------------ las alertas
    f = _h1(ws, f, "8 · Cuándo NO confiar en el importe")
    f = _p(ws, f, "Algunas filas tienen texto en la columna ALERTA DE VALORIZACIÓN. "
                  "Quiere decir que el importe puede estar muy mal, por una razón "
                  "concreta: SAP y Avain miden en distinta unidad.", col=1, ancho=5)
    f += 1
    f = _p(ws, f, "El caso más grave del archivo:", col=1, ancho=5, neg=True)
    f = _tabla(ws, f, [("Material", 30), ("Qué dice el archivo", 34),
                       ("Por qué no cierra", 34)], [
        ["ELECTRODOS C/CONECTOR PARA DESFIBRILADOR (2001077, Neuquén)",
         "SAP: 5 unidades por $ 1.047.361, o sea $ 209.472 cada una. "
         "Avain contó 1.465.",
         "Un electrodo no cuesta $ 209.472. Lo más probable es que SAP cuente CAJAS "
         "y Avain cuente UNIDADES sueltas."],
    ], fills=[ROJO])
    f = _p(ws, f, "Ese único material mueve la diferencia económica de Neuquén de "
                  "+$ 89,9 millones a −$ 215 millones. Por eso el Resumen muestra "
                  "el importe en tres columnas: el total, la parte con alerta, y el "
                  "importe confiable que queda al descontarla. Hasta que alguien "
                  "confirme las unidades de medida, usá la columna confiable.",
           col=1, ancho=5)
    f += 1
    f = _p(ws, f, "También hay 196 ítems sin código en SAP: no tienen precio, así "
                  "que su diferencia económica NO se puede calcular. No se inventó "
                  "ningún valor: figuran como dato faltante.", col=1, ancho=5)
    f += 1

    # ------------------------------------------------------ glosario
    f = _h1(ws, f, "9 · Glosario")
    f = _tabla(ws, f, [("Palabra", 30), ("Qué quiere decir", 34),
                       ("Dónde aparece", 34)], [
        ["SAP", "El sistema de gestión de la empresa. Es la base de este archivo",
         "Todas las hojas"],
        ["Avain", "Quien hizo el recuento físico en cada base",
         "Columnas «físico» y «Avain»"],
        ["Base / Centro", "La sede: San Juan (1120), Neuquén (1060), Salta (1130)",
         "Primera columna"],
        ["Libre utilización", "Las unidades disponibles para usar según SAP. Es la "
         "cantidad de SAP que se compara", "Columna I del detalle"],
        ["Homologar", "Emparejar el nombre de SAP con el nombre de Avain cuando son "
         "el mismo producto", "Estado de homologación"],
        ["Master de Seba", "La lista de 284 productos que se usó como puente entre "
         "los nombres de SAP y los de Avain. Es parcial: no cubre todo",
         "«¿Informado en Master de Seba?»"],
        ["Nivel de confianza", "Cuán seguros estamos del emparejamiento: Alta, "
         "Media o Baja. Media y Baja hay que validarlas", "Nivel de coincidencia"],
        ["VU", "Valor unitario: cuánto cuesta una unidad", "Columna P y VU promedio"],
        ["Lote / Almacén", "Divisiones internas de SAP. Un mismo material aparece "
         "varias veces, una por lote y almacén", "Columnas C y G del detalle"],
        ["ZMED / ZDES / ZUNI / ZEQI / ZERS",
         "El tipo de material en SAP: medicamentos, descartables, uniformes, "
         "equipos, repuestos", "Clasificación SAP"],
        ["BUSCARV", "La función de Excel para buscar un dato en otra tabla. Cuando "
         "dos códigos de SAP podían ser el mismo producto, se tomó el primero",
         "Posibles duplicidades"],
    ])
    f += 1
    f = _p(ws, f, "Si algo no se entiende, está en la hoja METODOLOGÍA con el "
                  "detalle técnico, o en el archivo CORRECCIONES.md del repositorio.",
           col=1, ancho=5)
    ws.sheet_view.zoomScale = 100
    return ws
