// Prévia do SIGEF de um serviço de GLEBAS: um memorial por gleba num PDF só.
//
// O SIGEF não certifica "o imóvel com três glebas": certifica três parcelas.
// A prévia sai como três memoriais emendados, cada um com cabeçalho, área,
// perímetro e anel próprios (ver parseSigefBlocos).
//
// O QUE O SIGEF MANDA E O QUE NÃO MANDA (regra do usuário, 2026-09-09):
// o PDF é fonte de ÁREA e PERÍMETRO, e de mais nada. O DESENHO da planta continua
// nascendo do cálculo do próprio sistema, que é o que funciona — este módulo
// nunca devolve vértice para desenhar, só o número que vai impresso na folha.
// Ver `numerosDoSigefPorAnel` e `numerosTotaisDoSigef`.
//
// O que ele resolve e o resto do sistema não resolvia:
//   1. saber QUAL gleba do sistema é cada memorial (pela geometria, não pelo
//      nome: o operador renomeia a gleba na tela e o SIGEF não fica sabendo);
//   2. nas PEÇAS, usar as coordenadas de cada gleba gleba a gleba — reconciliar
//      tudo de uma vez casaria o vértice de uma gleba com o marco homônimo da
//      vizinha.

import type { DadosSigef, LinhaSigef } from "./sigef_pdf.ts";
import type { GlebaRow } from "./planta_dados.ts";
import { GEO_DEF, fmtBR, utmDef } from "./geo.ts";
import type { Proj4 } from "./geo.ts";

