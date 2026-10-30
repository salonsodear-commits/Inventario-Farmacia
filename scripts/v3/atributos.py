# -*- coding: utf-8 -*-
"""Extrae los atributos que identifican un material, para poder exigir que una
coincidencia esté justificada por sus características y no por el parecido del nombre.

Medicamentos: denominación, concentración, forma farmacéutica, volumen, unidad de
comercialización.
Descartables: denominación, calibre, medidas, talle, material, presentación.

La regla de uso es: si dos materiales declaran el mismo atributo con valores
distintos, NO pueden ser el mismo material. Si uno lo declara y el otro no, el
dato falta y el caso va a revisión, nunca a coincidencia automática.
"""
import re, unicodedata

# ---------------------------------------------------------------- normalización
def sin_tildes(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn")

def base(s):
    """Minúsculas, sin tildes, con los separadores unificados."""
    s = sin_tildes(str(s or "")).lower()
    s = s.replace("½", " 1/2").replace("⅝", " 5/8").replace("¼", " 1/4")
    s = re.sub(r"[“”\"'`´]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def _num(x):
    """'5,0' -> 5.0 ; '1.000' -> 1000.0"""
    x = x.strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", x):        # 1.000 separador de miles
        return float(x.replace(".", ""))
    return float(x.replace(",", "."))

# ---------------------------------------------------------------- formas
FORMAS = {
    "comprimido": ["comprimidos", "comprimido", "compr", "comp", "cpdo", "tableta",
                   "tabletas", "grageas", "gragea"],
    "capsula":    ["capsulas", "capsula", "caps"],
    "ampolla":    ["ampollas", "ampolla", "amp", "ampoll"],
    "inyectable": ["inyectable", "inyec", "iny"],
    "crema":      ["crema", "pomada", "ungüento", "unguento", "gel"],
    "solucion":   ["solucion", "sol fisiologica", "sol."],
    "jarabe":     ["jarabe", "jbe"],
    "gotas":      ["gotas", "colirio"],
    "aerosol":    ["aerosol", "inhalador", "inhal", "puff", "spray", "nebulizar"],
    "sobre":      ["sobre", "sobres", "polvo", "sachet"],
    "supositorio":["supositorio", "supositorios"],
    "ovulo":      ["ovulo", "ovulos"],
    "parche":     ["parche", "parches"],
    "frasco":     ["frasco", "fco"],
}
# formas que no pueden ser la misma cosa
INCOMPATIBLES = [
    {"comprimido", "capsula"}, {"comprimido", "ampolla"}, {"comprimido", "crema"},
    {"comprimido", "jarabe"}, {"comprimido", "gotas"}, {"comprimido", "aerosol"},
    {"comprimido", "supositorio"}, {"comprimido", "ovulo"}, {"comprimido", "parche"},
    {"ampolla", "crema"}, {"ampolla", "jarabe"}, {"ampolla", "aerosol"},
    {"ampolla", "comprimido"}, {"ampolla", "supositorio"}, {"ampolla", "sobre"},
    {"crema", "jarabe"}, {"crema", "gotas"}, {"crema", "aerosol"},
    {"crema", "sobre"}, {"jarabe", "aerosol"}, {"gotas", "aerosol"},
    {"sobre", "jarabe"}, {"sobre", "crema"}, {"supositorio", "ovulo"},
]
# ampolla/inyectable y frasco/solucion son envases y formas compatibles entre sí
EQUIV = {"inyectable": "ampolla"}

def formas(txt):
    t = base(txt)
    out = set()
    for canon, variantes in FORMAS.items():
        for v in variantes:
            if re.search(r"(?<![a-z])" + re.escape(v) + r"(?![a-z])", t):
                out.add(EQUIV.get(canon, canon)); break
    return out

def conflicto_forma(a, b):
    if not a or not b:
        return False
    if a & b:
        return False                      # comparten al menos una forma
    for par in INCOMPATIBLES:
        if (par & a) and (par & b) and not (par & a) == (par & b):
            if len(par & (a | b)) == 2:
                return True
    return False

# ---------------------------------------------------------------- concentración
UNID_CONC = {
    "mg": "mg", "mgr": "mg", "miligramos": "mg", "miligramo": "mg",
    "g": "g", "gr": "g", "gramo": "g", "gramos": "g",
    "mcg": "mcg", "ug": "mcg", "µg": "mcg", "microgramos": "mcg",
    "ui": "ui", "u": "ui", "%": "%",
}
A_MG = {"mg": 1.0, "g": 1000.0, "mcg": 0.001}

RX_RATIO = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|mgr|g|gr|mcg|ug|ui)\s*/\s*(\d+(?:[.,]\d+)?)?\s*(ml|l|dosis|hora|h)\b")
RX_CONC  = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|mgr|miligramos?|gramos?|gr|g|mcg|ug|ui)(?![a-z/])")
RX_PCT   = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")

