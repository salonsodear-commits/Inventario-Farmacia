"""Extrae los inventarios fisicos de Avain (PDF) a tablas estructuradas.

Formatos soportados:
  * "Stock en Almacen" (San Juan, Salta): una fila por lote, columnas fijas.
  * Informe IHSA (Neuquen): filas TOTAL MEDICAMENTO + filas de lote.
"""
import re, json
import pdfplumber
import paths

# Columnas de texto, asignadas por borde izquierdo (x0)
COLS_TXT = [
    ("codigo",       40,  110),
    ("denominacion", 110, 366),
    ("descripcion",  366, 543),
    ("lote",         543, 605),
    ("vencimiento",  605, 705),
]
# Columnas numericas alineadas a la derecha, asignadas por borde derecho (x1)
COLS_NUM = [
    ("stock_min", 705, 780),
    ("stock",     780, 900),
]


def num(s):
    """'1.234,50' -> 1234.5 ; devuelve None si no es numero."""
    if s is None:
        return None
    s = s.strip().replace(".", "").replace(",", ".")
    if not s or not re.fullmatch(r"-?\d*\.?\d+", s):
        return None
    return float(s)


def rows_from_page(page, ytol=3.0):
    """Agrupa palabras en filas por coordenada vertical y las reparte en columnas."""
    lines = {}
    for w in page.extract_words():
        lines.setdefault(round(w["top"] / ytol), []).append(w)
    out = []
    for key in sorted(lines):
        ws = sorted(lines[key], key=lambda w: w["x0"])
        cells = {n: [] for n, _, _ in COLS_TXT + COLS_NUM}
        for w in ws:
            placed = False
            for n, lo, hi in COLS_TXT:
                if lo <= w["x0"] < hi:
                    cells[n].append(w["text"]); placed = True; break
            if placed:
                continue
            for n, lo, hi in COLS_NUM:
                if lo <= w["x1"] < hi:
                    cells[n].append(w["text"]); break
        rec = {k: " ".join(v).strip() for k, v in cells.items()}
        rec["_top"] = min(w["top"] for w in ws)
        out.append(rec)
    return out


SKIP_JOINED = re.compile(r"^(Stock en Almac|Almac[eé]n:|Pag\.\d)", re.I)


def parse_almacen(path, base):
    """San Juan / Salta: una fila por lote."""
    lots, control = [], {}
    with pdfplumber.open(path) as pdf:
        control["paginas"] = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, 1):
            for rec in rows_from_page(page):
                joined = " ".join(v for k, v in rec.items()
                                  if k != "_top" and v).strip()
                if not joined:
                    continue
                m = re.search(r"TOTAL:\s*([\d.,]+)", joined)
                if m:
                    control["total_declarado"] = num(m.group(1))
                    continue
                if SKIP_JOINED.match(joined) or rec["codigo"] == "Código":
                    continue
                stock = num(rec["stock"])
                if stock is None:
                    # renglon de continuacion: pertenece a la fila anterior
                    if lots:
                        for f in ("denominacion", "descripcion", "lote"):
                            if rec[f]:
                                lots[-1][f] = (lots[-1][f] + " " + rec[f]).strip()
                    continue
                if not rec["codigo"] and lots:
                    rec["codigo"] = lots[-1]["codigo"]
                    rec["denominacion"] = rec["denominacion"] or lots[-1]["denominacion"]
                lots.append({
                    "base": base, "pagina": pno,
                    "codigo": rec["codigo"], "denominacion": rec["denominacion"],
                    "descripcion": rec["descripcion"], "lote": rec["lote"],
                    "vencimiento": rec["vencimiento"], "stock": stock,
                })
    control["filas_lote"] = len(lots)
    control["suma_stock"] = round(sum(r["stock"] for r in lots), 2)
    return lots, control


def agrupar(lots):
    """Agrega por codigo + denominacion (suma de lotes)."""
    agg = {}
    for r in lots:
        k = (r["codigo"], r["denominacion"])
        d = agg.setdefault(k, {"base": r["base"], "codigo": r["codigo"],
                               "denominacion": r["denominacion"],
                               "stock": 0.0, "lotes": 0})
        d["stock"] += r["stock"]
        d["lotes"] += 1
    return list(agg.values())


if __name__ == "__main__":
    for base in ("San Juan", "Salta"):
        path = paths.dato(paths.PDF[base])
        lots, ctrl = parse_almacen(path, base)
        items = agrupar(lots)
        ok = ctrl.get("total_declarado") == ctrl["filas_lote"]
        print(f"== {base}: paginas={ctrl['paginas']} filas_lote={ctrl['filas_lote']} "
              f"declarado={ctrl.get('total_declarado')} "
              f"{'OK' if ok else 'DIFIERE'} | suma_stock={ctrl['suma_stock']:,.2f} "
              f"| items={len(items)}")
        json.dump({"control": ctrl, "lotes": lots, "items": items},
                  open(paths.salida(f"avain_{base.replace(' ', '_')}.json"), "w",
                       encoding="utf-8"), ensure_ascii=False, indent=1)
