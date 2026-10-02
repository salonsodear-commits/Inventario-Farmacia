# -*- coding: utf-8 -*-
"""Cruce de cada inventario fisico de Avain contra la base de stock de SAP.

Orden de precedencia, de mayor a menor evidencia:
  1. Homologacion (Catalogo comun): Avain -> item del master -> codigo SAP.
     La confianza resultante es la mas debil de los dos tramos.
  2. Nomenclatura: comparacion del nombre Avain contra el texto breve de SAP
     del mismo centro, con control de dosis y de calibre/talle.
  3. Sin coincidencia: se conserva el item y queda sin codigo SAP.
"""
import collections, json, re
import load, match, norm, paths

BASE_SHEET = {"San Juan": "1120 SJ", "Neuquén": "1060 NQN", "Salta": "1130 Salta"}


def indexar_homologacion(hom, base):
    """Indices del Catalogo comun para una base: por codigo y por nombre Avain."""
    por_cod, por_nom = collections.defaultdict(list), collections.defaultdict(list)
    for h in hom:
        b = h["bases"][base]
        if not h["sap_cod"]:
            continue
        for c in b["cod"]:
            por_cod[c.strip().upper()].append(h)
        for n in b["nom"]:
            por_nom[norm.key(n)].append(h)
    return por_cod, por_nom