def concentracion(txt):
    """Devuelve un set de concentraciones normalizadas a mg (o '%'/'ui')."""
    t = base(txt)
    out = set()
    for m in RX_RATIO.finditer(t):
        val, u, por, uu = m.group(1), m.group(2), m.group(3), m.group(4)
        u = UNID_CONC.get(u, u)
        if u in A_MG:
            v = _num(val) * A_MG[u]
            out.add(("ratio", round(v, 4), round(_num(por), 4) if por else 1.0, uu))
        else:
            out.add(("ratio", _num(val), _num(por) if por else 1.0, uu))
    t2 = RX_RATIO.sub(" ", t)
    for m in RX_CONC.finditer(t2):
        u = UNID_CONC.get(m.group(2), m.group(2))
        if u in A_MG:
            out.add(("masa", round(_num(m.group(1)) * A_MG[u], 4)))
        elif u == "ui":
            out.add(("ui", _num(m.group(1))))
    for m in RX_PCT.finditer(t2):
        out.add(("pct", _num(m.group(1))))
    return out

def _por_clase(s):
    d = {}
    for x in s:
        d.setdefault(x[0], set()).add(x)
    return d

def conflicto_concentracion(a, b):
    """Conflicto si ambos declaran la misma clase de concentración y no comparten valor."""
    if not a or not b:
        return False
    da, db = _por_clase(a), _por_clase(b)
    for clase in set(da) & set(db):
        if not (da[clase] & db[clase]):
            return True
    return False

# ---------------------------------------------------------------- volumen
RX_VOL = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|cc|lts?|litros?|l)(?![a-z])")
A_ML = {"ml": 1.0, "cc": 1.0, "l": 1000.0, "lt": 1000.0, "lts": 1000.0,
        "litro": 1000.0, "litros": 1000.0}

def volumen(txt):
    t = RX_RATIO.sub(" ", base(txt))      # no confundir 8mg/2ml con un volumen suelto
    return {round(_num(m.group(1)) * A_ML.get(m.group(2), 1.0), 3)
            for m in RX_VOL.finditer(t)}

def conflicto_simple(a, b):
    return bool(a) and bool(b) and not (a & b)

# ---------------------------------------------------------------- calibre y medidas
RX_CAL_N   = re.compile(r"(?:n[º°ºªo]\.?|nro\.?|numero)\s*(\d{1,2})(?![\d])")
RX_CAL_G   = re.compile(r"(\d{2})\s*g(?![a-z])")
RX_PAR     = re.compile(r"(?<![\d/])(\d{2})\s*[/x]\s*(\d{1,2})(?![\d])")   # 40/8 · 25/8 · 16x5
RX_MED     = re.compile(r"(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?")
RX_TALLE   = re.compile(r"talle\s*([a-z]{1,3})(?![a-z])")
RX_TALLE2  = re.compile(r"(?<![a-z])talle\s*(\d{2})(?![\d])")

# Un par "40/8" sólo es calibre en materiales punzantes; en una gasa, "10x10" son medidas.
CTX_CALIBRE = re.compile(r"(aguja|abbocath|abocath|catete?r|branula|jeringa|guia|gu[ií]a|"
                         r"sonda|trocar|mariposa|butterfly|lanceta|macrogotero|microgotero)")

def calibre(txt):
    """En agujas y catéteres, «N° 14» y «14G» nombran el mismo calibre: van a una
    única clase comparable. Fuera de ese contexto, un «N°» es un número de modelo
    y no se mezcla con un gauge."""
    t = base(txt)
    out = set()
    punzante = bool(CTX_CALIBRE.search(t))
    clase_n = "cal" if punzante else "n"
    for m in RX_CAL_N.finditer(t): out.add((clase_n, int(m.group(1))))
    for m in RX_CAL_G.finditer(t): out.add(("cal" if punzante else "g", int(m.group(1))))
    if punzante:
        for m in RX_PAR.finditer(t): out.add(("par", int(m.group(1)), int(m.group(2))))
    return out

def conflicto_calibre(a, b):
    """Conflicto si comparten clase de calibre con valores distintos.
    Un par 40/8 y un calibre 21G describen la misma aguja por vías distintas,
    así que sólo se comparan clases iguales."""
    if not a or not b:
        return False
    da, db = _por_clase(a), _por_clase(b)
    comunes = set(da) & set(db)
    if not comunes:
        return False
    return all(not (da[c] & db[c]) for c in comunes)

