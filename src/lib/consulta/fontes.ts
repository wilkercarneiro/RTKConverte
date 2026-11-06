// As fontes da Consultar imóvel num lugar só. A tela fala com esta interface;
// o laboratório (#/lab/consulta) troca por respostas gravadas, sem rede.
//
// O que sai direto do navegador (CORS conferido em 06/11/2026): SICAR, bases de
// restrição, Open-Meteo, SoilGrids, IBGE. O que passa pelo servidor: SIGEF
// (base do sistema + INCRA pela consultar-sigef), focos do INPE e o laudo
// (função analise-imovel) e o histórico (tabela analises_imovel, 0045).
import { chamarFuncao, supabase } from "../supabase";
import { consultarRestricoes } from "../restricoes.ts";
import type { ResultadoRestricoes } from "../restricoes.ts";
import { consultarSigef, sincronizarSigef } from "../sigef";
import type { FeatureParcela } from "../sigef";
import { erroColunaAusente } from "../coluna_ausente";
import { carNaCaixa, carNoPonto, carPorCodigo, carSobreAArea, ufsCandidatas } from "./car.ts";
import { consultarBioma, consultarClima, consultarMunicipio, consultarSolo } from "./ambiente.ts";
import type { Bioma, Clima, Municipio, Solo } from "./ambiente.ts";
import { classificarFocos, pedidoFocos } from "./focos.ts";
import type { Foco, FocosDoImovel } from "./focos.ts";
import { caixaComMargem, circulo } from "./geometria.ts";
import type { LonLat } from "./geometria.ts";
import { imovelDoSigef, RAIO_SIGEF_M, sigefDaArea } from "./sigef_imovel.ts";
import type { Analise, CarDaArea, Laudo, SigefDaArea, Tom } from "./analise.ts";
import type { ImovelEncontrado } from "./tipos.ts";

export type TipoEntrada = "car" | "sigef" | "coordenada" | "arquivo" | "desenho" | "campo";

/** Uma consulta do histórico (tabela analises_imovel). */
export interface RegistroConsulta {
  id: string;
  criado: string;
  entrada: string;
  tipo: TipoEntrada;
  rotulo: string;
  codigo: string | null;
  uf: string | null;
  municipio: string | null;
  areaHa: number | null;
  geometria: GeoJSON.MultiPolygon | null;
  resumo: string | null;
  tom: Tom | null;
  resultado: Analise | null;
  laudo: Laudo | null;
}

export type NovoRegistro = Omit<RegistroConsulta, "id" | "criado" | "laudo">;

export interface FontesConsulta {
  carPorCodigo(codigo: string): Promise<ImovelEncontrado[]>;
  /** imóveis declarados no ponto; `uf` null = descobre pelas UFs candidatas */
  carNoPonto(lon: number, lat: number, uf: string | null): Promise<ImovelEncontrado[]>;
  carNaArea(aneis: LonLat[][], uf: string | null, proprio: string | null): Promise<CarDaArea>;
  sigefPorCodigo(codigo: string): Promise<ImovelEncontrado | null>;
  sigefNoPonto(lon: number, lat: number, uf: string | null): Promise<{ imoveis: ImovelEncontrado[]; online: SigefDaArea["online"]; detalhe?: string }>;
  sigefNaArea(aneis: LonLat[][], uf: string | null, proprio: string | null): Promise<SigefDaArea>;
  municipio(lon: number, lat: number): Promise<Municipio | null>;
  restricoes(aneis: LonLat[][], fuso: number): Promise<ResultadoRestricoes>;
  clima(lon: number, lat: number): Promise<Clima>;
  solo(lon: number, lat: number): Promise<Solo>;
  bioma(lon: number, lat: number): Promise<Bioma>;
  focos(aneis: LonLat[][]): Promise<FocosDoImovel>;
  laudo(analiseId: string, refazer?: boolean): Promise<Laudo>;
  historico: {
    listar(): Promise<RegistroConsulta[]>;
    /** devolve o id (null = não gravou no banco: o laudo fica indisponível) */
    gravar(r: NovoRegistro, id?: string | null): Promise<string | null>;
    apagar(id: string): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Histórico: banco (0045); sem a tabela ainda, só neste navegador
// ---------------------------------------------------------------------------

const CHAVE_LOCAL = "vertces.consultas";
const tabelaAusente = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|relation .* does not exist/i.test(e.message ?? ""));

function lerLocal(): RegistroConsulta[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? "[]") as RegistroConsulta[]; } catch { return []; }
}
function gravarLocal(xs: RegistroConsulta[]) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(xs.slice(0, 12))); } catch { /* cheio ou bloqueado: segue sem histórico */ }
}

