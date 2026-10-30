# -*- coding: utf-8 -*-
"""Valorización por PRECIO DE ÚLTIMA COMPRA.

Estado del dato: NO está disponible en ninguno de los archivos recibidos.

Se revisaron, campo por campo:
  · Stock Centro SJ NQN y Salta 02.10.xlsx — 20 columnas. Tiene «Valor libre
    util.» (valorización del stock) y «VU» (ese valor dividido por las unidades).
    No hay precio de compra, ni fecha, ni proveedor, ni documento de compra.
  · Homologacion_Farmacia_AVAIN_con_SAP.xlsx — declara explícitamente que «los
    campos de costo quedan fuera de este trabajo».
  · Los tres PDF de inventario físico — cero menciones de precio o compra.

En consecuencia NINGÚN material queda valorizado por última compra: todos
figuran como pendientes. Para no perder la información económica que sí existe,
se expone en paralelo la valorización de SAP, SIEMPRE rotulada como lo que es
—una valorización de stock, no un precio de compra— y nunca sumada a la otra.

Cuando se consiga la bajada de última compra, alcanza con cargarla: el sistema
la admite por material y recalcula sin tocar nada más.
"""

PENDIENTE   = "Pendiente de valorización"
VALORIZADO  = "Valorizado por última compra"
NO_APLICA   = "Sin cantidad física que valorizar"

FUENTE_NO_DISPONIBLE = "No disponible en los archivos recibidos"
FUENTE_SAP_STOCK     = "SAP · valor de stock ÷ unidades (NO es precio de compra)"

# Formato esperado del archivo de última compra, para cuando esté disponible.
LAYOUT_ULTIMA_COMPRA = [
    ("material",        "Código SAP del material"),
    ("precio_unitario", "Precio unitario de la última compra"),
    ("moneda",          "Moneda (ARS)"),
    ("fecha",           "Fecha de la última compra (AAAA-MM-DD)"),
    ("documento",       "Orden de compra o factura que respalda el precio"),
    ("proveedor",       "Proveedor"),
]


def vu_sap(maestro, material, base):
    """Valor unitario de SAP: valor de stock dividido por unidades.

    Es un promedio ponderado de la valorización contable, NO el precio de la
    última compra. Se devuelve junto con el alcance del que sale, para que
    quede claro si corresponde a la base o a otra.
    """
    d = maestro.get(material)
    if not d:
        return None, None
    b = d["bases"].get(base)
    if b and b["stock"]:
        return b["valor"] / b["stock"], f"stock de SAP en {base}"
    stock = sum(x["stock"] for x in d["bases"].values())
    valor = sum(x["valor"] for x in d["bases"].values())
    if stock:
        otras = ", ".join(sorted(d["bases"]))
        return valor / stock, f"stock de SAP en {otras} (el material no tiene stock en {base})"
    return None, None


def valorizar(ficha, maestro, precios=None):
    """Agrega los campos de valorización a una ficha. `precios` es el diccionario
    de última compra cuando exista: {material: {precio_unitario, fecha, ...}}."""
    precios = precios or {}
    mat = ficha.get("material_sap")
    cant = ficha.get("cantidad_fisica") or 0.0
    if ficha["origen"] == "Stock SAP":
        cant = ficha.get("stock_sap") or 0.0

    p = precios.get(mat) if mat else None
    if p and p.get("precio_unitario"):
        ficha.update(
            precio_ultima_compra=p["precio_unitario"],
            fecha_ultima_compra=p.get("fecha"),
            fuente_precio=p.get("documento") or "Archivo de última compra",
            estado_valorizacion=VALORIZADO if cant else NO_APLICA,
            valorizacion=(p["precio_unitario"] * cant) if cant else 0.0,
        )
    else:
        ficha.update(
            precio_ultima_compra=None,
            fecha_ultima_compra=None,
            fuente_precio=FUENTE_NO_DISPONIBLE,
            estado_valorizacion=PENDIENTE,
            valorizacion=None,
            motivo_pendiente=(
                "No existe dato de última compra para este material en los archivos "
                "recibidos." if mat else
                "El ítem no tiene código SAP asignado, así que no hay material contra "
                "el cual buscar un precio de compra."),
        )

    vu, alcance = vu_sap(maestro, mat, ficha["base"]) if mat else (None, None)
    ficha.update(
        vu_sap_referencia=vu,
        vu_sap_alcance=alcance,
        fuente_vu_sap=FUENTE_SAP_STOCK if vu is not None else None,
        valor_sap_referencia=(vu * cant) if (vu is not None and cant) else None,
    )

    # En los casos a revisar, el material todavía no está confirmado. Se muestra
    # la referencia del candidato sólo como orden de magnitud, separada y rotulada,
    # para no mezclarla con la de los materiales ya identificados.
    sug = ficha.get("material_sugerido")
    if not mat and sug:
        vs, al = vu_sap(maestro, sug, ficha["base"])
        ficha.update(
            vu_sugerido=vs, vu_sugerido_alcance=al,
            valor_sugerido_referencia=(vs * cant) if (vs is not None and cant) else None,
            nota_valor_sugerido=("Orden de magnitud calculado sobre el material "
                                 f"sugerido {sug}, que NO está confirmado. No debe "
                                 "sumarse a los totales."),
        )
    else:
        ficha.update(vu_sugerido=None, vu_sugerido_alcance=None,
                     valor_sugerido_referencia=None, nota_valor_sugerido=None)
    return ficha
