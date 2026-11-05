// Conferência da planilha do SIGEF antes de gerar: o que o SIGEF recusa (erro)
// e o que costuma ser engano de digitação ou de campo (alerta). Lógica pura,
// sobre as linhas da prévia (planilha_sigef.ts) — as mesmas que vão para o ODS.
//
// FONTES DOS LIMITES
//   • Precisão posicional (σ planimétrico, o desvio de latitude/longitude que
//     vai nas colunas "sigma" da planilha): Norma Técnica para
//     Georreferenciamento de Imóveis Rurais (NTGIR), INCRA, 3ª edição (2013,
//     Portaria INCRA nº 486, de 02/09/2013), item 4.4 — vértices em limites
//     ARTIFICIAIS ≤ 0,50 m; em limites NATURAIS ≤ 3,00 m; em limites
//     INACESSÍVEIS ≤ 7,50 m.
//   • Tipos de vértice (M marco, P ponto, V virtual), códigos de limite
//     (LA1–LA7 artificiais, LN1–LN6 naturais) e métodos de posicionamento
//     (PG/PT/PA/PS…): Manual Técnico de Posicionamento e Manual Técnico de
//     Limites e Confrontações (INCRA, 1ª ed., 2013) e as listas de validação da
//     própria planilha oficial (src/lib/domains.ts).
//   • Código do vértice: Anexo A da NTGIR — CÓDIGO DO CREDENCIADO-TIPO-NÚMERO
//     (ex.: DSBN-P-0123), número sequencial por tipo, nunca repetido.
//
// Os limites geométricos (ponto duplicado, lado curto) não são da norma: são
// salvaguardas para o que, na prática, é erro de levantamento ou de digitação.
import { LIMITES, ehCodigoDeConferencia } from "../../supabase/functions/_shared/geo.ts";
import { METODOS_POSICIONAMENTO, TIPOS_LIMITE } from "./domains.ts";
import type { EstiloCodigo } from "../../supabase/functions/_shared/geo.ts";

/** NTGIR 3ª ed., item 4.4 (ver cabeçalho). */
export const SIGMA_MAX_ARTIFICIAL_M = 0.5;
export const SIGMA_MAX_NATURAL_M = 3.0;
export const SIGMA_MAX_INACESSIVEL_M = 7.5;
/** Dois vértices a menos que isso são o mesmo ponto. */
export const DUPLICADO_M = 0.01;
/** Lado mais curto que isso: confira se não é ponto repetido do levantamento. */
export const LADO_CURTO_M = 0.5;

export type Nivel = "erro" | "alerta" | "info";

export interface VerticeApontado {
  aba: string;
  /** posição na aba (0 = primeira linha da planilha) */
  linha: number;
  codigo: string;
  ordemBanco: number | null;
}

export interface AvisoConsistencia {
  nivel: Nivel;
  regra: string;
  mensagem: string;
  vertices: VerticeApontado[];
}

/** O mínimo que a conferência lê de cada linha (LinhaPrevia satisfaz). */
export interface LinhaConferida {
  codigo: string;
  tipo: "M" | "P" | "V";
  inserido: boolean;
  ordemBanco: number | null;
  sigmaPos: number;
  sigmaH: number;
  h: number;
  metodo: string;
  tipoLimite: string;
  descritivo: string;
  iniciaTrecho: boolean;
  eProj: number;
  nProj: number;
  latDeg: number;
  lonDeg: number;
}

export interface AbaConferida {
  aba: string;
  linhas: LinhaConferida[];
  deGleba?: boolean;
  invertido?: boolean;
}

export interface ContextoConferencia {
  estilo: EstiloCodigo;
  /** prefixo do credenciado do serviço (DSBN); null = não escolhido */
  prefixo: string | null;
}

const nivelPeso: Record<Nivel, number> = { erro: 0, alerta: 1, info: 2 };
const RE_OFICIAL = /^([A-Z0-9]+)-([MPV])-(\d+)$/;

const limiteSigma = (tipoLimite: string, tipo: string): number =>
  tipo === "V" ? SIGMA_MAX_INACESSIVEL_M : /^LN/.test(tipoLimite) ? SIGMA_MAX_NATURAL_M : SIGMA_MAX_ARTIFICIAL_M;

const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