const COLUNAS = "id, created_at, entrada, tipo_entrada, rotulo, codigo, uf, municipio, area_ha, geometria, resumo, tom, resultado, laudo, laudo_modelo, laudo_em";

function deLinha(l: Record<string, unknown>): RegistroConsulta {
  return {
    id: String(l.id), criado: String(l.created_at), entrada: String(l.entrada ?? ""), tipo: l.tipo_entrada as TipoEntrada,
    rotulo: String(l.rotulo ?? ""), codigo: (l.codigo as string) ?? null, uf: (l.uf as string) ?? null, municipio: (l.municipio as string) ?? null,
    areaHa: l.area_ha != null ? Number(l.area_ha) : null, geometria: (l.geometria as GeoJSON.MultiPolygon) ?? null,
    resumo: (l.resumo as string) ?? null, tom: (l.tom as Tom) ?? null,
    resultado: l.resultado && typeof l.resultado === "object" && "imovel" in (l.resultado as object) ? (l.resultado as Analise) : null,
    laudo: l.laudo ? { texto: String(l.laudo), modelo: (l.laudo_modelo as string) ?? null, quando: String(l.laudo_em ?? l.created_at) } : null,
  };
}

const historicoReal: FontesConsulta["historico"] = {
  async listar() {
    const { data, error } = await supabase.from("analises_imovel").select(COLUNAS).order("created_at", { ascending: false }).limit(12);
    if (tabelaAusente(error)) return lerLocal();
    if (error) throw new Error(error.message);
    return (data ?? []).map((l) => deLinha(l as Record<string, unknown>));
  },
  async gravar(r, id) {
    const linha = {
      entrada: r.entrada.slice(0, 2000), tipo_entrada: r.tipo, rotulo: r.rotulo.slice(0, 300) || "Consulta", codigo: r.codigo,
      uf: r.uf && /^[A-Z]{2}$/.test(r.uf) ? r.uf : null, municipio: r.municipio?.slice(0, 120) ?? null,
      area_ha: r.areaHa, geometria: r.geometria, resumo: r.resumo?.slice(0, 600) ?? null, tom: r.tom === "neutro" ? null : r.tom, resultado: r.resultado ?? {},
    };
    const q = id
      ? supabase.from("analises_imovel").update({ rotulo: linha.rotulo, resumo: linha.resumo, tom: linha.tom, resultado: linha.resultado, area_ha: linha.area_ha, uf: linha.uf, municipio: linha.municipio }).eq("id", id).select("id").maybeSingle()
      : supabase.from("analises_imovel").insert(linha).select("id").single();
    const { data, error } = await q;
    if (tabelaAusente(error) || erroColunaAusente(error, "resultado")) {
      const novo: RegistroConsulta = { ...r, id: id ?? `local-${Date.now()}`, criado: new Date().toISOString(), laudo: null };
      gravarLocal([novo, ...lerLocal().filter((x) => x.id !== novo.id)]);
      return null;
    }
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? id ?? null;
  },
  async apagar(id) {
    if (id.startsWith("local-")) { gravarLocal(lerLocal().filter((x) => x.id !== id)); return; }
    const { error } = await supabase.from("analises_imovel").delete().eq("id", id);
    if (error && !tabelaAusente(error)) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------
// SIGEF pela base do sistema (+ o INCRA na hora, quando dá)
// ---------------------------------------------------------------------------

async function sincronizar(aneis: LonLat[][], uf: string | null): Promise<{ online: SigefDaArea["online"]; detalhe?: string }> {
  if (!uf) return { online: "sem-uf" };
  try {
    const s = await sincronizarSigef(aneis, uf);
    return s.ok ? { online: "ok" } : { online: "local", detalhe: s.avisos.join(" · ") || undefined };
  } catch (e) {
    return { online: "local", detalhe: e instanceof Error ? e.message : String(e) };
  }
}

const imoveisDoSigef = (fs: FeatureParcela[]) => fs.map(imovelDoSigef).filter((x): x is ImovelEncontrado => !!x);

// ---------------------------------------------------------------------------
// As fontes de verdade
// ---------------------------------------------------------------------------

export const fontesReais: FontesConsulta = {
  carPorCodigo: (codigo) => carPorCodigo(codigo),
  async carNoPonto(lon, lat, uf) {
    const ufs = uf ? [uf] : ufsCandidatas(lon, lat);
    if (!ufs.length) return [];
    const listas = await Promise.all(ufs.map((u) => carNoPonto(lon, lat, u)));
    return listas.flat();
  },
  async carNaArea(aneis, uf, proprio) {
    const u = uf ?? (proprio?.slice(0, 2) || null);
    if (!u) throw new Error("falta a UF para buscar o CAR");
    const { imoveis, cortada } = await carNaCaixa(caixaComMargem(aneis, 100), u);
    return { itens: carSobreAArea(aneis, imoveis, proprio), cortada };
  },
  async sigefPorCodigo(codigo) {
    const { data, error } = await supabase.rpc("sigef_por_codigo", { p_codigo: codigo });
    if (error) throw new Error(/sigef_por_codigo/.test(error.message) ? "a busca por código do SIGEF chega com a atualização do banco (0045)" : error.message);
    return data ? imovelDoSigef(data as FeatureParcela) : null;
  },
  async sigefNoPonto(lon, lat, uf) {
    // um círculo de 3 m: "as parcelas que contêm o ponto"
    const aneis = [circulo([lon, lat], 3, 12)];
    const s = await sincronizar(aneis, uf);
    const r = await consultarSigef(aneis, { raioM: 0 });
    return { imoveis: imoveisDoSigef(r.parcelas.features), ...s };
  },
  async sigefNaArea(aneis, uf, proprio) {
    const s = await sincronizar(aneis, uf);
    const r = await consultarSigef(aneis, { raioM: RAIO_SIGEF_M });
    return { ...sigefDaArea(aneis, r.parcelas.features, r.sobreposicoes, proprio), ...s };
  },
  municipio: (lon, lat) => consultarMunicipio(lon, lat),
  restricoes: (aneis, fuso) => consultarRestricoes(aneis, { fuso }),
  clima: (lon, lat) => consultarClima(lon, lat),
  solo: (lon, lat) => consultarSolo(lon, lat),
  bioma: (lon, lat) => consultarBioma(lon, lat),
  async focos(aneis) {
    const { caixa, desde } = pedidoFocos(aneis);
    const r = await chamarFuncao<{ todos: Foco[]; referencia: Foco[] }>("analise-imovel", { acao: "focos", caixa, desde });
    return classificarFocos(r, aneis, desde);
  },
  async laudo(analiseId, refazer) {
    if (analiseId.startsWith("local-")) throw new Error("O laudo precisa da atualização do banco (0045) — peça ao suporte.");
    const r = await chamarFuncao<{ laudo: string; modelo: string | null; quando: string }>("analise-imovel", { acao: "laudo", analise_id: analiseId, refazer: !!refazer });
    return { texto: r.laudo, modelo: r.modelo, quando: r.quando };
  },
  historico: historicoReal,
};
