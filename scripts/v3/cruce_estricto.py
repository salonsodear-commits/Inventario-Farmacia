# -*- coding: utf-8 -*-
"""Cruza cada ítem del inventario físico contra el maestro de SAP.

Criterio: una coincidencia sólo se acepta si está justificada por las
características del material. El parecido del nombre genera el candidato;
los atributos deciden. Cualquier contradicción de atributos descarta al
candidato y cualquier atributo que falte para confirmar la presentación manda
el caso a revisión, nunca a coincidencia automática.
"""
import math, collections, re
import atributos as A

# --------------------------------------------------------------- IDF
def construir_idf(textos):
    df = collections.Counter()
    for t in textos:
        for w in set(A.denominacion(t)):
            df[w] += 1
    n = max(len(textos), 1)
    return {w: math.log(1 + n / (1 + c)) for w, c in df.items()}, n


def _peso(w, idf, n):
    return idf.get(w, math.log(1 + n))


def cobertura(origen, destino, idf, n):
    """Qué proporción del peso de 'origen' está explicada por 'destino'."""
    if not origen:
        return 0.0
    dest = collections.Counter(destino)
    tot = cub = 0.0
    for w in origen:
        p = _peso(w, idf, n)
        tot += p
        if dest.get(w, 0) > 0:
            dest[w] -= 1; cub += p
        else:                                  # prefijo largo: gasa/gasas, aguja/agujas
            for d in dest:
                if dest[d] > 0 and len(w) >= 5 and len(d) >= 5 and \
                   (w.startswith(d[:5]) or d.startswith(w[:5])):
                    dest[d] -= 1; cub += p * 0.9; break
    return cub / tot if tot else 0.0


DISCRIMINANTES = ("concentracion", "volumen", "calibre", "medidas", "talle",
                  "modelo", "longitud", "poblacion", "sueltos")

def declara_atributos(p):
    return any(p[k] for k in DISCRIMINANTES)

def atributos_comparados(pa, pb):
    """Atributos verificados: declarados por ambos lados, del mismo tipo, y coincidentes."""
    return A.comparar(pa, pb)[1]


# --------------------------------------------------------------- clasificación
IDENTIFICADO   = "Identificado en SAP"
SIN_CORRESP    = "Sin correspondencia en SAP"
REVISION       = "Requiere revisión"

R_CONFLICTO    = "Conflicto de presentación"
R_FALTA_ATRIB  = "Falta un atributo para confirmar la presentación"
R_AMBIGUO      = "Varios códigos SAP posibles"
R_NOM_POBRE    = "Nomenclatura insuficiente para decidir"
R_PARCIAL      = "Coincidencia parcial de denominación"

UMBRAL_CAND    = 0.45     # mínimo para considerar que hay algo parecido
MARGEN_AMBIGUO = 0.08     # si el segundo queda a menos de esto, es ambiguo

# Exigencia sobre la denominación según cuántos atributos quedaron VERIFICADOS.
# Cuantas más características se comprobaron, menos tiene que cargar el nombre:
# la coincidencia la justifican las características, que es el criterio pedido.
# Sin ningún atributo verificado, el nombre tiene que sostenerlo todo.
# La cobertura del texto SAP se exige fuerte sólo cuando no hay ningún atributo
# verificado. SAP suele ser más descriptivo que el inventario físico («CATETER
# INTRAVENOSO 14G T/ABBOCATH» por «Abbocath Nº 14»), y castigar esa riqueza
# descartaría identificaciones correctas. Cuando el calibre, la concentración o
# la medida están verificados, son ellos los que justifican la equivalencia.
EXIGENCIA = {        # atributos verificados -> (cobertura del nombre físico, del texto SAP)
    0: (0.85, 0.65),
    1: (0.80, 0.30),
    2: (0.70, 0.25),
}
def exigencia(n):
    return EXIGENCIA.get(min(n, 2), EXIGENCIA[2])


