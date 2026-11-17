// Configurações → Cupons (migração 0052): os cupons de desconto que a pessoa
// digita no cadastro (ou que já vão no link /cadastro/?cupom=CODIGO).
//
// Um cupom vale na ADESÃO, na MENSALIDADE ou nas duas — percentual, valor em
// reais ou isenção (na mensalidade, isenção = meses sem cobrança) — com
// validade, limite de usos e planos opcionais. Quem já usou guarda a foto do
// cupom do dia: editar ou desativar depois não muda o que foi combinado.
// A conta é a mesma do servidor (_shared/cupons.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ativarCupom, excluirCupom, linkDoCupom, listarCupons, salvarCupom } from "../../lib/admin";
import type { CupomAdmin, TipoCupom } from "../../lib/admin";
import { fmtPreco } from "../../lib/creditos";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { copiar, fmtData } from "./comum";
import {
  cupomDe, LIMITE_MESES_GRATIS, LIMITE_VEZES, normalizarCodigo, primeiroPagamento, problemasDoCupom, resumoDoCupom, textosDoCupom,
} from "../../../supabase/functions/_shared/cupons.ts";
import type { FormCupom } from "../../../supabase/functions/_shared/cupons.ts";

const ROTULO: Record<CupomAdmin["situacao"], string> = { ativo: "Ativo", inativo: "Desativado", expirado: "Vencido", esgotado: "Esgotado" };
const CLASSE: Record<CupomAdmin["situacao"], string> = { ativo: "ativo", inativo: "neutro", expirado: "suspenso", esgotado: "suspenso" };

/** O formulário como texto (o que a pessoa digita); vira números ao salvar. */
interface Campos {
  codigo: string; descricao: string;
  adesao: "" | TipoCupom; adesao_valor: string;
  mensalidade: "" | TipoCupom; mensalidade_valor: string; vezes: string; meses: string;
  planos: string[]; max_usos: string; valido_ate: string;
}
const VAZIO: Campos = {
  codigo: "", descricao: "", adesao: "", adesao_valor: "", mensalidade: "", mensalidade_valor: "", vezes: "", meses: "1",
  planos: [], max_usos: "", valido_ate: "",
};

const num = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
/** "29,9" e "29.90" valem; "1.000,50" também. Inteiro: sem casas. */
const numero = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  return /,/.test(t) ? num(t) : Number(t);
};

function paraForm(c: Campos): FormCupom {
  const desconto = c.mensalidade === "percentual" || c.mensalidade === "valor";
  return {
    codigo: normalizarCodigo(c.codigo),
    adesao_tipo: c.adesao || null, adesao_valor: c.adesao && c.adesao !== "isencao" ? numero(c.adesao_valor) : null,
    mensalidade_tipo: c.mensalidade || null, mensalidade_valor: desconto ? numero(c.mensalidade_valor) : null,
    mensalidade_vezes: desconto && c.vezes.trim() ? numero(c.vezes) : null,
    isencao_meses: c.mensalidade === "isencao" ? numero(c.meses) : null,
    max_usos: c.max_usos.trim() ? numero(c.max_usos) : null,
    valido_ate: c.valido_ate || null,
  };
}

function deCupom(c: CupomAdmin): Campos {
  const s = (n: number | null) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
  return {
    codigo: c.codigo, descricao: c.descricao ?? "",
    adesao: c.adesao_tipo ?? "", adesao_valor: s(c.adesao_valor),
    mensalidade: c.mensalidade_tipo ?? "", mensalidade_valor: s(c.mensalidade_valor), vezes: s(c.mensalidade_vezes), meses: s(c.isencao_meses) || "1",
    planos: c.planos ?? [], max_usos: s(c.max_usos), valido_ate: c.valido_ate ?? "",
  };
}

/** Um código fácil de ditar: VERTCES-7K3Q (sem 0/O nem 1/I). */
function codigoNovo(): string {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `VERTCES-${Array.from(b, (x) => letras[x % letras.length]).join("")}`;
}

/** O texto que vai junto do link no WhatsApp. */
export function textoDoCupom(link: string, codigo: string, resumo: string): string {
  return [
    `Seu cupom do Vertces: ${codigo}${resumo ? ` (${resumo})` : ""}`,
    "",
    `Cadastre-se por este link, com o cupom já aplicado: ${link}`,
  ].join("\n");
}

