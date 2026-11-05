# -*- coding: utf-8 -*-
"""Qué ítems del inventario físico son el mismo producto con otro nombre.

El depósito y SAP no nombran igual, y la correspondencia no es uno a uno en
ninguno de los dos sentidos. El caso de «un ítem físico → varios códigos de
SAP» lo resuelve el cruce. Acá se arma el otro: «varios ítems del depósito →
el mismo material». «Adrenalina amp 1 ml» en San Juan, «ADRENALINA INY» en
Neuquén y «Adrenalina 1 amp=1ml» en Salta son tres nombres de lo mismo.

Por qué no alcanza con «comparten un candidato en SAP»: el candidato lo genera
el parecido del nombre, y por ahí entran cosas como «Ácido acetilsalicílico»,
«Ácido tranexámico» y «N-acetilcisteína», que comparten tokens y no tienen
nada que ver. Sugerirlos como equivalentes invitaría exactamente al error que
todo este trabajo viene evitando.

Así que acá se aplica el mismo criterio que en el resto del análisis: deciden
las CARACTERÍSTICAS. Dos ítems se proponen como equivalentes sólo si
comparten un candidato y además:

  · ninguna característica declarada por los dos está en conflicto, y
  · o bien coinciden en alguna característica verificable, o bien —cuando
    ninguno declara nada— sus denominaciones son casi iguales.

La propuesta sigue siendo una propuesta: la confirma una persona.
"""
import collections
import atributos as A

# Cuánto se tienen que parecer dos nombres cuando no hay ninguna característica
# que comparar. Alto a propósito: sin atributos, el nombre es lo único que hay.
UMBRAL_SIN_ATRIBUTOS = 0.72

# Hay atributos que coinciden en casi todo y por eso no verifican nada: que dos
# medicamentos sean los dos «comprimido» no los hace el mismo producto, porque
# la mitad del vademécum es comprimido. Cuando lo único que coincide es uno de
# éstos, se exige igual el parecido del nombre.
#
# Esto lo trajo un caso concreto: «Ácido acetilsalicílico 100 mg» y
# «N-acetilcisteína 600» coincidían en «forma farmacéutica» y se proponían como
# el mismo producto.
#
# La esterilidad está acá por lo mismo: sirve para DESCARTAR —un apósito estéril
# no es el no estéril— pero no para confirmar, porque casi todo el descartable
# de uso clínico es estéril y que dos cosas lo sean no las hace el mismo
# producto.
DEBILES = {"forma farmacéutica", "población", "esterilidad"}


def _tokens(txt):
    return {t for t in A.base(txt).split() if len(t) > 2}


def _parecido(a, b):
    """Jaccard sobre las palabras de la denominación."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def calcular(casos):
    """Devuelve {caso_id: [{id, por, coinciden, parecido}]} con las
    equivalencias que vale la pena proponer."""
    fisicos = [c for c in casos if c["origen"] == "Inventario físico"]
    perfiles = {c["id"]: A.perfil(c["nombre_fisico"], c.get("tipo")) for c in fisicos}
    porId = {c["id"]: c for c in fisicos}

    # Qué ítems comparten cada candidato compatible.
    por_material = collections.defaultdict(list)
    for c in fisicos:
        vistos = set()
        for cand in c.get("candidatos", []):
            if cand.get("conflictos") or cand["material"] in vistos:
                continue
            vistos.add(cand["material"])
            por_material[cand["material"]].append(c["id"])
        if c.get("material_sap") and c["material_sap"] not in vistos:
            por_material[c["material_sap"]].append(c["id"])

    # Pares que comparten al menos un candidato.
    comparten = collections.defaultdict(set)
    for mat, ids in por_material.items():
        if len(ids) < 2:
            continue
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                comparten[(a, b)].add(mat)

    out = collections.defaultdict(list)
    for (a, b), mats in comparten.items():
        pa, pb = perfiles[a], perfiles[b]
        choca, coincide, _ = A.comparar(pa, pb)
        if choca:
            continue                      # declaran lo mismo con valores distintos
        par = _parecido(porId[a]["nombre_fisico"], porId[b]["nombre_fisico"])
        fuertes = [x for x in coincide if x not in DEBILES]
        if not fuertes and par < UMBRAL_SIN_ATRIBUTOS:
            continue      # nada que verifique de verdad, y nombres que no se parecen
        datos = {"por": sorted(mats), "coinciden": coincide,
                 "fuertes": fuertes, "parecido": round(par, 2)}
        out[a].append(dict(datos, id=b))
        out[b].append(dict(datos, id=a))

    # Primero los más sólidos: más características verificadas, después nombre.
    for k in out:
        out[k].sort(key=lambda x: (-len(x["fuertes"]), -len(x["coinciden"]), -x["parecido"]))
    return dict(out)


def resumen(eq, casos):
    n_items = len(eq)
    n_pares = sum(len(v) for v in eq.values()) // 2
    con_atrib = sum(1 for v in eq.values() for x in v if x["fuertes"]) // 2
    return {"items_con_equivalencias": n_items, "pares": n_pares,
            "pares_con_caracteristicas_verificadas": con_atrib}