/** "-39°19'35,975\"" → graus decimais. */
export function gmsPdfParaDeg(s: string): number {
  const m = s.match(/(-?)(\d+)°(\d+)'([\d,]+)"/);
  if (!m) throw new Error(`Coordenada inválida no PDF: ${s}`);
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  return m[1] === "-" ? -v : v;
}

/** As linhas de um memorial em UTM do fuso do serviço. */
export function anelDoBloco(linhas: LinhaSigef[], fusoUtm: number, proj4: Proj4): [number, number][] {
  const ud = utmDef(fusoUtm);
  return linhas.map((l) => {
    const [e, n] = proj4(GEO_DEF, ud, [gmsPdfParaDeg(l.lon), gmsPdfParaDeg(l.lat)]);
    return [e, n] as [number, number];
  });
}

/**
 * Até onde um ponto do anel da gleba "é" o mesmo marco que o do PDF.
 *
 * Folgado de propósito, e por motivo diferente do RAIO_CASAMENTO_M de 10 cm: lá
 * se casa vértice com vértice do MESMO cálculo; aqui se compara o E/N gravado na
 * tela com o que sai de reprojetar o GMS do PDF, truncado a 0,001" (~3 cm) e
 * possivelmente de outro ajustamento. Não precisa ser apertado: o que se quer
 * decidir é a QUAL GLEBA o memorial pertence, e duas glebas distam centenas de
 * metros — 1 m separa sem risco de confundir vizinhas.
 */
const RAIO_BLOCO_M = 1.0;

/** Quantos pontos do anel da gleba têm um vértice do bloco a menos de `raio`. */
function pontosEmComum(anelGleba: [number, number][], anelBloco: [number, number][], raio = RAIO_BLOCO_M): number {
  let n = 0;
  for (const [ge, gn] of anelGleba) {
    if (anelBloco.some(([be, bn]) => Math.hypot(be - ge, bn - gn) < raio)) n++;
  }
  return n;
}

/**
 * Para cada anel da lista, qual memorial do PDF o descreve (índice), ou null.
 *
 * Casamento guloso: o par (anel, bloco) com mais pontos em comum fecha primeiro,
 * e nem anel nem bloco entram em dois pares. Nome e ordem são ignorados de
 * propósito — o operador renomeia e reordena glebas na tela, e a ordem em que o
 * SIGEF devolve os memoriais não é promessa de nada.
 */
export function casarBlocosComAneis(
  blocos: DadosSigef[],
  aneis: [number, number][][],
  fusoUtm: number,
  proj4: Proj4,
): (number | null)[] {
  const aneisBloco = blocos.map((b) => anelDoBloco(b.linhas, fusoUtm, proj4));
  const pares: { ai: number; bi: number; comuns: number }[] = [];
  for (let ai = 0; ai < aneis.length; ai++) {
    if (aneis[ai].length < 3) continue;
    for (let bi = 0; bi < blocos.length; bi++) {
      const comuns = pontosEmComum(aneis[ai], aneisBloco[bi]);
      if (comuns >= 3) pares.push({ ai, bi, comuns });
    }
  }
  pares.sort((a, b) => b.comuns - a.comuns);

  const out: (number | null)[] = aneis.map(() => null);
  const blocoUsado = new Set<number>();
  const anelUsado = new Set<number>();
  for (const p of pares) {
    if (anelUsado.has(p.ai) || blocoUsado.has(p.bi)) continue;
    anelUsado.add(p.ai);
    blocoUsado.add(p.bi);
    out[p.ai] = p.bi;
  }
  return out;
}

export interface BlocoDaGleba {
  /** Posição do memorial no PDF (0-based). */
  indiceBloco: number;
  bloco: DadosSigef;
  /** A gleba do sistema que este memorial descreve; null = nenhuma casou. */
  gleba: GlebaRow | null;
  /** Posição da gleba na lista do banco (1-based) — é a que nomeia `satelite-gleba-K`. */
  numeroGleba: number | null;
  /** Nome para o quadro: o da gleba do sistema, ou o que o SIGEF deu. */
  nome: string;
  /** Fração do anel da gleba coberta pelo bloco (0..1); 0 quando não casou. */
  cobertura: number;
}

/**
 * Nome da gleba embutido na denominação do SIGEF.
 * "FAZENDA LAMEIRO DA BOA VISTA - GLEBA 1" → "GLEBA 1". Sem sufixo reconhecível,
 * devolve a denominação inteira — melhor um nome esquisito no quadro do que um
 * quadro em branco.
 */
export function nomeDaDenominacao(denominacao: string, denominacaoImovel: string): string {
  const d = denominacao.trim();
  const base = (denominacaoImovel ?? "").trim();
  if (base && d.toUpperCase().startsWith(base.toUpperCase())) {
    const resto = d.slice(base.length).replace(/^\s*[-–—]\s*/, "").trim();
    if (resto) return resto.toUpperCase();
  }
  const m = d.match(/(GLEBA|PARTE|LOTE)\s*[\wº°]+\s*$/i);
  return (m ? m[0] : d).toUpperCase();
}

/**
 * Casa cada memorial do PDF com uma gleba do sistema PELA GEOMETRIA.
 *
 * Casamento guloso: o par (bloco, gleba) com mais pontos em comum fecha
 * primeiro, e nem bloco nem gleba entram em dois pares. Nome e ordem são
 * ignorados de propósito — o operador renomeia e reordena glebas na tela, e a
 * ordem em que o SIGEF devolve os memoriais não é promessa de nada. Um memorial
 * que não casa com gleba nenhuma continua na lista, com `gleba: null`: ele ainda
 * é uma parte legítima do desenho (área e perímetro vêm do próprio PDF), só não
 * herda a confrontação nem a imagem de satélite que o operador preparou.
 */
export function casarBlocosComGlebas(
  blocos: DadosSigef[],
  glebaRows: GlebaRow[],
  denominacaoImovel: string,
  fusoUtm: number,
  proj4: Proj4,
): BlocoDaGleba[] {
  const glebas = glebaRows
    .map((g, i) => ({ row: g, numero: i + 1, anel: (g.anel ?? []) as [number, number][] }))
    .filter((g) => g.anel.length >= 3);
  const aneisBloco = blocos.map((b) => anelDoBloco(b.linhas, fusoUtm, proj4));

  type Par = { bi: number; gi: number; comuns: number };
  const pares: Par[] = [];
  for (let bi = 0; bi < blocos.length; bi++) {
    for (let gi = 0; gi < glebas.length; gi++) {
      const comuns = pontosEmComum(glebas[gi].anel, aneisBloco[bi]);
      if (comuns >= 3) pares.push({ bi, gi, comuns });
    }
  }
  pares.sort((a, b) => b.comuns - a.comuns);

  const glebaDoBloco = new Map<number, { gi: number; comuns: number }>();
  const blocoUsado = new Set<number>();
  const glebaUsada = new Set<number>();
  for (const p of pares) {
    if (blocoUsado.has(p.bi) || glebaUsada.has(p.gi)) continue;
    blocoUsado.add(p.bi);
    glebaUsada.add(p.gi);
    glebaDoBloco.set(p.bi, { gi: p.gi, comuns: p.comuns });
  }

  return blocos.map((bloco, bi) => {
    const casou = glebaDoBloco.get(bi);
    const g = casou ? glebas[casou.gi] : null;
    const nomeSistema = (g?.row.nome ?? "").trim();
    return {
      indiceBloco: bi,
      bloco,
      gleba: g?.row ?? null,
      numeroGleba: g?.numero ?? null,
      nome: nomeSistema || nomeDaDenominacao(bloco.cabecalho.denominacao, denominacaoImovel),
      cobertura: casou && g ? casou.comuns / g.anel.length : 0,
    };
  });
}

/** Área e perímetro que o SIGEF certificou, já no formato que a planta imprime. */
export interface NumerosSigef {
  areaFmt: string;       // "550,5523"
  tarefasFmt: string;    // "12.639,17"
  perimetroFmt: string;  // "11.753,39"
}

const numerosDoBloco = (b: DadosSigef): NumerosSigef => {
  const ha = parseFloat(b.cabecalho.areaHa.replace(/\./g, "").replace(",", ".")) || 0;
  return {
    areaFmt: b.cabecalho.areaHa,
    tarefasFmt: fmtBR(ha * 10000 / 4356, 2),
    perimetroFmt: b.cabecalho.perimetroM,
  };
};

/**
 * Os NÚMEROS do SIGEF para cada anel — e só eles.
 *
 * O PDF do SIGEF não desenha nada aqui: a planta continua nascendo do cálculo do
 * próprio sistema, que é o que funciona. O que o SIGEF tem de melhor é a área e o
 * perímetro que ele certificou, e é isso — e nada além disso — que deve aparecer
 * impresso na folha. Por isso esta função devolve strings formatadas, uma por
 * anel, e nunca vértices.
 *
 * `aneis` são os anéis das unidades (glebas/partes) na ordem em que a planta as
 * lista. Anel sem memorial correspondente volta como null e mantém o número
 * calculado — a planta não pode ficar sem área só porque o casamento falhou.
 */
export function numerosDoSigefPorAnel(
  blocos: DadosSigef[],
  aneis: [number, number][][],
  fusoUtm: number,
  proj4: Proj4,
): (NumerosSigef | null)[] {
  return casarBlocosComAneis(blocos, aneis, fusoUtm, proj4)
    .map((bi) => (bi === null ? null : numerosDoBloco(blocos[bi])));
}

/**
 * Os números do imóvel INTEIRO: área somada das glebas (o usuário confirmou que
 * a área total é a soma) e perímetro só quando o PDF descreve um anel único —
 * com glebas o perímetro é individual, e somá-lo daria um número que não é o
 * contorno de nada. `perimetroFmt` null = a planta mantém o perímetro calculado.
 */
export function numerosTotaisDoSigef(blocos: DadosSigef[]): { areaFmt: string; tarefasFmt: string; perimetroFmt: string | null } {
  if (blocos.length === 1) return { ...numerosDoBloco(blocos[0]), perimetroFmt: blocos[0].cabecalho.perimetroM };
  const ha = areaTotalHa(blocos);
  return { areaFmt: fmtBR(ha, 4), tarefasFmt: fmtBR(ha * 10000 / 4356, 2), perimetroFmt: null };
}

/**
 * Área total do imóvel em ha: a SOMA das glebas.
 *
 * O perímetro NÃO tem equivalente: ele é individual por gleba e somá-lo daria um
 * número que não é o contorno de nada. A planta lista um perímetro por gleba.
 */
export function areaTotalHa(blocos: DadosSigef[]): number {
  return blocos.reduce(
    (s, b) => s + (parseFloat(b.cabecalho.areaHa.replace(/\./g, "").replace(",", ".")) || 0),
    0,
  );
}

/**
 * Avisos para o operador sobre o casamento — memorial sem gleba, gleba sem
 * memorial, contorno que só casou em parte. Nenhum deles impede a geração: são
 * o que ele precisa ver para saber se o que saiu é o que ele desenhou.
 */
export function avisosDoCasamento(casados: BlocoDaGleba[], glebaRows: GlebaRow[]): string[] {
  const avisos: string[] = [];
  const validas = glebaRows.filter((g) => (g.anel?.length ?? 0) >= 3);
  for (const c of casados) {
    if (!c.gleba) {
      avisos.push(
        `O memorial "${c.bloco.cabecalho.denominacao}" do PDF não casou com nenhuma gleba desenhada: ` +
        `ele entra na planta com a área e o perímetro do SIGEF, mas sem a confrontação e sem a imagem de satélite da gleba.`,
      );
    } else if (c.cobertura < 0.9) {
      avisos.push(
        `${c.nome}: só ${Math.round(c.cobertura * 100)}% dos pontos do contorno desenhado batem com o memorial do SIGEF — ` +
        `confira se a gleba foi dividida antes de enviar ao SIGEF.`,
      );
    }
  }
  const casadas = new Set(casados.map((c) => c.numeroGleba).filter((n) => n !== null));
  validas.forEach((g, i) => {
    if (!casadas.has(i + 1)) {
      avisos.push(`A gleba "${(g.nome ?? "").trim() || `GLEBA ${i + 1}`}" não tem memorial correspondente no PDF do SIGEF e ficou fora da planta.`);
    }
  });
  return avisos;
}
