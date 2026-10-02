"""Neuquen (informe IHSA): seccion de detalle por lote + seccion de Conciliacion."""
import re, json
import pdfplumber
import paths
from parse_avain import num

COLS_DET = [("codigo", 35, 95), ("medicamento", 95, 230), ("stock_actual", 230, 300),
            ("lote", 300, 405), ("vencimiento", 405, 475), ("saldo_lote", 475, 530),
            ("control", 530, 900)]
COLS_CON = [("codigo", 35, 90), ("medicamento", 90, 190), ("stock_actual", 190, 235),
            ("suma_saldos_lotes", 235, 293), ("egresos_sin_asignar", 293, 355),
            ("saldo_movimientos", 355, 418), ("dif_stock_mov", 418, 512),
            ("dif_stock_lotes", 512, 583), ("diagnostico", 583, 900)]

HDR = re.compile(r"^(International Health|Farmacia$|Inventario completo|Documento:|Usuario:|"
                 r"Con stock:|Todos los medicamentos|Saldos parciales|C[oó]digo$|\(total\)$|"
                 r"Conciliaci[oó]n|Documento generado|IHSA-REP|Medicamento$|Stock$)", re.I)
# Pie de pagina / encabezados que se parten entre columnas
NOISE = re.compile(r"(Huella de los datos|constituye firma|Confidencial, uso interno|"
                   r"Documento generado|IHSA-REP-|egresos sin vencimiento|"
                   r"Los egresos sin|^\s*\|)", re.I)


def ruido(joined):
    return bool(NOISE.search(joined)) or bool(re.fullmatch(r"[\d\s/|—-]*", joined))


def rows(page, cols, ytol=3.0):
    lines = {}
    for w in page.extract_words():
        lines.setdefault(round(w["top"] / ytol), []).append(w)
    out = []
    for k in sorted(lines):
        ws = sorted(lines[k], key=lambda w: w["x0"])
        cells = {n: [] for n, _, _ in cols}
        for w in ws:
            for n, lo, hi in cols:
                if lo <= w["x0"] < hi:
                    cells[n].append(w["text"]); break
        out.append({n: " ".join(v).strip() for n, v in cells.items()})
    return out


def parse_nqn(path):
    detalle, totales, concil, meta = [], [], [], {}
    with pdfplumber.open(path) as pdf:
        meta["paginas"] = len(pdf.pages)
        first_con = next(i for i, p in enumerate(pdf.pages, 1)
                         if "Conciliación —" in (p.extract_text() or ""))
        meta["pagina_inicio_conciliacion"] = first_con
        m = re.search(r"Con stock:\s*(\d+)\s*medicamentos",
                      pdf.pages[0].extract_text() or "")
        meta["con_stock_declarado"] = int(m.group(1)) if m else None

        for pno, page in enumerate(pdf.pages, 1):
            if pno < first_con:                      # ---- seccion detalle
                for r in rows(page, COLS_DET):
                    joined = " ".join(v for v in r.values() if v).strip()
                    if not joined or HDR.match(joined) or ruido(joined):
                        continue
                    if r["lote"].startswith("TOTAL MEDICAMENTO"):
                        totales.append({"base": "Neuquén", "pagina": pno,
                                        "codigo": r["codigo"],
                                        "medicamento": r["medicamento"],
                                        "stock_actual": num(r["stock_actual"]),
                                        "control": r["control"]})
                    elif r["codigo"] and num(r["saldo_lote"]) is not None:
                        detalle.append({"base": "Neuquén", "pagina": pno,
                                        "codigo": r["codigo"],
                                        "medicamento": r["medicamento"],
                                        "lote": r["lote"],
                                        "vencimiento": r["vencimiento"],
                                        "saldo_lote": num(r["saldo_lote"]),
                                        "control": r["control"]})
                    elif r["medicamento"] and not r["codigo"]:
                        tgt = totales[-1] if (totales and (not detalle or
                              totales[-1]["pagina"] >= detalle[-1]["pagina"])) else None
                        tgt = tgt or (detalle[-1] if detalle else None)
                        if tgt:
                            tgt["medicamento"] = (tgt["medicamento"] + " " +
                                                  r["medicamento"]).strip()
            else:                                    # ---- seccion conciliacion
                for r in rows(page, COLS_CON):
                    joined = " ".join(v for v in r.values() if v).strip()
                    if not joined or HDR.match(joined) or ruido(joined):
                        continue
                    if r["codigo"] and num(r["stock_actual"]) is not None:
                        concil.append({"base": "Neuquén", "pagina": pno,
                                       "codigo": r["codigo"],
                                       "medicamento": r["medicamento"],
                                       "stock_actual": num(r["stock_actual"]),
                                       "suma_saldos_lotes": num(r["suma_saldos_lotes"]),
                                       "egresos_sin_asignar": num(r["egresos_sin_asignar"]),
                                       "saldo_movimientos": num(r["saldo_movimientos"]),
                                       "dif_stock_mov": num(r["dif_stock_mov"]),
                                       "dif_stock_lotes": num(r["dif_stock_lotes"]),
                                       "diagnostico": r["diagnostico"]})
                    elif r["medicamento"] and not r["codigo"] and concil:
                        concil[-1]["medicamento"] = (concil[-1]["medicamento"] + " " +
                                                     r["medicamento"]).strip()
    return detalle, totales, concil, meta


if __name__ == "__main__":
    det, tot, con, meta = parse_nqn(paths.dato(paths.PDF["Neuquén"]))
    print("meta:", meta)
    print(f"detalle(lotes)={len(det)}  TOTAL MEDICAMENTO={len(tot)}  conciliacion={len(con)}")
    print(f"suma stock TOTAL MEDICAMENTO = {sum(r['stock_actual'] for r in tot):,.0f}")
    print(f"suma stock conciliacion      = {sum(r['stock_actual'] for r in con):,.0f}")
    print(f"suma saldos de lote          = {sum(r['saldo_lote'] for r in det):,.0f}")
    print(f"conciliacion con stock > 0   = {sum(1 for r in con if r['stock_actual'] > 0)}")
    print(f"egresos sin asignar > 0      = {sum(1 for r in con if r['egresos_sin_asignar'])}")
    print(f"diferencias != 0             = {sum(1 for r in con if r['dif_stock_mov'] or r['dif_stock_lotes'])}")
    # cruce de las dos secciones
    tmap = {r["codigo"]: r["stock_actual"] for r in tot}
    cmap = {r["codigo"]: r["stock_actual"] for r in con}
    difs = [(k, tmap.get(k), cmap.get(k)) for k in set(tmap) | set(cmap)
            if tmap.get(k) != cmap.get(k)]
    print(f"codigos con stock distinto entre secciones: {len(difs)}")
    for d in difs[:15]:
        print("   ", d)
    json.dump({"meta": meta, "conciliacion": con, "totales": tot, "detalle": det},
              open(paths.salida("avain_Neuquen.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
