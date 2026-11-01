// Formatos empacotados e relatórios: planilha Excel/LibreOffice, KMZ, PDF com
// texto, RTKLIB .pos e relatório IBGE-PPP. Os arquivos são montados aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import proj4 from "proj4";
import { abrirArquivo } from "../supabase/functions/_shared/leitor/arquivo.ts";
import { abrir } from "../supabase/functions/_shared/leitor/abertura.ts";
import { lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";

const op = { proj4 };
const verdade = lerLinhas(abrir(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url))).linhas, op).anel;
const textoDoPdf = async (b) => { const { text } = await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true }); return text; };
const conferir = (l, n = verdade.length, tol = 0) => {
  assert.ok(l, "leu");
  assert.equal(l.anel.length, n);
  for (const p of l.anel) {
    const v = verdade.find((x) => x.num === p.num) ?? verdade.find((x) => Math.hypot(x.e - p.e, x.n - p.n) <= Math.max(tol, 1e-6));
    assert.ok(v, `ponto ${p.nome}`);
    assert.ok(Math.abs(p.e - v.e) <= tol && Math.abs(p.n - v.n) <= tol, `ponto ${p.nome}: ${p.e},${p.n} ≠ ${v.e},${v.n}`);
  }
};

test("planilha Excel (.xlsx): 1ª aba com cabeçalho; números do Excel com ruído binário saem limpos", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml", "<workbook/>");
  const titulos = ["Ponto", "Este", "Norte", "Cota", "HRMS", "VRMS"];
  zip.file("xl/sharedStrings.xml", `<sst>${titulos.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`);
  const col = (j) => String.fromCharCode(65 + j);
  const linhas = [`<row r="1">${titulos.map((_, j) => `<c r="${col(j)}1" t="s"><v>${j}</v></c>`).join("")}</row>`,
    ...verdade.map((p, i) => {
      // o Excel guarda 8738840.077 como 8738840.0769999996
      const ruido = (v) => (v + 1e-10).toPrecision(17);
      return `<row r="${i + 2}">${[p.num, ruido(p.e), ruido(p.n), p.h, p.sigmaPos, p.sigmaH].map((v, j) => `<c r="${col(j)}${i + 2}"><v>${v}</v></c>`).join("")}</row>`;
    })];
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${linhas.join("")}</sheetData></worksheet>`);
  const a = await abrirArquivo(await zip.generateAsync({ type: "uint8array" }), "pontos.xlsx");
  assert.equal(a.tipo, "planilha");
  const l = lerLinhas(a.linhas, op);
  conferir(l);
  assert.equal(l.confianca, "alta");
  assert.ok(l.ok);
});

test("planilha LibreOffice (.ods): valores com decimal vírgula na tela e ponto no XML", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet");
  const cel = (v) => typeof v === "number" ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${String(v).replace(".", ",")}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
  const rows = [["Nome", "E", "N", "H", "σ Horizontal", "σ Vertical"], ...verdade.map((p) => [String(p.num), p.e, p.n, p.h, p.sigmaPos, p.sigmaH])];
  zip.file("content.xml", `<office:document-content><office:body><office:spreadsheet><table:table table:name="Pontos">${rows.map((r) => `<table:table-row>${r.map(cel).join("")}<table:table-cell table:number-columns-repeated="1000"/></table:table-row>`).join("")}<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`);
  const a = await abrirArquivo(await zip.generateAsync({ type: "uint8array" }), "pontos.ods");
  assert.equal(a.tipo, "planilha");
  assert.equal(a.linhas.length, verdade.length + 1, "linhas vazias repetidas do fim não viram 1 milhão de linhas");
  conferir(lerLinhas(a.linhas, op));
});

test("KMZ: o KML de dentro é lido", async () => {
  const zip = new JSZip();
  const g = (p) => proj4(utmDef(24), GEO_DEF, [p.e, p.n]);
  zip.file("doc.kml", `<?xml version="1.0"?><kml><Document>${verdade.map((p) => { const [lon, lat] = g(p); return `<Placemark><name>${p.num}</name><Point><coordinates>${lon.toFixed(10)},${lat.toFixed(10)},${p.h}</coordinates></Point></Placemark>`; }).join("\n")}</Document></kml>`);
  const a = await abrirArquivo(await zip.generateAsync({ type: "uint8array" }), "area.kmz");
  assert.equal(a.tipo, "kmz");
  conferir(lerLinhas(a.linhas, op), verdade.length, 0.002);
});

test("PDF com texto (memorial): coordenadas extraídas com a linha de origem; PDF sem texto é recusado com orientação", async () => {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  let pagina = doc.addPage([595, 842]), y = 800;
  const br = (v) => { const [i, d] = v.toFixed(3).split("."); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`; };
  for (const p of verdade.slice(0, 12)) {
    if (y < 60) { pagina = doc.addPage([595, 842]); y = 800; }
    pagina.drawText(`Vertice ${p.num}, de coordenadas N ${br(p.n)} m e E ${br(p.e)} m, altitude ${p.h.toFixed(3).replace(".", ",")} m;`, { x: 30, y, size: 9, font: fonte });
    y -= 16;
  }
  const a = await abrirArquivo(await doc.save(), "memorial.pdf", { textoDoPdf });
  assert.equal(a.tipo, "pdf");
  const l = lerLinhas(a.linhas, op);
  assert.ok(l);
  assert.equal(l.receita.registro, "texto_livre");
  assert.notEqual(l.confianca, "alta", "texto corrido sempre pede conferência");
  assert.equal(l.anel.length, 12);
  for (const p of l.anel) { const v = verdade.find((x) => x.num === p.num); assert.equal(p.e, v.e); assert.equal(p.n, v.n); }
  const vazio = await PDFDocument.create(); vazio.addPage();
  const b = await abrirArquivo(await vazio.save(), "scan.pdf", { textoDoPdf });
  assert.equal(b.tipo, "binario");
  assert.match(b.binario.orientacao, /imagem/);
});

