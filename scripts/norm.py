# -*- coding: utf-8 -*-
"""Normalizacion de nomenclatura para el cruce SAP <-> Avain."""
import re, unicodedata

# Sinonimos / abreviaturas -> forma canonica
SINON = {
    "COMP": "COMPRIMIDO", "COMPS": "COMPRIMIDO", "COMPRIMIDOS": "COMPRIMIDO",
    "CPDO": "COMPRIMIDO", "CP": "COMPRIMIDO", "TAB": "COMPRIMIDO",
    "GRAGEAS": "COMPRIMIDO", "GRAGEA": "COMPRIMIDO",
    "AMP": "AMPOLLA", "AMPS": "AMPOLLA", "AMPOLLAS": "AMPOLLA",
    "FCO": "FRASCO", "FCOAMP": "FRASCOAMPOLLA", "FA": "FRASCOAMPOLLA",
    "JGA": "JERINGA", "JERINGAS": "JERINGA",
    "SOL": "SOLUCION", "SOLUC": "SOLUCION", "SOLN": "SOLUCION",
    "INY": "INYECTABLE", "INYEC": "INYECTABLE", "INYECT": "INYECTABLE",
    "SUSP": "SUSPENSION", "JBE": "JARABE", "JAR": "JARABE",
    "UNG": "UNGUENTO", "POM": "POMADA", "CREM": "CREMA",
    "GTS": "GOTAS", "GOTA": "GOTAS",
    "OFT": "OFTALMICO", "OFTAL": "OFTALMICO", "OFTALMICA": "OFTALMICO",
    "OTICAS": "OTICO", "OTICA": "OTICO",
    "CAPS": "CAPSULA", "CAPSULAS": "CAPSULA", "CAP": "CAPSULA",
    "SOBRE": "SOBRE", "SOBRES": "SOBRE",
    "UD": "UNIDAD", "UDS": "UNIDAD", "UN": "UNIDAD", "U": "UNIDAD",
    "CU": "UNIDAD", "C/U": "UNIDAD",
    "VENDAS": "VENDA", "GUANTE": "GUANTES", "AGUJAS": "AGUJA",
    "APOSITOS": "APOSITO", "ELECTRODO": "ELECTRODOS",
    "TIRA": "TIRAS", "PILA": "PILAS", "SONDAS": "SONDA",
    "ABOCATH": "ABBOCATH", "ABOCCATH": "ABBOCATH", "ABBOCATT": "ABBOCATH",
    "BARBIJOS": "BARBIJO", "JERINGAS": "JERINGA",
    "TBO": "TUBO", "BJA": "BAJALENGUAS", "BAJALENGUA": "BAJALENGUAS",
    "SF": "SOLUCIONFISIOLOGICA", "DX": "DEXTROSA",
    "CLORHID": "CLORHIDRATO", "CLORH": "CLORHIDRATO",
    "SOD": "SODICO", "SODICA": "SODICO",
    "TALLE": "TALLE",
    "N": "NRO", "NO": "NRO", "NRO": "NRO", "Nº": "NRO", "N°": "NRO", "#": "NRO",
    "GRAMO": "G", "GRAMOS": "G", "GR": "G", "GRS": "G",
    "MGR": "MG", "MGRS": "MG", "MILIGRAMOS": "MG", "MILIGRAMO": "MG",
    "MILILITRO": "ML", "MILILITROS": "ML", "CC": "ML",
    "LTS": "L", "LITRO": "L", "LITROS": "L", "LT": "L",
    "MCG": "UG", "UI": "UI",
    "ESTERIL": "ESTERIL", "ESTERILES": "ESTERIL",
    "DESCARTABLE": "DESCARTABLE", "DESCARTABLES": "DESCARTABLE",
    "EXAMINACION": "EXAMEN", "EXAMINACIÓN": "EXAMEN",
    # sinonimos de uso corriente en estas bases
    "REGULABLE": "AJUSTABLE", "SATUROMETRO": "OXIMETRO",
    "OXIMETRIA": "OXIMETRO", "GASAS": "GASA", "TELA": "TELA",
    "TENSIOMETRO": "TENSIOMETRO", "PRECINTO": "PRECINTO",
}
# Palabras sin valor discriminante
STOP = {"DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "CON", "SIN", "PARA",
        "POR", "A", "AL", "EN", "X", "UNIDAD", "C", "S", "TOTAL", "ML?"}
