# -*- coding: utf-8 -*-
"""Arma el conjunto de datos único que alimenta el sistema, el Excel y el PDF.

Que los tres salgan de acá es lo que garantiza que las cifras coincidan.
"""
import json, os, datetime, collections
import fuentes, cruce_estricto as C, clasificar as K, valorizar as V

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SALIDA_JSON = os.path.join(RAIZ, "sistema", "datos.json")
SALIDA_JS   = os.path.join(RAIZ, "sistema", "datos.js")

CLASES = [K.A_IDENT, K.B_ALTA, K.C_BAJA, K.D_REVISAR, K.E_FUERA]


def construir():
    fis = fuentes.inventarios_fisicos()
    sap = fuentes.materiales_sap()

    res = []
    for b in fuentes.BASES:
        res += C.cruzar(fis[b], sap)
    fichas = K.clasificar_fisicos(res, sap)
    bajas = K.candidatos_baja(fichas, sap)
    casos = fichas + bajas
    for f in casos:
        V.valorizar(f, sap)
    for i, f in enumerate(casos):
        f["n"] = i + 1
        f["candidatos"] = f.get("candidatos", [])[:5]

    control = _control(fis, sap, casos)
    return {
        "meta": _meta(fis, sap, casos),
        "casos": casos,
        "kpis": _kpis(casos),
        "control": control,
    }


def _meta(fis, sap, casos):
    return {
        "generado": datetime.date.today().isoformat(),
        "criterio": ("El universo del análisis son los ítems de los inventarios "
                     "físicos. Cada uno se cruza contra los materiales que HOY tienen "
                     "stock en SAP, verificando que la nomenclatura Y la presentación "
                     "se correspondan. Esa misma bajada aporta los materiales con "
                     "stock que ningún inventario identificó, como candidatos a baja."),
        "fuentes": [
            {"base": b, "sistema": fuentes.FUENTE[b]["sistema"],
             "informe": fuentes.FUENTE[b]["informe"],
             "archivo": fuentes.FUENTE[b]["archivo"],
             "centro": fuentes.FUENTE[b]["centro"],
             "items": len(fis[b]),
             "unidades": sum(x["stock"] for x in fis[b]),
             "renglones_lote": sum(len(x["lotes"]) for x in fis[b])}
            for b in fuentes.BASES
        ],
        "sap": {"archivo": "Stock Centro SJ NQN y Salta 02.10.xlsx",
                "corte": "02/10", "codigos_unicos": len(sap),
                "pares_material_base": sum(len(d["bases"]) for d in sap.values()),
                "es_maestro_completo": False,
                "que_contiene": "Únicamente los materiales que HOY tienen stock en SAP.",
                "limitacion": ("No es el maestro completo de materiales. Un material dado de "
                               "alta en SAP con existencia cero no figura en este archivo. Por "
                               "eso, que un ítem del inventario físico no se encuentre acá no "
                               "prueba que no exista en SAP."),
                "fuera_de_alcance": ("Verificar contra el maestro completo de SAP si los ítems "
                                     "no identificados ya existen sin stock, y decidir en ese "
                                     "caso si se reutiliza el código o se da de baja y se crea "
                                     "de nuevo.")},
        "valorizacion": {
            "criterio": "Precio de última compra",
            "disponible": False,
            "explicacion": V.__doc__.strip(),
            "layout_esperado": [{"campo": a, "descripcion": b}
                                for a, b in V.LAYOUT_ULTIMA_COMPRA],
        },
        "clases": CLASES,
        "bases": fuentes.BASES,
        "tipos": sorted({f["tipo"] for f in casos}),
        "motivos_revision": sorted({f["motivo"] for f in casos
                                    if f["clasificacion"] == K.D_REVISAR and f["motivo"]}),
    }