export function Cupons({ d, adesao }: { d: DadosAdmin | null; adesao: number }) {
  const planos = useMemo(() => (d?.planos ?? []).filter((p) => p.ativo && Number(p.preco_mensal ?? 0) > 0), [d]);
  const [lista, setLista] = useState<CupomAdmin[] | null>(null);
  const [f, setF] = useState<Campos>(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => { setLista(await listarCupons()); }, []);
  useEffect(() => { carregar().catch((x) => setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) })); }, [carregar]);

  const form = paraForm(f);
  const problemas = problemasDoCupom(form);
  const cupom = cupomDe(form);
  const campo = <K extends keyof Campos>(k: K, v: Campos[K]) => setF((x) => ({ ...x, [k]: v }));
  const erro = (k: string) => (tocado && problemas[k] ? <span className="erro-campo">{problemas[k]}</span> : null);

  // o exemplo: no 1º plano marcado (ou no 1º plano à venda), mensal
  const exemplo = planos.find((p) => f.planos.includes(p.id)) ?? planos[0];
  const conta = exemplo && cupom ? {
    antes: primeiroPagamento(Number(exemplo.preco_mensal), adesao, null),
    depois: primeiroPagamento(Number(exemplo.preco_mensal), adesao, cupom),
  } : null;

  function novo() {
    setF({ ...VAZIO, codigo: codigoNovo() });
    setEditando(null); setAberto(true); setTocado(false); setMsg(null);
  }
  function editar(c: CupomAdmin) {
    setF(deCupom(c));
    setEditando(c.id); setAberto(true); setTocado(false); setMsg(null);
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setTocado(true);
    if (Object.keys(problemas).length) return;
    setOcupado(true); setMsg(null);
    try {
      await salvarCupom(editando, {
        ...form, descricao: f.descricao.trim(), planos: f.planos,
        ...(editando ? {} : { ativo: true }),
      });
      setMsg({ tipo: "ok", texto: editando ? `Cupom ${form.codigo} salvo. Quem já usou continua com o combinado do dia do cadastro.` : `Cupom ${form.codigo} criado: já vale no cadastro.` });
      setAberto(false); setEditando(null); setF(VAZIO);
      await carregar();
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  async function copiarLink(c: CupomAdmin) {
    const link = linkDoCupom(c.codigo, c.planos?.length === 1 ? c.planos[0] : null);
    if (await copiar(link)) { setCopiado(c.id); setTimeout(() => setCopiado(null), 2500); }
  }

  const ativos = (lista ?? []).filter((c) => c.situacao === "ativo").length;

  return (
    <section className="sa-card sa-cupons">
      <header>
        <h3>Cupons de desconto<Dica>
          O cliente digita o código no cadastro (ou já recebe no link) e vê o desconto antes de criar a conta. Vale na taxa de adesão,
          na mensalidade ou nas duas: em percentual, em reais ou como isenção. Na mensalidade, o desconto pode valer nas primeiras
          cobranças ou em todas, e a isenção dá meses sem cobrança (a 1ª mensalidade só vence depois). Quem usou guarda o combinado
          do dia: editar ou desativar o cupom depois não muda nada para ele.
        </Dica></h3>
        {ativos > 0 && <span className="sa-pill ativo" style={{ marginLeft: "auto" }}>{ativos} ativo{ativos > 1 ? "s" : ""}</span>}
        {!aberto && <button type="button" className="principal" style={{ marginLeft: ativos > 0 ? 8 : "auto" }} onClick={novo}>Novo cupom</button>}
      </header>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      {aberto && (
        <form className="sa-cupom-form" onSubmit={salvar} noValidate>
          <div className="sa-campos">
            <label><Rotulo dica="o que o cliente digita; letras, números, - e _">Código</Rotulo>
              <span className="sa-cupom-codigo">
                <input className="mono" value={f.codigo} maxLength={30} onChange={(e) => campo("codigo", normalizarCodigo(e.target.value))} />
                <button type="button" onClick={() => campo("codigo", codigoNovo())} title="Gerar outro código">Gerar</button>
              </span>
              {erro("codigo")}
            </label>
            <label><Rotulo dica="só para a equipe; o cliente não vê">Anotação</Rotulo>
              <input value={f.descricao} maxLength={200} placeholder="Ex.: feira de agrimensura 2026" onChange={(e) => campo("descricao", e.target.value)} />
            </label>
          </div>

          <fieldset className="sa-cupom-parte">
            <legend>Na taxa de adesão{adesao > 0 ? <small> (hoje {fmtPreco(adesao)})</small> : <small> (hoje sem adesão)</small>}</legend>
            <div className="sa-campos">
              <label>Desconto
                <select value={f.adesao} onChange={(e) => campo("adesao", e.target.value as Campos["adesao"])}>
                  <option value="">Não mexe na adesão</option>
                  <option value="percentual">Percentual (%)</option>
                  <option value="valor">Valor (R$ a menos)</option>
                  <option value="isencao">Isenção (adesão zerada)</option>
                </select>
              </label>
              {(f.adesao === "percentual" || f.adesao === "valor") ? (
                <label>{f.adesao === "percentual" ? "Percentual" : "Valor em reais"}
                  <input inputMode="decimal" value={f.adesao_valor} placeholder={f.adesao === "percentual" ? "Ex.: 50" : "Ex.: 200,00"} onChange={(e) => campo("adesao_valor", e.target.value)} />
                  {erro("adesao_valor")}
                </label>
              ) : <span className="sa-cupom-vazio" aria-hidden="true" />}
            </div>
          </fieldset>

          <fieldset className="sa-cupom-parte">
            <legend>Na mensalidade</legend>
            <div className="sa-campos">
              <label>Desconto
                <select value={f.mensalidade} onChange={(e) => campo("mensalidade", e.target.value as Campos["mensalidade"])}>
                  <option value="">Não mexe na mensalidade</option>
                  <option value="percentual">Percentual (%)</option>
                  <option value="valor">Valor (R$ a menos em cada cobrança)</option>
                  <option value="isencao">Isenção (meses sem cobrança)</option>
                </select>
              </label>
              {(f.mensalidade === "percentual" || f.mensalidade === "valor") && (
                <>
                  <label>{f.mensalidade === "percentual" ? "Percentual" : "Valor em reais"}
                    <input inputMode="decimal" value={f.mensalidade_valor} placeholder={f.mensalidade === "percentual" ? "Ex.: 20" : "Ex.: 50,00"} onChange={(e) => campo("mensalidade_valor", e.target.value)} />
                    {erro("mensalidade_valor")}
                  </label>
                  <label><Rotulo dica={`em quantas cobranças o desconto vale (o 1º pagamento conta como a primeira); vazio = em todas. No semestral e no anual, cada cobrança é um período. Até ${LIMITE_VEZES}.`}>Em quantas cobranças</Rotulo>
                    <input inputMode="numeric" value={f.vezes} placeholder="Todas" onChange={(e) => campo("vezes", e.target.value.replace(/\D/g, ""))} />
                    {erro("mensalidade_vezes")}
                  </label>
                </>
              )}
              {f.mensalidade === "isencao" && (
                <label><Rotulo dica={`a 1ª mensalidade só vence depois destes meses (de 1 a ${LIMITE_MESES_GRATIS}); com adesão, o cliente paga só a adesão no cadastro`}>Meses sem mensalidade</Rotulo>
                  <input inputMode="numeric" value={f.meses} onChange={(e) => campo("meses", e.target.value.replace(/\D/g, ""))} />
                  {erro("isencao_meses")}
                </label>
              )}
              {!f.mensalidade && <span className="sa-cupom-vazio" aria-hidden="true" />}
            </div>
          </fieldset>
          {tocado && problemas.alvo && <div className="sa-aviso erro" style={{ marginTop: 10 }}>{problemas.alvo}</div>}

          <div className="sa-campos" style={{ marginTop: 14 }}>
            <label><Rotulo dica="quantas empresas podem usar; vazio = sem limite. Cadastro abandonado devolve o uso">Limite de usos</Rotulo>
              <input inputMode="numeric" value={f.max_usos} placeholder="Sem limite" onChange={(e) => campo("max_usos", e.target.value.replace(/\D/g, ""))} />
              {erro("max_usos")}
            </label>
            <label><Rotulo dica="vale até o fim deste dia (horário de Brasília); vazio = sem prazo">Válido até</Rotulo>
              <input type="date" value={f.valido_ate} onChange={(e) => campo("valido_ate", e.target.value)} />
              {erro("valido_ate")}
            </label>
          </div>
          <div className="sa-cupom-planos">
            <span>Planos<Dica>nenhum marcado = vale em todos</Dica></span>
            {planos.map((p) => (
              <label key={p.id} className="sa-check">
                <input type="checkbox" checked={f.planos.includes(p.id)}
                  onChange={(e) => campo("planos", e.target.checked ? [...f.planos, p.id] : f.planos.filter((x) => x !== p.id))} />
                {p.nome} · {fmtPreco(Number(p.preco_mensal))}/mês
              </label>
            ))}
          </div>

          {cupom && (
            <div className="sa-cupom-previa" aria-live="polite">
              <b>O cliente vê:</b> {textosDoCupom(cupom).join(" · ")}
              {conta && exemplo && (
                <small>Exemplo no {exemplo.nome}, mensal: 1º pagamento de {fmtPreco(conta.antes.total)} vira <b>{fmtPreco(conta.depois.total)}</b>
                  {conta.depois.meses_gratis > 0 ? ` (a 1ª mensalidade vence em ${conta.depois.meses_gratis} ${conta.depois.meses_gratis === 1 ? "mês" : "meses"})` : ""}.</small>
              )}
            </div>
          )}

          <div className="sa-rodape-form">
            <button type="button" className="fantasma" style={{ marginRight: "auto" }} onClick={() => { setAberto(false); setEditando(null); setF(VAZIO); }}>Cancelar</button>
            <button type="submit" className="principal" disabled={ocupado}>{ocupado ? "Salvando…" : editando ? "Salvar o cupom" : "Criar cupom"}</button>
          </div>
        </form>
      )}

      {lista === null ? <p className="sub">Carregando os cupons…</p> : !lista.length ? (
        !aberto && <p className="sub" style={{ margin: "10px 0 0" }}>Nenhum cupom ainda. Crie o primeiro em “Novo cupom”.</p>
      ) : (
        <div className="sa-tabela-wrap" style={{ marginTop: 14 }}>
          <table className="sa-tabela sa-cupons-tabela">
            <thead><tr><th>Cupom</th><th>O que dá</th><th>Usos</th><th>Validade</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {lista.map((c) => {
                const link = linkDoCupom(c.codigo, c.planos?.length === 1 ? c.planos[0] : null);
                return (
                  <tr key={c.id}>
                    <td>
                      <b className="mono">{c.codigo}</b> <span className={`sa-pill ${CLASSE[c.situacao]}`}>{ROTULO[c.situacao]}</span>
                      {c.descricao && <div className="sub" style={{ fontSize: 12 }}>{c.descricao}</div>}
                    </td>
                    <td>
                      {resumoDoCupom(cupomDe(c)) || "—"}
                      <div className="sub" style={{ fontSize: 12 }}>{c.nomes_planos.length ? `só ${c.nomes_planos.join(", ")}` : "todos os planos"}</div>
                    </td>
                    <td>
                      {c.usos}{c.max_usos ? ` de ${c.max_usos}` : ""}
                      {c.empresas.length > 0 && (
                        <details className="sa-cupom-quem">
                          <summary className="sub">quem usou</summary>
                          <ul>{c.empresas.map((e) => <li key={e.id}><a href={`#/admin/empresas/${e.id}`}>{e.nome}</a> <span className="sub">{fmtData(e.usado_em)}</span></li>)}</ul>
                        </details>
                      )}
                    </td>
                    <td>{c.valido_ate ? `até ${fmtData(`${c.valido_ate}T12:00:00`)}` : "sem prazo"}</td>
                    <td>
                      <span className="sa-cupom-acoes">
                        <button type="button" onClick={() => copiarLink(c)} title={link}>{copiado === c.id ? "Copiado ✓" : "Copiar link"}</button>
                        <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(textoDoCupom(link, c.codigo, resumoDoCupom(cupomDe(c))))}`, "_blank", "noopener")}>WhatsApp</button>
                        <button type="button" className="fantasma" onClick={() => editar(c)}>Editar</button>
                        <button type="button" className="fantasma" onClick={async () => {
                          try { await ativarCupom(c.id, !c.ativo); await carregar(); } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
                        }}>{c.ativo ? "Desativar" : "Ativar"}</button>
                        {c.usos === 0 && (
                          <button type="button" className="perigo-btn" onClick={async () => {
                            if (!(await confirmar({ titulo: `Excluir o cupom ${c.codigo}?`, texto: "Ninguém usou ainda; ele some da lista e o código deixa de valer.", confirmar: "Excluir", perigo: true }))) return;
                            try { await excluirCupom(c.id); await carregar(); } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
                          }}>Excluir</button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
