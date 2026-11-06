// Lógica pura da função analise-imovel (sem Deno, sem supabase-js): roda nos
// testes do node. O index.ts só cuida de login, limites e banco.
//
//   focos — ponte para o WFS de queimadas do INPE (TerraBrasilis), que não
//           libera CORS. A URL é montada AQUI, só para os hosts da lista: a
//           tela manda a caixa e a data, nunca um endereço.
//   laudo — o parecer técnico escrito pela IA (o mesmo provedor do ler-arquivo:
//           OpenAI, Responses API, chave só no servidor) SÓ com os dados que a
//           consulta coletou e que estão gravados em analises_imovel.
import { PRECOS_OPENAI } from "../_shared/leitor/ia.ts";

// ---------------------------------------------------------------------------
// Focos de queimada (INPE)
// ---------------------------------------------------------------------------

/** Os únicos hosts que a ponte chama. */
export const HOSTS_PONTE = ["terrabrasilis.dpi.inpe.br"] as const;
export const WFS_QUEIMADAS = "https://terrabrasilis.dpi.inpe.br/queimadas/geoserver/wfs";

/** Lado máximo da caixa, em grau (~55 km): imóvel + 1 km cabe com folga; o Brasil inteiro não. */
export const LADO_MAX_GRAU = 0.5;

export type Caixa = [number, number, number, number];

export function validarCaixa(c: unknown): Caixa {
  if (!Array.isArray(c) || c.length !== 4 || !c.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error("Caixa inválida: [oeste, sul, leste, norte] em grau.");
  }
  const [o, s, l, n] = c as Caixa;
  if (o >= l || s >= n) throw new Error("Caixa inválida: oeste < leste e sul < norte.");
  if (o < -75 || l > -28 || s < -35 || n > 6) throw new Error("A caixa precisa estar no Brasil.");
  if (l - o > LADO_MAX_GRAU || n - s > LADO_MAX_GRAU) throw new Error("Área grande demais para a consulta de focos (máximo de ~50 km de lado).");
  return [o, s, l, n];
}

/** "AAAA-MM-DD", no passado e até 2 anos atrás. */
export function validarDesde(d: unknown, agora = new Date()): string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Data inicial inválida (AAAA-MM-DD).");
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t) || t > agora.getTime() || t < agora.getTime() - 731 * 864e5) throw new Error("Data inicial fora do intervalo (até 2 anos).");
  return d;
}

/** Camadas que cobrem de `desde` até hoje: a do ano atual e as dos anos fechados no meio. */
export function camadasFocos(desde: string, agora = new Date(), conjunto: "todosats" | "satref" = "todosats"): string[] {
  const ano = agora.getUTCFullYear();
  const de = Number(desde.slice(0, 4));
  const out = [`dados_abertos:focos_ano_atual_br_${conjunto}`];
  for (let a = Math.max(de, ano - 2); a < ano; a++) out.push(`dados_abertos:focos_${a}_br_${conjunto}`);
  return out;
}

/** Feições por página do WFS e páginas por camada: até 6.000 focos por camada; passou disso, a resposta é "cortada". */
export const FOCOS_POR_PAGINA = 2000;
export const PAGINAS_FOCOS = 3;

export function urlFocos(camada: string, caixa: Caixa, max = FOCOS_POR_PAGINA, inicio = 0): string {
  if (!/^dados_abertos:focos_(ano_atual|\d{4})_br_(todosats|satref)$/.test(camada)) throw new Error("Camada de focos fora da lista.");
  if (!Number.isInteger(inicio) || inicio < 0 || !Number.isInteger(max) || max < 1 || max > FOCOS_POR_PAGINA) throw new Error("Página de focos inválida.");
  const [o, s, l, n] = caixa;
  // WFS 2.0 com o CRS em URN: a caixa vai em lat,lon (a ordem do EPSG:4326)
  const q = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: camada, outputFormat: "application/json", count: String(max),
    ...(inicio ? { startIndex: String(inicio) } : {}),
    srsName: "urn:ogc:def:crs:EPSG::4326", bbox: `${s},${o},${n},${l},urn:ogc:def:crs:EPSG::4326`,
    propertyName: "data_hora_gmt,satelite,municipio,frp,geometria",
  });
  const url = `${WFS_QUEIMADAS}?${q}`;
  if (!HOSTS_PONTE.includes(new URL(url).host as typeof HOSTS_PONTE[number])) throw new Error("Host fora da lista.");
  return url;
}

