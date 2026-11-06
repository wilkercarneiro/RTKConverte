// A área que chega na Consulta vinda de outra ferramenta (Medir no campo,
// arquivo, o "← Voltar" do CAR novo) e o que a Consulta repassa ao CAR.
//
// A medição de campo chega com a origem já pronta ("Medição de campo de hoje
// 14:32 · GPS do celular ±3,3 m") e a frase do CAR ("Área medida no campo hoje
// às 14:32 (GPS do celular, ±3,3 m)"). A Consulta guarda as duas COMO VIERAM e
// repassa iguais: Campo → Consulta → CAR → Voltar → CAR mostra a mesma frase do
// caminho direto Campo → CAR, sem acumular sufixo a cada ida e volta. Puro.
import type { AreaTransferida } from "../area_transferida.ts";
import type { ImovelEncontrado } from "./tipos.ts";

/** A área recebida como imóvel da lista da Consulta. */
export function imovelDaAreaRecebida(vinda: AreaTransferida, id = `vinda:${Date.now()}`): ImovelEncontrado {
  const campo = /campo/i.test(vinda.origem);
  return {
    id, fonte: campo ? "campo" : "arquivo", codigo: null, titulo: vinda.nome || "Área recebida",
    aneis: [vinda.perimetro], poligonos: [[vinda.perimetro]], furos: 0, nomes: vinda.nomes, areaDeclaradaHa: null,
    municipio: vinda.municipio ?? null, uf: vinda.uf ?? null, atualizacao: null, situacao: vinda.origem, detalhes: [],
    levada: { origem: vinda.origem, ...(vinda.frase ? { frase: vinda.frase } : {}) },
  };
}

/** De onde a área veio, para o aviso do CAR novo. A que veio de outra ferramenta segue com a origem e a frase dela. */
export function origemParaOCar(im: ImovelEncontrado): { origem: string; frase?: string } {
  if (im.levada) return { ...im.levada };
  if (im.fonte === "car") return { origem: `CAR ${im.codigo} (declarado no SICAR${im.situacao ? `, ${im.situacao.toLowerCase()}` : ""})` };
  if (im.fonte === "sigef") return { origem: `parcela certificada ${im.codigo} (SIGEF)` };
  return { origem: `${im.titulo} (Consultar imóvel)` };
}
