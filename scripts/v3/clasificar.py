# -*- coding: utf-8 -*-
"""Clasifica cada caso y propone un curso de acción.

El universo base son los inventarios físicos. SAP entra como contraparte a
verificar, no como universo.

    A · Identificado en SAP            -> mantener, no dar de alta
    B · Sin correspondencia en SAP     -> candidato a ALTA de material nuevo
    C · SAP sin correspondencia física -> candidato a BAJA en SAP
    D · Requiere revisión              -> no se resuelve automáticamente

Nada de esto ejecuta nada sobre SAP: son propuestas sujetas a revisión y
aprobación.
"""
import collections
import fuentes

A_IDENT   = "A · Identificado en SAP"
B_ALTA    = "B · Candidato a alta"
C_BAJA    = "C · Candidato a baja"
D_REVISAR = "D · Requiere revisión"
E_FUERA   = "E · Fuera del alcance"

ACC_MANTENER = "Mantener identificación"
ACC_ALTA     = "Proponer alta de material nuevo"
ACC_BAJA     = "Proponer baja en SAP"
ACC_REVISAR  = "Revisar y decidir"
ACC_NADA     = "No concluir · fuera del alcance"
ACC_REGISTRAR= "Registrar existencia en SAP en esta base"

# El inventario relevado es de Farmacia. Los materiales que no son medicamentos
# ni descartables nunca iban a aparecer en él, así que su ausencia no prueba
# nada y no puede fundamentar una baja.
TIPOS_FARMACIA = {"ZMED", "ZDES"}
NOMBRE_TIPO = {"ZMED": "Medicamento", "ZDES": "Descartable", "ZUNI": "Indumentaria",
               "ZEQI": "Equipamiento", "ZERS": "Repuesto / seguridad"}

MAP = {
    "Identificado en SAP":        (A_IDENT,   ACC_MANTENER),
    "Sin correspondencia en SAP": (B_ALTA,    ACC_ALTA),
    "Requiere revisión":          (D_REVISAR, ACC_REVISAR),
}

# Qué información hace falta para poder dar de alta un material en SAP
CAMPOS_ALTA = ["Denominación normalizada", "Tipo (medicamento / descartable)",
               "Presentación y unidad de comercialización", "Unidad de medida base",
               "Grupo de artículos", "Precio de última compra"]


def tipo_material(nombre, codigo, tipo_sap=None):
    """Medicamento o descartable. Se usa el tipo de SAP cuando hay identificación;
    si no, el prefijo del código del inventario físico y el vocabulario del nombre."""
    if tipo_sap == "ZMED":
        return "Medicamento"
    if tipo_sap == "ZDES":
        return "Descartable"
    if tipo_sap:
        return NOMBRE_TIPO.get(tipo_sap, "Otro")
    c = str(codigo).upper()
    if c.startswith("MED"):
        return "Medicamento"
    if c.startswith("DESC"):
        return "Descartable"
    import atributos as A
    p = A.perfil(nombre)
    if p["forma"] & {"comprimido", "ampolla", "jarabe", "crema", "gotas", "capsula",
                     "supositorio", "ovulo", "sobre", "aerosol"}:
        return "Medicamento"
    if p["concentracion"]:
        return "Medicamento"
    return "Descartable"


def confianza(res):
    """Qué tan sostenida está una identificación, para saber cuáles conviene repasar."""
    if res["clasificacion"] != "Identificado en SAP":
        return None
    c = res["candidatos"][0]
    n = len(res.get("atributos_ok") or [])
    if n >= 2 and c["cob_fis"] >= 0.85:
        return "Alta"
    if n >= 1 and c["cob_fis"] >= 0.90 and c["cob_sap"] >= 0.55:
        return "Alta"
    if n == 0 and c["cob_fis"] >= 0.98 and c["cob_sap"] >= 0.98:
        return "Alta"
    return "Media"


def clasificar_fisicos(resultados, maestro):
    """Una ficha por ítem físico. Conserva la base y la cantidad física originales."""
    out = []
    for r in resultados:
        clase, accion = MAP[r["clasificacion"]]

        mat = r.get("material")
        d = maestro.get(mat) if mat else None
        # El material puede existir en SAP pero no tener stock en el centro donde
        # se contó. El código no hay que crearlo: lo que falta es la existencia.
        en_base = bool(d and r["base"] in d["bases"])
        stock_base = d["bases"][r["base"]]["stock"] if en_base else 0.0
        if clase == A_IDENT and d and not en_base:
            accion = ACC_REGISTRAR
        tipo = tipo_material(r["nombre"], r["codigo"], d["tipo"] if d else None)
        f = fuentes.FUENTE[r["base"]]
        ficha = {
            "id": f"{f['centro']}-{r['codigo']}",
            "origen": "Inventario físico",
            "base": r["base"], "centro": f["centro"],
            "sistema_origen": f["sistema"], "informe_origen": f["informe"],
            "codigo_fisico": r["codigo"], "nombre_fisico": r["nombre"],
            "cantidad_fisica": r["stock"],
            "lotes": r["lotes"], "n_lotes": len(r["lotes"]),
            "tipo": tipo,
            "clasificacion": clase, "accion": accion,
            "stock_sap_en_base": stock_base if d else None,
            "material_sin_stock_en_base": bool(d and not en_base),
            "stock_sap_otras_bases": (sorted(d["bases"]) if d and not en_base else []),
            "motivo": r.get("motivo"),
            "material_sap": mat,
            "material_sugerido": r.get("sugerido"),
            "texto_sap": r.get("texto_sap"),
            "justificacion": r["justificacion"],
            "atributos_verificados": r.get("atributos_ok") or [],
            "confianza": confianza(r),
            "candidatos": r["candidatos"],
            "presentacion": _presentacion(r["perfil"]),
            "falta_para_alta": CAMPOS_ALTA if clase == B_ALTA else [],
            "estado_revision": "Pendiente",
            "aprobacion": "Sin decidir",
            "observaciones": "",
        }
        out.append(ficha)
    return out