def cruzar(items_fis, maestro_sap, hints=None):
    """Devuelve una lista de resultados, uno por ítem físico."""
    hints = hints or {}
    textos_sap = [d["texto"] for d in maestro_sap.values()]
    nombres_fis = [i["nombre"] for i in items_fis]
    idf, n = construir_idf(textos_sap + nombres_fis)

    perf_sap = {m: A.perfil(d["texto"], d["tipo"]) for m, d in maestro_sap.items()}
    # índice invertido para no comparar todo contra todo
    inv = collections.defaultdict(set)
    for m, p in perf_sap.items():
        for w in set(p["denominacion"]):
            inv[w].add(m)
            if len(w) >= 5:
                inv[w[:5]].add(m)

    resultados = []
    for it in items_fis:
        pf = A.perfil(it["nombre"])
        cands = set()
        for w in set(pf["denominacion"]):
            cands |= inv.get(w, set())
            if len(w) >= 5:
                cands |= inv.get(w[:5], set())
        for m in hints.get((it["base"], it["codigo"]), []):
            if m in maestro_sap:
                cands.add(m)

        evaluados = []
        for m in cands:
            ps = perf_sap[m]
            cf = cobertura(pf["denominacion"], ps["denominacion"], idf, n)
            cs = cobertura(ps["denominacion"], pf["denominacion"], idf, n)
            if max(cf, cs) < UMBRAL_CAND:
                continue
            confl, coinc, _ = A.comparar(pf, ps)
            detalle = A.comparar_detalle(pf, ps)
            evaluados.append({
                "detalle": detalle, "presentacion": A.describir(ps),
                "material": m, "texto": maestro_sap[m]["texto"],
                "tipo": maestro_sap[m]["tipo"], "cob_fis": cf, "cob_sap": cs,
                "score": 0.5 * cf + 0.5 * cs, "conflictos": confl,
                "coinciden": coinc, "n_coinc": len(coinc),
                "sap_declara": declara_atributos(ps),
            })
        # Primero manda cuántos atributos quedaron verificados; el parecido del
        # nombre sólo desempata. Es la regla que pide el criterio: la coincidencia
        # la justifican las características, no el nombre.
        limpios = sorted([e for e in evaluados if not e["conflictos"]],
                         key=lambda e: (-e["n_coinc"], -e["score"]))
        sucios  = sorted([e for e in evaluados if e["conflictos"]],
                         key=lambda e: -e["score"])

        res = {
            "base": it["base"], "codigo": it["codigo"], "nombre": it["nombre"],
            "stock": it["stock"], "lotes": it["lotes"],
            "presentacion": A.describir(pf),
            "candidatos": [_corto(e) for e in (limpios[:4] + sucios[:4])],
        }

        if not limpios:
            if sucios and sucios[0]["score"] >= 0.60:
                e = sucios[0]
                res.update(clasificacion=REVISION, motivo=R_CONFLICTO, material=None,
                           texto_sap=None, score=e["score"],
                           justificacion=(
                               f"El candidato más parecido es {e['material']} «{e['texto']}», "
                               f"pero difiere en {', '.join(e['conflictos'])}. "
                               f"No se asigna el código: una diferencia de presentación "
                               f"significa que no es el mismo material."))
            else:
                res.update(clasificacion=SIN_CORRESP, motivo=None, material=None,
                           texto_sap=None, score=sucios[0]["score"] if sucios else 0.0,
                           justificacion=("No se encontró ningún material cuya denominación "
                                          "y presentación se correspondan con este ítem "
                                          "ENTRE LOS MATERIALES QUE HOY TIENEN STOCK en SAP. "
                                          "La bajada disponible no es el maestro completo, así "
                                          "que el material podría existir en SAP con existencia "
                                          "cero: hay que verificarlo antes de proponer el alta."))
            resultados.append(res); continue

        mejor = limpios[0]
        segundo = limpios[1] if len(limpios) > 1 else None
        res["atributos_ok"] = mejor["coinciden"]
        min_fis, min_sap = exigencia(mejor["n_coinc"])
        bastante = mejor["cob_fis"] >= min_fis and mejor["cob_sap"] >= min_sap
        # Sólo hay «varios códigos posibles» si el segundo también es un candidato
        # serio. Dos candidatos malos no son una duda: son una falta de coincidencia.
        seg_min_f, seg_min_s = exigencia(segundo["n_coinc"]) if segundo else (9, 9)
        ambiguo = bool(segundo and bastante
                       and segundo["n_coinc"] == mejor["n_coinc"]
                       and segundo["cob_fis"] >= seg_min_f
                       and segundo["cob_sap"] >= seg_min_s
                       and (mejor["score"] - segundo["score"]) < MARGEN_AMBIGUO)
        # Si alguno de los dos declaró una característica y NINGUNA quedó
        # verificada, la correspondencia no está justificada por las
        # características: va a revisión. Sólo puede identificarse por el nombre
        # un material que no declare ninguna característica de ningún lado
        # (un otoscopio, un glucómetro, una llave de 3 vías).
        falta = mejor["n_coinc"] == 0 and (declara_atributos(pf) or mejor["sap_declara"])

        base_just = (f"Candidato {mejor['material']} «{mejor['texto']}». "
                     f"Denominación: {mejor['cob_fis']:.0%} del nombre del inventario "
                     f"explicado por el texto de SAP y {mejor['cob_sap']:.0%} a la inversa.")
        if mejor["coinciden"]:
            base_just += (" Atributos verificados: " + ", ".join(mejor["coinciden"]) + ".")

        if bastante and not ambiguo and not falta:
            res.update(clasificacion=IDENTIFICADO, motivo=None,
                       material=mejor["material"], texto_sap=mejor["texto"],
                       score=mejor["score"],
                       justificacion=base_just + " Sin contradicción en ningún atributo.")
        elif ambiguo:
            res.update(clasificacion=REVISION, motivo=R_AMBIGUO,
                       material=None, texto_sap=None, score=mejor["score"],
                       justificacion=(base_just + f" Pero {segundo['material']} "
                                      f"«{segundo['texto']}» es igual de plausible. "
                                      "Hay que elegir cuál corresponde."))
        elif falta:
            lado = "el inventario físico" if declara_atributos(pf) else "SAP"
            otro = "SAP" if lado == "el inventario físico" else "el inventario físico"
            res.update(clasificacion=REVISION, motivo=R_FALTA_ATRIB,
                       material=None, texto_sap=mejor["texto"], score=mejor["score"],
                       sugerido=mejor["material"],
                       justificacion=(base_just + f" {lado.capitalize()} declara la "
                                      f"presentación y {otro} no, así que la equivalencia "
                                      "no puede confirmarse con la información disponible."))
        else:
            motivo = R_NOM_POBRE if mejor["cob_sap"] < 0.35 else R_PARCIAL
            res.update(clasificacion=REVISION, motivo=motivo,
                       material=None, texto_sap=mejor["texto"], score=mejor["score"],
                       sugerido=mejor["material"],
                       justificacion=(base_just + " La coincidencia de denominación no "
                                      "alcanza para dar la identificación por confirmada."))
        resultados.append(res)
    return resultados


def _ser(v):
    if isinstance(v, set):
        return sorted(str(x) for x in v)
    return v

def _corto(e):
    return {"material": e["material"], "texto": e["texto"], "tipo": e["tipo"],
            "cob_fis": round(e["cob_fis"], 3), "cob_sap": round(e["cob_sap"], 3),
            "conflictos": e["conflictos"], "coinciden": e["coinciden"],
            "presentacion": e["presentacion"], "detalle": e["detalle"]}
