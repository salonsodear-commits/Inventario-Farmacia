# -*- coding: utf-8 -*-
"""Carga las fuentes con su procedencia real, sin modificar los archivos originales.

Inventarios físicos — son el universo base del análisis:
    San Juan  · AVAIN   · informe "Stock en Almacén"
    Salta     · AVAIN   · informe "Stock en Almacén"
    Neuquén   · Sistema Nico (informe IHSA de Farmacia)

SAP: bajada de STOCK por centro al 02/10.

ATENCIÓN — alcance de esta fuente: NO es el maestro completo de materiales de
SAP. Son únicamente los materiales que hoy tienen stock. Un material dado de
alta en SAP pero con existencia cero no figura en este archivo.

Consecuencia directa: que un ítem del inventario físico no se encuentre acá NO
prueba que no exista en SAP. Puede existir sin stock. Verificarlo contra el
maestro completo queda FUERA DEL ALCANCE de este trabajo, y es el paso previo
obligatorio antes de proponer cualquier alta.
"""
import json, sys, os, collections
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
import paths, load

FUENTE = {
    "San Juan": {"sistema": "AVAIN", "informe": "Stock en Almacén · BASE SAN JUAN",
                 "centro": "1120", "archivo": "Inventario - Base San Juan.pdf"},
    "Salta":    {"sistema": "AVAIN", "informe": "Stock en Almacén · Almacén Base Salta",
                 "centro": "1130", "archivo": "Inventario - Base Salta.pdf"},
    "Neuquén":  {"sistema": "Sistema Nico", "informe": "Inventario completo de Farmacia · IHSA-REP-2026-834809",
                 "centro": "1060", "archivo": "Inventario - Base Neuquén.pdf"},
}
BASES = ["San Juan", "Neuquén", "Salta"]
HOJA = {"San Juan": "1120 SJ", "Neuquén": "1060 NQN", "Salta": "1130 Salta"}


def inventarios_fisicos():
    """Una entrada por ítem físico, con sus lotes conservados."""
    out = {}
    sj = json.load(open(paths.salida("avain_San_Juan.json"), encoding="utf-8"))
    sa = json.load(open(paths.salida("avain_Salta.json"), encoding="utf-8"))
    nq = json.load(open(paths.salida("avain_Neuquen.json"), encoding="utf-8"))

    for base, d in (("San Juan", sj), ("Salta", sa)):
        porcod = collections.defaultdict(list)
        for l in d["lotes"]:
            porcod[(l["codigo"], l["denominacion"])].append(l)
        items = []
        for it in d["items"]:
            lotes = porcod.get((it["codigo"], it["denominacion"]), [])
            items.append({
                "base": base, "codigo": str(it["codigo"]), "nombre": it["denominacion"],
                "stock": it["stock"], "lotes": [
                    {"lote": l["lote"], "vencimiento": l["vencimiento"], "stock": l["stock"]}
                    for l in lotes],
            })
        out[base] = items

    porcod = collections.defaultdict(list)
    for l in nq["detalle"]:
        porcod[str(l["codigo"])].append(l)
    items = []
    for it in nq["totales"]:
        lotes = porcod.get(str(it["codigo"]), [])
        items.append({
            "base": "Neuquén", "codigo": str(it["codigo"]), "nombre": it["medicamento"],
            "stock": it["stock_actual"], "lotes": [
                {"lote": l["lote"], "vencimiento": l["vencimiento"], "stock": l["saldo_lote"]}
                for l in lotes],
            "control": it.get("control", ""),
        })
    out["Neuquén"] = items
    return out


def materiales_sap():
    """Maestro de materiales de SAP, consolidado por código, con su stock por base.

    Se conservan las filas originales (material/lote/almacén) para trazabilidad.
    """
    sap = load.load_sap()
    mat = {}
    for base in BASES:
        for r in sap[HOJA[base]]:
            m = r["material"]
            d = mat.setdefault(m, {
                "material": m, "texto": r["texto"], "tipo": r["tipo"],
                "grupo": r["grupo"], "um": r["um"], "bases": {}, "filas": [],
            })
            b = d["bases"].setdefault(base, {"stock": 0.0, "valor": 0.0, "filas": 0})
            b["stock"] += r["libre"] or 0
            b["valor"] += r["vlibre"] or 0
            b["filas"] += 1
            d["filas"].append({"base": base, "fila": r["row"], "lote": r.get("lote"),
                               "almacen": r.get("almacen"), "stock": r["libre"],
                               "valor": r["vlibre"]})
    return mat


def homologacion():
    """Candidatos sugeridos por la homologación histórica. Son pistas, no verdades:
    cada candidato se verifica después contra los atributos del material."""
    try:
        return load.load_homologacion()
    except Exception:
        return {}


if __name__ == "__main__":
    fis = inventarios_fisicos()
    sap = materiales_sap()
    print("INVENTARIOS FÍSICOS · el universo base")
    tot = 0
    for b in BASES:
        n = len(fis[b]); tot += n
        u = sum(x["stock"] for x in fis[b])
        lot = sum(len(x["lotes"]) for x in fis[b])
        print(f"   {b:10s} {FUENTE[b]['sistema']:14s} {n:>4} ítems · {u:>9,.0f} unidades · {lot:>4} renglones de lote")
    print(f"   {'TOTAL':10s} {'':14s} {tot:>4} ítems")
    print(f"\nSAP · maestro consolidado: {len(sap)} códigos únicos")
    multi = sum(1 for d in sap.values() if len(d["bases"]) > 1)
    print(f"   presentes en más de una base: {multi}")
    for b in BASES:
        print(f"   con stock en {b:10s}: {sum(1 for d in sap.values() if b in d['bases']):>4}")
