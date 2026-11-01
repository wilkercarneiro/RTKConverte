// Detector por regras: escreve a receita de um arquivo tabular sem ajuda,
// olhando a ESTRUTURA (separador, decimal, cabeçalho) e os VALORES de cada
// coluna (no Brasil, N UTM tem 7 dígitos e E tem 6; σ é pequeno e tem casas
// decimais; latitude e longitude não se sobrepõem). Devolve também a confiança:
// "alta" dispensa a IA; "media"/"baixa" chamam a IA (ler-arquivo).
import { LIMITES } from "../geo.ts";
import { APOIO_PADRAO, camposVazios } from "./receita.ts";
import type { Campos, Papel, Receita } from "./receita.ts";
import { dividirDelimitado, dividirEspacos, mapearTabela, tabelaDeLinhas } from "./executor.ts";
import { lerAngulo, lerNumero, limparToken } from "./numeros.ts";

export type Confianca = "alta" | "media" | "baixa";

export interface Deteccao {
  receita: Receita;
  confianca: Confianca;
  /** Por que a confiança não é alta (vai para a IA como pista). */
  duvidas: string[];
  /** Pontos com coordenada válida que a receita produziu. */
  pontosValidos: number;
}

// ---------------------------------------------------------------------------
// Cabeçalho: sinônimos em PT/EN/ES/ZH
// ---------------------------------------------------------------------------

export const normalizarCab = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[\[(].*?[\])]/g, " ").replace(/[_\-./:]+/g, " ").replace(/\s+/g, " ").trim();

type PapelCab = Papel | "ignorar";

const SINONIMOS: [PapelCab, string[]][] = [
  ["ignorar", ["base easting", "base northing", "base elevation", "base latitude", "base longitude", "base height", "base ellipsoidal height", "base antenna height", "base name", "antenna height", "antena", "altura antena", "altura da antena", "antenna", "instrument height", "altura instrumento", "hi", "ht", "pdop", "hdop", "vdop", "gdop", "sats", "satellites", "satelites", "num sats", "ns", "q", "status", "solution status", "solution", "fix", "age", "ratio", "origin", "origem", "tilt angle", "tilt", "averaging start", "averaging end", "samples", "amostras", "epochs", "epocas", "date", "time", "data", "hora", "gpst", "utc", "sdne", "sdeu", "sdun", "cq", "base", "rtk", "solucao", "tipo solucao", "geoid", "ondulacao", "n geoidal", "undulation"]],
  ["sigma_pos", ["hrms", "h rms", "sigma pos", "sigmapos", "σpos", "σ pos", "sigma xy", "sxy", "s xy", "prec h", "precisao h", "precisao horizontal", "precisão horizontal", "horizontal precision", "hprec", "h prec", "hz prec", "lateral rms", "horizontal rms", "2d rms", "sigma horizontal", "σ horizontal", "σhorizontal", "σ hz", "sigma hz", "σ planimetrico", "rms h", "平面精度", "水平精度", "sigma planimetrico", "sp", "prec horizontal", "precisao planimetrica", "desvio horizontal"]],
  ["sigma_h", ["vrms", "v rms", "sigma h", "sigmah", "σh", "σ h", "sigma z", "sz", "s z", "prec v", "precisao v", "precisao vertical", "vertical precision", "vprec", "v prec", "elevation rms", "vertical rms", "height rms", "sdu", "shgeo", "sigma vertical", "σ vertical", "σvertical", "σ v", "σv", "sigma v", "sigmav", "sigma altimetrico", "σ altimetrico", "rms v", "高程精度", "垂直精度", "sh", "prec vertical", "precisao altimetrica", "desvio vertical"]],
  ["sigma_n", ["northing rms", "north rms", "n rms", "sdn", "sn", "slat", "sigma n", "σn", "sigma lat", "sigma y", "sy", "prec n", "σ n", "sigma norte"]],
  ["sigma_e", ["easting rms", "east rms", "e rms", "sde", "se", "slon", "sigma e", "σe", "sigma lon", "sigma x", "sx", "prec e", "σ e", "sigma este"]],
  ["nome", ["name", "point", "point name", "point id", "pt", "pt id", "pto", "ponto", "nome", "id", "numero", "num", "nº", "n ponto", "nome ponto", "station", "estacao", "vertice", "vertex", "marco", "pnt", "pt name", "点名", "点号", "名称", "punto", "nombre"]],
  ["codigo", ["code", "codigo", "cod", "desc", "description", "descricao", "descr", "feature", "attribute", "atributo", "obs", "observacao", "observacoes", "comentario", "comment", "note", "nota", "label", "rotulo", "layer", "camada", "编码", "代码", "描述", "属性", "codigo ponto", "point code"]],
  ["e", ["e", "este", "easting", "east", "x", "coord e", "coordenada e", "utm e", "utme", "e utm", "leste", "grid east", "grid easting", "东", "东坐标", "e m"]],
  ["n", ["n", "norte", "northing", "north", "y", "coord n", "coordenada n", "utm n", "utmn", "n utm", "grid north", "grid northing", "北", "北坐标", "n m"]],
  ["h", ["h", "z", "elev", "elevation", "altitude", "alt", "cota", "height", "ellipsoidal height", "altura elipsoidal", "alt elip", "h elip", "hgeo", "hnor", "hort", "altitude ortometrica", "altitude elipsoidal", "altura", "高程", "大地高", "elevacion", "h elipsoidal", "h ortometrica"]],
  ["lat", ["lat", "latitude", "b", "phi", "φ", "纬度", "lat dms", "latitude dms", "lat deg", "latitud"]],
  ["lon", ["lon", "long", "longitude", "lng", "l", "lambda", "λ", "经度", "lon dms", "longitude dms", "lon deg", "longitud"]],
];

