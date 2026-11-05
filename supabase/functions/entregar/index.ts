// Edge Function: entregar
//
// Os arquivos finais do CAR (shapefiles do SICAR, KML) e do loteamento (planta,
// memoriais, quadro, KML, DXF, locação, projetos de infraestrutura e o pacote
// lote a lote — memorial, planta A4 e locação de cada lote). Até a
// auditoria de 04/11/2026 eles eram montados no navegador, e o crédito era só
// uma porta da tela: bastava trocar o desenho para gerar outro imóvel.
//
// Agora o servidor:
//   1. confere login, acesso ao serviço, permissão documentos.gerar e o limite
//      de frequência;
//   2. lê o projeto DO BANCO (car_projetos / loteamentos + vértices) — nada de
//      geometria vinda do cliente;
//   3. confere o contorno do imóvel contra o assinado na 1ª geração (0039);
//   4. gera e devolve o arquivo (corpo binário, nome em X-Nome-Arquivo).
// Do cliente só vêm a escolha (qual arquivo, folha, formato) e o carimbo da
// planta (textos, logo e a imagem de situação, que é feita no navegador).
//
// Publicação: o código das telas (src/lib/...) entra num pacote só, gerado por
// `node scripts/empacotar-entregar.mjs` (esbuild).
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../_shared/geo.ts";
import { autorDaChamada, exigirPermissao, exigirServicoDoUsuario } from "../_shared/acesso.ts";
import type { ClienteUsuario } from "../_shared/acesso.ts";
import { CorpoInvalido, dentroDoLimite, lerJson, LIMITE_MB, MUITAS_CHAMADAS } from "../_shared/limite.ts";
import { conferirContorno } from "../_shared/contorno.ts";
import type { AnelLonLat } from "../_shared/contorno.ts";
import { arquivoDoCar, projetoCarDoBanco, SAIDAS_CAR } from "../../../src/lib/car/entregas.ts";
import type { SaidaCar } from "../../../src/lib/car/entregas.ts";
import { arquivoDoLoteamento, SAIDAS_LOTEAMENTO } from "../../../src/lib/loteamento/entregas.ts";
import type { PedidoLoteamento, SaidaLoteamento } from "../../../src/lib/loteamento/entregas.ts";
import { conferirItens } from "../../../src/lib/loteamento/loteALote.ts";
import { perimetroDoServico, projetoInicial } from "../../../src/lib/loteamento/perimetro.ts";
import { calcular } from "../../../src/lib/loteamento/calculo.ts";
import type { DadosCarimbo } from "../../../src/lib/loteamento/planta.ts";
import type { Servico, Vertice } from "../../../src/lib/types.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

const clienteDoUsuario = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteUsuario;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-nome-arquivo",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- carimbo
const MAX_IMAGEM = 6 * 1024 * 1024;
const txt = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
function imagem(v: unknown): Uint8Array | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const bin = atob(v.replace(/^data:[^,]*,/, ""));
    if (bin.length > MAX_IMAGEM) return null;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
/** O carimbo vem da tela (textos da empresa, logo e situação): só apresentação. */
function carimboDoPedido(c: Record<string, unknown> | undefined, servico: Servico): DadosCarimbo {
  const x = c ?? {};
  const logoBytes = imagem((x.logo as { base64?: unknown } | null)?.base64);
  const logoTipo = (x.logo as { tipo?: unknown } | null)?.tipo === "jpg" ? "jpg" : "png";
  return {
    empresa: txt(x.empresa), cnpj: txt(x.cnpj, 40), desenhista: txt(x.desenhista),
    proprietario: txt(x.proprietario) || (servico.detentor_nome ?? ""), cpfProprietario: txt(x.cpfProprietario, 40) || (servico.detentor_cpf ?? ""),
    imovel: txt(x.imovel) || (servico.denominacao ?? ""), municipio: txt(x.municipio, 120) || (servico.municipio ?? ""),
    uf: txt(x.uf, 4) || (servico.uf ?? ""), matricula: txt(x.matricula, 80) || (servico.matricula ?? ""),
    rt: txt(x.rt), rtTitulo: txt(x.rtTitulo, 120), rtRegistro: txt(x.rtRegistro, 120), credenciado: txt(x.credenciado, 40),
    trt: txt(x.trt, 80) || (servico.trt ?? ""), fuso: servico.fuso_utm ?? 24,
    logo: logoBytes ? { bytes: logoBytes, tipo: logoTipo } : null,
    situacao: imagem(x.situacao),
  };
}

/** Opções da locação vindas da tela, com a estaca dentro do razoável (5 a 100 m). */
function opcoesLocacao(v: unknown): PedidoLoteamento["op"] {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const estaca = Number(o.estaca);
  return {
    lotes: o.lotes !== false, curvas: o.curvas !== false, eixos: o.eixos !== false, perimetro: o.perimetro === true,
    estaca: Number.isFinite(estaca) ? Math.min(100, Math.max(5, estaca)) : 20,
  };
}

