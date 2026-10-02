# -*- coding: utf-8 -*-
"""Cruce Avain <-> SAP: homologacion primero, luego nomenclatura.

El puntaje combina tres senales y resuelve los desajustes tipicos de
nomenclatura (tokens partidos/pegados, nombres SAP mas verbosos, erratas),
y ademas evalua compatibilidad de dosis y de calibre/talle, que son las que
degradan la confianza aunque el nombre se parezca.
"""
import math, re, difflib, collections
import norm

# formas farmaceuticas / envases: descriptivas, no identifican el producto
_FORMA = {"COMPRIMIDO", "AMPOLLA", "FRASCO", "FRASCOAMPOLLA", "CAPSULA",
          "SOLUCION", "INYECTABLE", "SUSPENSION", "JARABE", "CREMA", "POMADA",
          "UNGUENTO", "GOTAS", "SOBRE", "JERINGA", "TALLE", "NRO", "MG", "ML",
          "G", "L", "UI", "UG", "%", "CM", "MM", "VOL", "MEQ", "ESTERIL",
          "DESCARTABLE", "OFTALMICO", "OTICO", "CAJA", "UNIDAD"}

NIVELES = ["Alta", "Media", "Baja", "Sin coincidencia"]
RANK = {n: i for i, n in enumerate(NIVELES)}


def peor(a, b):
    """Confianza de encadenar dos vinculos (Avain->master->SAP): manda la mas debil."""
    a = a if a in RANK else "Sin coincidencia"
    b = b if b in RANK else "Sin coincidencia"
    return NIVELES[max(RANK[a], RANK[b])]


def build_idf(names):
    df = collections.Counter()
    for n in names:
        for t in set(norm.tokens(n)):
            df[t] += 1
    N = max(len(names), 1)
    return {t: math.log((N + 1) / (c + 0.5)) for t, c in df.items()}, N


def _align(ta, tb, w):
    """Peso alineado entre dos listas de tokens.

    Reconoce igualdad, token partido vs pegado ('ACETIL SALICILICO' <->
    'ACETILSALICILICO') y variantes ortograficas cercanas.
    """
    resta, restb = list(ta), list(tb)
    matched, pares = 0.0, []

    # 1. coincidencias exactas
    for t in list(resta):
        if t in restb:
            matched += w(t)
            pares.append(t)
            resta.remove(t)
            restb.remove(t)

    # 2. un token pegado de un lado equivale a varios consecutivos del otro
    def fusionar(src_seq, src_rest, dst_rest):
        nonlocal matched
        i = 0
        while i < len(src_seq):
            hecho = False
            for j in range(min(i + 3, len(src_seq)), i + 1, -1):
                parts = src_seq[i:j]
                glue = "".join(parts)
                if glue in dst_rest and all(p in src_rest for p in parts):
                    matched += w(glue)
                    pares.append(glue)
                    pares.extend(parts)
                    for p in parts:
                        src_rest.remove(p)
                    dst_rest.remove(glue)
                    i = j
                    hecho = True
                    break
            if not hecho:
                i += 1

    fusionar(list(ta), resta, restb)
    fusionar(list(tb), restb, resta)

    # 3. variantes ortograficas cercanas (plurales, erratas)
    for t in list(resta):
        best, bs = None, 0.0
        for u in restb:
            if min(len(t), len(u)) < 4:
                continue
            r = difflib.SequenceMatcher(None, t, u).ratio()
            if r > bs:
                best, bs = u, r
        if best and bs >= 0.86:
            matched += min(w(t), w(best)) * bs
            pares.append(f"{t}~{best}")
            resta.remove(t)
            restb.remove(best)
    return matched, pares