export interface Foco { lon: number; lat: number; quando: string; satelite: string | null; frp: number | null; municipio: string | null }

/** A resposta do INPE → os focos a partir de `desde`, sem repetir (mesmo lugar e hora). */
export function lerFocos(j: unknown, desde: string): Foco[] {
  const fc = j as { type?: string; features?: { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[] };
  if (!fc || fc.type !== "FeatureCollection") throw new Error("INPE: resposta inesperada");
  const vistos = new Set<string>();
  const out: Foco[] = [];
  for (const f of fc.features ?? []) {
    const c = f.geometry?.coordinates;
    if (f.geometry?.type !== "Point" || !Array.isArray(c)) continue;
    // o GeoServer devolve em lon,lat no GeoJSON (mesmo com o CRS em URN)
    let [lon, lat] = [Number(c[0]), Number(c[1])];
    if (lon > -20 && lat < -30) [lon, lat] = [lat, lon];
    const quando = String(f.properties?.data_hora_gmt ?? "");
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !/^\d{4}-\d{2}-\d{2}/.test(quando) || quando.slice(0, 10) < desde) continue;
    const chave = `${lon.toFixed(5)}|${lat.toFixed(5)}|${quando.slice(0, 16)}|${f.properties?.satelite ?? ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const frp = Number(f.properties?.frp);
    out.push({
      lon, lat, quando: quando.slice(0, 19), satelite: f.properties?.satelite ? String(f.properties.satelite) : null,
      frp: Number.isFinite(frp) ? frp : null, municipio: f.properties?.municipio ? String(f.properties.municipio) : null,
    });
  }
  return out.sort((a, b) => (a.quando < b.quando ? 1 : -1));
}

/** A página veio cheia (ou o servidor diz que há mais do que mandou)? Então pode haver mais focos. */
export function paginaCheia(j: unknown, max: number, inicio = 0): boolean {
  const fc = j as { features?: unknown[]; numberMatched?: unknown; totalFeatures?: unknown };
  const n = Array.isArray(fc?.features) ? fc.features.length : 0;
  // numberMatched "unknown" (GeoServer sem contagem) não é número: cai no "página cheia"
  const total = Number(fc?.numberMatched ?? fc?.totalFeatures);
  if (Number.isFinite(total) && total >= 0) return total > inicio + n;
  return n >= max;
}

/**
 * Busca os focos em todas as camadas do período (as duas listas: todos os satélites e o de
 * referência), página por página (até PAGINAS_FOCOS). O GeoServer não devolve por proximidade:
 * se a última página ainda veio cheia, os focos de dentro do imóvel podem ter ficado de fora —
 * aí `cortada` = true, e a tela trata como fonte incompleta (nunca como "nenhum foco").
 */
export async function buscarFocos(caixa: Caixa, desde: string, f: typeof fetch, agora = new Date(), timeoutMs = 25_000): Promise<{ todos: Foco[]; referencia: Foco[]; cortada: boolean }> {
  let cortada = false;
  const pagina = async (camada: string, inicio: number) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await f(urlFocos(camada, caixa, FOCOS_POR_PAGINA, inicio), { signal: ctl.signal });
      if (!r.ok) throw new Error(`INPE respondeu ${r.status}`);
      const texto = await r.text();
      let j: unknown;
      try { j = JSON.parse(texto); } catch { throw new Error("INPE: resposta inesperada"); }
      return { focos: lerFocos(j, desde), cheia: paginaCheia(j, FOCOS_POR_PAGINA, inicio) };
    } catch (e) {
      throw new Error(ctl.signal.aborted ? "o INPE não respondeu a tempo" : e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
    }
  };
  const pegar = async (conjunto: "todosats" | "satref") => {
    const listas = await Promise.all(camadasFocos(desde, agora, conjunto).map(async (camada) => {
      const out: Foco[] = [];
      for (let p = 0; p < PAGINAS_FOCOS; p++) {
        const { focos, cheia } = await pagina(camada, p * FOCOS_POR_PAGINA);
        out.push(...focos);
        if (!cheia) return out;
      }
      cortada = true;
      return out;
    }));
    // sem repetir entre páginas (mesmo lugar, hora e satélite)
    const vistos = new Set<string>();
    return listas.flat().filter((x) => {
      const k = `${x.lon.toFixed(5)}|${x.lat.toFixed(5)}|${x.quando.slice(0, 16)}|${x.satelite ?? ""}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).sort((a, b) => (a.quando < b.quando ? 1 : -1));
  };
  const [todos, referencia] = await Promise.all([pegar("todosats"), pegar("satref")]);
  return { todos, referencia, cortada };
}

