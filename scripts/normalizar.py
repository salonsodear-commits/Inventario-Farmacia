# -*- coding: utf-8 -*-
"""Normaliza el .xlsx final reescribiendolo con LibreOffice.

openpyxl produce un paquete valido segun el esquema, pero con construcciones que
Excel considera defectuosas y que lo llevan a "reparar" el libro, descartando
contenido en el proceso. LibreOffice reescribe el archivo con la forma que Excel
espera (tabla de cadenas compartidas, estilos y valores en cache incluidos), de
modo que el archivo entregado abre sin reparacion.

Verifica ademas que la normalizacion no haya alterado los datos.
"""
import os, shutil, subprocess, sys, tempfile
import openpyxl
import paths

SOFFICE = "soffice"
CLAVE = {                       # hoja -> (fila, columna, valor esperado)
    "1120 SJ":    (2, 1, "2001555"),
    "1060 NQN":   (2, 1, "2000158"),
    "1130 Salta": (2, 1, "1000124"),
}


def _cifras(path):
    """Datos de control del libro, para comparar antes y despues."""
    wb = openpyxl.load_workbook(path, data_only=False)
    out = {"hojas": list(wb.sheetnames), "celdas": {}, "filas": {}, "sumas": {}}
    for sheet, (r0, r1) in [("1120 SJ", (2, 679)), ("1060 NQN", (2, 2023)),
                            ("1130 Salta", (2, 485))]:
        ws = wb[sheet]
        mats = [ws.cell(r, 1).value for r in range(r0, r1 + 1)]
        out["filas"][sheet] = sum(1 for m in mats if m not in (None, ""))
        out["sumas"][sheet] = sum(ws.cell(r, 9).value or 0 for r in range(r0, r1 + 1)
                                  if isinstance(ws.cell(r, 9).value, (int, float)))
        out["celdas"][sheet] = [ws.cell(2, 1).value, ws.cell(3, 1).value,
                                ws.cell(3, 2).value, ws.cell(2, 18).value,
                                ws.cell(2, 19).value]
    wb.close()
    return out


def normalizar(path, verbose=True):
    antes = _cifras(path)
    tmp = tempfile.mkdtemp(prefix="norm_")
    perfil = os.path.join(tmp, "perfil")
    # La entrada y la salida deben estar en carpetas DISTINTAS: si coinciden,
    # LibreOffice no convierte nada y se reescribiria el original sin cambios.
    dir_in = os.path.join(tmp, "in")
    dir_out = os.path.join(tmp, "out")
    os.makedirs(dir_in); os.makedirs(dir_out)
    entrada = os.path.join(dir_in, "libro.xlsx")
    salida = os.path.join(dir_out, "libro.xlsx")
    shutil.copy(path, entrada)
    env = dict(os.environ, HOME=tmp)
    r = subprocess.run(
        [SOFFICE, f"-env:UserInstallation=file://{perfil}", "--headless",
         "--norestore", "--convert-to", "xlsx", "--outdir", dir_out, entrada],
        capture_output=True, text=True, env=env, timeout=900)
    if not os.path.exists(salida) or os.path.getsize(salida) < 10000:
        raise RuntimeError("LibreOffice no produjo el archivo normalizado:\n"
                           + r.stdout + r.stderr)
    # control de que la reescritura ocurrio de verdad: el paquete normalizado
    # lleva tabla de cadenas compartidas, que el de openpyxl no tiene
    import zipfile
    partes = zipfile.ZipFile(salida).namelist()
    if not any("sharedStrings" in n for n in partes):
        raise RuntimeError("El archivo no se normalizó: LibreOffice devolvió el "
                           "mismo paquete de entrada.")
    despues = _cifras(salida)

    problemas = []
    if antes["hojas"] != despues["hojas"]:
        problemas.append(f"cambiaron las hojas: {despues['hojas']}")
    for sheet in antes["filas"]:
        if antes["filas"][sheet] != despues["filas"][sheet]:
            problemas.append(f"{sheet}: filas {antes['filas'][sheet]} -> "
                             f"{despues['filas'][sheet]}")
        if abs(antes["sumas"][sheet] - despues["sumas"][sheet]) > 1e-6:
            problemas.append(f"{sheet}: Libre utilización {antes['sumas'][sheet]} "
                             f"-> {despues['sumas'][sheet]}")
        if antes["celdas"][sheet] != despues["celdas"][sheet]:
            problemas.append(f"{sheet}: celdas de control {antes['celdas'][sheet]} "
                             f"-> {despues['celdas'][sheet]}")
        esperado = CLAVE[sheet]
        wb = openpyxl.load_workbook(salida)
        real = wb[sheet].cell(esperado[0], esperado[1]).value
        wb.close()
        if str(real) != esperado[2]:
            problemas.append(f"{sheet}: celda clave A2 = {real!r}, "
                             f"se esperaba {esperado[2]!r}")
    if problemas:
        raise RuntimeError("La normalización alteró el libro:\n  - "
                           + "\n  - ".join(problemas))

    shutil.move(salida, path)
    shutil.rmtree(tmp, ignore_errors=True)
    if verbose:
        for sheet in antes["filas"]:
            print(f"    {sheet}: {antes['filas'][sheet]} filas · "
                  f"Libre utilización {antes['sumas'][sheet]:,.0f} · sin cambios")
    return True


if __name__ == "__main__":
    destino = (sys.argv[1] if len(sys.argv) > 1 else
               os.path.join(paths.RAIZ,
                            "Stock SAP vs Inventario Fisico Avain - cruce.xlsx"))
    normalizar(destino)
    print("normalizado:", destino)
