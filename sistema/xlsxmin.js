/* Generador de .xlsx sin dependencias.
   Un .xlsx es un ZIP de XML. Acá se arma el ZIP (entradas sin comprimir, que
   Excel acepta) y las planillas con fórmulas reales, formatos numéricos y de
   fecha, anchos de columna, panel fijo y autofiltro.
   Se escribe a mano a propósito: el sistema tiene que funcionar sin internet y
   sin librerías de terceros. */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- CRC32
  var TABLA = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  var ENC = new TextEncoder();

  // ---------------------------------------------------------------- ZIP
  function zip(archivos) {
    var partes = [], central = [], offset = 0;
    archivos.forEach(function (f) {
      var nombre = ENC.encode(f.nombre);
      var datos = typeof f.datos === "string" ? ENC.encode(f.datos) : f.datos;
      var crc = crc32(datos);
      var lh = new Uint8Array(30 + nombre.length);
      var v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true); v.setUint16(6, 0, true); v.setUint16(8, 0, true);
      v.setUint16(10, 0, true); v.setUint16(12, 0x2100, true);   // hora/fecha fijas
      v.setUint32(14, crc, true);
      v.setUint32(18, datos.length, true); v.setUint32(22, datos.length, true);
      v.setUint16(26, nombre.length, true); v.setUint16(28, 0, true);
      lh.set(nombre, 30);
      partes.push(lh, datos);

      var cd = new Uint8Array(46 + nombre.length);
      var w = new DataView(cd.buffer);
      w.setUint32(0, 0x02014b50, true);
      w.setUint16(4, 20, true); w.setUint16(6, 20, true);
      w.setUint16(8, 0, true); w.setUint16(10, 0, true);
      w.setUint16(12, 0, true); w.setUint16(14, 0x2100, true);
      w.setUint32(16, crc, true);
      w.setUint32(20, datos.length, true); w.setUint32(24, datos.length, true);
      w.setUint16(28, nombre.length, true);
      w.setUint32(42, offset, true);
      cd.set(nombre, 46);
      central.push(cd);
      offset += lh.length + datos.length;
    });
    var tamCentral = central.reduce(function (a, c) { return a + c.length; }, 0);
    var fin = new Uint8Array(22), vf = new DataView(fin.buffer);
    vf.setUint32(0, 0x06054b50, true);
    vf.setUint16(8, central.length, true); vf.setUint16(10, central.length, true);
    vf.setUint32(12, tamCentral, true); vf.setUint32(16, offset, true);
    return new Blob(partes.concat(central, [fin]),
                    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ---------------------------------------------------------------- utilidades
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }
  function col(n) {                       // 1 -> A
    var s = "";
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
    return s;
  }
  function serieFecha(d) {                // Date -> número de serie de Excel
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30);
    return ms / 86400000;
  }

  // ---------------------------------------------------------------- estilos
  // 0 normal · 1 encabezado · 2 entero · 3 importe · 4 fecha · 5 ajustado
  // 6 título · 7 tenue · 8 entero tenue · 9 encabezado de bloque
  var ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
      '<numFmt numFmtId="164" formatCode="#,##0"/>' +
      '<numFmt numFmtId="165" formatCode="&quot;$&quot;\\ #,##0.00"/>' +
      '<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>' +
    '</numFmts>' +
    '<fonts count="5">' +
      '<font><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><color rgb="FF1F4E78"/><name val="Calibri"/></font>' +
      '<font><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FF1F4E78"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/>' +
        '<bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border/>' +
      '<border><left/><right/><top/><bottom style="thin">' +
        '<color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
      '<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0"   fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1">' +
        '<alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
        '<alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0"   fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0"   fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1">' +
        '<alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
      '<xf numFmtId="0"   fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  var EST = { NORMAL: 0, CAB: 1, ENTERO: 2, IMPORTE: 3, FECHA: 4, TEXTO: 5,
              TITULO: 6, TENUE: 7, ENTERO_TENUE: 8, SUBTITULO: 9 };

  // ---------------------------------------------------------------- planilla
  /* hoja = { nombre, filas: [[celda, ...], ...], anchos: [n], congelar: "A2",
              autofiltro: "A1:F100" }
     celda = valor simple | { v, s, f, t }   (f = fórmula, s = estilo, t='d' fecha) */
  function hojaXml(hoja, sst) {
    var filas = hoja.filas || [], out = [], maxc = 0;
    for (var i = 0; i < filas.length; i++) {
      var fila = filas[i] || [], celdas = [];
      for (var j = 0; j < fila.length; j++) {
        var c = fila[j];
        if (c === null || c === undefined || c === "") continue;
        if (typeof c !== "object" || c instanceof Date) c = { v: c };
        // Una celda de texto vacía produce <c t="s"> apuntando a una cadena vacía,
        // y eso es justamente lo que hace que Excel ofrezca reparar el archivo.
        // Si no hay fórmula ni contenido, no se escribe la celda.
        if (!c.f && (c.v === null || c.v === undefined || c.v === "")) continue;
        var ref = col(j + 1) + (i + 1), s = c.s || 0, v = c.v, attr = ' s="' + s + '"';
        if (j + 1 > maxc) maxc = j + 1;
        if (c.f) {                                   // fórmula: Excel la recalcula al abrir
          celdas.push('<c r="' + ref + '"' + attr + '><f>' + esc(c.f) + '</f></c>');
        } else if (v instanceof Date) {
          celdas.push('<c r="' + ref + '"' + attr + '><v>' + serieFecha(v) + '</v></c>');
        } else if (typeof v === "number" && isFinite(v)) {
          celdas.push('<c r="' + ref + '"' + attr + '><v>' + v + '</v></c>');
        } else if (typeof v === "boolean") {
          celdas.push('<c r="' + ref + '"' + attr + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>');
        } else {
          var txt = String(v);
          var idx = sst.mapa[txt];
          if (idx === undefined) { idx = sst.lista.length; sst.lista.push(txt); sst.mapa[txt] = idx; }
          celdas.push('<c r="' + ref + '"' + attr + ' t="s"><v>' + idx + '</v></c>');
        }
      }
      if (celdas.length) out.push('<row r="' + (i + 1) + '">' + celdas.join("") + "</row>");
    }
    var cols = "";
    if (hoja.anchos && hoja.anchos.length) {
      cols = "<cols>" + hoja.anchos.map(function (w, k) {
        return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w +
               '" customWidth="1"/>';
      }).join("") + "</cols>";
    }
    var panes = "";
    if (hoja.congelar) {
      var m = /^([A-Z]+)(\d+)$/.exec(hoja.congelar);
      var x = 0, y = parseInt(m[2], 10) - 1, letras = m[1];
      for (var q = 0; q < letras.length; q++) x = x * 26 + (letras.charCodeAt(q) - 64);
      x -= 1;
      panes = '<pane xSplit="' + x + '" ySplit="' + y + '" topLeftCell="' + hoja.congelar +
              '" activePane="bottomRight" state="frozen"/>';
    }
    var dim = "A1:" + col(Math.max(maxc, 1)) + Math.max(filas.length, 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="' + dim + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' + panes +
      "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultRowHeight="14"/>' + cols +
      "<sheetData>" + out.join("") + "</sheetData>" +
      (hoja.autofiltro ? '<autoFilter ref="' + esc(hoja.autofiltro) + '"/>' : "") +
      "</worksheet>";
  }

  function construir(hojas, props) {
    props = props || {};
    var sst = { lista: [], mapa: {} };
    var cuerpos = hojas.map(function (h) { return hojaXml(h, sst); });

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      hojas.map(function (h, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
               'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>";

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>";

    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" + hojas.map(function (h, i) {
        return '<sheet name="' + esc(h.nombre) + '" sheetId="' + (i + 1) +
               '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + "</sheets>" +
      '<calcPr calcId="0" fullCalcOnLoad="1"/>' +   // Excel recalcula las fórmulas al abrir
      "</workbook>";

    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map(function (h, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join("") +
      '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (hojas.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      "</Relationships>";

    var ss = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      sst.lista.length + '" uniqueCount="' + sst.lista.length + '">' +
      sst.lista.map(function (s) {
        return "<si><t xml:space=\"preserve\">" + esc(s) + "</t></si>";
      }).join("") + "</sst>";

    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>" + esc(props.titulo || "Inventario físico vs SAP") + "</dc:title>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' +
      (props.fecha || new Date().toISOString().slice(0, 19) + "Z") + "</dcterms:created>" +
      "</cp:coreProperties>";

    var archivos = [
      { nombre: "[Content_Types].xml", datos: ct },
      { nombre: "_rels/.rels", datos: rels },
      { nombre: "docProps/core.xml", datos: core },
      { nombre: "xl/workbook.xml", datos: wb },
      { nombre: "xl/_rels/workbook.xml.rels", datos: wbRels },
      { nombre: "xl/styles.xml", datos: ESTILOS },
      { nombre: "xl/sharedStrings.xml", datos: ss },
    ];
    cuerpos.forEach(function (c, i) {
      archivos.push({ nombre: "xl/worksheets/sheet" + (i + 1) + ".xml", datos: c });
    });
    return zip(archivos);
  }

  global.XLSXMin = { construir: construir, EST: EST, col: col };
})(typeof window !== "undefined" ? window : globalThis);
