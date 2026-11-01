// Gerador de arquivos sintéticos: reescreve um levantamento real (a "verdade")
// nos formatos que os aparelhos exportam e em variações de estrutura. Cada
// variação devolve os bytes do arquivo e o que se espera ler dele.
import proj4 from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";

/** PRNG determinístico (mulberry32): o teste é reprodutível. */
export function prng(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f3 = (v) => v.toFixed(3);
const br = (s) => s.replace(".", ",");
/** 8738840.077 → "8.738.840,077" */
const brMilhar = (v) => { const [i, d] = v.toFixed(3).split("."); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`; };
const enc = (t) => new TextEncoder().encode(t);

function utf16le(t, bom = true) {
  const out = bom ? [0xff, 0xfe] : [];
  for (const c of t) { const u = c.charCodeAt(0); out.push(u & 0xff, u >> 8); }
  return new Uint8Array(out);
}
function cp1252(t) {
  return new Uint8Array([...t].map((c) => { const u = c.charCodeAt(0); return u < 256 ? u : 63; }));
}

function geo(p, fuso) {
  const [lon, lat] = proj4(utmDef(fuso), GEO_DEF, [p.e, p.n]);
  return { lat, lon };
}
function gms(v, eixo, sep = "simbolos") {
  const neg = v < 0, a = Math.abs(v);
  const d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  const ss = s.toFixed(5);
  const hem = eixo === "lat" ? (neg ? "S" : "N") : (neg ? "W" : "E");
  if (sep === "espacos") return `${neg ? "-" : ""}${d} ${m} ${ss}`;
  if (sep === "dois_pontos") return `${d}:${String(m).padStart(2, "0")}:${ss}${hem}`;
  return `${d}°${String(m).padStart(2, "0")}'${ss.replace(".", ",")}"${hem}`;
}

/**
 * Variações de um levantamento. `pts`: [{num, rotulo, e, n, h, sigmaPos, sigmaH}]
 * na ordem do perímetro; `fuso` do levantamento. Cada variação:
 * { nome, arquivo, bytes, espera: { coords: "exato"|"geo"|"geo_sem_h", nomes, rotulos, sigma, sigmaTolerancia } }
 */
export function variacoes(pts, fuso, semente = 1) {
  const rnd = prng(semente);
  const V = [];
  const add = (nome, arquivo, texto, espera = {}, bytes = null) => V.push({ nome, arquivo, bytes: bytes ?? enc(texto), espera: { coords: "exato", nomes: true, rotulos: true, sigma: true, h: true, ...espera } });
  const linhas = (fn, sep = "\r\n") => pts.map(fn).join(sep) + sep;
  const rot = (p) => p.rotulo ?? "";

  // 1) PNEZD (Carlson/Stonex): ponto, N, E, cota, descrição + σ no fim
  add("pnezd_virgula", "pontos.csv", linhas((p) => `${p.num},${f3(p.n)},${f3(p.e)},${f3(p.h)},${rot(p)},${p.sigmaPos},${p.sigmaH}`));
  // 2) PENZD com ponto e vírgula e decimal vírgula, sem σ (vai pedir σ)
  add("penzd_br_sem_sigma", "pontos.txt", linhas((p) => `${p.num};${br(f3(p.e))};${br(f3(p.n))};${br(f3(p.h))};${rot(p)}`), { sigma: false });
  // 3) Trimble: nome, código, N, E, cota (sem cabeçalho)
  add("trimble", "job.csv", linhas((p) => `${p.num},${rot(p)},${f3(p.n)},${f3(p.e)},${f3(p.h)}`), { sigma: false });
  // 4) Emlid Flow com cabeçalho e RMS
  {
    const cab = "Name,Code,Easting,Northing,Elevation,Description,Longitude,Latitude,Ellipsoidal height,Origin,Easting RMS,Northing RMS,Elevation RMS,Lateral RMS,Antenna height,Antenna height units,Solution status";
    add("emlid_flow", "emlid.csv", cab + "\r\n" + linhas((p) => {
      const g = geo(p, fuso);
      return `${p.num},${rot(p)},${f3(p.e)},${f3(p.n)},${f3(p.h)},,${g.lon.toFixed(9)},${g.lat.toFixed(9)},${f3(p.h)},Global,${p.sigmaPos},${p.sigmaPos},${p.sigmaH},${p.sigmaPos},1.800,m,FIX`;
    }));
  }
  // 5) Emlid Studio corrigido: E/N vazios, só lat/lon
  {
    const cab = "Name,Code,Easting,Northing,Elevation,Description,Longitude,Latitude,Ellipsoidal height,Easting RMS,Northing RMS,Elevation RMS";
    add("emlid_studio_so_latlon", "corrigido.csv", cab + "\n" + linhas((p) => {
      const g = geo(p, fuso);
      return `${p.num},${rot(p)},,,,,${g.lon.toFixed(10)},${g.lat.toFixed(10)},${f3(p.h)},${p.sigmaPos},${p.sigmaPos},${p.sigmaH}`;
    }, "\n"), { coords: "geo" });
  }
  // 6) Tabulação com cabeçalho em português e σ em mm
  add("tab_pt_sigma_mm", "pontos.txt", "Ponto\tCódigo\tEste\tNorte\tCota\tσ Horizontal (mm)\tσ Vertical (mm)\r\n" +
    linhas((p) => `${p.num}\t${rot(p)}\t${br(f3(p.e))}\t${br(f3(p.n))}\t${br(f3(p.h))}\t${br((p.sigmaPos * 1000).toFixed(1))}\t${br((p.sigmaH * 1000).toFixed(1))}`), { sigmaTolerancia: 1e-6 });
  // 7) Colunas alinhadas por espaços, com metadados no topo e rodapé
  add("espacos_metadados", "relatorio.txt",
    "Projeto: Fazenda Teste\r\nData: 01/11/2026\r\nSistema: SIRGAS 2000 / UTM 24S\r\n\r\n" +
    "PONTO        ESTE           NORTE         ALT       HRMS     VRMS\r\n" +
    linhas((p) => `${String(p.num).padEnd(8)} ${f3(p.e).padStart(12)} ${f3(p.n).padStart(14)} ${f3(p.h).padStart(9)} ${String(p.sigmaPos).padStart(8)} ${String(p.sigmaH).padStart(8)}`) +
    `\r\nTotal de pontos: ${pts.length}\r\n`, { rotulos: false });
  // 8) Cabeçalho chinês com X = Norte (convenção chinesa)
  add("chines_xy", "点.csv", "点名,X,Y,H,平面精度,高程精度,编码\n" + linhas((p) => `${p.num},${f3(p.n)},${f3(p.e)},${f3(p.h)},${p.sigmaPos},${p.sigmaH},${rot(p)}`, "\n"));
  // 9) Lat/lon em GMS com letras, colunas em ordem incomum (cabeçalho EN)
  add("gms_letras", "geo.csv", "Point;Latitude;Longitude;Height;HRMS;VRMS\n" + linhas((p) => {
    const g = geo(p, fuso);
    return `${p.num};${gms(g.lat, "lat")};${gms(g.lon, "lon")};${br(f3(p.h))};${br(String(p.sigmaPos))};${br(String(p.sigmaH))}`;
  }, "\n"), { coords: "geo", rotulos: false });
  // 10) Base no meio da lista, cabeçalho repetido (exportação em páginas)
  {
    const meio = Math.floor(pts.length / 2);
    const cab = "Nome,Este,Norte,Cota,SigmaPos,SigmaH";
    const corpo = pts.map((p, i) => {
      const l = `${p.num},${f3(p.e)},${f3(p.n)},${f3(p.h)},${p.sigmaPos},${p.sigmaH}`;
      return i === meio ? `BASE,${f3(p.e + 812.4)},${f3(p.n - 640.2)},${f3(p.h + 3)},0.001,0.002\r\n${cab}\r\n${l}` : l;
    });
    add("base_no_meio_paginas", "pts.csv", `${cab}\r\n${corpo.join("\r\n")}\r\n`, { rotulos: false, base: true });
  }
  // 11) Windows-1252 com rótulos acentuados
  add("cp1252", "pontos.txt", "", {}, cp1252(linhas((p) => `${p.num}${p.rotulo ? p.rotulo.replace(/a/g, "ã") : ""};${br(f3(p.e))};${br(f3(p.n))};${br(f3(p.h))};${br(String(p.sigmaPos))};${br(String(p.sigmaH))}`)));
  V[V.length - 1].espera.rotulos = "acentuado";
  // 12) UTF-16 com BOM (Bloco de Notas antigo)
  add("utf16", "pontos.txt", "", {}, utf16le(linhas((p) => `${p.num}${rot(p)},${f3(p.e)},${f3(p.n)},${f3(p.h)},${p.sigmaPos},${p.sigmaH}`)));
  // 13) Leica GSI-16
  {
    const w = (wi, val, dec = true) => {
      if (!dec) return `${wi}....+${String(val).padStart(16, "0")} `;
      const mm = Math.round(Math.abs(val) * 1000);
      return `${wi}..10${val < 0 ? "-" : "+"}${String(mm).padStart(16, "0")} `;
    };
    add("leica_gsi16", "dados.gsi", linhas((p, i) => `*11${String(i + 1).padStart(4, "0")}+${String(p.num).padStart(16, "0")} ${w(81, p.e)}${w(82, p.n)}${w(83, p.h)}`.trimEnd()), { sigma: false, rotulos: false });
  }
  // 14) KML de pontos (Google Earth: altitude zero)
  add("kml_pontos", "pontos.kml", `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n` +
    pts.map((p) => { const g = geo(p, fuso); return `<Placemark><name>${p.num}</name><Point><coordinates>${g.lon.toFixed(10)},${g.lat.toFixed(10)},0</coordinates></Point></Placemark>`; }).join("\n") +
    "\n</Document></kml>\n", { coords: "geo", sigma: false, h: false, rotulos: false });
  // 15) GPX com waypoints e altitude
  add("gpx", "trilha.gpx", `<?xml version="1.0"?>\n<gpx version="1.1" creator="eTrex">\n` +
    pts.map((p) => { const g = geo(p, fuso); return `<wpt lat="${g.lat.toFixed(10)}" lon="${g.lon.toFixed(10)}"><ele>${f3(p.h)}</ele><name>${p.num}</name></wpt>`; }).join("\n") +
    "\n</gpx>\n", { coords: "geo", sigma: false, rotulos: false });
  // 16) LandXML (CgPoint: norte este cota)
  add("landxml", "obra.xml", `<?xml version="1.0"?>\n<LandXML version="1.2"><CgPoints>\n` +
    pts.map((p) => `<CgPoint name="${p.num}" code="${(p.rotulo ?? "").replace(/"/g, "")}">${f3(p.n)} ${f3(p.e)} ${f3(p.h)}</CgPoint>`).join("\n") + "\n</CgPoints></LandXML>\n", { sigma: false });
  // 17) Trimble JobXML
  add("jobxml", "job.jxl", `<?xml version="1.0"?>\n<JOBFile><FieldBook>\n` +
    pts.map((p) => `<PointRecord ID="${p.num}">\n  <Name>${p.num}</Name>\n  <Code>${p.rotulo ?? ""}</Code>\n  <Grid>\n    <North>${f3(p.n)}</North>\n    <East>${f3(p.e)}</East>\n    <Elevation>${f3(p.h)}</Elevation>\n  </Grid>\n</PointRecord>`).join("\n") +
    "\n</FieldBook></JOBFile>\n", { sigma: false });
  // 18) DXF com POINTs
  add("dxf_points", "desenho.dxf", "0\nSECTION\n2\nENTITIES\n" +
    pts.map((p) => `0\nPOINT\n8\nVERTICES\n10\n${f3(p.e)}\n20\n${f3(p.n)}\n30\n${f3(p.h)}\n0\nTEXT\n8\nNOMES\n10\n${f3(p.e + 0.5)}\n20\n${f3(p.n + 0.5)}\n40\n1.0\n1\n${p.num}`).join("\n") +
    "\n0\nENDSEC\n0\nEOF\n", { sigma: false, rotulos: false });
  // 19) GeoJSON com Points
  add("geojson", "pontos.geojson", JSON.stringify({ type: "FeatureCollection", features: pts.map((p) => { const g = geo(p, fuso); return { type: "Feature", properties: { name: String(p.num) }, geometry: { type: "Point", coordinates: [Number(g.lon.toFixed(10)), Number(g.lat.toFixed(10)), Number(f3(p.h))] } }; }) }, null, 1), { coords: "geo", sigma: false, rotulos: false });
  // 20) Memorial descritivo (texto corrido)
  add("memorial", "memorial.txt",
    "MEMORIAL DESCRITIVO\n\nImóvel: Fazenda Teste. Município: Teste/BA.\n\n" +
    pts.map((p, i) => `${i === 0 ? "Inicia-se a descrição deste perímetro no" : "Deste, segue confrontando com quem de direito, até o"} vértice ${p.num}, de coordenadas N ${brMilhar(p.n)} m e E ${brMilhar(p.e)} m, altitude ${br(f3(p.h))} m;`).join("\n") +
    "\nfechando o perímetro.\n", { sigma: false, rotulos: false });

  // 20b) Células no estilo chave=valor, separadas por barra, com comentário no topo
  add("chave_igual_valor", "export.txt", "### LEVANTAMENTO ###\n" + linhas((p) => `PT=${p.num} | E=${f3(p.e)} | N=${f3(p.n)} | H=${f3(p.h)} | SP=${p.sigmaPos} | SV=${p.sigmaH}`, "\n"), { rotulos: false });

  // 21..) Cabeçalho completo com colunas embaralhadas (o aparelho "do futuro")
  const COLS = [
    ["Ponto", (p) => String(p.num)], ["Este", (p) => f3(p.e)], ["Norte", (p) => f3(p.n)], ["Altitude", (p) => f3(p.h)],
    ["HRMS", (p) => String(p.sigmaPos)], ["VRMS", (p) => String(p.sigmaH)], ["Descrição", (p) => rot(p)],
    ["PDOP", () => (1 + rnd()).toFixed(1)], ["Satélites", () => String(8 + Math.floor(rnd() * 20))], ["Data", () => "2026-10-31"],
  ];
  for (let k = 0; k < 8; k++) {
    const ord = [...COLS].sort(() => rnd() - 0.5);
    const sep = [",", ";", "\t", "|"][k % 4];
    const dec = sep === "," ? "." : (k % 2 ? "," : ".");
    const fmt = (s) => (dec === "," ? s.replace(/^(-?\d+)\.(\d+)$/, "$1,$2") : s);
    add(`embaralhado_${k}`, `futuro_${k}.txt`, ord.map((c) => c[0]).join(sep) + "\n" + linhas((p) => ord.map((c) => fmt(c[1](p))).join(sep), "\n"));
  }
  return V;
}
