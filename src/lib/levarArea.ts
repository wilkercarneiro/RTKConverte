// "Usar a área em outro serviço" (Exportar ▾ de qualquer serviço).
//
// A área de um serviço vira a ENTRADA de um serviço novo de outro tipo — a
// divisão de um serviço completo, o loteamento da gleba, o CAR do imóvel, uma
// nova conferência — sem baixar e reenviar arquivo:
//
//   serviço de origem ──▶ camadas (as MESMAS da Exportar a área: geo.ts/car.ts)
//                     ──▶ TXT do levantamento (pontos, altitude, σ, confrontantes, partes)
//                     ──▶ área transferida (sessionStorage) ──▶ #/novo/<modalidade>
//   Upload: abre o TXT direto na conferência (o leitor reconhece como "Formato
//   da equipe"); CarNovo: usa o perímetro em lon/lat.
//
// Monta no navegador, a partir do que o usuário já pode ler do banco (RLS), e
// de propósito NÃO passa pela função `entregar`: lá, o primeiro arquivo fixa o
// imóvel do serviço de origem (0039) — levar a área para outro serviço não é
// gerar documento deste, e o serviço novo paga o próprio crédito ao ser criado.
import { supabase } from "./supabase";
import type { AreaTransferida, LonLat } from "./area_transferida";
import { prepararCamadas } from "./exportar/coordenadas.ts";
import { camadasDoGeo } from "./exportar/geo.ts";
import type { GlebaArea, VerticeArea } from "./exportar/geo.ts";
import { camadasDoCar, fusoDoCar } from "./exportar/car.ts";
import { nomeDoArquivo } from "./exportar/index.ts";
import { aneisDoPerimetro, gerarTxtLevantamento } from "./exportar/levantamento.ts";
import type { Camada } from "./exportar/tipos.ts";
import { projetoCarDoBanco } from "./car/entregas.ts";
import { chaveDoServico, rotuloCurto } from "./modalidades";
import type { Servico, Vertice } from "./types";
import { verticesLevados } from "./area_vertices";

export interface AreaParaLevar {
  area: AreaTransferida;
  /** cliente do serviço de origem: o serviço novo nasce ligado a ele */
  clienteId: string | null;
  pontos: number;
  partes: number;
  /** vértices que vão sem altitude / sem σ (a conferência do serviço novo completa) */
  semAltura: number;
  semSigma: number;
}

type ServicoLido = Pick<Servico, "id" | "tipo" | "modalidade" | "tem_glebas" | "fuso_utm" | "denominacao" | "nome_arquivo_txt" | "uf" | "municipio" | "cliente_id" | "credenciado_id">;