# Unidades reconocidas en expresiones de dosis
UNITS = r"(?:MG|ML|G|L|UG|UI|%|CM|MM|M|G/L|MEQ|VOL|FR|GA|G\b)"


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def basic(s):
    """Mayusculas, sin acentos, sin puntuacion suelta."""
    if s is None:
        return ""
    s = strip_accents(str(s)).upper()
    s = s.replace("Nº", " NRO ").replace("N°", " NRO ").replace("º", " ")
    s = re.sub(r"®|\(R\)|\(TM\)|™", " ", s)
    # par dimensional de aguja/calibre (40/12) -> token unico 40|12
    s = re.sub(r"\b(\d{1,3})\s*/\s*(\d{1,3})\b(?!\s*(?:MG|ML|G|L|UI))", r" \1|\2 ", s)
    s = re.sub(r"[\(\)\[\]\{\};:\"'`/\\_+\|](?<!\|)", " ", s)
    s = re.sub(r"(?<![\d])\|(?![\d])", " ", s)
    s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)       # 1.000 -> 1000
    s = s.replace(",", ".")                           # 0,6 -> 0.6
    s = re.sub(r"[.](?!\d)", " ", s)                  # punto no decimal
    s = re.sub(r"\s*-\s*", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


_U = r"(?:MCG|MEQ|VOL|MG|ML|UG|UI|KG|CM|MM|G|L|%)"


def split_num_unit(s):
    """Normaliza expresiones numero+unidad: '500MG', '500 mg', '0.6 mgcomp'."""
    # pega numero y unidad
    s = re.sub(r"(\d)\s+(" + _U + r")(?![A-Z0-9])", r"\1\2", s)
    # separa unidad pegada a una palabra siguiente: 0.6MGCOMP -> 0.6 MG COMP
    s = re.sub(r"(\d+(?:\.\d+)?)(" + _U + r")(?=[A-Z])", r" \1 \2 ", s)
    # separa numero y unidad en tokens propios
    s = re.sub(r"(\d+(?:\.\d+)?)(" + _U + r")", r" \1 \2 ", s)
    # dimensiones: 10X10 / 10 X 10CM -> tokens separados
    s = re.sub(r"(\d)\s*[X]\s*(\d)", r"\1 X \2", s)
    # unidad pegada a la forma farmaceutica: MGCOMP -> MG COMP
    s = re.sub(r"\b(MG|ML|G|UI|MCG)(COMP\w*|AMP\w*|CAP\w*|GOTAS|JARABE|SOBRE\w*)\b",
               r" \1 \2 ", s)
    return re.sub(r"\s+", " ", s).strip()


# Articulos donde 'G' y 'Nro' expresan calibre (gauge/French), no gramos
CAL_CTX = ("ABBOCATH", "ABOCATH", "CATETER", "AGUJA", "SONDA", "BRANULA",
           "GUIA", "MARIPOSA", "TROCAR", "FRENCH", "CANULA", "TUBO",
           "YELCO", "SCALP", "BUTTERFLY")


def tokens(s):
    """Tokens canonicos significativos, con calibres unificados.

    'Abbocath Nro 14' y 'Cateter intravenoso 14G' comparten el token CAL14,
    de modo que el calibre se compara aunque se escriba de dos formas.
    """
    raw = split_num_unit(basic(s))
    pre = []
    for t in raw.split():
        pre.append(SINON.get(t, t))
    es_cal = any(c in pre for c in CAL_CTX)
    out, i = [], 0
    while i < len(pre):
        t = pre[i]
        nxt = pre[i + 1] if i + 1 < len(pre) else None
        # 'NRO 14' -> CAL14
        if t == "NRO" and nxt and re.fullmatch(r"\d+(?:\.\d+)?", nxt):
            out.append("CAL" + nxt.rstrip("0").rstrip(".") if "." in nxt else "CAL" + nxt)
            i += 2
            continue
        # '14 G' / '14 FR' -> CAL14 solo en articulos de calibre
        if (re.fullmatch(r"\d+(?:\.\d+)?", t) and nxt in ("G", "FR", "FRENCH")
                and (es_cal or nxt in ("FR", "FRENCH"))):
            out.append("CAL" + t)
            i += 2
            continue
        if t in STOP or not t:
            i += 1
            continue
        out.append(t)
        i += 1
    return out


def key(s):
    """Clave normalizada para match exacto (tokens ordenados)."""
    return " ".join(sorted(tokens(s)))


def seq(s):
    """Secuencia normalizada (conserva el orden)."""
    return " ".join(tokens(s))


_UNIT_SET = {"MG", "ML", "G", "L", "UG", "UI", "%", "CM", "MM", "VOL", "MEQ"}


def doses(s):
    """Conjunto de pares (valor, unidad) normalizados a una unidad base.

    Opera sobre los tokens canonicos, de modo que 'GRAMO'/'GR' ya llegan como 'G'
    y 'CC' como 'ML'.
    """
    toks = tokens(s)
    out = set()
    for i, t in enumerate(toks):
        if not re.fullmatch(r"\d+(?:\.\d+)?", t):
            continue
        unit = toks[i + 1] if i + 1 < len(toks) else None
        if unit not in _UNIT_SET:
            continue
        v = float(t)
        if unit == "G":
            # 'G' es ambiguo: gramos o calibre (gauge). Se guardan ambas lecturas
            # y el conflicto se evalua por unidad, de modo que la ambiguedad no
            # genera falsos conflictos.
            out.add((round(v, 4), "G"))
            out.add((round(v * 1000, 4), "MG"))
            continue
        if unit == "L":
            v, unit = v * 1000, "ML"
        elif unit == "UG":
            v, unit = v / 1000.0, "MG"
        out.add((round(v, 4), unit))
    return out


def collapsed(s):
    """Cadena sin espacios: tolera 'ACETIL SALICILICO' vs 'ACETILSALICILICO'."""
    return "".join(t for t in tokens(s))


def plain_numbers(s):
    """Numeros sueltos (calibres, tallas, Nro) sin unidad asociada."""
    s = split_num_unit(basic(s))
    toks = s.split()
    out = set()
    for i, t in enumerate(toks):
        if re.fullmatch(r"\d+\|\d+", t):      # par dimensional 40|12
            out.add(t)
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?", t):
            nxt = toks[i + 1] if i + 1 < len(toks) else ""
            if not re.fullmatch(UNITS, nxt):
                out.add(float(t))
    return out