/** Papel de um título de coluna (null = não reconhecido). */
export function papelDoCabecalho(titulo: string): PapelCab | null {
  const t = normalizarCab(titulo);
  if (!t) return null;
  for (const [papel, lista] of SINONIMOS) if (lista.some((s) => normalizarCab(s) === t)) return papel;
  // contém um sinônimo de 2+ palavras ("easting rms", "ellipsoidal height")
  for (const [papel, lista] of SINONIMOS) {
    if (lista.some((s) => { const n = normalizarCab(s); return n.includes(" ") && t.includes(n); })) return papel;
  }
  return null;
}

const unidadeDoCabecalho = (titulo: string): "m" | "cm" | "mm" | null => {
  const t = titulo.toLowerCase();
  if (/(\(|\[|\s|^)mm(\)|\]|\s|$)/.test(t)) return "mm";
  if (/(\(|\[|\s|^)cm(\)|\]|\s|$)/.test(t)) return "cm";
  return null;
};

// ---------------------------------------------------------------------------
// Perfil de coluna pelos valores
// ---------------------------------------------------------------------------

interface PerfilColuna {
  j: number;
  preenchidas: number;
  vazias: number;
  numericas: number;
  inteirasSemDecimal: number;
  E: number; N: number; lat: number; lon: number; alt: number; pequeno: number;
  texto: number;
  /** Começa com dígito e tem letras ("5ramon/faz", "105V"). */
  numeroComTexto: number;
  valores: (number | null)[];
}

const NMIN_BR = 6100000;

function perfilar(linhas: string[][], j: number, dec: "," | "."): PerfilColuna {
  const p: PerfilColuna = { j, preenchidas: 0, vazias: 0, numericas: 0, inteirasSemDecimal: 0, E: 0, N: 0, lat: 0, lon: 0, alt: 0, pequeno: 0, texto: 0, numeroComTexto: 0, valores: [] };
  for (const cel of linhas) {
    const bruto = cel[j] ?? "";
    const t = limparToken(bruto);
    if (!t) { p.vazias++; p.valores.push(null); continue; }
    p.preenchidas++;
    const v = lerNumero(t, dec);
    p.valores.push(v);
    if (v !== null) {
      p.numericas++;
      const temDec = dec === "," ? t.includes(",") : t.includes(".");
      if (!temDec) p.inteirasSemDecimal++;
      if (v >= LIMITES.eMin && v <= LIMITES.eMax) p.E++;
      if (v >= NMIN_BR && v <= LIMITES.nMax) p.N++;
      if (v >= -100 && v <= 3100) p.alt++;
      // σ = 0 às vezes sai como "0" (sem casas): não deixa de ser coluna de σ
      if (v >= 0 && v <= 10 && (temDec || v === 0)) p.pequeno++;
    } else {
      if (/^\d+\s*\S/.test(t) && /[a-z/]/i.test(t)) p.numeroComTexto++;
      else if (/[a-z]/i.test(t) && !/^[+-]?\d/.test(t)) p.texto++;
    }
    // pelos VALORES só conta como lat/lon o que tem sinal "-", letra de
    // hemisfério ou GMS: σ (0,0042) e altitude (45,3) caberiam nas faixas
    if (anguloForte(t, "lat", dec)) p.lat++;
    if (anguloForte(t, "lon", dec)) p.lon++;
  }
  return p;
}