/** Perímetro UTM do loteamento → anel lon/lat para a conferência do contorno. */
function anelLonLatUtm(pts: [number, number][], fuso: number): AnelLonLat {
  const ud = utmDef(fuso);
  return pts.map((p) => proj(ud, GEO_DEF, p));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const corpo = await lerJson(req, LIMITE_MB(20));
    const { servico_id, saida } = corpo as { servico_id?: string; saida?: string };
    if (!servico_id || typeof servico_id !== "string") return json({ erro: "servico_id é obrigatório" }, 400);
    if (!saida || typeof saida !== "string") return json({ erro: "Diga qual arquivo gerar." }, 400);

    const recusa = await exigirServicoDoUsuario(clienteDoUsuario(req), servico_id);
    if (recusa) return json({ erro: recusa.erro }, recusa.status);
    const semPermissao = await exigirPermissao(clienteDoUsuario(req), "documentos.gerar", "gerar documentos");
    if (semPermissao) return json({ erro: semPermissao.erro }, semPermissao.status);
    const autor = await autorDaChamada(clienteDoUsuario(req));

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // lote a lote tem conta própria: o loteamento de 600 lotes são 10 chamadas
    // de 60 seguidas, e cada chamada já tem teto de lotes (loteALote.ts)
    const loteALote = saida === "lote" || saida === "lotes";
    const [chave, max, janela] = loteALote ? [`lotes:${autor ?? servico_id}`, 60, 600] : [`gerar:${autor ?? servico_id}`, 30, 300];
    if (!(await dentroDoLimite(supa, chave, max, janela))) return json({ erro: MUITAS_CHAMADAS.erro }, MUITAS_CHAMADAS.status);

    const { data: servico } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (!servico) return json({ erro: "Serviço não encontrado" }, 404);
    const s = servico as Servico;

    let arquivo: { dados: Uint8Array; nome: string; tipo: string };

    if (s.modalidade === "car") {
      if (!(SAIDAS_CAR as string[]).includes(saida)) return json({ erro: "Arquivo de CAR desconhecido." }, 400);
      const { data: linha, error } = await supa.from("car_projetos").select("projeto").eq("servico_id", servico_id).maybeSingle();
      if (error) throw error;
      const projeto = projetoCarDoBanco((linha?.projeto ?? null) as never, s.denominacao);
      if (projeto.perimetro.length < 3) return json({ erro: "O projeto deste serviço não tem o perímetro do imóvel." }, 422);
      const contorno = await conferirContorno(supa, servico_id, [projeto.perimetro as AnelLonLat]);
      if (contorno) return json({ erro: contorno.erro }, contorno.status);
      arquivo = await arquivoDoCar(saida as SaidaCar, projeto, { municipio: s.municipio, uf: s.uf, proprietario: s.detentor_nome });
    } else if (s.modalidade === "loteamento") {
      if (!(SAIDAS_LOTEAMENTO as string[]).includes(saida)) return json({ erro: "Arquivo de loteamento desconhecido." }, 400);
      const fuso = s.fuso_utm ?? 24;
      const [{ data: vertRows, error: eV }, { data: linha, error: eP }] = await Promise.all([
        supa.from("vertices").select().eq("servico_id", servico_id).order("ordem"),
        supa.from("loteamentos").select("projeto").eq("servico_id", servico_id).maybeSingle(),
      ]);
      if (eV) throw eV;
      if (eP) throw eP;
      const perimetro = perimetroDoServico((vertRows ?? []) as Vertice[], fuso);
      if (perimetro.pts.length < 3) return json({ erro: "O serviço não tem o perímetro da gleba." }, 422);
      if (!linha?.projeto) return json({ erro: "O projeto do loteamento ainda não foi salvo." }, 422);
      const contorno = await conferirContorno(supa, servico_id, [anelLonLatUtm(perimetro.pts, fuso)]);
      if (contorno) return json({ erro: contorno.erro }, contorno.status);
      const projeto = projetoInicial(linha.projeto as never, s, perimetro);
      const res = calcular(projeto, perimetro);
      const c = corpo as Record<string, unknown>;
      const pedido: PedidoLoteamento = {
        saida: saida as SaidaLoteamento,
        folha: c.folha as PedidoLoteamento["folha"],
        formato: c.formato as PedidoLoteamento["formato"],
        op: opcoesLocacao(c.op),
        locarRedes: c.locarRedes === true,
      };
      // lote a lote: os ids vêm da tela, mas só valem os que existem no projeto
      // recalculado aqui (até 60 por chamada: a tela divide os pedidos maiores)
      if (saida === "lote" || saida === "lotes") {
        const ok = conferirItens(res, saida === "lote" ? (typeof c.id === "string" ? [c.id] : null) : c.ids);
        if ("erro" in ok) return json({ erro: ok.erro }, 400);
        pedido.ids = ok.itens.map((x) => x.id);
      }
      arquivo = await arquivoDoLoteamento(pedido, projeto, res, perimetro, s, carimboDoPedido(c.carimbo as Record<string, unknown> | undefined, s));
    } else {
      return json({ erro: "Este serviço não é de CAR nem de loteamento." }, 400);
    }

    return new Response(arquivo.dados, {
      status: 200,
      headers: { ...CORS, "Content-Type": arquivo.tipo, "X-Nome-Arquivo": encodeURIComponent(arquivo.nome) },
    });
  } catch (e) {
    if (e instanceof CorpoInvalido) return json({ erro: e.message }, e.status);
    console.error("entregar:", e);
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