def _presentacion(p):
    """Resumen legible de las características detectadas en el nombre."""
    trozos = []
    for etq, clave in [("concentración", "concentracion"), ("forma", "forma"),
                       ("volumen", "volumen"), ("calibre", "calibre"),
                       ("medidas", "medidas"), ("talle", "talle"),
                       ("modelo", "modelo"), ("longitud", "longitud"),
                       ("población", "poblacion")]:
        v = p.get(clave)
        if v:
            trozos.append(f"{etq}: {', '.join(str(x) for x in sorted(map(str, v)))}")
    return " · ".join(trozos)


def candidatos_baja(fichas, maestro):
    """Materiales de SAP con stock que ningún inventario físico identificó.

    Se evalúa por material y base, porque el ajuste se registra en un centro.
    Un material identificado en otra base no es candidato a baja ahí: se
    distingue la coincidencia de material de la coincidencia de stock.
    """
    ident_por_base = collections.defaultdict(set)
    for f in fichas:
        if f["material_sap"]:
            ident_por_base[f["base"]].add(f["material_sap"])
    sugeridos = collections.defaultdict(set)
    for f in fichas:
        if f["clasificacion"] == D_REVISAR and f.get("material_sugerido"):
            sugeridos[f["base"]].add(f["material_sugerido"])

    out = []
    for m, d in maestro.items():
        nombre_tipo = NOMBRE_TIPO.get(d["tipo"], d["tipo"])
        fuera = d["tipo"] not in TIPOS_FARMACIA
        for base, b in d["bases"].items():
            if m in ident_por_base[base]:
                continue
            en_revision = (m in sugeridos[base]) and not fuera
            en_otra = sorted(bb for bb in ident_por_base if m in ident_por_base[bb])

            if fuera:
                just = (f"Es un material de tipo {nombre_tipo}. El inventario relevado "
                        "es de Farmacia, así que este material nunca iba a figurar en "
                        "él: su ausencia no permite concluir nada y no se propone "
                        "ninguna baja.")
            else:
                just = ("Ningún ítem del inventario físico de esta base se identificó "
                        "con este material.")
                if en_otra:
                    just += (f" Sí está identificado en {', '.join(en_otra)}, así que el "
                             "código está en uso: la baja sería sólo del stock de esta "
                             "base, no del material.")
                else:
                    just += " Tampoco se identificó en las otras bases relevadas."
                if en_revision:
                    just += (" Atención: aparece como posible equivalencia en un caso "
                             "pendiente de revisión. Conviene resolver ese caso antes "
                             "de proponer la baja.")

            f_ = fuentes.FUENTE[base]
            out.append({
                "id": f"SAP-{f_['centro']}-{m}",
                "origen": "Stock SAP",
                "base": base, "centro": f_["centro"],
                "sistema_origen": "SAP",
                "informe_origen": "Bajada de stock por centro al 02/10",
                "codigo_fisico": None, "nombre_fisico": None,
                "cantidad_fisica": 0.0, "lotes": [], "n_lotes": b["filas"],
                "tipo": nombre_tipo,
                "clasificacion": E_FUERA if fuera else C_BAJA,
                "accion": ACC_NADA if fuera else (ACC_REVISAR if en_revision else ACC_BAJA),
                "motivo": (f"No es medicamento ni descartable: {nombre_tipo}" if fuera
                           else ("Citado como posible equivalencia en un caso a revisar"
                                 if en_revision else None)),
                "bloqueado_por_revision": en_revision,
                "material_sap": m, "material_sugerido": None,
                "texto_sap": d["texto"],
                "stock_sap": b["stock"], "valor_sap": b["valor"],
                "grupo_sap": d["grupo"], "um_sap": d["um"], "tipo_sap": d["tipo"],
                "justificacion": just,
                "identificado_en_otras_bases": en_otra,
                "atributos_verificados": [], "confianza": None, "candidatos": [],
                "presentacion": "", "falta_para_alta": [],
                "estado_revision": "Pendiente", "aprobacion": "Sin decidir",
                "observaciones": "",
            })
    return out