// ---------------------------------------------------------------------------
// Laudo por IA
// ---------------------------------------------------------------------------

/** Laudos por empresa em 24 h (contados em chamadas_ia, nome_arquivo = NOME_CHAMADA_LAUDO, aprovada). */
export const LIMITE_LAUDOS_DIA = 20;
export const NOME_CHAMADA_LAUDO = "laudo:consulta-imovel";

/**
 * O que vai para a IA: `resultado.para_laudo` (dadosParaLaudo, src/lib/consulta/analise.ts), os fatos
 * com a fonte e a natureza de cada um. null = consulta gravada antes disso (sem para_laudo): a função
 * recusa em vez de mandar o resultado inteiro (geometria, listas de focos) e torcer pela fonte.
 */
export function dadosDoLaudo(resultado: unknown): Record<string, unknown> | null {
  const p = (resultado as { para_laudo?: unknown } | null)?.para_laudo;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const d = p as Record<string, unknown>;
  // o mínimo para um parecer: a identificação e a leitura do sistema
  if (!d.identificacao || !d.leitura_do_sistema) return null;
  return d;
}
export const MODELO_LAUDO_PADRAO = "gpt-6.1-terra";
export const MAX_DADOS_LAUDO = 60_000;

export const INSTRUCOES_LAUDO = `Você é um engenheiro agrimensor brasileiro escrevendo um PARECER TÉCNICO PRELIMINAR sobre um imóvel rural, para o escritório que vai orçar ou começar um serviço (georreferenciamento SIGEF, CAR, desmembramento).

Regras (obrigatórias):
- Use SOMENTE os dados do JSON. Não invente número, nome, data, lei ou fato. Se um dado não está no JSON, não fale dele.
- Toda afirmação de fato termina com a fonte entre colchetes, com o nome que está no campo "fonte" do JSON: [SICAR], [SIGEF/INCRA], [FUNAI], [MMA/CNUC], [INCRA], [IBAMA], [ICMBio], [IBGE], [IPHAN], [INPE], [Open-Meteo], [SoilGrids], [Vertces].
- Respeite a natureza de cada fonte: CAR é DECLARAÇÃO do proprietário (diga "declarado" e a condição, ex.: "aguardando análise"); SIGEF é CERTIFICADO pelo INCRA; as bases de restrição são ALERTA (escalas e datas próprias), não certidão; SoilGrids é modelo estimado (250 m); o clima é reanálise (Open-Meteo/ERA5).
- Fonte que "não respondeu" ou "incompleta" deve aparecer como pendência: diga que não foi possível verificar e recomende consultar de novo.
- Áreas em hectares com vírgula decimal (padrão brasileiro), como estão no JSON.
- Português do Brasil, frases curtas, tom técnico e direto. Sem markdown pesado: só títulos numerados e listas com "-".

Estrutura (nesta ordem, só as seções que têm dado):
1. Identificação — o que foi consultado, área calculada pelo sistema e a declarada/certificada, município/UF.
2. Situação fundiária — CAR (declarado) e SIGEF (certificado): o que existe e o que sobrepõe.
3. Restrições — o que sobrepõe e o que encosta; o que ficou sem verificar.
4. Ambiente — bioma (e a reserva legal de referência, se estiver no JSON), solo, clima e focos de queimada.
5. Conclusão e próximos passos — 2 a 5 itens práticos para o escritório (o que conferir em campo, o que pedir ao cliente, que certidão buscar).

No máximo 450 palavras.`;