def medidas(txt):
    t = base(txt)
    if CTX_CALIBRE.search(t):
        t = RX_PAR.sub(" ", t)            # en un punzante, 40/8 es calibre y no medida
    out = set()
    for m in RX_MED.finditer(t):
        a, b = _num(m.group(1)), _num(m.group(2))
        if a >= 3 or b >= 3:              # descarta "x 2 ml" y multiplicadores chicos
            out.add((min(a, b), max(a, b)))
    return out

def talle(txt):
    t = base(txt)
    out = {m.group(1) for m in RX_TALLE.finditer(t) if m.group(1) in
           ("s", "m", "l", "xl", "xxl", "xs")}
    out |= {m.group(1) for m in RX_TALLE2.finditer(t)}
    return out

# ---------------------------------------------------------------- modelo / medida / población
# Designadores de tamaño propios del rubro: sondas y cánulas K10, K29, K30, T/K-27;
# referencias de catálogo REF 1547. Dos números distintos son dos materiales distintos.
RX_K    = re.compile(r"(?<![a-z0-9])k\s*-?\s*(\d{1,3})(?![\d])")
RX_REF  = re.compile(r"\bref\.?\s*(\d{3,})")
RX_LARGO= re.compile(r"(\d+(?:[.,]\d+)?)\s*(cm|mm)(?![a-z])")

def modelo(txt):
    t = base(txt)
    out = {("k", int(m.group(1))) for m in RX_K.finditer(t)}
    out |= {("ref", int(m.group(1))) for m in RX_REF.finditer(t)}
    return out

def longitud(txt):
    """Medida simple (14 cm), excluyendo las que ya forman un par 10x20 cm."""
    t = base(txt)
    t = RX_MED.sub(" ", t)
    return {round(_num(m.group(1)) * (0.1 if m.group(2) == "mm" else 1.0), 2)
            for m in RX_LARGO.finditer(t)}

POBLACION = {
    "adulto":    ["adulto", "adultos", "adult"],
    "pediatrico":["pediatrico", "pediatrica", "pediatrico", "pediatria", "infantil",
                  "niño", "nino", "ninos", "bebe"],
    "neonatal":  ["neonatal", "neonato", "neo"],
}
def sueltos(txt):
    """Números sin unidad: «CLARITROMICINA 500 COMPRIMIDOS» puede ser 500 mg o un
    envase de 500. No se puede interpretar, así que tampoco se puede dar por
    verificado: su presencia obliga a revisar."""
    t = base(txt)
    t = RX_RATIO.sub(" ", t); t = RX_CONC.sub(" ", t); t = RX_PCT.sub(" ", t)
    t = RX_VOL.sub(" ", t);   t = RX_MED.sub(" ", t); t = RX_PAR.sub(" ", t)
    t = RX_CAL_N.sub(" ", t); t = RX_CAL_G.sub(" ", t)
    t = RX_K.sub(" ", t);     t = RX_REF.sub(" ", t); t = RX_LARGO.sub(" ", t)
    return {int(m) for m in re.findall(r"(?<![a-z0-9/.,])(\d{1,4})(?![\d.,/])", t)
            if 2 <= int(m) <= 5000}

def poblacion(txt):
    t = base(txt)
    out = set()
    for canon, vs in POBLACION.items():
        for v in vs:
            if re.search(r"(?<![a-z])" + re.escape(v) + r"(?![a-z])", t):
                out.add(canon); break
    return out

# ---------------------------------------------------------------- denominación
RUIDO = set("""de del la el los las para por con sin y o a en al x un una uso
esteril estéril descartable descartables comun comunes marca s/m c/ p/ tipo
unidad unidades env envase caja cajas pack blister caja""".split())

def denominacion(txt):
    """Palabras que nombran al material, sin números, formas, ni palabras vacías."""
    t = base(txt)
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^a-z0-9/ ]", " ", t)
    t = t.replace("/", " ")          # "t/abbocath" nombra un abbocath
    palabras = []
    todas_formas = {v for vs in FORMAS.values() for v in vs}
    for w in t.split():
        if w in RUIDO or w in todas_formas: continue
        if re.fullmatch(r"[\d/.,%-]+", w):  continue
        if re.fullmatch(r"\d+(mg|ml|g|gr|mcg|ui|cc|cm|mm)", w): continue
        if len(w) <= 2: continue
        palabras.append(w)
    return palabras