/** Os segmentos [a,b] e [c,d] se cruzam (interior com interior)? */
function cruzam(a: LinhaConferida, b: LinhaConferida, c: LinhaConferida, d: LinhaConferida): boolean {
  const o = (p: LinhaConferida, q: LinhaConferida, r: LinhaConferida) =>
    Math.sign((q.eProj - p.eProj) * (r.nProj - p.nProj) - (q.nProj - p.nProj) * (r.eProj - p.eProj));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function conferirAba(a: AbaConferida, ctx: ContextoConferencia): AvisoConsistencia[] {
  const out: AvisoConsistencia[] = [];
  const ls = a.linhas;
  const n = ls.length;
  const ap = (i: number): VerticeApontado => ({ aba: a.aba, linha: i, codigo: ls[i].codigo, ordemBanco: ls[i].ordemBanco });
  const add = (nivel: Nivel, regra: string, mensagem: string, idx: number[] = []) => {
    out.push({ nivel, regra, mensagem, vertices: idx.map(ap) });
  };
  const onde = (filtro: (l: LinhaConferida, i: number) => boolean) => ls.flatMap((l, i) => (filtro(l, i) ? [i] : []));

  if (n < 3) {
    add("erro", "poucos_vertices", `A aba ${a.aba} tem ${n} vértice(s): o SIGEF precisa de pelo menos 3 para fechar o polígono.`);
    return out;
  }

  // ---------------- tipos de vértice ----------------
  if (ls.every((l) => l.tipo === "M")) {
    add("alerta", "todos_m", `Todos os ${n} vértices estão como M (marco). M é o ponto materializado com marco; ponto de cerca ou de divisa natural sem marco é P, e vértice calculado ou inacessível é V. Confira o tipo de cada um.`);
  }
  if (!ls.some((l) => l.tipo === "M")) {
    add("alerta", "sem_m", "Nenhum vértice M: o perímetro inteiro sai como uma confrontação só, sem confrontante. A confrontação começa nos vértices M.");
  }
  const mCalculado = onde((l) => l.tipo === "M" && /^PA/.test(l.metodo));
  if (mCalculado.length) {
    add("alerta", "m_calculado", "Marco (M) com método de posição calculada (PA): se o marco já foi implantado e levantado em campo, troque o método pelo do levantamento.", mCalculado);
  }

  // ---------------- precisão (sigma) ----------------
  const acima = onde((l, i) => {
    const ant = ls[(i - 1 + n) % n];
    // o vértice fica entre dois lados: vale o limite mais exigente dos dois
    const lim = Math.min(limiteSigma(l.tipoLimite, l.tipo), limiteSigma(ant.tipoLimite, l.tipo));
    return l.sigmaPos > lim + 1e-9;
  });
  if (acima.length) {
    const piores = acima.map((i) => ls[i].sigmaPos);
    add("erro", "sigma_acima", `Precisão acima do limite da norma (NTGIR 3ª ed., item 4.4: até 0,50 m em limite artificial, 3,00 m em natural, 7,50 m em inacessível). Pior σ: ${fmt(Math.max(...piores), 3)} m. O SIGEF recusa a planilha.`, acima);
  }
  const zerados = onde((l) => l.tipo !== "V" && !(l.sigmaPos > 0));
  if (zerados.length) {
    add("alerta", "sigma_zero", "Vértice levantado com σ zero: o processamento sempre tem algum desvio. Confira se a coluna de precisão veio no arquivo.", zerados);
  }
  const levantados = ls.filter((l) => l.tipo !== "V" && !l.inserido);
  if (levantados.length >= 4 && levantados.every((l) => l.sigmaPos === levantados[0].sigmaPos && l.sigmaH === levantados[0].sigmaH) && levantados[0].sigmaPos > 0) {
    add("alerta", "sigma_igual", `Todos os vértices levantados têm o mesmo σ (${fmt(levantados[0].sigmaPos, 3)} m / h ${fmt(levantados[0].sigmaH, 3)} m). Costuma ser valor fixo digitado, e não o do processamento de cada ponto: o SIGEF e o analista do cartório desconfiam.`);
  }

  // ---------------- método ----------------
  const metodoRuim = onde((l) => !METODOS_POSICIONAMENTO.includes((l.metodo ?? "").trim()));
  if (metodoRuim.length) {
    add("erro", "metodo_invalido", `Método de posicionamento ausente ou fora da lista do SIGEF (PG1–PG9, PT1–PT8, PA1–PA2, PS1–PS4): ${[...new Set(metodoRuim.map((i) => ls[i].metodo || "vazio"))].join(", ")}.`, metodoRuim);
  }

  // ---------------- códigos ----------------
  const semCodigo = onde((l) => !(l.codigo ?? "").trim());
  if (semCodigo.length) add("erro", "sem_codigo", "Vértice sem código: toda linha da planilha precisa do código do vértice.", semCodigo);
  const porCodigo = new Map<string, number[]>();
  ls.forEach((l, i) => { if (l.codigo) porCodigo.set(l.codigo, [...(porCodigo.get(l.codigo) ?? []), i]); });
  const repetidos = [...porCodigo.values()].filter((v) => v.length > 1).flat();
  if (repetidos.length) {
    add("erro", "codigo_repetido", `Código repetido na planilha: ${[...porCodigo.entries()].filter(([, v]) => v.length > 1).map(([c]) => c).join(", ")}. Cada vértice tem um código único.`, repetidos);
  }
  if (ctx.estilo === "oficial") {
    const formato = onde((l) => !!l.codigo && !RE_OFICIAL.test(l.codigo));
    if (formato.length) add("erro", "codigo_formato", "Código fora do padrão do SIGEF (CREDENCIADO-TIPO-NÚMERO, ex.: DSBN-P-0123).", formato);
    const letraTrocada = onde((l) => {
      const m = RE_OFICIAL.exec(l.codigo ?? "");
      return !!m && m[2] !== l.tipo;
    });
    const letraErro = letraTrocada.filter((i) => !ls[i].inserido);
    const letraVizinho = letraTrocada.filter((i) => ls[i].inserido);
    if (letraErro.length) add("erro", "codigo_tipo", "O tipo no código não bate com o tipo do vértice (ex.: código -P- num vértice M). Renumere ou corrija o tipo.", letraErro);
    if (letraVizinho.length) add("info", "codigo_tipo_vizinho", "Vértice inserido com código de outro tipo (vértice certificado do vizinho igualado a um marco nosso): confira.", letraVizinho);
    if (ctx.prefixo) {
      const outroPrefixo = onde((l) => {
        const m = RE_OFICIAL.exec(l.codigo ?? "");
        return !!m && !l.inserido && m[1] !== ctx.prefixo;
      });
      if (outroPrefixo.length) add("alerta", "codigo_prefixo", `Código com prefixo diferente do credenciado do serviço (${ctx.prefixo}). Só vértice certificado de outro credenciado leva outro prefixo.`, outroPrefixo);
    }
    // sequência por tipo, na ordem da planilha (aba de gleba usa os códigos do imóvel: não conta)
    if (!a.deGleba) {
      const saltos: number[] = [];
      const ultimos: Partial<Record<string, { num: number; i: number }>> = {};
      ls.forEach((l, i) => {
        const m = RE_OFICIAL.exec(l.codigo ?? "");
        if (!m || l.inserido || (ctx.prefixo && m[1] !== ctx.prefixo)) return;
        const num = Number(m[3]);
        const u = ultimos[m[2]];
        if (u && num !== u.num + 1) saltos.push(i);
        ultimos[m[2]] = { num, i };
      });
      if (saltos.length) {
        add("alerta", "codigo_sequencia", "Numeração fora da sequência do credenciado na ordem da planilha (pula ou volta número). Acontece depois de reordenar ou inserir pontos: o SIGEF aceita, mas confira se os números são mesmo deste imóvel.", saltos);
      }
    }
  } else {
    const formato = onde((l) => !!l.codigo && !l.inserido && !ehCodigoDeConferencia(l.codigo));
    if (formato.length) add("alerta", "codigo_formato", "Na conferência de área os códigos saem no formato da prévia (P-1, M-1): estes serão refeitos ao gerar.", formato);
  }

  // ---------------- confrontação / tipo de limite ----------------
  const semLimite = onde((l) => !TIPOS_LIMITE.includes((l.tipoLimite ?? "").trim()));
  if (semLimite.length) add("erro", "sem_tipo_limite", "Vértice sem tipo de limite válido (LA1–LA7, LN1–LN6). O tipo vem da confrontação do vértice M que abre o trecho.", semLimite);
  const semConf = onde((l, i) => (l.iniciaTrecho || (i === 0 && !ls.some((x) => x.iniciaTrecho))) && !(l.descritivo ?? "").trim());
  if (semConf.length) add("alerta", "sem_confrontante", "Confrontação sem confrontante (descritivo vazio): a planilha e o memorial saem sem o nome do vizinho nesse trecho.", semConf);

  // ---------------- coordenadas ----------------
  const fora = onde((l) => l.latDeg < LIMITES.latMin || l.latDeg > LIMITES.latMax || l.lonDeg < LIMITES.lonMin || l.lonDeg > LIMITES.lonMax);
  if (fora.length) add("erro", "fora_do_brasil", "Coordenada fora dos limites aceitos pelo SIGEF (território brasileiro). Confira o fuso UTM e as coordenadas.", fora);
  const hZero = onde((l) => !(l.h !== 0));
  if (hZero.length) add("alerta", "altitude_zero", "Altitude zerada: confira se a coluna de altitude veio no arquivo.", hZero);

  // ---------------- geometria ----------------
  const dist = (i: number, j: number) => Math.hypot(ls[i].eProj - ls[j].eProj, ls[i].nProj - ls[j].nProj);
  if (dist(n - 1, 0) < DUPLICADO_M) {
    add("erro", "fechamento_repetido", "O último vértice repete o primeiro. Na planilha do SIGEF o polígono fecha sozinho: retire o ponto de fechamento.", [n - 1, 0]);
  }
  const duplicados = new Set<number>();
  for (let i = 0; i < n && n <= 4000; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // já tratado como fechamento
      if (dist(i, j) < DUPLICADO_M) { duplicados.add(i); duplicados.add(j); }
    }
  }
  if (duplicados.size) add("erro", "ponto_duplicado", `Vértices no mesmo lugar (menos de ${fmt(DUPLICADO_M * 100, 0)} cm um do outro): ponto repetido no levantamento. Retire a repetição.`, [...duplicados].sort((x, y) => x - y));
  const curtos = onde((_, i) => {
    const d = dist(i, (i + 1) % n);
    return d >= DUPLICADO_M && d < LADO_CURTO_M;
  });
  if (curtos.length) add("alerta", "lado_curto", `Lado com menos de ${fmt(LADO_CURTO_M)} m saindo destes vértices: confira se não é ponto repetido ou erro de coleta.`, curtos);
  const cruzados = new Set<number>();
  if (n <= 3000) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // lados vizinhos pelo fechamento
        if (cruzam(ls[i], ls[(i + 1) % n], ls[j], ls[(j + 1) % n])) { cruzados.add(i); cruzados.add(j); }
      }
    }
  }
  if (cruzados.size) add("erro", "poligono_cruza", "O perímetro cruza a si mesmo (lados que se atravessam): a ordem dos vértices está trocada. Corrija a ordem na tabela de vértices.", [...cruzados].sort((x, y) => x - y));

  // ---------------- sentido e início ----------------
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = ls[i], q = ls[(i + 1) % n];
    area2 += p.eProj * q.nProj - q.eProj * p.nProj;
  }
  if (area2 > 0) add("erro", "sentido", "A planilha está no sentido anti-horário: o SIGEF exige o perímetro descrito no sentido horário.");
  const norte = ls.reduce((m, l, i) => (l.latDeg > ls[m].latDeg ? i : m), 0);
  if (ls[norte].latDeg > ls[0].latDeg + 1e-9) add("erro", "inicio_norte", "A planilha não começa pelo vértice mais ao norte, como exige o SIGEF.", [0, norte]);
  if (a.invertido) add("info", "sentido_invertido", "O arquivo veio no sentido anti-horário: a planilha sai no sentido horário (exigência do SIGEF), começando pelo vértice mais ao norte, e cada confrontação acompanhou a sua divisa.");

  return out;
}

/** Todos os avisos, erros primeiro. */
export function conferirPlanilha(abas: AbaConferida[], ctx: ContextoConferencia): AvisoConsistencia[] {
  return abas.flatMap((a) => conferirAba(a, ctx)).sort((x, y) => nivelPeso[x.nivel] - nivelPeso[y.nivel]);
}

export const contarNiveis = (avisos: AvisoConsistencia[]) => ({
  erros: avisos.filter((a) => a.nivel === "erro").length,
  alertas: avisos.filter((a) => a.nivel === "alerta").length,
});
