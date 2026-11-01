// Executor: aplica uma receita às linhas do arquivo. Determinístico e sem
// adivinhação: cada número de cada ponto é copiado de um trecho do texto
// original, e esse trecho (linha + texto bruto) fica guardado em `fontes` —
// é o que o validador usa para provar a procedência (V1).
//
// Toda linha não vazia termina em UM de dois lugares: vira ponto, ou vai para
// `ignoradas` com o motivo. É a cobertura de 100% (V2).
import { GEO_DEF, utmDef } from "../geo.ts";
import type { Proj4 } from "../geo.ts";
import { PAPEIS } from "./receita.ts";
import type { Campos, Papel, Receita } from "./receita.ts";
import { lerAngulo, lerNumero, limparToken } from "./numeros.ts";

/** De onde veio um valor: `bruto` é um trecho literal da linha `linha` do
 *  arquivo; `valor` é o texto decodificado quando difere do bruto (ex.: GSI
 *  "+00005387" em mm → "5.387"). */
export interface Fonte { linha: number; bruto: string; valor?: string }

export interface PontoLido {
  /** Posição do ponto no arquivo (0-based, só entre os pontos). */
  idx: number;
  /** Linha do arquivo (1-based). */
  linha: number;
  /** Identificador como veio ("1", "5", "postp_1", "M-01"). */
  nome: string;
  /** Número do ponto (do nome) — null quando o nome não é numérico. */
  num: number | null;
  rotulo: string | null;
  e: number;
  n: number;
  h: number | null;
  sigmaPos: number | null;
  sigmaH: number | null;
  /** Coordenada geográfica lida (graus decimais), quando o arquivo a trazia. */
  geo: { lat: number; lon: number } | null;
  /** E/N vieram do arquivo (utm) ou foram calculados da geográfica (geo). */
  origemEN: "utm" | "geo";
  fontes: Partial<Record<Papel, Fonte>>;
  /** Ponto de apoio (base/referência): fora do perímetro. */
  apoio: boolean;
}

export type TipoIgnorada = "topo" | "padrao" | "cabecalho" | "ilegivel" | "repetido" | "excluido";

export interface LinhaIgnorada { linha: number; texto: string; motivo: string; tipo: TipoIgnorada }

export type NivelAviso = "bloqueio" | "alerta" | "info";
export interface Aviso { codigo: string; nivel: NivelAviso; mensagem: string; linhas?: number[] }

/** Uma linha já quebrada em células (de texto, planilha ou extrator de formato).
 *  `brutos`, quando presente, traz o trecho literal do arquivo de cada célula
 *  e `linhas` a linha de origem de cada célula (formatos de várias linhas). */
export interface LinhaTabela {
  linha: number; texto: string; celulas: string[]; partesExcedente?: string[];
  brutos?: (string | null)[]; linhas?: (number | null)[];
}

export interface Tabela {
  linhas: LinhaTabela[];
  ignoradas: LinhaIgnorada[];
  avisos: Aviso[];
}

export interface ResultadoExecucao {
  pontos: PontoLido[];
  ignoradas: LinhaIgnorada[];
  avisos: Aviso[];
  /** Fuso usado para converter geográficas (null se tudo veio em UTM). */
  fusoGeo: number | null;
}

// ---------------------------------------------------------------------------
// Tokenização (registro "linha")
// ---------------------------------------------------------------------------

/**
 * Divide por um delimitador respeitando aspas como no CSV: aspas só abrem um
 * campo quando vêm no INÍCIO dele ("Ponto, 1";…). No meio do campo são texto —
 * é o símbolo de segundos de 15°33'18,9"S.
 */
export function dividirDelimitado(linha: string, d: string): string[] {
  if (!linha.includes("\"")) return linha.split(d);
  const out: string[] = [];
  let i = 0;
  while (i <= linha.length) {
    // espaços antes das aspas de abertura são tolerados
    let j = i;
    while (j < linha.length && linha[j] === " ") j++;
    if (linha[j] === "\"") {
      let cur = "", k = j + 1, fechou = false;
      while (k < linha.length) {
        if (linha[k] === "\"") {
          if (linha[k + 1] === "\"") { cur += "\""; k += 2; continue; }
          fechou = true; k++; break;
        }
        cur += linha[k++];
      }
      // depois das aspas de fechamento só pode vir espaço e o delimitador
      let m = k;
      while (m < linha.length && linha[m] === " ") m++;
      if (fechou && (m >= linha.length || linha[m] === d)) {
        out.push(cur);
        i = m + 1;
        if (m >= linha.length) return out;
        continue;
      }
    }
    const fim = linha.indexOf(d, i);
    if (fim < 0) { out.push(linha.slice(i)); return out; }
    out.push(linha.slice(i, fim));
    i = fim + 1;
  }
  return out;
}