const frac = (x: number, de: number) => (de ? x / de : 0);

/** Lat/lon reconhecível pelo valor: dentro do Brasil E com sinal, letra ou GMS. */
function anguloForte(t: string, eixo: "lat" | "lon", dec: "," | "."): boolean {
  const a = lerAngulo(t, eixo, dec);
  if (!a || !(a.hemisferioExplicito || a.gms)) return false;
  if (!a.gms && Math.abs(a.graus % 1) < 1e-9) return false;
  return eixo === "lat"
    ? a.graus >= LIMITES.latMin && a.graus <= LIMITES.latMax
    : a.graus >= LIMITES.lonMin && a.graus <= LIMITES.lonMax;
}

// ---------------------------------------------------------------------------
// Candidatos de tokenização
// ---------------------------------------------------------------------------

type Tok = { modo: "delimitado"; d: string } | { modo: "espacos" };
const TOKS: Tok[] = [
  { modo: "delimitado", d: ";" }, { modo: "delimitado", d: "," }, { modo: "delimitado", d: "\t" },
  { modo: "delimitado", d: "|" }, { modo: "delimitado", d: ":" }, { modo: "espacos" },
];

const dividir = (l: string, t: Tok) => (t.modo === "espacos" ? dividirEspacos(l) : dividirDelimitado(l, t.d));

function moda(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let melhor = 0, mv = -1;
  for (const [k, v] of c) if (v > mv || (v === mv && k > melhor)) { melhor = k; mv = v; }
  return melhor;
}

