# -*- coding: utf-8 -*-
"""Modelo de almacenes: dónde está registrado el stock dentro de cada base.

Hay tres cuestiones distintas y conviene no mezclarlas:

    1. ¿El material está bien IDENTIFICADO?   -> lo resuelve el cruce
    2. ¿Tiene STOCK?                          -> lo dice la bajada
    3. ¿Ese stock está en el ALMACÉN que corresponde?  -> esto

Un material perfectamente identificado puede figurar en el almacén equivocado.
Eso no lo convierte en candidato a alta ni a baja: es un problema de ubicación.

CENTRO y ALMACÉN son campos distintos de SAP. El centro es la base; el almacén
es el depósito dentro de esa base.

Qué está OBSERVADO y qué es una PROPUESTA:

  · Observado — a qué base pertenece cada almacén. En la bajada, cada código de
    almacén aparece bajo un único centro. No se dedujo por parecido de nombres
    ni de códigos: está en el archivo.

  · Propuesta — qué almacén DEBERÍA contener el stock de Farmacia en cada base.
    Eso no está en ningún archivo recibido. Se propone a partir de la
    composición observada de cada almacén (qué materiales y cuántas unidades
    concentra) y HAY QUE VALIDARLO con cada base antes de concluir nada.

Lo que falta en los archivos recibidos está listado en FALTANTES.
"""
import collections

OK       = "Almacén correcto"
A_CAMBIAR= "Almacén a cambiar"
VALIDAR  = "Almacén pendiente de validación"
MULTIPLE = "Material en múltiples almacenes"
NO_IDENT = "Almacén no identificado"
SIN_STOCK= "Sin stock, sin almacén"

ESTADOS = [OK, A_CAMBIAR, MULTIPLE, VALIDAR, NO_IDENT, SIN_STOCK]

FALTANTES = [
    "Descripción de cada código de almacén (la bajada sólo trae el código)",
    "Confirmación de qué almacén debe contener el stock de Farmacia en cada base",
    "Confirmación de si medicamentos y descartables van a almacenes distintos",
]

# El inventario relevado es de Farmacia: la propuesta de almacén esperado sólo
# tiene sentido para medicamentos y descartables.
TIPOS_FARMACIA = ("Medicamento", "Descartable")


def inventario(sap, tipo_de):
    """Recorre las filas originales de la bajada y arma tres vistas.

    `sap`     es el consolidado de fuentes.materiales_sap()
    `tipo_de` es una función material -> "Medicamento" / "Descartable" / otro

    Devuelve:
      det  {(base, material): {almacen: stock}}      dónde está cada material
      comp {(base, almacen): {...}}                   composición de cada almacén
      por_tipo {(base, tipo): {almacen: {...}}}       composición por tipo
    """
    det = collections.defaultdict(lambda: collections.defaultdict(float))
    comp = collections.defaultdict(lambda: {"unidades": 0.0, "materiales": set(),
                                            "tipos": collections.Counter()})
    por_tipo = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {"unidades": 0.0, "materiales": set()}))

    for m, d in sap.items():
        t = tipo_de(m)
        for fila in d["filas"]:
            alm = (fila.get("almacen") or "").strip()
            u = fila.get("stock") or 0.0
            base = fila["base"]
            det[(base, m)][alm] += u
            if u <= 0:
                continue                     # sin stock no hay ubicación que analizar
            c = comp[(base, alm)]
            c["unidades"] += u
            c["materiales"].add(m)
            c["tipos"][t] += 1
            p = por_tipo[(base, t)][alm]
            p["unidades"] += u
            p["materiales"].add(m)

    det = {k: dict(v) for k, v in det.items()}
    comp = {k: {"unidades": round(v["unidades"], 2), "materiales": len(v["materiales"]),
                "tipos": dict(v["tipos"])} for k, v in comp.items()}
    por_tipo = {k: {a: {"unidades": round(x["unidades"], 2),
                        "materiales": len(x["materiales"])}
                    for a, x in v.items()} for k, v in por_tipo.items()}
    return det, comp, por_tipo


def almacenes_por_base(comp):
    """Qué almacenes aparecen en cada base. Esto está OBSERVADO en la bajada."""
    out = collections.defaultdict(set)
    for (base, alm) in comp:
        if alm:
            out[base].add(alm)
    return {b: sorted(v) for b, v in out.items()}


def proponer(por_tipo, bases):
    """Propone el almacén esperado por (base, tipo). Es una PROPUESTA a validar.

    El criterio es la composición observada: el almacén que concentra el stock
    de ese tipo en esa base. Cuando el segundo almacén está cerca del primero la
    propuesta se marca «Ambigua» y se dice por qué: no se elige por el nombre ni
    por el número del código.
    """
    prop = {}
    filas = []
    for b in bases:
        for t in TIPOS_FARMACIA:
            d = por_tipo.get((b, t), {})
            orden = sorted(((a, x) for a, x in d.items() if a),
                           key=lambda p: -p[1]["unidades"])
            if not orden:
                continue
            mejor = orden[0]
            segundo = orden[1] if len(orden) > 1 else None
            clara = (segundo is None) or (mejor[1]["unidades"] >= 3 * segundo[1]["unidades"])
            nota = ""
            if not clara:
                nota = ("El segundo almacén también concentra volumen de este tipo "
                        f"({segundo[0]}: {segundo[1]['unidades']:,.0f} un., "
                        f"{segundo[1]['materiales']} materiales). La propuesta no es "
                        "concluyente: hay que preguntarle a la base.")
            prop[(b, t)] = mejor[0]
            filas.append({
                "base": b, "tipo": t, "almacen": mejor[0],
                "confianza": "Clara" if clara else "Ambigua",
                "nota": nota,
                "alternativas": [{"almacen": a, "unidades": x["unidades"],
                                  "materiales": x["materiales"]} for a, x in orden],
            })
    return prop, filas


def clasificar_ubicacion(ubic, esperado):
    """ubic: {almacen: stock} de un material en una base. esperado: código propuesto."""
    con_stock = {a: u for a, u in ubic.items() if u > 0}
    if not con_stock:
        return SIN_STOCK, esperado, []
    detalle = [{"almacen": a or "(sin almacén)", "stock": round(u, 2)}
               for a, u in sorted(con_stock.items(), key=lambda x: -x[1])]
    if len(con_stock) > 1:
        return MULTIPLE, esperado, detalle
    alm = next(iter(con_stock))
    if not alm:
        return NO_IDENT, esperado, detalle
    if esperado is None:
        return VALIDAR, None, detalle
    return (OK if alm == esperado else A_CAMBIAR), esperado, detalle


def resumen(casos):
    """Conteos por estado de ubicación, para el tablero."""
    return dict(collections.Counter(c.get("almacen_estado") for c in casos
                                    if c.get("almacen_estado")))