export function dividirEspacos(linha: string): string[] {
  const t = linha.trim();
  if (!t) return [];
  if (!t.includes("\"")) return t.split(/\s+/);
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push(m[1] ?? m[2]);
  return out;
}

const compilarI = (p: string) => new RegExp(p, "i");

/** Quebra as linhas do arquivo conforme a receita (registro "linha"). */
export function tabelaDeLinhas(linhas: string[], r: Receita): Tabela {
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  const ignorar = r.ignorar.map(compilarI);
  const re = r.tokenizacao === "regex" && r.regex ? compilarI(r.regex) : null;
  linhas.forEach((texto, i) => {
    const linha = i + 1;
    if (!texto.trim()) return;
    if (i < r.pular_inicio) { tabela.ignoradas.push({ linha, texto, motivo: "início do arquivo (cabeçalho/metadados)", tipo: "topo" }); return; }
    const pad = ignorar.find((x) => x.test(texto));
    if (pad) { tabela.ignoradas.push({ linha, texto, motivo: `não é ponto (padrão ${pad.source})`, tipo: "padrao" }); return; }
    let celulas: string[];
    let partesExcedente: string[] | undefined;
    if (r.tokenizacao === "regex") {
      if (texto.length > 2000) { tabela.ignoradas.push({ linha, texto: texto.slice(0, 200), motivo: "linha longa demais", tipo: "ilegivel" }); return; }
      const m = texto.match(re!);
      if (!m || !m.groups) { tabela.ignoradas.push({ linha, texto, motivo: "a linha não segue o padrão dos pontos", tipo: "ilegivel" }); return; }
      celulas = PAPEIS.map((p) => m.groups![p] ?? "");
    } else if (r.tokenizacao === "largura_fixa") {
      const c = r.cortes!;
      celulas = c.map((ini, k) => texto.slice(ini, k + 1 < c.length ? c[k + 1] : undefined));
    } else {
      celulas = r.tokenizacao === "espacos" ? dividirEspacos(texto) : dividirDelimitado(texto, r.delimitador!);
      // separador sobrando no fim ("1;2;3;") não é coluna
      while (celulas.length > (r.colunas ?? 0) && celulas.length > 1 && celulas[celulas.length - 1].trim() === "") celulas.pop();
      const k = r.colunas;
      if (k !== null && celulas.length > k && r.excedente_em !== null && r.excedente_em < k) {
        const j = r.excedente_em, extra = celulas.length - k;
        partesExcedente = celulas.slice(j, j + extra + 1);
        const sep = r.tokenizacao === "espacos" ? " " : r.delimitador!;
        celulas = [...celulas.slice(0, j), partesExcedente.join(sep), ...celulas.slice(j + extra + 1)];
      }
    }
    tabela.linhas.push({ linha, texto, celulas, partesExcedente });
  });
  return tabela;
}