/** Linha "de dados": tem um par de coordenadas plausível (E/N ou lat/lon). */
function linhaDeDados(celulas: string[], dec: "," | "."): boolean {
  let e = 0, n = 0, la = 0, lo = 0;
  for (const c of celulas) {
    const t = limparToken(c);
    if (!t) continue;
    const v = lerNumero(t, dec);
    if (v !== null) {
      if (v >= LIMITES.eMin && v <= LIMITES.eMax) e++;
      if (v >= NMIN_BR && v <= LIMITES.nMax) n++;
    }
    if (anguloForte(t, "lat", dec)) la++;
    if (anguloForte(t, "lon", dec)) lo++;
  }
  return (e >= 1 && n >= 1) || (la >= 1 && lo >= 1);
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Detecção
// ---------------------------------------------------------------------------

interface Tentativa { deteccao: Deteccao; nota: number }

function tentar(linhas: string[], tok: Tok, dec: "," | "."): Tentativa | null {
  const idxNaoVazias = linhas.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  if (!idxNaoVazias.length) return null;
  const cels = new Map<number, string[]>();
  // célula vazia no fim NÃO é descartada: pode ser a coluna de descrição vazia
  // (descartar desalinha as linhas que têm descrição das que não têm)
  for (const i of idxNaoVazias) cels.set(i, dividir(linhas[i], tok));
  // linha de comentário (%, #, //, !) nunca é ponto — nem quando traz uma
  // coordenada, como o "% ref pos" (posição da base) do RTKLIB
  const comentario = (i: number) => /^\s*(%|#|\/\/|!)/.test(linhas[i]);
  const dados = idxNaoVazias.filter((i) => !comentario(i) && cels.get(i)!.length >= 2 && linhaDeDados(cels.get(i)!, dec));
  if (dados.length < 3) return null;
  const k = moda(dados.map((i) => cels.get(i)!.length));
  if (k < 2) return null;
  const primeiro = dados[0], ultimo = dados[dados.length - 1];

  // ---- cabeçalho: a última linha não-dado antes dos dados com ~k títulos ----
  let cabecalho: string[] | null = null, linhaCab = -1;
  for (let i = primeiro - 1; i >= 0; i--) {
    if (!linhas[i].trim()) continue;
    let c = dividir(linhas[i].replace(/^\s*[%#]\s*/, ""), tok);
    const reconhecidos = c.filter((x) => papelDoCabecalho(x) !== null).length;
    if (reconhecidos >= 2 && c.length >= Math.min(k, 2)) {
      // RTKLIB: "GPST" ocupa duas colunas de dado (data e hora)
      const d0 = cels.get(primeiro)!;
      if (c.length + 1 === k && /^\d{4}[/-]\d\d[/-]\d\d$/.test(d0[0]?.trim() ?? "") && /^\d\d:\d\d/.test(d0[1]?.trim() ?? "")) c = [c[0], "time", ...c.slice(1)];
      cabecalho = c; linhaCab = i;
    }
    break;
  }

  // ---- perfis das colunas (linhas com o nº de colunas da maioria) ----
  const dadosK = dados.filter((i) => cels.get(i)!.length === k).map((i) => cels.get(i)!);
  const perfis = Array.from({ length: k }, (_, j) => perfilar(dadosK.length >= 3 ? dadosK : dados.map((i) => cels.get(i)!), j, dec));

  // ---- papéis ----
  const campos: Campos = camposVazios();
  const duvidas: string[] = [];
  const usados = new Set<number>();
  let unidade: "m" | "cm" | "mm" = "m", confiancaSigma: "1sigma" | "95" = "1sigma";
  const ignoradosCab = new Set<number>();
  if (cabecalho) {
    // "σh" é ambíguo: na equipe é a vertical (σpos | σh), mas em "σH | σV" o H é horizontal
    const AMBIGUO_H = new Set(["σh", "σ h", "sigma h", "sigmah", "sh"]);
    const temVerticalExplicita = cabecalho.some((t) => papelDoCabecalho(t) === "sigma_h" && !AMBIGUO_H.has(normalizarCab(t)));
    const desconhecidos = cabecalho.filter((t, j) => j < k && t.trim() && papelDoCabecalho(t) === null);
    if (desconhecidos.length) duvidas.push(`título(s) de coluna desconhecido(s): ${desconhecidos.map((t) => `"${t.trim()}"`).join(", ")}`);
    cabecalho.forEach((titulo, j) => {
      if (j >= k) return;
      let papel = papelDoCabecalho(titulo);
      if (!papel) return;
      if (papel === "sigma_h" && AMBIGUO_H.has(normalizarCab(titulo)) && temVerticalExplicita) papel = "sigma_pos";
      if (papel === "ignorar") { ignoradosCab.add(j); return; }
      if (campos[papel] !== null) {
        // dois títulos para o mesmo papel ("Elevation" vazia e "Ellipsoidal height"
        // preenchida, no Emlid Studio): vale a coluna que tem valores
        const atual = campos[papel]!;
        if (perfis[atual].preenchidas > 0 || perfis[j].preenchidas === 0) return;
        usados.delete(atual);
      }
      campos[papel] = j; usados.add(j);
      if (papel.startsWith("sigma")) {
        const u = unidadeDoCabecalho(titulo);
        if (u) unidade = u;
        if (/95/.test(titulo)) confiancaSigma = "95";
      }
    });
    // X/Y à chinesa (X = norte): os valores mandam
    if (campos.e !== null && campos.n !== null) {
      const pe = perfis[campos.e], pn = perfis[campos.n];
      if (frac(pe.N, pe.numericas) > 0.9 && frac(pn.E, pn.numericas) > 0.9) {
        // X = norte (convenção chinesa): os valores decidem sem ambiguidade
        [campos.e, campos.n] = [campos.n, campos.e];
      }
    }
    if (campos.lat !== null && campos.lon !== null) {
      const pa = perfis[campos.lat], po = perfis[campos.lon];
      if (frac(pa.lon, pa.preenchidas) > 0.9 && frac(po.lat, po.preenchidas) > 0.9 && frac(pa.lat, pa.preenchidas) < 0.5) {
        [campos.lat, campos.lon] = [campos.lon, campos.lat];
      }
    }
    // papel do cabeçalho que os valores desmentem (E com valor de altura…)
    for (const p of ["e", "n"] as const) {
      const j = campos[p];
      if (j === null) continue;
      const pf = perfis[j];
      const ok = p === "e" ? frac(pf.E, pf.numericas) > 0.9 : frac(pf.N, pf.numericas) > 0.9;
      if (!ok || pf.numericas < pf.preenchidas * 0.9) {
        if (pf.preenchidas === 0) continue; // coluna vazia: pode vir pela geográfica
        duvidas.push(`a coluna "${cabecalho[j]}" não tem valores de ${p.toUpperCase()} UTM`);
        campos[p] = null; usados.delete(j);
      }
    }
  }

  const livre = (j: number) => !usados.has(j) && !ignoradosCab.has(j);
  const pega = (papel: Papel, j: number) => { campos[papel] = j; usados.add(j); };

  // E e N pelos valores
  if (campos.e === null || campos.n === null) {
    const cE = perfis.filter((p) => livre(p.j) && p.numericas >= 3 && frac(p.E, p.numericas) > 0.95 && frac(p.numericas, p.preenchidas) > 0.95);
    const cN = perfis.filter((p) => livre(p.j) && p.numericas >= 3 && frac(p.N, p.numericas) > 0.95 && frac(p.numericas, p.preenchidas) > 0.95);
    if (campos.e === null && cE.length) pega("e", cE[0].j);
    if (campos.n === null && cN.length) pega("n", cN[0].j);
    // coluna repetida (E;N;E;N) → descarta a cópia
    for (const lista of [cE, cN]) {
      for (const c of lista.slice(1)) {
        const base = perfis[lista[0].j];
        const iguais = c.valores.filter((v, i) => v !== null && v === base.valores[i]).length;
        if (iguais >= c.numericas * 0.95) ignoradosCab.add(c.j);
        else duvidas.push(`há mais de uma coluna com valores de ${lista === cE ? "E" : "N"}`);
      }
    }
  }
  // lat/lon pelos valores (texto GMS também)
  if (campos.lat === null || campos.lon === null) {
    const cLat = perfis.filter((p) => livre(p.j) && p.preenchidas >= 3 && frac(p.lat, p.preenchidas) > 0.95 && frac(p.lon, p.preenchidas) < 0.5);
    const cLon = perfis.filter((p) => livre(p.j) && p.preenchidas >= 3 && frac(p.lon, p.preenchidas) > 0.95 && frac(p.lat, p.preenchidas) < 0.5);
    const la = campos.lat ?? cLat[0]?.j ?? null, lo = campos.lon ?? cLon[0]?.j ?? null;
    if (la !== null && lo !== null && la !== lo) {
      if (campos.lat === null) pega("lat", la);
      if (campos.lon === null) pega("lon", lo);
    }
  }
  const temUtm = campos.e !== null && campos.n !== null;
  const temGeo = campos.lat !== null && campos.lon !== null;
  if (!temUtm && !temGeo) return null;

  // nome: pelo cabeçalho; senão a 1ª coluna não numérica/sequencial à esquerda das coordenadas
  if (campos.nome === null) {
    const primeiraCoord = Math.min(...[campos.e, campos.n, campos.lat, campos.lon].filter((x): x is number => x !== null));
    const cand = perfis.find((p) => livre(p.j) && p.j < primeiraCoord && p.preenchidas > 0 && (p.texto + p.numeroComTexto > 0 || p.inteirasSemDecimal === p.numericas));
    if (cand) pega("nome", cand.j);
  }
  // código: coluna de texto restante (Trimble/Carlson: depois das coordenadas)
  if (campos.codigo === null) {
    const cand = perfis.find((p) => livre(p.j) && p.texto + p.numeroComTexto > 0 && p.numericas < Math.max(1, p.preenchidas * 0.5));
    if (cand) pega("codigo", cand.j);
  }

  // altura: a 1ª coluna numérica com valores de altitude que não seja σ
  const numericaLivre = (p: PerfilColuna) => livre(p.j) && p.numericas >= Math.max(1, p.preenchidas * 0.95) && p.preenchidas > 0;
  if (campos.h === null) {
    const cand = perfis.find((p) => numericaLivre(p) && frac(p.alt, p.numericas) > 0.95 && !(frac(p.pequeno, p.numericas) > 0.95) && p.inteirasSemDecimal < p.numericas);
    if (cand) pega("h", cand.j);
  }
  // σ: colunas pequenas COM casas decimais (status/satélites são inteiros)
  const temSigmaCab = campos.sigma_pos !== null || campos.sigma_h !== null || campos.sigma_n !== null || campos.sigma_e !== null;
  const pequenas = perfis.filter((p) => numericaLivre(p) && frac(p.pequeno, p.numericas) > 0.95);
  if (!temSigmaCab) {
    if (pequenas.length === 2) { pega("sigma_pos", pequenas[0].j); pega("sigma_h", pequenas[1].j); }
    else if (pequenas.length === 3 && !cabecalho) {
      duvidas.push("três colunas de precisão sem cabeçalho: não dá para saber qual é a vertical");
    } else if (pequenas.length === 1) {
      duvidas.push("só uma coluna de precisão: não dá para saber se é horizontal ou vertical");
    } else if (pequenas.length > 3) {
      duvidas.push("várias colunas numéricas pequenas sem cabeçalho (precisões? DOP? antena?)");
    }
  } else {
    if ((campos.sigma_n !== null || campos.sigma_e !== null) && campos.sigma_pos === null && campos.sigma_h === null) {
      duvidas.push("o arquivo tem precisões de N e E mas não a vertical");
    }
  }
  if (campos.h === null) duvidas.push("nenhuma coluna de altitude reconhecida");

  // colunas numéricas que ficaram sem explicação
  const soltas = perfis.filter((p) => livre(p.j) && p.numericas > 0 && p.numericas >= p.preenchidas * 0.5);
  if (soltas.length && !cabecalho) duvidas.push(`${soltas.length} coluna(s) numérica(s) sem papel (colunas ${soltas.map((p) => p.j + 1).join(", ")})`);
  else if (soltas.length && cabecalho) {
    // títulos desconhecidos já viraram dúvida acima; aqui, colunas além do cabeçalho
    const semTitulo = soltas.filter((p) => !(cabecalho![p.j] ?? "").trim());
    if (semTitulo.length) duvidas.push(`coluna(s) numérica(s) sem título no cabeçalho (colunas ${semTitulo.map((p) => p.j + 1).join(", ")})`);
  }

  // nome: número com rótulo colado (formato da equipe) ou nome inteiro
  const pNome = campos.nome !== null ? perfis[campos.nome] : null;
  const nomeFormato: Receita["nome_formato"] = campos.codigo === null && pNome && (pNome.numeroComTexto > 0 || pNome.inteirasSemDecimal === pNome.numericas && pNome.texto === 0)
    ? "numero_e_rotulo" : "texto";

  // ---- linhas que não são ponto ----
  const pular = cabecalho ? linhaCab + 1 : primeiro;
  const ignorar: string[] = [];
  const dadosSet = new Set(dados);
  for (let i = pular; i <= ultimo; i++) {
    const l = linhas[i];
    if (!l.trim() || dadosSet.has(i)) continue;
    // cabeçalho repetido (exportação em páginas), comentário, régua de traços
    if (cabecalho && l.trim() === linhas[linhaCab].trim()) { const p = `^${escaparRegex(l.trim())}$`; if (!ignorar.includes(p)) ignorar.push(p); continue; }
    if (/^\s*(#|\/\/|%|!)/.test(l) && !ignorar.includes("^\\s*(#|//|%|!)")) { ignorar.push("^\\s*(#|//|%|!)"); continue; }
    if (/^[\s\-=_*~.]+$/.test(l) && !ignorar.includes("^[\\s\\-=_*~.]+$")) ignorar.push("^[\\s\\-=_*~.]+$");
  }

  // ---- excedente (rótulo com o separador dentro) ----
  const temMais = dados.filter((i) => cels.get(i)!.length > k);
  let excedente_em: number | null = tok.modo === "delimitado" ? (campos.nome ?? campos.codigo ?? null) : null;
  if (temMais.length) {
    // a coluna de texto que absorve o excedente é a que faz as numéricas lerem certo
    const numericas = (["e", "n", "h", "sigma_pos", "sigma_h", "sigma_n", "sigma_e"] as const).map((p) => campos[p]).filter((j): j is number => j !== null);
    // a coluna mais "textual" primeiro: rótulo com vírgula cai na descrição, não
    // num nome que nas outras linhas é só número
    const textual = (j: number) => frac(perfis[j].texto + perfis[j].numeroComTexto, perfis[j].preenchidas || 1);
    const candidatas = [campos.nome, campos.codigo].filter((j): j is number => j !== null).sort((a, b) => textual(b) - textual(a));
    excedente_em = candidatas.find((j) => temMais.every((i) => {
      const c = cels.get(i)!, extra = c.length - k;
      const junta = [...c.slice(0, j), c.slice(j, j + extra + 1).join(";"), ...c.slice(j + extra + 1)];
      return numericas.every((q) => lerNumero(junta[q] ?? "", dec) !== null || !(junta[q] ?? "").trim());
    })) ?? candidatas[0] ?? 0;
  }

  const receita: Receita = {
    versao: 1, registro: "linha", pular_inicio: pular, ignorar,
    tokenizacao: tok.modo, delimitador: tok.modo === "delimitado" ? tok.d : null,
    colunas: k, excedente_em, cortes: null, regex: null, decimal: dec, campos,
    sistema: temUtm ? "utm" : "geografica", fuso: null, hemisferio: "S",
    unidade_sigma: unidade, confianca_sigma: confiancaSigma, nome_formato: nomeFormato,
    ordem: "auto", apoio: [...APOIO_PADRAO], origem: "regras", explicacao: "",
  };

  // ---- execução de prova ----
  const tabela = tabelaDeLinhas(linhas, receita);
  const exec = mapearTabela(tabela, receita, null);
  const validos = exec.pontos.filter((p) => p.origemEN === "utm" ? (p.e >= LIMITES.eMin && p.e <= LIMITES.eMax && p.n >= LIMITES.nMin && p.n <= LIMITES.nMax) : true).length;
  const ilegMeio = exec.ignoradas.filter((x) => x.tipo === "ilegivel" && x.linha - 1 > primeiro && x.linha - 1 < ultimo).length;
  if (ilegMeio) duvidas.push(`${ilegMeio} linha(s) no meio dos pontos não foram lidas`);
  const linhasForaDoPadrao = dados.filter((i) => cels.get(i)!.length < k).length;
  if (linhasForaDoPadrao) duvidas.push(`${linhasForaDoPadrao} linha(s) com menos colunas que as outras`);

  let confianca: Confianca = duvidas.length === 0 ? "alta" : "media";
  if (validos < 3) confianca = "baixa";
  receita.explicacao = explicar(receita, cabecalho, tok);
  const nota = validos * 10 - ilegMeio * 5 - duvidas.length - (tok.modo === "espacos" ? 0.5 : 0) + (cabecalho ? 1 : 0);
  return { deteccao: { receita, confianca, duvidas, pontosValidos: validos }, nota };
}

const NOME_TOK: Record<string, string> = { ";": "ponto e vírgula", ",": "vírgula", "\t": "tabulação", "|": "barra vertical", ":": "dois-pontos" };

function explicar(r: Receita, cabecalho: string[] | null, tok: Tok): string {
  const sep = tok.modo === "espacos" ? "espaços" : NOME_TOK[tok.d];
  const ordem = (Object.entries(r.campos) as [Papel, number | null][])
    .filter(([, j]) => j !== null).sort((a, b) => a[1]! - b[1]!)
    .map(([p]) => ({ nome: "nome", codigo: "código", e: "E", n: "N", h: "altura", lat: "latitude", lon: "longitude", sigma_pos: "σ horizontal", sigma_h: "σ vertical", sigma_n: "σ N", sigma_e: "σ E" } as Record<Papel, string>)[p]);
  const partes = [`Colunas separadas por ${sep}, decimal com ${r.decimal === "," ? "vírgula" : "ponto"}`];
  partes.push(cabecalho ? "com cabeçalho" : "sem cabeçalho");
  partes.push(`na ordem: ${ordem.join(", ")}`);
  if (r.unidade_sigma !== "m") partes.push(`precisões em ${r.unidade_sigma}`);
  if (r.sistema === "geografica") partes.push("coordenadas geográficas convertidas para UTM");
  if (r.nome_formato === "numero_e_rotulo") partes.push("o rótulo vem colado ao número do ponto");
  return partes.join("; ") + ".";
}

/** Melhor receita por regras para um arquivo de texto tabular (null = não achou coordenadas). */
export function detectar(linhas: string[]): Deteccao | null {
  let melhor: Tentativa | null = null;
  for (const tok of TOKS) {
    const decs: ("," | ".")[] = tok.modo === "delimitado" && tok.d === "," ? ["."] : [",", "."];
    for (const dec of decs) {
      let t: Tentativa | null = null;
      try { t = tentar(linhas, tok, dec); } catch { t = null; }
      if (t && (!melhor || t.nota > melhor.nota)) melhor = t;
    }
  }
  return melhor?.deteccao ?? null;
}
