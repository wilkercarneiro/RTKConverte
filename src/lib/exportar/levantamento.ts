// "TXT do levantamento": a área do serviço no formato de sempre das coletoras da
// equipe — `NÚMERO[ RÓTULO];E;N;h;σpos;σh`, ";" e vírgula decimal, sem
// cabeçalho. É o formato que o leitor (supabase/functions/_shared/leitor)
// reconhece sozinho como "Formato da equipe", com confiança alta e sem IA.
//
// Para que serve: levar a área de um serviço para outro (fazer a divisão de um
// serviço completo, lotear a gleba, conferir de novo) sem perder nada que o
// novo serviço precise. Ao contrário do TXT da coletora (P,E,N,Z,D), este:
//   • leva a altitude e as duas precisões (σ) de cada vértice — o leitor não
//     pede de novo; vértice sem altitude/σ sai com a célula vazia, e a prévia
//     oferece completar (configuração do GPS + altitude pelo relevo);
//   • leva o confrontante: o vértice M sai com o nome do confrontante como
//     rótulo (o rótulo é o que faz o ponto voltar como M e abrir o trecho);
//     M sem nome sai com "V" (continua M, sem nome — RE_ROTULO_SO_ANOTACAO);
//     os demais saem sem rótulo (voltam como P);
//   • leva as PARTES: cada polígono do perímetro numerado num bloco de centena
//     (1…, 100…, 200…), a regra de partes do leitor (blocosPorCentena).
//
// Os anéis saem como a camada do perímetro os tem: no GEO, a ordem do memorial
// (horário, do vértice mais ao norte). O código oficial do vértice NÃO vai: o
// serviço novo numera os seus (é outro serviço, com outra numeração).
import type { CamadaPronta, FeicaoPronta } from "./coordenadas.ts";

/** Camadas que são o perímetro do imóvel, por modalidade (GEO, loteamento, CAR). */
const PERIMETROS = ["PERIMETRO", "GLEBA", "AREA_IMOVEL"];

const chave = (u: [number, number]) => `${Math.round(u[0] * 1000)},${Math.round(u[1] * 1000)}`;
const br = (v: number, casas: number) => v.toFixed(casas).replace(".", ",");

/** Rótulo que o leitor relê inteiro: sem o separador, sem "/" (que corta o apelido), numa linha. */
export function rotuloLevantamento(s: string | null | undefined): string {
  return String(s ?? "").replace(/[;/\\\t\r\n|]+/g, " - ").replace(/\s+/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").slice(0, 60);
}

/** Os polígonos do perímetro: a primeira camada conhecida que tiver; senão, a primeira com polígono. */
export function aneisDoPerimetro(camadas: CamadaPronta[]): FeicaoPronta[] {
  for (const nome of PERIMETROS) {
    const pols = camadas.find((c) => c.nome === nome)?.feicoes.filter((f) => f.tipo === "poligono") ?? [];
    if (pols.length) return pols;
  }
  return camadas.flatMap((c) => c.feicoes.filter((f) => f.tipo === "poligono")).slice(0, 1);
}

export interface ResumoLevantamento { texto: string; pontos: number; partes: number; semAltura: number; semSigma: number }

export function gerarTxtLevantamento(camadas: CamadaPronta[]): ResumoLevantamento {
  const aneis = aneisDoPerimetro(camadas);
  if (!aneis.length) throw new Error("O serviço não tem o perímetro da área para exportar.");
  // os pontos com nome (vértices) dizem o tipo e a precisão de cada canto do anel
  const pontos = new Map<string, FeicaoPronta>();
  for (const c of camadas) for (const f of c.feicoes) if (f.tipo === "ponto" && !pontos.has(chave(f.utm[0]))) pontos.set(chave(f.utm[0]), f);

  // blocos de centena maiores que a maior parte: 1–75, 100–123, 200–228…
  const maior = Math.max(...aneis.map((a) => a.utm.length));
  const passo = 100 * Math.ceil((maior + 2) / 100);
  const linhas: string[] = [];
  let semAltura = 0, semSigma = 0;
  aneis.forEach((anel, p) => {
    const base = p === 0 ? 1 : p * passo;
    anel.utm.forEach((u, i) => {
      const ponto = pontos.get(chave(u));
      const tipo = ponto?.props.tipo;
      const rotulo = tipo === "M" ? rotuloLevantamento(anel.confrontantes[i]) || "V" : "";
      const h = anel.alt[i] ?? ponto?.alt[0] ?? null;
      const s = ponto?.sigma ?? null;
      if (h === null) semAltura++;
      if (!s) semSigma++;
      linhas.push([
        `${base + i}${rotulo ? ` ${rotulo}` : ""}`,
        br(u[0], 3), br(u[1], 3),
        h === null ? "" : br(h, 3),
        s ? br(s.pos, 3) : "", s ? br(s.h, 3) : "",
      ].join(";"));
    });
  });
  return { texto: linhas.join("\r\n") + "\r\n", pontos: linhas.length, partes: aneis.length, semAltura, semSigma };
}