# ---------------------------------------------------------------- perfil completo
def perfil(txt, tipo=None):
    return {
        "texto": (txt or "").strip(),
        "denominacion": denominacion(txt),
        "forma": formas(txt),
        "concentracion": concentracion(txt),
        "volumen": volumen(txt),
        "calibre": calibre(txt),
        "medidas": medidas(txt),
        "talle": talle(txt),
        "modelo": modelo(txt),
        "longitud": longitud(txt),
        "poblacion": poblacion(txt),
        "sueltos": sueltos(txt),
        "tipo": tipo,
    }

CONFLICTOS = [
    ("concentración", "concentracion", conflicto_concentracion),
    ("forma farmacéutica", "forma", conflicto_forma),
    ("volumen / presentación", "volumen", conflicto_simple),
    ("calibre", "calibre", conflicto_calibre),
    ("medidas", "medidas", conflicto_simple),
    ("talle", "talle", conflicto_simple),
    ("modelo / referencia", "modelo", conflicto_calibre),
    ("longitud", "longitud", conflicto_simple),
    ("población", "poblacion", conflicto_simple),
    ("cantidad o dosis sin unidad", "sueltos", conflicto_simple),
]

# Atributos que se comparan por clase: declarar "21G" y "40/8" no es declarar lo
# mismo, así que no puede contarse como una coincidencia verificada.
POR_CLASE = {"concentracion", "calibre", "modelo"}


def comparar(pa, pb):
    """Tri-estado por atributo: en conflicto, coincide, o no comparable.

    «Coincide» exige que los dos lados hayan declarado el MISMO tipo de dato y
    que ese dato sea el mismo. Si uno declara calibre en gauge y el otro en
    milímetros, no hay nada verificado: el atributo queda como no comparable.
    """
    choca, coincide, no_comp = [], [], []
    for nombre, clave, fn in CONFLICTOS:
        va, vb = pa[clave], pb[clave]
        if not va or not vb:
            no_comp.append(nombre); continue
        if clave in POR_CLASE:
            da = {x[0] for x in va}; db = {x[0] for x in vb}
            if not (da & db):
                no_comp.append(nombre); continue
        if fn(va, vb):
            choca.append(nombre)
        else:
            coincide.append(nombre)
    return choca, coincide, no_comp


def conflictos(pa, pb):
    """Lista de atributos en los que los dos perfiles se contradicen."""
    return comparar(pa, pb)[0]


# ---------------------------------------------------------------- descripción
def _n(x):
    """100.0 -> '100' ; 5.5 -> '5,5'"""
    return (f"{x:g}").replace(".", ",")

def _conc(v):
    if v[0] == "masa":
        return f"{_n(v[1]/1000)} g" if v[1] >= 1000 else f"{_n(v[1])} mg"
    if v[0] == "ratio":
        u = f"{_n(v[1])} mg" if isinstance(v[1], float) else str(v[1])
        return f"{u}/{_n(v[2])} {v[3]}"
    if v[0] == "pct":
        return f"{_n(v[1])}%"
    if v[0] == "ui":
        return f"{_n(v[1])} UI"
    return str(v)

def _cal(v):
    if v[0] == "par": return f"{v[1]}/{v[2]}"
    if v[0] == "g":   return f"{v[1]}G"
    if v[0] == "cal": return f"{v[1]}"
    return f"N° {v[1]}"

def _mod(v):
    return f"K{v[1]}" if v[0] == "k" else f"ref. {v[1]}"

ETIQUETAS = [
    ("concentración", "concentracion", _conc),
    ("forma", "forma", lambda v: str(v)),
    ("volumen", "volumen", lambda v: f"{_n(v)} ml"),
    ("calibre", "calibre", _cal),
    ("medidas", "medidas", lambda v: f"{_n(v[0])} × {_n(v[1])}"),
    ("talle", "talle", lambda v: str(v).upper()),
    ("modelo", "modelo", _mod),
    ("longitud", "longitud", lambda v: f"{_n(v)} cm"),
    ("población", "poblacion", lambda v: str(v)),
    ("cantidad sin unidad", "sueltos", lambda v: str(v)),
]

def describir(p):
    """Resumen legible de las características detectadas."""
    trozos = []
    for etiqueta, clave, fmt in ETIQUETAS:
        vals = p.get(clave)
        if not vals:
            continue
        try:
            txt = ", ".join(sorted(fmt(v) for v in vals))
        except Exception:
            txt = ", ".join(sorted(str(v) for v in vals))
        trozos.append(f"{etiqueta} {txt}")
    return " · ".join(trozos)
