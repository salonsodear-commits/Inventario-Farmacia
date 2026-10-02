# -*- coding: utf-8 -*-
"""Clasificacion SAP, alcance del inventario fisico y estados de homologacion."""
import collections, statistics

# Tipo de material SAP -> clasificacion legible
CLASIF = {
    "ZMED": "Medicamentos",
    "ZDES": "Descartables",
    "ZUNI": "Uniformes",
    "ZEQI": "Equipos",
    "ZERS": "Repuestos",
    "ZSER": "Servicios",
}
# Clasificaciones que los inventarios de Farmacia de Avain SI relevan
EN_ALCANCE = {"Medicamentos", "Descartables"}

ACC_BAJA = "Dar de baja en SAP"
ACC_ALTA = "Dar de alta en SAP"
ACC_IGUAL = "Sin diferencia"
ACC_SIN_REC = "Sin recuento físico"
ACC_FUERA = "Fuera del alcance del inventario físico"
ACC_NUEVO = "Alta de material en SAP (sin código)"


def clasificacion(tipo):
    return CLASIF.get(str(tipo or "").strip().upper(), "Sin clasificar")


def alcance(clas):
    return "Dentro del alcance" if clas in EN_ALCANCE else "Fuera del alcance"


def accion(origen, tiene_recuento, dif, clas):
    """Traduce la diferencia en una salida operativa. dif = SAP - fisico."""
    if origen != "Stock SAP":
        return ACC_NUEVO
    if not tiene_recuento:
        return ACC_SIN_REC if alcance(clas) == "Dentro del alcance" else ACC_FUERA
    if dif > 0:
        return ACC_BAJA
    if dif < 0:
        return ACC_ALTA
    return ACC_IGUAL


def estado_homologacion(origen, tiene_recuento, nivel, clas, en_master,
                        hay_aproximacion):
    """Distingue sin homologacion / otra clasificacion / no encontrado / pendiente."""
    if origen != "Stock SAP":
        if en_master:
            return ("Pendiente de validación: el ítem está en el Master pero no "
                    "tiene código SAP confirmado")
        if hay_aproximacion:
            return ("Sin correspondencia confirmada: hay aproximaciones en SAP, "
                    "descartadas por presentación o evidencia débil")
        return ("Sin homologación: no informado en el Master y sin candidato en "
                "el stock SAP de este centro")
    if not tiene_recuento:
        if alcance(clas) != "Dentro del alcance":
            return (f"No aplica: {clas.lower()}, clasificación que el inventario "
                    f"físico de Farmacia no releva")
        return "Sin recuento físico en el inventario de Avain"
    if nivel == "Alta":
        return "Homologado – confianza Alta"
    if nivel in ("Media", "Baja"):
        return f"Homologado – confianza {nivel} – pendiente de validación"
    return "Homologado – nivel sin determinar"


# ---- alertas de valorizacion -------------------------------------------------
VU_FACTOR = 20      # VU sospechoso: mas de 20 veces la mediana de la base
DIF_MIN = 10        # ...y con una diferencia de cantidades relevante
RATIO_MAX = 50      # relacion SAP/fisico que sugiere distinta unidad de medida


def mediana_vu(vus):
    v = [x for x in vus if x and x > 0]
    return statistics.median(v) if v else 0.0


def alerta_valorizacion(vu, cant_sap, cant_fis, dif, med_vu):
    """Marca valorizaciones no confiables, sin modificar el calculo."""
    motivos = []
    if med_vu and vu and vu > VU_FACTOR * med_vu and abs(dif) > DIF_MIN:
        motivos.append(f"VU atípico (${vu:,.2f} contra una mediana de "
                       f"${med_vu:,.2f} en la base)")
    if cant_sap > 0 and cant_fis > 0:
        r = max(cant_sap / cant_fis, cant_fis / cant_sap)
        if r > RATIO_MAX:
            motivos.append(f"relación de cantidades {r:,.0f} a 1 entre SAP y el "
                           f"recuento físico")
    if not motivos:
        return ""
    return ("Valorización a validar: " + "; ".join(motivos) +
            ". Sugiere distinta unidad de medida (SAP por caja o envase y el "
            "recuento por unidad). La diferencia económica de esta fila no debe "
            "tomarse como definitiva.")
