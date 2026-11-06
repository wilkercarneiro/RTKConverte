// As tarefas da análise (uma por fonte), montadas para que "tentar de novo"
// chame a fonte DE NOVO. O município é pedido uma vez só e repartido entre
// quem precisa dele (a tile Município e a UF do SIGEF/CAR); se o IBGE falhar,
// a promessa rejeitada é descartada e o próximo pedido vai ao IBGE outra vez —
// assim o "tentar de novo" do Município funciona e, quando ele volta, o SIGEF
// que ficou "só na base local (falta a UF)" pode ser refeito com a UF certa.
import type { Municipio } from "./ambiente.ts";
import type { Analise, ChaveFonte } from "./analise.ts";
import type { FontesConsulta } from "./fontes.ts";
import type { LonLat, Medidas } from "./geometria.ts";
import type { ImovelEncontrado } from "./tipos.ts";

export type Tarefas = Record<ChaveFonte, () => Promise<unknown>>;

export function montarTarefas(fontes: FontesConsulta, im: ImovelEncontrado, medidas: Medidas, centro: LonLat, municipio: Municipio | null = null): Tarefas {
  // o município já veio da busca pelo ponto: não pergunta de novo
  let mun: Promise<Municipio | null> | null = municipio ? Promise.resolve(municipio) : null;
  const pegarMun = (): Promise<Municipio | null> => {
    if (mun) return mun;
    const p = fontes.municipio(centro[0], centro[1]);
    mun = p;
    // falhou: esquece, para o próximo pedido (tentar de novo) ir ao IBGE outra vez
    p.catch(() => { if (mun === p) mun = null; });
    return p;
  };
  // a UF na hora do pedido: a do imóvel, senão a do município (que pode ter voltado a responder)
  const uf = async () => im.uf ?? (await pegarMun().catch(() => null))?.uf ?? null;
  return {
    restricoes: () => fontes.restricoes(im.aneis, medidas.fuso),
    sigef: async () => fontes.sigefNaArea(im.aneis, await uf(), im.fonte === "sigef" ? im.codigo : null),
    car: async () => fontes.carNaArea(im.aneis, await uf(), im.fonte === "car" ? im.codigo : null),
    focos: () => fontes.focos(im.aneis),
    clima: () => fontes.clima(centro[0], centro[1]),
    solo: () => fontes.solo(centro[0], centro[1]),
    bioma: () => fontes.bioma(centro[0], centro[1]),
    municipio: () => pegarMun(),
  };
}

/** O município acabou de responder: as fontes que rodaram sem a UF e valem ser refeitas agora. */
export function fontesQueEsperavamUf(a: Analise): ChaveFonte[] {
  if (a.imovel.uf || a.municipio.estado !== "ok" || !a.municipio.dados?.uf) return [];
  return a.sigef.estado === "ok" && a.sigef.dados.online === "sem-uf" ? ["sigef"] : [];
}