class Scorer:
    def __init__(self, sap_names):
        self.idf, self.N = build_idf(sap_names)
        self._fallback = math.log((self.N + 1) / 0.5)

    def _w(self, t):
        return self.idf.get(t, self._fallback)

    def compare(self, a, b):
        ta, tb = norm.tokens(a), norm.tokens(b)
        if not ta or not tb:
            return 0.0, {"score": 0.0, "conflicto_dosis": False,
                         "conflicto_numero": False, "dosis_igual": False,
                         "dosis_un_lado": False, "dose_a": [], "dose_b": [],
                         "tokens_comunes": []}
        wa = sum(self._w(t) for t in ta) or 1e-9
        wb = sum(self._w(t) for t in tb) or 1e-9
        mw, pares = _align(ta, tb, self._w)
        wj = mw / (wa + wb - mw) if (wa + wb - mw) > 0 else 0.0
        cov = max(mw / wa, mw / wb)
        ratio = difflib.SequenceMatcher(None, norm.collapsed(a),
                                        norm.collapsed(b)).ratio()
        combined = 0.30 * wj + 0.45 * cov + 0.25 * ratio

        da, db = norm.doses(a), norm.doses(b)
        ua = collections.defaultdict(set); ub = collections.defaultdict(set)
        for v, u in da: ua[u].add(v)
        for v, u in db: ub[u].add(v)
        shared = set(ua) & set(ub)
        # basta que UNA unidad compartida discrepe para que haya incompatibilidad:
        # 'agua oxigenada 10 vol x 500 ml' y '10 vol x 100 ml' comparten la
        # concentracion pero no el envase, y no son el mismo item.
        en_conflicto = {u for u in shared if not (ua[u] & ub[u])}
        conflict_dose = bool(en_conflicto)
        dose_equal = bool(shared) and not en_conflicto
        one_sided = bool(da) != bool(db)

        na, nb = norm.plain_numbers(a), norm.plain_numbers(b)
        conflict_num = bool(na) and bool(nb) and not (na & nb)

        # el token mas discriminante del lado Avain (principio activo / articulo)
        # debe haber quedado alineado; si no, el parecido es accesorio
        cand = [t for t in ta if not re.fullmatch(r"[\d.]+", t) and t not in _FORMA
                and (len(t) >= 5 or t.startswith("CAL"))]
        principal = max(cand, key=self._w) if cand else None
        alineados = set()
        for x in pares:
            alineados.add(x.split("~")[0]); alineados.add(x.split("~")[-1])
        principal_ok = principal is None or principal in alineados

        ev = {"principal": principal, "principal_ok": principal_ok,
              "wj": round(wj, 3), "cov": round(cov, 3), "ratio": round(ratio, 3),
              "score": round(combined, 3), "dose_a": sorted(da), "dose_b": sorted(db),
              "conflicto_dosis": conflict_dose, "dosis_igual": dose_equal,
              "dosis_un_lado": one_sided, "conflicto_numero": conflict_num,
              "tokens_comunes": pares}
        return combined, ev

    def nivel(self, score, ev):
        cd, cn = ev["conflicto_dosis"], ev["conflicto_numero"]
        dur = cd or cn                      # incompatibilidad comprobada
        if not ev.get("principal_ok", True):
            # el termino principal del item Avain no aparece en SAP
            return "Baja" if score >= 0.60 else "Sin coincidencia"
        if dur:
            return "Baja" if score >= 0.50 else "Sin coincidencia"
        if score >= 0.86:
            return "Alta"
        if score >= 0.74 and ev["dosis_igual"]:
            return "Alta"
        if score >= 0.74 and not ev["dose_a"] and not ev["dose_b"]:
            return "Alta"
        if score >= 0.56:
            return "Media"
        if score >= 0.44:
            return "Baja"
        return "Sin coincidencia"

    def best(self, a, candidatos, topn=5):
        out = []
        for mat, txt in candidatos:
            sc, ev = self.compare(a, txt)
            out.append({"material": mat, "texto": txt, "score": sc, "ev": ev})
        out.sort(key=lambda d: -d["score"])
        for d in out:
            d["nivel"] = self.nivel(d["score"], d["ev"])
        return out[:topn]


def motivo(ev):
    p = []
    if ev.get("dosis_igual"):
        p.append("dosis coincide")
    if ev.get("conflicto_dosis"):
        p.append(f"dosis/presentación distinta ({_f(ev['dose_a'])} vs {_f(ev['dose_b'])})")
    if ev.get("conflicto_numero"):
        p.append("calibre/talle/medida distinta")
    if ev.get("dosis_un_lado") and not ev.get("conflicto_dosis"):
        p.append("una nomenclatura no informa dosis")
    p.append(f"similitud {ev.get('score', 0):.2f}")
    return "; ".join(p)


def _f(ds):
    return ", ".join(f"{v:g}{u}" for v, u in ds if u != "G") or "s/d"