def _kpis(casos):
    def cuenta(pred): return sum(1 for f in casos if pred(f))
    por_clase = collections.Counter(f["clasificacion"] for f in casos)
    k = {
        "total_casos": len(casos),
        "items_fisicos": cuenta(lambda f: f["origen"] == "Inventario físico"),
        "unidades_fisicas": sum(f["cantidad_fisica"] or 0 for f in casos
                                if f["origen"] == "Inventario físico"),
        "identificados": por_clase[K.A_IDENT],
        "pendientes_alta": por_clase[K.B_ALTA],
        "candidatos_baja": por_clase[K.C_BAJA],
        "en_revision": por_clase[K.D_REVISAR],
        "fuera_alcance": por_clase[K.E_FUERA],
        "pendientes_valorizacion": cuenta(
            lambda f: f["estado_valorizacion"] == V.PENDIENTE),
        "valorizacion_total": None,
        "bajas_bloqueadas": cuenta(lambda f: f.get("bloqueado_por_revision")),
        "sin_stock_en_base": cuenta(lambda f: f.get("material_sin_stock_en_base")),
        "referencia_sap": {
            cl: round(sum(f["valor_sap_referencia"] or 0
                          for f in casos if f["clasificacion"] == cl), 2)
            for cl in CLASES},
        "por_base": {}, "por_tipo": {}, "por_base_clase": {}, "por_tipo_clase": {},
    }
    for b in fuentes.BASES:
        g = [f for f in casos if f["base"] == b]
        k["por_base"][b] = {
            "casos": len(g),
            "items_fisicos": sum(1 for f in g if f["origen"] == "Inventario físico"),
            "unidades_fisicas": sum(f["cantidad_fisica"] or 0 for f in g
                                    if f["origen"] == "Inventario físico"),
            **{cl: sum(1 for f in g if f["clasificacion"] == cl) for cl in CLASES},
            "referencia_sap": round(sum(f["valor_sap_referencia"] or 0 for f in g), 2),
        }
    for t in sorted({f["tipo"] for f in casos}):
        g = [f for f in casos if f["tipo"] == t]
        k["por_tipo"][t] = {"casos": len(g),
                            **{cl: sum(1 for f in g if f["clasificacion"] == cl)
                               for cl in CLASES}}
    k["motivos"] = dict(collections.Counter(
        f["motivo"] for f in casos if f["clasificacion"] == K.D_REVISAR and f["motivo"]))
    k["confianza"] = dict(collections.Counter(
        f["confianza"] for f in casos if f.get("confianza")))
    return k


def _control(fis, sap, casos):
    """Controles de integridad: lo que el sistema dice tiene que cerrar contra las fuentes."""
    ctl = []
    for b in fuentes.BASES:
        orig_items = len(fis[b]); orig_un = sum(x["stock"] for x in fis[b])
        sis_items = sum(1 for f in casos
                        if f["base"] == b and f["origen"] == "Inventario físico")
        sis_un = sum(f["cantidad_fisica"] or 0 for f in casos
                     if f["base"] == b and f["origen"] == "Inventario físico")
        ctl.append({"control": f"Ítems del inventario físico · {b}",
                    "fuente": orig_items, "sistema": sis_items,
                    "estado": "Coincide" if orig_items == sis_items else "A REVISAR"})
        ctl.append({"control": f"Unidades físicas · {b}",
                    "fuente": round(orig_un, 2), "sistema": round(sis_un, 2),
                    "estado": "Coincide" if abs(orig_un - sis_un) < 0.005 else "A REVISAR"})
    pares = sum(len(d["bases"]) for d in sap.values())
    ident = len({(f["base"], f["material_sap"]) for f in casos
                 if f["material_sap"] and f["origen"] == "Inventario físico"
                 and f["base"] in sap[f["material_sap"]]["bases"]})
    desde_sap = sum(1 for f in casos if f["origen"] == "Stock SAP")
    ctl.append({"control": "Pares material-base de SAP cubiertos",
                "fuente": pares, "sistema": ident + desde_sap,
                "estado": "Coincide" if pares == ident + desde_sap else "A REVISAR",
                "detalle": f"{ident} identificados por un ítem físico + {desde_sap} sin identificar"})
    sin_stock = sum(1 for f in casos if f.get("material_sin_stock_en_base"))
    ctl.append({"control": "Ítems identificados cuyo material no tiene stock en SAP en su base",
                "fuente": sin_stock, "sistema": sin_stock, "estado": "Informativo",
                "detalle": ("Existe la existencia física y existe el código, pero SAP no "
                            "registra stock en ese centro. No son altas: hay que registrar "
                            "la existencia o revisar el centro.")})
    return ctl


def guardar(d):
    os.makedirs(os.path.dirname(SALIDA_JSON), exist_ok=True)
    with open(SALIDA_JSON, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, separators=(",", ":"))
    with open(SALIDA_JS, "w", encoding="utf-8") as fh:
        fh.write("// Generado automáticamente. No editar a mano.\n")
        fh.write("window.DATOS = ")
        json.dump(d, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    return SALIDA_JSON, SALIDA_JS


if __name__ == "__main__":
    d = construir()
    a, b = guardar(d)
    k = d["kpis"]
    print(f"casos: {k['total_casos']}   ítems físicos: {k['items_fisicos']}")
    print(f"A={k['identificados']}  B={k['pendientes_alta']}  C={k['candidatos_baja']}  "
          f"D={k['en_revision']}  E={k['fuera_alcance']}")
    print(f"pendientes de valorización: {k['pendientes_valorizacion']}")
    print("\nCONTROLES")
    for c in d["control"]:
        print(f"   {c['estado']:10s} {c['control']:44s} fuente={c['fuente']} sistema={c['sistema']}")
    print(f"\n{a}  ({os.path.getsize(a)/1024:.0f} KB)")
    print(f"{b}  ({os.path.getsize(b)/1024:.0f} KB)")
