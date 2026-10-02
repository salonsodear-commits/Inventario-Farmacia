# -*- coding: utf-8 -*-
"""Rutas del proyecto. Extrae los PDF/XLSX del ZIP la primera vez."""
import os, zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(RAIZ, "data")
SALIDA = os.path.join(RAIZ, "salida")
ZIP = os.path.join(RAIZ, "RV__Bajadas_Stock_Bases_Op_Complejas_SAP.zip")
HOMOLOGACION = os.path.join(RAIZ, "Homologacion_Farmacia_AVAIN_con_SAP.xlsx")

STOCK_SAP = "Stock Centro SJ NQN y Salta 02.10.xlsx"
PDF = {"San Juan": "Inventario - Base San Juan.pdf",
       "Salta": "Inventario - Base Salta.pdf",
       "Neuquén": "Inventario - Base Neuquén.pdf"}


def preparar():
    """Descomprime el ZIP de bajadas si todavia no se hizo."""
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(SALIDA, exist_ok=True)
    faltan = [n for n in [STOCK_SAP] + list(PDF.values())
              if not os.path.exists(os.path.join(DATA, n))]
    if faltan and os.path.exists(ZIP):
        with zipfile.ZipFile(ZIP) as z:
            z.extractall(DATA)
    return DATA


def dato(nombre):
    preparar()
    return os.path.join(DATA, nombre)


def salida(nombre):
    os.makedirs(SALIDA, exist_ok=True)
    return os.path.join(SALIDA, nombre)
