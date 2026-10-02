# -*- coding: utf-8 -*-
"""Arma la vista unificada de conciliacion: una fila por material / item fisico.

Es la estructura que permite tomar un material y verificar de un solo golpe
cantidad SAP, cantidad fisica, diferencia, valorizacion y estado de homologacion,
con filtros por base, clasificacion, codigo y estado.
"""
import collections, json
import load, match, clasif, paths

BASE_SHEET = {"San Juan": "1120 SJ", "Neuquén": "1060 NQN", "Salta": "1130 Salta"}
CENTRO = {"San Juan": "1120", "Neuquén": "1060", "Salta": "1130"}
# (primera fila de datos SAP, ultima fila de datos SAP) en cada hoja
GEO = {"1120 SJ": (2, 679), "1060 NQN": (2, 2023), "1130 Salta": (2, 485)}

ORIG_SAP = "Stock SAP"
ORIG_FIS = "Inventario físico sin código SAP"


def construir():
    sap = load.load_sap()
    cruce = json.load(open(paths.salida("cruce.json"), encoding="utf-8"))
    filas, meta = [], {}

    for base, sheet in BASE_SHEET.items():
        rows = sap[sheet]
        res = cruce[base]

        # agregados por material
        stock = collections.defaultdict(float)     # cantidad SAP
        valor = collections.defaultdict(float)     # valor libre utilizacion
        txt, tipo, grupo, um = {}, {}, {}, {}
        filas_mat = collections.defaultdict(list)
        for r in rows:
            m = r["material"]
            stock[m] += r["libre"] or 0
            valor[m] += r["vlibre"] or 0
            txt.setdefault(m, r["texto"])
            tipo.setdefault(m, r["tipo"])
            grupo.setdefault(m, r["grupo"])
            um.setdefault(m, r["um"])
            filas_mat[m].append(r["row"])

        # items de Avain imputados a cada material
        por_mat = collections.defaultdict(list)
        sin_codigo = []
        for x in res:
            if x["material"]:
                por_mat[x["material"]].append(x)
            else:
                sin_codigo.append(x)

        # mediana de VU de la base, para las alertas de valorizacion
        med_vu = clasif.mediana_vu([valor[m] / stock[m] for m in stock if stock[m] > 0])
        meta[base] = {"mediana_vu": med_vu, "hoja": sheet,
                      "fila_sap_ini": GEO[sheet][0], "fila_sap_fin": GEO[sheet][1]}

        # ---- una fila por material SAP
        for m in sorted(stock, key=lambda k: (-stock[k], k)):
            recs = por_mat.get(m, [])
            clas = clasif.clasificacion(tipo[m])
            cant_sap = stock[m]
            cant_fis = sum(x["cantidad"] for x in recs)
            dif = cant_sap - cant_fis
            vu = (valor[m] / cant_sap) if cant_sap else 0.0
            nivel = ""
            if recs:
                nivel = recs[0]["nivel"]
                for x in recs[1:]:
                    nivel = match.peor(nivel, x["nivel"])
            obs = []
            dup, dupcods = False, []
            for x in recs:
                obs.extend(x["observaciones"])
                if x["sap_multiple"]:
                    dup, dupcods = True, x["sap_multiple"]
                if x["obs_origen"]:
                    obs.append(x["obs_origen"])
            if len(recs) > 1:
                obs.insert(0, "Varias denominaciones del inventario físico "
                              "corresponden a este material SAP (" +
                           "; ".join(f"{x['codigo_avain']} {x['nombre_avain']}"
                                     for x in recs) +
                           "). Se sumaron las cantidades físicas.")
            if len(filas_mat[m]) > 1:
                obs.append(f"El material ocupa {len(filas_mat[m])} filas en la hoja "
                           f"{sheet} (lote/almacén). La cantidad SAP y la física de "
                           f"esta vista son el total del material.")
            alerta = clasif.alerta_valorizacion(vu, cant_sap, cant_fis, dif, med_vu) \
                if recs else ""
            filas.append({
                "base": base, "centro": CENTRO[base], "hoja": sheet,
                "origen": ORIG_SAP, "clasificacion": clas,
                "tipo": tipo[m], "grupo": grupo[m], "um": um[m],
                "alcance": clasif.alcance(clas),
                "material": m, "texto_sap": txt[m],
                "codigo_avain": "; ".join(x["codigo_avain"] for x in recs),
                "nombre_avain": "; ".join(x["nombre_avain"] for x in recs),
                "cant_sap": cant_sap, "cant_fis": cant_fis, "dif": dif,
                "vu": vu, "tiene_recuento": bool(recs),
                "nivel": nivel,
                "estado": clasif.estado_homologacion(
                    ORIG_SAP, bool(recs), nivel, clas,
                    any(x["en_master"] for x in recs), False),
                "accion": clasif.accion(ORIG_SAP, bool(recs), dif, clas),
                "metodo": "; ".join(sorted({x["metodo"] for x in recs})),
                "duplicidad": dup, "dup_codigos": dupcods,
                "en_master": any(x["en_master"] for x in recs),
                "id_master": "; ".join(sorted({x["id_master"] for x in recs
                                               if x["id_master"]})),
                "alerta": alerta,
                "filas_detalle": filas_mat[m],
                "fila_fisico": None,
                "observaciones": " ".join(obs),
            })

        # ---- una fila por item fisico sin codigo SAP
        for x in sorted(sin_codigo, key=lambda z: z["nombre_avain"].upper()):
            hay_aprox = bool(x.get("candidatos"))
            obs = list(x["observaciones"])
            if x["obs_origen"]:
                obs.append(x["obs_origen"])
            filas.append({
                "base": base, "centro": CENTRO[base], "hoja": sheet,
                "origen": ORIG_FIS, "clasificacion": "Sin clasificar en SAP",
                "tipo": "", "grupo": "", "um": "C/U",
                "alcance": "Dentro del alcance",
                "material": "", "texto_sap": "",
                "codigo_avain": x["codigo_avain"], "nombre_avain": x["nombre_avain"],
                "cant_sap": 0.0, "cant_fis": x["cantidad"], "dif": -x["cantidad"],
                "vu": None, "tiene_recuento": True,
                "nivel": "Sin coincidencia",
                "estado": clasif.estado_homologacion(
                    ORIG_FIS, True, "Sin coincidencia", "Sin clasificar en SAP",
                    x["en_master"], hay_aprox),
                "accion": clasif.ACC_NUEVO,
                "metodo": x["metodo"], "duplicidad": False, "dup_codigos": [],
                "en_master": x["en_master"], "id_master": x["id_master"],
                "alerta": ("Sin valor unitario en SAP: la diferencia económica de "
                           "este ítem no puede calcularse (dato faltante)."),
                "filas_detalle": [], "fila_fisico": None,
                "observaciones": " ".join(obs),
            })
    return filas, meta


if __name__ == "__main__":
    filas, meta = construir()
    print(f"filas de conciliación: {len(filas)}")
    c = collections.Counter(f["accion"] for f in filas)
    for k, v in c.most_common():
        print(f"   {k:<45} {v:>5}")
    print()
    print("por clasificación:",
          dict(collections.Counter(f["clasificacion"] for f in filas)))
    print("con alerta de valorización:",
          sum(1 for f in filas if f["alerta"] and f["origen"] == "Stock SAP"))
    print()
    for base in BASE_SHEET:
        fs = [f for f in filas if f["base"] == base]
        print(f"{base}: filas={len(fs)} "
              f"SAP={sum(f['cant_sap'] for f in fs):,.0f} "
              f"físico={sum(f['cant_fis'] for f in fs):,.0f} "
              f"dif={sum(f['dif'] for f in fs):,.0f} "
              f"econ={sum((f['dif']*f['vu']) for f in fs if f['vu']):,.2f}")
