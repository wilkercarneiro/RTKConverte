// Sondagem do WFS do INCRA: descobre endpoint vivo, lista as camadas de parcelas
// certificadas e testa GetFeature com filtro BBOX (o que falta na API oficial).
//
// Uso:
//   node scripts/probe_wfs_incra.mjs
//   node scripts/probe_wfs_incra.mjs -55.5 -12.0 -55.4 -11.9    # minLon minLat maxLon maxLat
//
// Não escreve nada: só imprime o diagnóstico.

const ENDPOINTS = [
  "https://geoservicos.incra.gov.br/geoserver/ows",
  "https://acervofundiario.incra.gov.br/geoserver/ows",
  "https://certificacao.incra.gov.br/geoserver/ows",
  "https://acervofundiario.incra.gov.br/i3geo/ogc.php",
];

// Camadas de interesse: parcelas certificadas / imóveis do acervo.
const RE_CAMADA = /sigef|certific|parcela|imovel|im[oó]vel/i;

const TIMEOUT_MS = 30000;

const bboxArgs = process.argv.slice(2).map(Number);
const BBOX = bboxArgs.length === 4 && bboxArgs.every(Number.isFinite)
  ? bboxArgs
  : [-55.5, -12.0, -55.4, -11.9]; // caixa pequena em MT, só para amostrar

async function get(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: accept ?? "*/*", "User-Agent": "RTKConverte/probe" },
    });
    const texto = await r.text();
    return { ok: r.ok, status: r.status, tipo: r.headers.get("content-type") ?? "", texto };
  } catch (e) {
    return { ok: false, status: 0, tipo: "", texto: "", erro: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

// GetCapabilities do GeoServer traz <FeatureType><Name>ws:camada</Name>. Regex basta
// para sondagem — não vale trazer parser de XML para cá.
function extrairCamadas(xml) {
  const nomes = new Set();
  const re = /<(?:\w+:)?Name>\s*([^<\s][^<]*?)\s*<\/(?:\w+:)?Name>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const nome = m[1];
    if (nome.includes(":") || RE_CAMADA.test(nome)) nomes.add(nome);
  }
  return [...nomes];
}

// WFS 1.0.0 de propósito: em 1.1.0 o BBOX em EPSG:4326 inverte para lat,lon e
// devolve vazio silenciosamente.
function urlGetFeature(base, camada) {
  const q = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: camada,
    maxFeatures: "2",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    BBOX: BBOX.join(","),
  });
  return `${base}?${q}`;
}

async function sondarCamada(base, camada) {
  const r = await get(urlGetFeature(base, camada), "application/json");
  if (!r.ok) return `      ${camada}: HTTP ${r.status}${r.erro ? ` (${r.erro})` : ""}`;

  let gj;
  try {
    gj = JSON.parse(r.texto);
  } catch {
    // GeoServer devolve ServiceExceptionReport em XML quando a camada não aceita
    // o formato/filtro pedido.
    const msg = r.texto.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/i);
    return `      ${camada}: resposta não-JSON${msg ? ` — ${msg[1].trim().slice(0, 160)}` : ` (${r.tipo})`}`;
  }

  const feats = gj.features ?? [];
  if (feats.length === 0) return `      ${camada}: 0 feições no BBOX (camada responde, área vazia?)`;

  const props = Object.keys(feats[0].properties ?? {});
  const geom = feats[0].geometry?.type ?? "?";
  return [
    `      ${camada}: ${feats.length} feição(ões), geometria ${geom}`,
    `        campos: ${props.join(", ")}`,
  ].join("\n");
}

async function main() {
  console.log(`BBOX de teste (lon/lat): ${BBOX.join(", ")}\n`);

  for (const base of ENDPOINTS) {
    const caps = await get(`${base}?service=WFS&version=1.1.0&request=GetCapabilities`, "text/xml");
    if (!caps.ok) {
      console.log(`[--] ${base}\n      HTTP ${caps.status}${caps.erro ? ` (${caps.erro})` : ""}`);
      continue;
    }

    const todas = extrairCamadas(caps.texto);
    const alvo = todas.filter((n) => RE_CAMADA.test(n));
    console.log(`[OK] ${base}`);
    console.log(`      ${todas.length} camadas anunciadas, ${alvo.length} candidatas`);
    if (alvo.length === 0) {
      console.log(`      amostra: ${todas.slice(0, 12).join(", ") || "(nenhuma extraída)"}`);
      continue;
    }

    for (const camada of alvo.slice(0, 6)) {
      console.log(await sondarCamada(base, camada));
    }
  }

  console.log("\nO que confirmar na saída:");
  console.log("  1. algum endpoint respondeu GetCapabilities sem autenticação;");
  console.log("  2. existe camada de parcelas certificadas;");
  console.log("  3. o BBOX filtra de fato (feições > 0 numa área com parcelas);");
  console.log("  4. os campos incluem código da parcela e detentor/titular.");
}

main().catch((e) => {
  console.error("falha na sondagem:", e?.message ?? e);
  process.exitCode = 1;
});