export function montarPedidoLaudo(dados: unknown): { instrucoes: string; entrada: string } {
  const json = JSON.stringify(dados);
  if (json.length > MAX_DADOS_LAUDO) throw new Error("Dados da consulta grandes demais para o laudo.");
  return { instrucoes: INSTRUCOES_LAUDO, entrada: `Dados coletados pela consulta (JSON):\n${json}` };
}

export interface ConfigLaudo { apiKey: string; modelo?: string; url?: string; fetch?: typeof fetch; timeoutMs?: number }
export interface RespostaLaudo { texto: string; modelo: string; tokensEntrada: number; tokensSaida: number; custoUsd: number | null; ms: number }

function textoDaResposta(j: Record<string, unknown>): string | null {
  if (typeof j.output_text === "string") return j.output_text;
  for (const item of (Array.isArray(j.output) ? j.output : []) as Record<string, unknown>[]) {
    for (const c of (Array.isArray(item.content) ? item.content : []) as Record<string, unknown>[]) {
      if (c.type === "refusal") throw new Error(`a IA recusou: ${String(c.refusal ?? "")}`);
      if (c.type === "output_text" && typeof c.text === "string") return c.text;
    }
  }
  return null;
}

export const custoLaudo = (modelo: string, ent: number, sai: number): number | null => {
  const p = PRECOS_OPENAI[modelo];
  return p ? (ent * p[0] + sai * p[1]) / 1e6 : null;
};

/** Chama a IA (Responses API, texto) e devolve o laudo limpo. */
export async function escreverLaudo(cfg: ConfigLaudo, dados: unknown): Promise<RespostaLaudo> {
  const f = cfg.fetch ?? fetch;
  const modelo = cfg.modelo || MODELO_LAUDO_PADRAO;
  const pedido = montarPedidoLaudo(dados);
  const t0 = Date.now();
  const corpo = (comRaciocinio: boolean) => ({
    model: modelo,
    input: [{ role: "system", content: pedido.instrucoes }, { role: "user", content: pedido.entrada }],
    ...(comRaciocinio ? { reasoning: { effort: "low" } } : {}),
    max_output_tokens: 4000,
  });
  for (const raciocinio of [true, false]) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 90_000);
    let r: Response;
    try {
      r = await f(cfg.url ?? "https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(corpo(raciocinio)),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? "a IA não respondeu a tempo" : `falha ao chamar a IA (${e instanceof Error ? e.message : String(e)})`);
    } finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok) {
      const msg = String((j.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${r.status}`);
      if (raciocinio && r.status === 400 && /reasoning|not supported|unsupported/i.test(msg)) continue;
      throw new Error(`OpenAI ${r.status}: ${msg}`);
    }
    const texto = limparLaudo(textoDaResposta(j) ?? "");
    if (texto.length < 80) throw new Error("a IA devolveu um laudo vazio");
    const uso = (j.usage ?? {}) as Record<string, number>;
    const ent = uso.input_tokens ?? 0, sai = uso.output_tokens ?? 0;
    return { texto, modelo, tokensEntrada: ent, tokensSaida: sai, custoUsd: custoLaudo(modelo, ent, sai), ms: Date.now() - t0 };
  }
  throw new Error("OpenAI: o modelo não aceitou o pedido");
}

/** Tira markdown pesado (negrito, cabeçalho com #) e limita o tamanho. */
export function limparLaudo(t: string): string {
  return t
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);
}