/** Em modo regex as células vêm na ordem de PAPEIS: os campos são os índices. */
export function camposDaRegex(r: Receita): Campos {
  const c = { ...r.campos };
  const grupos = new Set([...(r.regex ?? "").matchAll(/\(\?<([a-z_]+)>/g)].map((m) => m[1]));
  for (const [i, p] of PAPEIS.entries()) c[p] = grupos.has(p) ? i : null;
  return c;
}

// ---------------------------------------------------------------------------
// Mapeamento: células → ponto
// ---------------------------------------------------------------------------

const zonaDaLongitude = (lon: number) => Math.floor((lon + 180) / 6) + 1;
const FATOR_SIGMA = { m: 1, cm: 0.01, mm: 0.001 } as const;

/**
 * Aplica a receita a uma tabela já quebrada. `proj4` só é usado quando há
 * coordenada geográfica a converter.
 */
export function mapearTabela(tabela: Tabela, r: Receita, proj4: Proj4 | null): ResultadoExecucao {
  const campos = r.tokenizacao === "regex" ? camposDaRegex(r) : r.campos;
  const pontos: PontoLido[] = [];
  const ignoradas = [...tabela.ignoradas];
  const avisos = [...tabela.avisos];
  const lonSemSinal: number[] = [], latSemSinal: number[] = [], numsExtrasDescartados: number[] = [];
  const pendentesGeo: PontoLido[] = [];

  for (const lt of tabela.linhas) {
    const cel = (p: Papel): Fonte | null => {
      const c = campos[p];
      if (c === null || c >= lt.celulas.length) return null;
      const texto = lt.celulas[c];
      if (texto.trim() === "") return null;
      const bruto = lt.brutos?.[c];
      const linha = lt.linhas?.[c] ?? lt.linha;
      return bruto != null && bruto !== texto ? { linha, bruto, valor: texto } : { linha, bruto: texto };
    };
    const txt = (f: Fonte) => f.valor ?? f.bruto;
    const ilegivel = (motivo: string) => ignoradas.push({ linha: lt.linha, texto: lt.texto, motivo, tipo: "ilegivel" });
    const fontes: Partial<Record<Papel, Fonte>> = {};
    const num = (p: Papel): number | null | "erro" => {
      const f = cel(p);
      if (!f) return null;
      const v = lerNumero(txt(f), r.decimal);
      if (v === null) return "erro";
      fontes[p] = f;
      return v;
    };

    // ---- coordenadas ----
    let e: number | null = null, n: number | null = null, geo: { lat: number; lon: number } | null = null;
    const fe = cel("e"), fn = cel("n");
    if (fe && fn) {
      const ve = num("e"), vn = num("n");
      if (ve === "erro" || vn === "erro") { ilegivel(`coordenada E/N não é número: "${(ve === "erro" ? fe : fn).bruto.trim()}"`); continue; }
      e = ve; n = vn;
    }
    const fla = cel("lat"), flo = cel("lon");
    if (fla && flo) {
      const a = lerAngulo(txt(fla), "lat", r.decimal), o = lerAngulo(txt(flo), "lon", r.decimal);
      if (!a || !o) {
        if (e === null) { ilegivel(`latitude/longitude não lida: "${(!a ? fla : flo).bruto.trim()}"`); continue; }
      } else {
        let lat = a.graus, lon = o.graus;
        if (!o.hemisferioExplicito && lon > 0) { lon = -lon; lonSemSinal.push(lt.linha); }
        if (!a.hemisferioExplicito && lat > 0 && r.hemisferio === "S") { lat = -lat; latSemSinal.push(lt.linha); }
        geo = { lat, lon };
        fontes.lat = fla; fontes.lon = flo;
      }
    }
    if (e === null && geo === null) {
      // linha sem coordenada nenhuma: célula vazia onde deveria haver número
      ilegivel(fe || fn || fla || flo ? "coordenada incompleta na linha" : "linha sem coordenadas");
      continue;
    }

    // ---- altura e precisões ----
    const h = num("h");
    if (h === "erro") { ilegivel(`altura não é número: "${cel("h")!.bruto.trim()}"`); continue; }
    const fs = FATOR_SIGMA[r.unidade_sigma];
    const sp = num("sigma_pos"), sh = num("sigma_h"), sn = num("sigma_n"), se = num("sigma_e");
    const ruim = ([["sigma_pos", sp], ["sigma_h", sh], ["sigma_n", sn], ["sigma_e", se]] as const).find(([, v]) => v === "erro");
    if (ruim) { ilegivel(`precisão não é número: "${cel(ruim[0])!.bruto.trim()}"`); continue; }
    let sigmaPos: number | null = sp as number | null;
    if (sigmaPos === null && (sn !== null || se !== null)) sigmaPos = Math.max((sn as number | null) ?? 0, (se as number | null) ?? 0);
    if (sigmaPos !== null) sigmaPos = arred(sigmaPos * fs);
    const sigmaH = sh === null ? null : arred((sh as number) * fs);

    // ---- nome, número e rótulo ----
    const fNome = cel("nome");
    let nomeBruto = fNome ? txt(fNome) : "";
    if (fNome && lt.partesExcedente && campos.nome !== null && campos.nome === r.excedente_em) {
      // linha com colunas a mais coladas no nome: números a mais só saem se
      // forem REPETIÇÃO dos valores da própria linha (E/N duplicados)
      const [primeira, ...resto] = lt.partesExcedente;
      const numericas = resto.map((x) => lerNumero(x, r.decimal));
      if (resto.length && numericas.every((v) => v !== null)) {
        const daLinha = new Set([e, n, h].filter((v): v is number => typeof v === "number").map((v) => v.toFixed(4)));
        if (numericas.every((v) => daLinha.has((v as number).toFixed(4)))) {
          nomeBruto = primeira; numsExtrasDescartados.push(lt.linha);
        } else {
          ilegivel(`a linha tem números a mais que não são repetição das coordenadas: ${resto.join(r.delimitador ?? " ")}`);
          continue;
        }
      }
    }
    // nome: sem aspas e sem rótulo de chave antes de um NÚMERO ("PT=17", "ID: 5")
    // — "Base: estação" fica inteiro (é o que identifica o ponto de apoio)
    const nomeLimpo = nomeBruto.trim().replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").trim()
      .replace(/^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ_ ]{0,14}\s*[:=]\s*(?=\d)/, "");
    let nome = nomeLimpo, numero: number | null = null, rotuloNome: string | null = null;
    if (r.nome_formato === "numero_e_rotulo") {
      const m = nomeLimpo.match(/^(\d+)\s*(.*)$/s);
      if (m) { numero = parseInt(m[1], 10); nome = m[1]; rotuloNome = m[2].trim() || null; }
    } else if (/^\d+$/.test(nome)) numero = parseInt(nome, 10);
    if (fNome) fontes.nome = fNome;
    const fCod = cel("codigo");
    const codigo = fCod ? limparToken(txt(fCod)) : "";
    if (fCod) fontes.codigo = fCod;
    const rotulo = [rotuloNome, codigo].filter((x) => x && x.trim()).join(" ").trim() || null;

    const p: PontoLido = {
      idx: pontos.length, linha: lt.linha, nome, num: numero, rotulo,
      e: e ?? NaN, n: n ?? NaN, h: h as number | null, sigmaPos, sigmaH,
      geo, origemEN: e !== null ? "utm" : "geo", fontes, apoio: false,
    };
    pontos.push(p);
    if (e === null) pendentesGeo.push(p);
  }

  // ---- geográficas → UTM (um fuso para o arquivo todo) ----
  let fusoGeo: number | null = null;
  if (pendentesGeo.length) {
    const comGeo = pontos.filter((p) => p.geo);
    const lonMedia = comGeo.reduce((s, p) => s + p.geo!.lon, 0) / comGeo.length;
    fusoGeo = r.fuso ?? zonaDaLongitude(lonMedia);
    // sem proj4 (detector só contando pontos) a conversão fica para a leitura de verdade
    if (proj4) {
      const ud = utmDef(fusoGeo);
      for (const p of pendentesGeo) {
        const [x, y] = proj4(GEO_DEF, ud, [p.geo!.lon, p.geo!.lat]);
        p.e = arred(x, 3); p.n = arred(y, 3);
      }
    }
  }

  if (lonSemSinal.length) avisos.push({ codigo: "lon_sem_sinal", nivel: "info", mensagem: `Longitude sem sinal nem letra: assumida Oeste (todo o Brasil é Oeste).`, linhas: lonSemSinal });
  if (latSemSinal.length) avisos.push({ codigo: "lat_sem_sinal", nivel: "alerta", mensagem: `Latitude sem sinal nem letra: assumida Sul. Se o imóvel fica ao norte do Equador, corrija o hemisfério.`, linhas: latSemSinal });
  if (numsExtrasDescartados.length) avisos.push({ codigo: "coordenada_repetida_na_linha", nivel: "alerta", mensagem: "Linha com as coordenadas repetidas duas vezes: a cópia a mais foi descartada (os valores são idênticos).", linhas: numsExtrasDescartados });
  if (r.confianca_sigma === "95" && pontos.some((p) => p.sigmaPos !== null)) {
    avisos.push({ codigo: "sigma_95", nivel: "alerta", mensagem: "As precisões do arquivo são a 95% (ex.: relatório do IBGE-PPP), não 1σ. Foram gravadas como vieram; confira com o responsável técnico." });
  }
  return { pontos, ignoradas, avisos, fusoGeo };
}

function arred(v: number, casas = 6): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}