test("RTKLIB .pos: metadados com %, data e hora em duas colunas, sdn/sde/sdu", () => {
  const g = (p) => proj4(utmDef(24), GEO_DEF, [p.e, p.n]);
  const pos = [
    "% program   : RTKLIB ver.2.4.3",
    "% ref pos   :  -11.400000000  -39.080000000   300.0000",
    "%",
    "%  GPST          latitude(deg) longitude(deg)  height(m)   Q  ns   sdn(m)   sde(m)   sdu(m)  sdne(m)  sdeu(m)  sdun(m) age(s)  ratio",
    ...verdade.slice(0, 20).map((p, i) => { const [lon, lat] = g(p); return `2026/10/31 12:${String(i).padStart(2, "0")}:00.000  ${lat.toFixed(9)}  ${lon.toFixed(9)}  ${p.h.toFixed(4)}   1   12   ${p.sigmaPos.toFixed(4)}   ${p.sigmaPos.toFixed(4)}   ${p.sigmaH.toFixed(4)}   0.0010   0.0010  -0.0010   1.00  999.9`; }),
  ];
  const l = lerLinhas(pos, op);
  assert.ok(l);
  assert.equal(l.receita.campos.lat, 2);
  assert.equal(l.receita.campos.sigma_h, 9);
  assert.equal(l.anel.length, 20);
  for (const [i, p] of l.anel.entries()) {
    assert.ok(Math.abs(p.e - verdade[i].e) < 0.002 && Math.abs(p.n - verdade[i].n) < 0.002);
    assert.equal(p.sigmaH, Number(verdade[i].sigmaH.toFixed(4)));
  }
});

test("relatório IBGE-PPP (chave → valor): UTM, GMS com espaços e σ a 95% com aviso", () => {
  const g = (p) => proj4(utmDef(24), GEO_DEF, [p.e, p.n]);
  const gms = (v) => { const s = v < 0 ? "-" : ""; const a = Math.abs(v); const d = Math.floor(a), m = Math.floor((a - d) * 60); return `${s}${d} ${String(m).padStart(2, "0")} ${(((a - d) * 60 - m) * 60).toFixed(4)}`; };
  const blocos = verdade.slice(0, 5).flatMap((p) => {
    const [lon, lat] = g(p);
    return [`ESTACAO: M${p.num}`, `LAT: ${gms(lat)}`, `LON: ${gms(lon)}`, `HGEO: ${p.h.toFixed(3)}`, `SLAT: 0.012`, `SLON: 0.010`, `SHGEO: 0.025`, `UTMN: ${p.n.toFixed(3)}`, `UTME: ${p.e.toFixed(3)}`, `MC: -39`, ""];
  });
  const l = lerLinhas(["RELATORIO DO PROCESSAMENTO PPP", "", ...blocos], op);
  assert.ok(l);
  assert.equal(l.receita.registro, "chave_valor");
  assert.equal(l.anel.length, 5);
  assert.equal(l.anel[0].nome, `M${verdade[0].num}`);
  assert.equal(l.anel[0].e, verdade[0].e);
  assert.equal(l.anel[0].sigmaPos, 0.012);
  assert.ok(l.aConfirmar.includes("sigma_95"));
  assert.ok(!l.avisos.some((a) => a.codigo === "V5_utm_geo" && a.nivel === "bloqueio"), "UTM e GMS do relatório batem");
});
