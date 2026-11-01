// Edge Function ler-arquivo: lê o arquivo de pontos e devolve a RECEITA de
// leitura e as linhas, para a prévia "Como lemos o seu arquivo". NÃO cria
// serviço nem gasta crédito: quem grava é o parse-txt, que reexecuta a receita
// confirmada pelo operador sobre o mesmo arquivo.
//
// Ordem: perfil aprendido da empresa (ou global) → formato padrão → detector por
// regras → IA (só quando as regras não têm certeza; cascata gpt-6-luna →
// gpt-6.1-sol; limite diário por empresa; a empresa pode desligar). Arquivo que
// não deu para ler fica guardado em uploads-recusados para virar caso de teste.
//
// Ação "regressao" (superadmin): reaplica cada perfil aos arquivos que ele já
// leu e aponta se algum resultado mudou (V9).
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import type { Proj4 } from "../_shared/geo.ts";
import { abrirArquivo } from "../_shared/leitor/arquivo.ts";
import { executarReceita, lerLinhas, notaDaLeitura } from "../_shared/leitor/index.ts";
import type { Leitura, PerfilSalvo } from "../_shared/leitor/index.ts";
import { validarReceita } from "../_shared/leitor/receita.ts";
import { interpretarComIA } from "../_shared/leitor/ia.ts";
import { autorDaChamada, ehRecusa, escritorioDoUsuario, exigirPermissao } from "../_shared/acesso.ts";
import type { ClienteUsuario } from "../_shared/acesso.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const clienteDoUsuario = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteUsuario;

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_LINHAS = 50000;

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes);
  const { text } = await extractText(proxy, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Bloqueios que o operador resolve na prévia (σ declarado, exclusão): não são recusa do formato. */
const RESOLVIVEIS_NA_PREVIA = new Set(["sem_precisao", "sem_altura", "nome_repetido", "poucos_pontos"]);
const leituraUtil = (l: Leitura | null) => !!l && l.anel.length >= 3 && !l.avisos.some((a) => a.nivel === "bloqueio" && !RESOLVIVEIS_NA_PREVIA.has(a.codigo));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const corpo = await req.json();
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- regressão dos perfis (superadmin) ----
    if (corpo.acao === "regressao") {
      const { data: sou } = await (clienteDoUsuario(req) as unknown as { rpc: (n: string) => Promise<{ data: unknown }> }).rpc("sou_superadmin");
      if (sou !== true) return json({ erro: "Apenas o superadmin" }, 403);
      return json(await regressao(supa));
    }

    const acesso = await escritorioDoUsuario(clienteDoUsuario(req));
    if (ehRecusa(acesso)) return json({ erro: acesso.erro }, acesso.status);
    const semPermissao = await exigirPermissao(clienteDoUsuario(req), "servicos.criar", "criar serviços");
    if (semPermissao) return json({ erro: semPermissao.erro }, semPermissao.status);
    const autor = await autorDaChamada(clienteDoUsuario(req));
    const escritorioId = acesso.escritorioId;

    const nome = typeof corpo.nome_arquivo === "string" && corpo.nome_arquivo ? corpo.nome_arquivo.slice(0, 200) : "pontos.txt";
    if (typeof corpo.arquivo_base64 !== "string" || !corpo.arquivo_base64) return json({ erro: "Arquivo ausente" }, 400);
    const bytes = bytesDeBase64(corpo.arquivo_base64);
    if (bytes.length > MAX_BYTES) return json({ erro: "Arquivo maior que 20 MB" }, 413);

    const recusar = async (motivo: string, formato: string, assinatura: string | null) => {
      if (!escritorioId) return;
      const caminho = `${escritorioId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}-${nome.replace(/[^\w.\- ]/g, "_")}`;
      const up = await supa.storage.from("uploads-recusados").upload(caminho, new Blob([bytes as BlobPart]), { upsert: true });
      await supa.from("arquivos_recusados").insert({
        escritorio_id: escritorioId, user_id: autor, nome_arquivo: nome, caminho: up.error ? null : caminho,
        tamanho: bytes.length, formato, assinatura, motivo: motivo.slice(0, 2000),
      });
    };

    const aberto = await abrirArquivo(bytes, nome, { textoDoPdf });
    if (aberto.tipo === "binario") {
      await recusar(`binário: ${aberto.binario!.formato}`, aberto.origem, null);
      return json({ ok: false, binario: aberto.binario, origem: aberto.origem });
    }
    if (aberto.linhas.length > MAX_LINHAS) return json({ erro: `Arquivo com ${aberto.linhas.length} linhas: o limite é ${MAX_LINHAS}.` }, 413);

    // ---- perfis aprendidos: da empresa primeiro, depois os globais ----
    let perfis: PerfilSalvo[] = [];
    const filtro = escritorioId ? `escritorio_id.eq.${escritorioId},escritorio_id.is.null` : "escritorio_id.is.null";
    const { data: pf, error: ePf } = await supa.from("perfis_leitura").select("id, assinatura, receita, nome, escritorio_id, usos").or(filtro).order("usos", { ascending: false }).limit(500);
    if (!ePf && pf) perfis = [...pf].sort((a, b) => Number(b.escritorio_id !== null) - Number(a.escritorio_id !== null)) as PerfilSalvo[];

    const regras = lerLinhas(aberto.linhas, { proj4, perfis });
    let escolhida: Leitura | null = regras;
    const ia: { usada: boolean; tentativas: unknown[]; custoUsd: number; erro: string | null; motivo: string | null } = { usada: false, tentativas: [], custoUsd: 0, erro: null, motivo: null };

    // ---- IA: só quando as regras não têm certeza num arquivo tabular ----
    const tabular = !regras || regras.receita.registro === "linha" || regras.receita.registro === "planilha" || regras.receita.registro === "texto_livre";
    const precisaIA = tabular && (!regras || regras.confianca !== "alta" || !leituraUtil(regras));
    if (precisaIA) {
      const chave = Deno.env.get("OPENAI_API_KEY");
      let liberada = !!chave && corpo.usar_ia !== false;
      if (!chave) ia.motivo = "IA não configurada no servidor";
      if (liberada && escritorioId) {
        const { data: esc } = await supa.from("escritorios").select("leitura_ia").eq("id", escritorioId).maybeSingle();
        if (esc && esc.leitura_ia === false) { liberada = false; ia.motivo = "IA desligada pela empresa"; }
        const limite = Number(Deno.env.get("OPENAI_LIMITE_DIARIO") ?? 60);
        const { count } = await supa.from("chamadas_ia").select("id", { count: "exact", head: true })
          .eq("escritorio_id", escritorioId).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
        if (liberada && (count ?? 0) >= limite) { liberada = false; ia.motivo = `limite de ${limite} chamadas de IA por dia atingido`; }
      }
      if (liberada) {
        const r = await interpretarComIA(aberto.linhas, nome, proj4, {
          apiKey: chave!,
          modeloRapido: Deno.env.get("OPENAI_MODELO_RAPIDO") ?? undefined,
          modeloForte: Deno.env.get("OPENAI_MODELO_FORTE") ?? undefined,
          timeoutMs: 120_000,
        }, regras ? { receita: regras.receita, duvidas: regras.duvidas } : null);
        ia.usada = true;
        ia.tentativas = r.tentativas;
        ia.custoUsd = r.tentativas.reduce((s, t) => s + (t.custoUsd ?? 0), 0);
        ia.erro = r.erro;
        if (r.tentativas.length) {
          await supa.from("chamadas_ia").insert(r.tentativas.map((t) => ({
            escritorio_id: escritorioId, user_id: autor, nome_arquivo: nome, assinatura: regras?.assinatura ?? null,
            modelo: t.modelo, tentativa: t.tentativa, tokens_entrada: t.tokensEntrada, tokens_saida: t.tokensSaida,
            custo_usd: t.custoUsd, aprovada: t.aprovada, motivo: t.motivo.slice(0, 2000), ms: t.ms,
          })));
        }
        // a da IA vence se foi aprovada, ou se é melhor que a das regras
        if (r.leitura && (r.tentativas.some((t) => t.aprovada) || !regras || notaDaLeitura(r.leitura) > notaDaLeitura(regras))) escolhida = r.leitura;
      }
    }

    if (!leituraUtil(escolhida)) {
      const motivo = escolhida
        ? escolhida.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.mensagem).join(" | ") || "menos de 3 pontos"
        : "nenhuma coluna de coordenadas encontrada";
      await recusar(motivo, aberto.origem, escolhida?.assinatura ?? null);
    }

    const perfilUsado = escolhida?.receita.origem.startsWith("perfil:")
      ? perfis.find((p) => `perfil:${p.id}` === escolhida!.receita.origem) ?? null : null;
    return json({
      ok: !!escolhida,
      formato: aberto.origem,
      codificacao: aberto.codificacao,
      linhas: aberto.linhas,
      receita: escolhida?.receita ?? null,
      confianca: escolhida?.confianca ?? "baixa",
      duvidas: escolhida?.duvidas ?? [],
      perfil: perfilUsado ? { id: perfilUsado.id, nome: perfilUsado.nome ?? null } : null,
      ia,
    });
  } catch (err) {
    console.error("ler-arquivo:", err);
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** Reaplica cada perfil aos arquivos que ele leu e compara com o que foi gravado. */
// deno-lint-ignore no-explicit-any
async function regressao(supa: any) {
  const { data: leituras } = await supa.from("leituras_arquivo").select("servico_id, nome_arquivo, perfil_id, receita").not("perfil_id", "is", null).order("created_at", { ascending: false }).limit(200);
  const resultado: { servico_id: string; nome_arquivo: string; perfil_id: string; ok: boolean; motivo?: string }[] = [];
  for (const l of leituras ?? []) {
    const { data: perfil } = await supa.from("perfis_leitura").select("receita").eq("id", l.perfil_id).maybeSingle();
    if (!perfil) continue;
    const arq = await supa.storage.from("uploads-txt").download(`${l.servico_id}/${l.nome_arquivo}`);
    const gravado = await supa.storage.from("uploads-txt").download(`${l.servico_id}/leitura.json`);
    if (arq.error || gravado.error) { resultado.push({ servico_id: l.servico_id, nome_arquivo: l.nome_arquivo, perfil_id: l.perfil_id, ok: false, motivo: "arquivo ou leitura.json ausente" }); continue; }
    const aberto = await abrirArquivo(new Uint8Array(await arq.data.arrayBuffer()), l.nome_arquivo, { textoDoPdf });
    const { receita } = validarReceita(perfil.receita);
    if (!receita) { resultado.push({ servico_id: l.servico_id, nome_arquivo: l.nome_arquivo, perfil_id: l.perfil_id, ok: false, motivo: "receita do perfil inválida" }); continue; }
    const antes = JSON.parse(await gravado.data.text());
    const agora = executarReceita(aberto.linhas, receita, { proj4, ordem: antes.ordem ?? undefined, excluir: antes.excluir ?? [], sigmaPadrao: antes.sigma_padrao ?? null, versao: typeof antes.versao_pontos === "string" ? antes.versao_pontos : null });
    const chave = (p: { num: number; e: number; n: number; h: number }) => `${p.num}|${p.e}|${p.n}|${p.h}`;
    const iguais = JSON.stringify(agora.anel.map(chave)) === JSON.stringify((antes.anel ?? []).map(chave));
    resultado.push({ servico_id: l.servico_id, nome_arquivo: l.nome_arquivo, perfil_id: l.perfil_id, ok: iguais, ...(iguais ? {} : { motivo: "o perfil hoje lê o arquivo diferente do que foi gravado" }) });
  }
  return { conferidos: resultado.length, divergentes: resultado.filter((r) => !r.ok), resultado };
}
