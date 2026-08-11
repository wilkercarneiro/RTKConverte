// `DadosPecas` a partir do cálculo do próprio sistema, sem PDF do SIGEF.
//
// Existe porque DOIS geradores precisam do mesmo pacote de dados:
//   · gerar-pecas com `origem: "calculo"` — a conferência de área, que tira as
//     peças antes de mandar qualquer coisa ao SIGEF;
//   · gerar-documentos — o Memorial Descritivo, que sai do MESMO modelo .docx da
//     peça 1 e por isso precisa exatamente dos mesmos campos.
//
// Antes esse bloco morava dentro de gerar-pecas. Ao fazer o memorial sair do
// modelo da peça 1, copiá-lo para a outra function criaria duas montagens do
// mesmo objeto — e a primeira divergência entre elas apareceria como um campo
// preenchido numa peça e vazio na outra, sem nada no código dizendo qual está
// certa.
import { montarTrechosPecas } from "./pecas.ts";
import type { DadosPecas, Requerente } from "./pecas.ts";
import { geometriaDoCalculo, sigefDoCalculo } from "./planta_dados.ts";
import type { CredRow, RtRow, ServicoRow } from "./planta_dados.ts";
import type { ServicoCalculado } from "./servico.ts";

export interface ContextoPecas {
  servico: ServicoRow & Record<string, unknown>;
  rt: (RtRow & Record<string, unknown>) | null;
  cred: CredRow | null;
  calc: ServicoCalculado;
  dataStr: string;
}

export function montarDadosPecasDoCalculo(ctx: ContextoPecas): DadosPecas {
  const { servico, rt, cred, calc } = ctx;
  const s = servico as Record<string, string | number | boolean | null | undefined>;
  const posse = servico.tipo_imovel === "posse";
  // TRT preenchido no sistema manda: campo do serviço, depois o TRT padrão do RT.
  const trt = String(s.trt ?? "").trim() || String((rt as Record<string, unknown> | null)?.trt ?? "").trim();

  // A confrontação de cada vértice sai do trecho a que ele pertence — a mesma
  // invariante "de M a M" do resto do sistema (ARQUITETURA-TRECHOS.md).
  const descPorCodigo = new Map(calc.ring.map((v) => [v.codigo, v.trecho.descritivo]));
  const sigef = sigefDoCalculo(geometriaDoCalculo(calc), {
    servico,
    rt,
    cred,
    trt,
    confrontacaoDe: (c) => descPorCodigo.get(c) ?? "",
  });
  const inicios = new Map(
    calc.ring
      .filter((v) => v.iniciaTrecho)
      .map((v) => [v.codigo, {
        descritivo: v.iniciaTrecho!.descritivo,
        tipoLimite: v.iniciaTrecho!.tipoLimite,
        ehVia: v.iniciaTrecho!.ehVia,
      }]),
  );
  const { trechos, confrontacaoDe } = montarTrechosPecas(sigef.linhas, inicios);

  const requerentes: Requerente[] = [{
    nome: String(s.detentor_nome ?? ""),
    cpf: String(s.detentor_cpf ?? ""),
    genero: s.detentor_genero === "F" ? "F" : "M",
    isEspolio: !!s.is_espolio,
    inventarianteNome: (s.inventariante_nome as string | null) ?? null,
    inventarianteCpf: (s.inventariante_cpf as string | null) ?? null,
    inventarianteRg: (s.inventariante_rg as string | null) ?? null,
  }];
  // segundo requerente não existe em posse: lá quem assina é o posseiro
  if (s.requerente2_nome && !posse) {
    requerentes.push({
      nome: String(s.requerente2_nome),
      cpf: String(s.requerente2_cpf ?? ""),
      genero: s.requerente2_genero === "F" ? "F" : "M",
    });
  }

  const r = rt as Record<string, string | null> | null;
  return {
    requerentes,
    rg: (s.detentor_rg as string | null) ?? null,
    endereco: String(s.endereco_detentor ?? ""),
    municipio: String(s.municipio ?? ""),
    uf: String(s.uf ?? ""),
    denominacao: String(s.denominacao ?? ""),
    matricula: String(s.matricula ?? ""),
    cns: String(s.cns ?? ""),
    sncrFmt: String(s.codigo_sncr ?? ""),
    sncrNum: String(s.codigo_sncr ?? "").replace(/\D/g, ""),
    areaHa: sigef.cabecalho.areaHa,
    perimetro: sigef.cabecalho.perimetroM,
    // vem do banco como veio: o gerador das peças formata, não converte
    areaMatriculaHa: (s.area_matricula_ha as string | null) ?? null,
    mcAbs: Math.abs(6 * Number(s.fuso_utm ?? 24) - 183),
    trt,
    dataStr: ctx.dataStr,
    rt: {
      nome: r?.nome ?? "",
      formacao: r?.formacao ?? "",
      conselhoSigla: r?.conselho_sigla ?? "CFTA",
      conselhoNumero: r?.conselho_numero ?? "",
      identidade: r?.identidade ?? "",
      cpf: r?.cpf ?? "",
    },
    sigef,
    trechos,
    confrontacaoDe,
  };
}