/** A área do serviço `servicoId`, pronta para abrir em outro serviço. */
export async function areaDoServico(servicoId: string): Promise<AreaParaLevar> {
  const { data, error } = await supabase.from("servicos")
    .select("id, tipo, modalidade, tem_glebas, fuso_utm, denominacao, nome_arquivo_txt, uf, municipio, cliente_id, credenciado_id")
    .eq("id", servicoId).single();
  if (error || !data) throw new Error(error?.message ?? "Serviço não encontrado.");
  const s = data as ServicoLido;
  const nome = s.denominacao?.trim() || s.nome_arquivo_txt?.replace(/\.[^.]+$/, "") || "Imóvel";

  let camadas: Camada[];
  let fuso: number;
  // linhas de `vertices` da origem (GEO e loteamento): a confrontação completa e o método vão junto
  let origem: Vertice[] = [];
  if (s.modalidade === "car") {
    const { data: linha, error: e } = await supabase.from("car_projetos").select("projeto").eq("servico_id", s.id).maybeSingle();
    if (e) throw new Error(e.message);
    const projeto = projetoCarDoBanco(((linha as { projeto?: unknown } | null)?.projeto ?? null) as never, s.denominacao);
    if (projeto.perimetro.length < 3) throw new Error("O CAR ainda não tem o perímetro do imóvel.");
    camadas = camadasDoCar(projeto);
    fuso = fusoDoCar(projeto);
  } else {
    fuso = s.fuso_utm ?? 24;
    // o loteamento usa só a gleba (os vértices); o GEO, as glebas quando há (como a Exportar)
    const usaGlebas = s.tem_glebas && s.modalidade !== "loteamento";
    const [{ data: vs, error: eV }, { data: gs, error: eG }] = await Promise.all([
      supabase.from("vertices").select().eq("servico_id", s.id).order("ordem"),
      usaGlebas ? supabase.from("glebas").select().eq("servico_id", s.id).order("ordem") : Promise.resolve({ data: [], error: null }),
    ]);
    if (eV) throw new Error(eV.message);
    if (eG) throw new Error(eG.message);
    origem = (vs ?? []) as Vertice[];
    camadas = camadasDoGeo(origem as VerticeArea[], (gs ?? []) as GlebaArea[], fuso, { nome });
  }

  const prontas = prepararCamadas(camadas, fuso);
  const aneis = aneisDoPerimetro(prontas);
  if (!aneis.length) throw new Error("O serviço não tem o perímetro da área: são precisos ao menos 3 vértices.");
  const txt = gerarTxtLevantamento(prontas);
  // `perimetro` é o maior anel; com várias partes, todas vão em `glebas` (o CAR as leva como glebas da área total)
  const maior = aneis.reduce((a, b) => (b.utm.length > a.utm.length ? b : a));
  const areaM2 = aneis.reduce((t, f) => t + (typeof f.props.area_ha === "number" ? f.props.area_ha * 1e4 : 0), 0);
  const tipo = rotuloCurto[chaveDoServico(s)];
  // o prefixo do NOSSO credenciado separa os vértices certificados do vizinho (código do SIGEF de outro)
  let prefixo: string | null = null;
  if (origem.length && s.credenciado_id) {
    const { data: cred } = await supabase.from("credenciados").select("prefixo_vertice").eq("id", s.credenciado_id).maybeSingle();
    prefixo = (cred as { prefixo_vertice?: string | null } | null)?.prefixo_vertice?.trim() || null;
  }
  const levados = origem.length ? verticesLevados(origem, aneis.map((a) => a.utm), prefixo) : [];
  const confrontantes = levados.filter((v) => v.confrontacao?.descritivo?.trim()).length;
  const certificados = levados.filter((v) => v.certificado).length;
  const extras = [
    confrontantes ? `${confrontantes} confrontante${confrontantes === 1 ? "" : "s"}` : "",
    certificados ? `${certificados} vértice${certificados === 1 ? "" : "s"} certificado${certificados === 1 ? "" : "s"} do vizinho com o código do SIGEF` : "",
  ].filter(Boolean);
  const leva = (txt.semAltura === 0 && txt.semSigma === 0
    ? ", com altitude e precisão de cada ponto"
    : txt.semAltura === txt.pontos && txt.semSigma === txt.pontos ? " (sem altitude nem precisão: a conferência completa)"
    : " (parte dos pontos sem altitude ou precisão: a conferência completa)")
    + (extras.length ? `; leva ${extras.join(" e ")}` : "");

  return {
    area: {
      nome,
      perimetro: maior.geo.map((g): LonLat => [g[0], g[1]]),
      ...(aneis.length > 1 ? { glebas: aneis.map((f, i) => ({ nome: f.nome?.trim() || `Parte ${i + 1}`, anel: f.geo.map((g): LonLat => [g[0], g[1]]) })) } : {}),
      origem: `Serviço ${tipo.toLowerCase()} · ${nome}`,
      frase: `Área do serviço ${tipo.toLowerCase()} "${nome}": ${txt.pontos} ponto${txt.pontos === 1 ? "" : "s"}${txt.partes > 1 ? ` em ${txt.partes} partes` : ""}${leva}`,
      uf: s.uf, municipio: s.municipio,
      ...(areaM2 > 0 ? { areaOrigemM2: areaM2 } : {}),
      partes: txt.partes,
      volta: { rotulo: "o serviço de origem", hash: `#/servico/${s.id}` },
      arquivo: { nome: nomeDoArquivo(nome, "levantamento", fuso), conteudo: txt.texto },
      fuso,
      ...(levados.length ? { vertices: levados } : {}),
    },
    clienteId: s.cliente_id ?? null,
    pontos: txt.pontos, partes: txt.partes, semAltura: txt.semAltura, semSigma: txt.semSigma,
  };
}
