# -*- coding: utf-8 -*-
"""Calibracion: reproducir con el scorer los niveles que fijo la homologacion.

Para cada fila del master con candidato SAP, se compara el nombre del master
contra el nombre SAP propuesto y se contrasta el nivel calculado con el nivel
que asigno la revision experta.
"""
import collections, sys
import load, match

hom = load.load_homologacion()
sap = load.load_sap()
nombres = [r["texto"] for rows in sap.values() for r in rows]
sc = match.Scorer(nombres)

conf = collections.Counter()
detalle = collections.defaultdict(list)
for h in hom:
    if not h["sap_cod"] or not h["sap_nom"]:
        continue
    esperado = h["sap_conf"] if h["sap_conf"] in match.RANK else "Sin coincidencia"
    # se evalua contra el primer candidato (el que la homologacion lista primero)
    s, ev = sc.compare(h["nombre_master"], h["sap_nom"][0])
    obtenido = sc.nivel(s, ev)
    conf[(esperado, obtenido)] += 1
    detalle[(esperado, obtenido)].append(
        (h["id"], h["nombre_master"], h["sap_nom"][0], round(s, 3), match.motivo(ev)))

ordenes = ["Alta", "Media", "Baja", "Sin coincidencia"]
print("Filas del master con candidato SAP:", sum(conf.values()))
print()
hdr = "experto / calculado"
print(f"{hdr:<24}" + "".join(f"{o:>18}" for o in ordenes))
for e in ordenes:
    print(f"{e:<24}" + "".join(f"{conf.get((e,o),0):>18}" for o in ordenes))
print()
exact = sum(conf.get((o, o), 0) for o in ordenes)
tot = sum(conf.values())
adj = sum(v for (e, o), v in conf.items() if abs(ordenes.index(e) - ordenes.index(o)) <= 1)
print(f"coincidencia exacta de nivel: {exact}/{tot} = {exact/tot:.1%}")
print(f"dentro de un nivel          : {adj}/{tot} = {adj/tot:.1%}")
print()
# los casos mas graves: experto Alta y el scorer lo descarta
for par in [("Alta", "Sin coincidencia"), ("Alta", "Baja"), ("Sin coincidencia", "Alta")]:
    ej = detalle.get(par, [])
    if ej:
        print(f"--- {par[0]} (experto) -> {par[1]} (calculado): {len(ej)} casos")
        for d in ej[:8]:
            print(f"    {d[0]} | {d[1][:40]:<42} | {d[2][:40]:<42} | {d[3]} | {d[4]}")
        print()