def cruzar(base, avain_items, sap_rows, hom, scorer):
    sheet = BASE_SHEET[base]
    # catalogo SAP del centro: material -> texto (primera aparicion) y filas
    mat_txt, mat_rows = {}, collections.defaultdict(list)
    for r in sap_rows:
        mat_rows[r["material"]].append(r)
        mat_txt.setdefault(r["material"], r["texto"])
    candidatos = sorted(mat_txt.items())
    por_cod, por_nom = indexar_homologacion(hom, base)
    # materiales SAP informados en el master (para la columna de Master)
    sap_en_master = set()
    for h in hom:
        for c in h["sap_cod"]:
            sap_en_master.add(c.strip())

    res = []
    for it in avain_items:
        rec = {"base": base, "codigo_avain": it["codigo"], "nombre_avain": it["nombre"],
               "cantidad": it["cantidad"], "obs_origen": it["obs"],
               "material": None, "texto_sap": None, "nivel": "Sin coincidencia",
               "metodo": "", "id_master": "", "nombre_master": "",
               "observaciones": [], "candidatos": [], "en_master": False,
               "sap_multiple": [], "score": None, "conflicto_codigo": False,
               "sim_homologacion": None}

        # ---- 1. homologacion
        hits = por_cod.get(str(it["codigo"]).strip().upper(), [])
        via = "código Avain"
        if not hits:
            hits = por_nom.get(norm.key(it["nombre"]), [])
            via = "nombre Avain"

        def parecido(h):
            """Cuanto se parece el nombre del inventario al que registra el master."""
            refs = list(h["bases"][base]["nom"]) + [h["nombre_master"] or ""]
            return max((scorer.compare(it["nombre"], n)[0] for n in refs if n),
                       default=0.0)

        if hits:
            # si el codigo apunta a varias filas del master, ordenar por nombre
            if len(hits) > 1:
                hits = sorted(hits, key=lambda h: -parecido(h))
            h = hits[0]
            # Control de consistencia del codigo: el codigo de la base puede haber
            # quedado desactualizado o reasignado a otro producto. Si el nombre del
            # inventario no se parece al que registra el master, el vinculo por
            # codigo no es confiable.
            sim = parecido(h)
            if via == "código Avain" and sim < 0.45:
                rec["observaciones"].append(
                    f"El código Avain {it['codigo']} figura en la homologación como "
                    f"«{(h['bases'][base]['nom'] or [h['nombre_master']])[0]}» "
                    f"(master {h['id']}), pero en el inventario físico corresponde a "
                    f"«{it['nombre']}». El código no coincide con el producto: no se "
                    f"usó el vínculo de la homologación y se cruzó por nomenclatura. "
                    f"A revisar con los responsables de la base.")
                rec["conflicto_codigo"] = True
                hits = []
            else:
                rec["sim_homologacion"] = round(sim, 3)
        if hits:
            rec["en_master"] = True
            rec["id_master"] = h["id"]
            rec["nombre_master"] = h["nombre_master"] or ""
            conf_base = h["bases"][base]["conf"]
            nivel = match.peor(conf_base, h["sap_conf"])
            if nivel == "Sin coincidencia":
                # el item SI se imputa a un material, asi que no puede rotularse
                # 'Sin coincidencia' (reservado para los que quedan sin codigo):
                # se rotula Baja y se explica de donde viene la debilidad
                nivel = "Baja"
                rec["observaciones"].append(
                    f"La homologación no confirma la equivalencia (confianza base "
                    f"{conf_base or 's/d'} / confianza SAP {h['sap_conf'] or 's/d'}). "
                    f"Se imputó al código SAP del master con nivel Baja para no "
                    f"perder el recuento; requiere validación.")
            if via == "código Avain" and sim < 0.60:
                nivel = match.peor(nivel, "Baja")
                rec["observaciones"].append(
                    f"La denominación del inventario («{it['nombre']}») difiere de la "
                    f"que registra el master para ese código "
                    f"(«{(h['bases'][base]['nom'] or [h['nombre_master']])[0]}»). "
                    f"Nivel degradado a Baja hasta validar la equivalencia.")
            # codigos SAP del master presentes en el stock de ESTE centro
            presentes = [c for c in h["sap_cod"] if c.strip() in mat_rows]
            if presentes:
                rec["material"] = presentes[0].strip()
                rec["texto_sap"] = mat_txt[rec["material"]]
                rec["nivel"] = nivel
                rec["metodo"] = f"Homologación por {via} (master {h['id']})"
                rec["observaciones"].append(
                    f"Homologación: confianza base {conf_base or 's/d'} + "
                    f"confianza SAP {h['sap_conf'] or 's/d'} → {nivel}.")
                # Control de presentacion: la homologacion aporta el vinculo, pero si
                # el material elegido discrepa en dosis, volumen o calibre/talle,
                # ese codigo concreto no puede darse por bueno.
                sc_mat, ev = scorer.compare(it["nombre"], rec["texto_sap"])
                if ev["conflicto_dosis"] or ev["conflicto_numero"]:
                    rec["nivel"] = match.peor(rec["nivel"], "Baja")
                    rec["observaciones"].append(
                        "Aunque la homologación vincula estos registros, la "
                        "presentación no coincide con el material imputado ("
                        + match.motivo(ev) + "). Nivel degradado a Baja: "
                        "verificar si corresponde otro código SAP.")
                elif scorer.nivel(sc_mat, ev) == "Sin coincidencia":
                    rec["nivel"] = match.peor(rec["nivel"], "Baja")
                    rec["observaciones"].append(
                        f"La nomenclatura del material imputado no respalda por sí "
                        f"sola la equivalencia (similitud {sc_mat:.2f}); el vínculo "
                        f"proviene sólo de la homologación. Nivel degradado a Baja.")
                if len(presentes) > 1:
                    rec["sap_multiple"] = [c.strip() for c in presentes]
                    rec["observaciones"].append(
                        "El cruce SAP–Avain identificó " + str(len(presentes)) +
                        " códigos SAP como posibles equivalentes del mismo ítem "
                        "de Avain (" + ", ".join(c.strip() for c in presentes) +
                        "). Se imputó al primero (lógica BUSCARV); requiere "
                        "validación posterior.")
                if len(h["sap_cod"]) > len(presentes):
                    faltan = [c.strip() for c in h["sap_cod"]
                              if c.strip() not in mat_rows]
                    rec["observaciones"].append(
                        "Otros códigos SAP del master no están en el stock de "
                        "este centro: " + ", ".join(faltan) + ".")
            else:
                rec["observaciones"].append(
                    f"Homologado al master {h['id']}, pero sus códigos SAP "
                    f"({', '.join(c.strip() for c in h['sap_cod']) or 's/d'}) no "
                    f"figuran en el stock SAP de este centro.")

        # ---- 2. nomenclatura (si la homologacion no resolvio)
        if not rec["material"]:
            rank = scorer.best(it["nombre"], candidatos, topn=4)
            rec["candidatos"] = [
                {"material": d["material"], "texto": d["texto"],
                 "nivel": d["nivel"], "score": round(d["score"], 3),
                 "motivo": match.motivo(d["ev"])} for d in rank]
            if rank and rank[0]["nivel"] != "Sin coincidencia":
                top = rank[0]
                rec["material"] = top["material"]
                rec["texto_sap"] = top["texto"]
                rec["nivel"] = top["nivel"]
                rec["score"] = round(top["score"], 3)
                rec["metodo"] = "Cruce por nomenclatura SAP"
                rec["observaciones"].append(
                    "Cruce por nomenclatura: " + match.motivo(top["ev"]) + ".")
                # ambiguedad: segundo candidato muy cerca del primero
                cerca = [d for d in rank[1:]
                         if d["score"] >= top["score"] - 0.04
                         and d["nivel"] != "Sin coincidencia"]
                if cerca:
                    rec["sap_multiple"] = [top["material"]] + [d["material"] for d in cerca]
                    rec["observaciones"].append(
                        "El cruce SAP–Avain identificó " +
                        str(1 + len(cerca)) + " códigos SAP como posibles "
                        "equivalentes del mismo ítem de Avain (" +
                        ", ".join(rec["sap_multiple"]) + "). Se imputó al primero "
                        "(lógica BUSCARV); requiere validación posterior.")
            else:
                rec["nivel"] = "Sin coincidencia"
                rec["metodo"] = "Sin coincidencia"
                if rank:
                    rec["observaciones"].append(
                        "Mejor aproximación descartada: " + rank[0]["material"] +
                        " " + rank[0]["texto"] + " (" + match.motivo(rank[0]["ev"]) + ").")
        if rec["material"] and not rec["en_master"]:
            rec["en_master"] = rec["material"] in sap_en_master
        res.append(rec)
    return res


def main():
    sap = load.load_sap()
    inv = load.load_avain()
    hom = load.load_homologacion()
    salida = {}
    for base, sheet in BASE_SHEET.items():
        rows = sap[sheet]
        scorer = match.Scorer([r["texto"] for r in rows])
        res = cruzar(base, inv[base], rows, hom, scorer)
        salida[base] = res
        c = collections.Counter(r["nivel"] for r in res)
        qmatch = sum(r["cantidad"] for r in res if r["material"])
        qtot = sum(r["cantidad"] for r in res)
        print(f"== {base}: {len(res)} ítems Avain")
        for n in match.NIVELES:
            print(f"     {n:<17} {c.get(n,0):>4}")
        print(f"     cantidad física total      {qtot:>12,.0f}")
        print(f"     cantidad con código SAP    {qmatch:>12,.0f} ({qmatch/qtot:.1%})")
        print(f"     ítems con posible duplicidad SAP: "
              f"{sum(1 for r in res if r['sap_multiple'])}")
    json.dump(salida, open(paths.salida("cruce.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n->", paths.salida("cruce.json"))


if __name__ == "__main__":
    main()
