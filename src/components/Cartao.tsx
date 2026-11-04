// O cartão de crédito da empresa (migração 0037 + edge function `cobranca`).
//
//   FormCartao        — o formulário (cartão + titular), validado enquanto digita
//   TelaCartao        — tela cheia ao entrar: "Cadastre o cartão para cobrança
//                       automática e compra de crédito" (com "Agora não")
//   AvisoCartao       — a faixa do Início para o dono sem cartão
//   PainelCartao      — Configurações → Plano e uso: o cartão salvo, trocar,
//                       remover e a compra automática de cada carteira
//   useRecargaAutomatica — carteira zerada + compra automática ligada: compra
//
// Os dados do cartão vão da tela para a função e dela ao Asaas; o Vertces
// guarda só bandeira, final e validade. Sem a tokenização liberada no Asaas, o
// cartão paga a mensalidade, mas não compra créditos (a tela diz isso).
import { useEffect, useRef, useState } from "react";
import {
  bandeiraDoNumero, formatarCep, formatarNumeroCartao, formatarValidade, problemasDoCartao,
} from "../../supabase/functions/_shared/cartao.ts";
import type { CartaoDigitado, TitularDigitado } from "../../supabase/functions/_shared/cartao.ts";
import { formatarTelefone, soDigitos } from "../../supabase/functions/_shared/cnpj.ts";
import { formatarDoc } from "./clientes/qualificacao";
import { definirRecarga, recargaAutomatica, removerCartao, salvarCartao } from "../lib/cobranca";
import type { CartaoPublico, MinhaCobranca, RecargaCarteira, ResultadoCartao } from "../lib/cobranca";
import { aVenda, disponivel, fmtPreco, nomeCredito } from "../lib/creditos";
import type { Carteira, Creditos } from "../lib/creditos";
import { cotar, minimoDe } from "../../supabase/functions/_shared/precos.ts";
import { avisar, confirmar, Dica, Gaveta, Rotulo } from "./ui";
import { Logo } from "./Logo";
import "./cartao.css";

const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const ADIADO = "vertces.cartao.adiado";

/** "Agora não" vale até sair do sistema (na próxima entrada a tela volta). */
export function cartaoAdiado(): boolean {
  try { return sessionStorage.getItem(ADIADO) === "1"; } catch { return false; }
}
export function adiarCartao(): void {
  try { sessionStorage.setItem(ADIADO, "1"); } catch { /* sem storage: volta a pedir */ }
}

/** Quantos créditos a compra automática compra por padrão: o mínimo da tabela, ao menos 5 (10 no CAR). */
export const padraoRecarga = (k: Carteira): number => Math.max(minimoDe(k.precos) ?? 1, k.servicos ? 10 : 5);

/** "Visa •••• 1111" */
export const rotuloCartao = (c: Pick<CartaoPublico, "bandeira" | "final">): string =>
  `${c.bandeira ? c.bandeira.charAt(0).toUpperCase() + c.bandeira.slice(1).toLowerCase() : "Cartão"} •••• ${c.final ?? "????"}`;

// ================================================================== o formulário

export function FormCartao({ contato, botao, onSalvo, rodape, carteirasVenda }: {
  contato?: MinhaCobranca["contato"];
  /** texto do botão de enviar */
  botao: string;
  onSalvo: (r: ResultadoCartao, recarga: boolean) => void | Promise<void>;
  /** à esquerda do botão (ex.: "Agora não") */
  rodape?: React.ReactNode;
  /** carteiras à venda: oferece ligar a compra automática junto */
  carteirasVenda?: Carteira[];
}) {
  const [c, setC] = useState<CartaoDigitado>({ numero: "", nome: "", validade: "", cvv: "" });
  const [t, setT] = useState<TitularDigitado>({
    nome: contato?.responsavel ?? "", cpf_cnpj: "", email: contato?.email ?? "",
    telefone: contato?.telefone ? formatarTelefone(contato.telefone) : "", cep: "", numero_endereco: "",
  });
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [recarga, setRecarga] = useState(true);
  const problemas = problemasDoCartao(c, t, hojeIso());
  const valido = Object.keys(problemas).length === 0;
  const bandeira = bandeiraDoNumero(c.numero);
  const msg = (k: string) => (tocado[k] && problemas[k] ? <span className="erro-campo">{problemas[k]}</span> : null);
  const toque = (k: string) => () => setTocado((x) => ({ ...x, [k]: true }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(Object.fromEntries(["numero", "nome", "validade", "cvv", "titular_nome", "cpf_cnpj", "email", "telefone", "cep", "numero_endereco"].map((k) => [k, true])));
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      const r = await salvarCartao(c, t);
      await onSalvo(r, recarga && !!carteirasVenda?.length);
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setEnviando(false);
    }
  }

  const digitos = soDigitos(c.numero);
  const mascara = (digitos + "•".repeat(Math.max(0, 16 - digitos.length))).replace(/(.{4})(?=.)/g, "$1 ");

  return (
    <form className="ct-form" onSubmit={enviar} noValidate>
      <div className="ct-plastico" aria-hidden="true">
        <span className="ct-chip" />
        <span className="ct-bandeira">{bandeira ?? ""}</span>
        <span className="ct-numero">{mascara}</span>
        <span className="ct-rodape">
          <span>{c.nome.trim().toUpperCase() || "NOME COMO NO CARTÃO"}</span>
          <span>{c.validade || "MM/AA"}</span>
        </span>
      </div>

      {erro && <div className="aviso-erro-pagina" role="alert">{erro}</div>}

      <fieldset className="ct-bloco">
        <legend>Cartão</legend>
        <div className="grade">
          <label><Rotulo>Número do cartão</Rotulo>
            <input inputMode="numeric" autoComplete="cc-number" className="mono" placeholder="0000 0000 0000 0000" value={c.numero}
              onChange={(e) => setC({ ...c, numero: formatarNumeroCartao(e.target.value) })} onBlur={toque("numero")} />
            {msg("numero")}
          </label>
          <label><Rotulo>Nome impresso no cartão</Rotulo>
            <input autoComplete="cc-name" value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} onBlur={toque("nome")} />
            {msg("nome")}
          </label>
          <label><Rotulo>Validade</Rotulo>
            <input inputMode="numeric" autoComplete="cc-exp" className="mono" placeholder="MM/AA" value={c.validade}
              onChange={(e) => setC({ ...c, validade: formatarValidade(e.target.value) })} onBlur={toque("validade")} />
            {msg("validade")}
          </label>
          <label><Rotulo dica="os 3 números no verso (4 na frente, no Amex)">Código de segurança</Rotulo>
            <input inputMode="numeric" autoComplete="cc-csc" className="mono" placeholder="CVV" maxLength={4} value={c.cvv}
              onChange={(e) => setC({ ...c, cvv: soDigitos(e.target.value).slice(0, 4) })} onBlur={toque("cvv")} />
            {msg("cvv")}
          </label>
        </div>
      </fieldset>

      <fieldset className="ct-bloco">
        <legend>Titular do cartão<Dica>o Asaas confere estes dados com a operadora do cartão</Dica></legend>
        <div className="grade">
          <label><Rotulo>Nome do titular</Rotulo>
            <input autoComplete="name" value={t.nome} onChange={(e) => setT({ ...t, nome: e.target.value })} onBlur={toque("titular_nome")} />
            {msg("titular_nome")}
          </label>
          <label><Rotulo dica="CPF de quem é o cartão, ou CNPJ se for cartão da empresa">CPF ou CNPJ do titular</Rotulo>
            <input inputMode="numeric" className="mono" value={t.cpf_cnpj}
              onChange={(e) => setT({ ...t, cpf_cnpj: formatarDoc(e.target.value, soDigitos(e.target.value).length > 11 ? "PJ" : "PF") })}
              onBlur={toque("cpf_cnpj")} />
            {msg("cpf_cnpj")}
          </label>
          <label><Rotulo>E-mail</Rotulo>
            <input type="email" autoComplete="email" value={t.email} onChange={(e) => setT({ ...t, email: e.target.value })} onBlur={toque("email")} />
            {msg("email")}
          </label>
          <label><Rotulo>Telefone</Rotulo>
            <input inputMode="tel" autoComplete="tel" value={t.telefone} placeholder="(71) 99999-0000"
              onChange={(e) => setT({ ...t, telefone: formatarTelefone(e.target.value) })} onBlur={toque("telefone")} />
            {msg("telefone")}
          </label>
          <label><Rotulo dica="o da fatura do cartão">CEP</Rotulo>
            <input inputMode="numeric" autoComplete="postal-code" className="mono" value={t.cep}
              onChange={(e) => setT({ ...t, cep: formatarCep(e.target.value) })} onBlur={toque("cep")} />
            {msg("cep")}
          </label>
          <label><Rotulo>Número do endereço</Rotulo>
            <input value={t.numero_endereco} placeholder="ex.: 120 ou S/N" onChange={(e) => setT({ ...t, numero_endereco: e.target.value })} onBlur={toque("numero_endereco")} />
            {msg("numero_endereco")}
          </label>
        </div>
      </fieldset>

      {!!carteirasVenda?.length && (
        <label className="ct-opcao">
          <input type="checkbox" checked={recarga} onChange={(e) => setRecarga(e.target.checked)} />
          <span>
            <b>Comprar créditos automaticamente quando acabarem</b>
            <small>
              {carteirasVenda.map((k) => {
                const q = padraoRecarga(k);
                const cot = cotar(k.precos, q);
                return `${q} ${nomeCredito(k)}${cot ? ` (${fmtPreco(cot.total)})` : ""}`;
              }).join(" · ")}. Dá para mudar a quantidade, pôr um limite por mês ou desligar em Configurações → Plano e uso.
            </small>
          </span>
        </label>
      )}

      <p className="ct-seguro">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" /></svg>
        Os dados do cartão vão direto para o Asaas, que processa os pagamentos. O Vertces guarda só a bandeira e os 4 últimos números.
      </p>

      <div className="ct-acoes">
        {rodape}
        <button type="submit" className="principal" disabled={enviando}>{enviando ? "Conferindo o cartão…" : botao}</button>
      </div>
    </form>
  );
}

/** Depois de salvar: liga a compra automática das carteiras à venda (quando o cartão compra créditos). */
async function ligarRecargaPadrao(carteiras: Carteira[] | undefined, r: ResultadoCartao, querRecarga: boolean): Promise<void> {
  if (!querRecarga || !r.reutilizavel || !carteiras?.length) return;
  for (const k of carteiras) await definirRecarga(k.chave, true, padraoRecarga(k), null).catch(() => null);
}

function textoSalvo(r: ResultadoCartao, recarga: boolean): string {
  const base = `Cartão ${r.bandeira ? `${r.bandeira} ` : ""}final ${r.final} cadastrado.`;
  const pago = r.ativou ? " A mensalidade foi paga e o acesso está liberado." : r.pagas > 0 ? " A mensalidade em aberto foi paga." : "";
  const mens = r.assinatura ? " A mensalidade passa a ser cobrada nele." : "";
  const cred = r.reutilizavel ? (recarga ? " A compra automática de créditos está ligada." : "") : " Os créditos continuam por Pix por enquanto.";
  return base + pago + mens + cred;
}

// ================================================================== tela cheia ao entrar

export function TelaCartao({ cobranca, carteirasVenda, onPronto, onAdiar }: {
  cobranca: MinhaCobranca;
  carteirasVenda?: Carteira[];
  onPronto: () => void;
  onAdiar: () => void;
}) {
  return (
    <div className="centro ct-tela">
      <div className="ct-caixa">
        <Logo size={28} />
        <span className="olho-pagina" style={{ marginTop: 18, display: "block" }}>Pagamento</span>
        <h2>Cadastre o cartão para cobrança automática e compra de crédito</h2>
        <ul className="ct-vantagens">
          <li><b>Mensalidade no automático</b><span>{cobranca.valor ? `${fmtPreco(Number(cobranca.valor))} por mês, ` : ""}paga sozinha no vencimento: sem boleto e sem acesso suspenso por esquecimento.</span></li>
          <li><b>Créditos que não acabam</b><span>Quando os créditos zerarem, o Vertces compra mais no cartão e o trabalho segue. Você escolhe quantos e pode desligar.</span></li>
        </ul>
        <FormCartao contato={cobranca.contato} carteirasVenda={carteirasVenda} botao="Cadastrar cartão"
          rodape={<button type="button" className="fantasma" onClick={() => { adiarCartao(); onAdiar(); }}>Agora não</button>}
          onSalvo={async (r, recarga) => {
            await ligarRecargaPadrao(carteirasVenda, r, recarga);
            avisar("ok", textoSalvo(r, recarga));
            onPronto();
          }} />
      </div>
    </div>
  );
}

// ================================================================== a faixa do Início

export function AvisoCartao({ cobranca, creditos, onCadastrado }: {
  cobranca: MinhaCobranca | null; creditos?: Creditos | null; onCadastrado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  if (!cobranca?.precisa_cartao || !cobranca.sou_dono) return null;
  const venda = (creditos?.carteiras ?? []).filter(aVenda);
  return (
    <>
      <div className="ct-aviso" role="status">
        <span className="ct-aviso-icone" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
        </span>
        <span><b>Cadastre o cartão para cobrança automática e compra de crédito</b>
          <small>A mensalidade é paga sozinha e os créditos são repostos quando acabam.</small></span>
        <button type="button" className="principal" onClick={() => setAberto(true)}>Cadastrar cartão</button>
      </div>
      {aberto && (
        <Gaveta olho="Pagamento" titulo="Cartão de crédito" onFechar={() => setAberto(false)}>
          <FormCartao contato={cobranca.contato} carteirasVenda={venda} botao="Cadastrar cartão"
            onSalvo={async (r, recarga) => {
              await ligarRecargaPadrao(venda, r, recarga);
              avisar("ok", textoSalvo(r, recarga));
              setAberto(false);
              onCadastrado();
            }} />
        </Gaveta>
      )}
    </>
  );
}

// ================================================================== Configurações → Plano e uso

export function PainelCartao({ cobranca, creditos, onMudou }: {
  cobranca: MinhaCobranca | null; creditos: Creditos | null | undefined; onMudou: () => void;
}) {
  const [trocando, setTrocando] = useState(false);
  const cartao = cobranca?.cartao ?? creditos?.cartao ?? null;
  const dono = cobranca?.sou_dono ?? creditos?.sou_dono ?? false;
  const venda = (creditos?.carteiras ?? []).filter(aVenda);
  if (!cobranca?.pagamento_online && !creditos?.pagamento_online) return null;
  if (!cartao && !cobranca?.precisa_cartao) return null;

  async function remover() {
    if (!(await confirmar({
      titulo: "Remover o cartão?",
      texto: "A mensalidade volta a ser cobrada por boleto ou Pix (o link chega no vencimento) e a compra automática de créditos para.",
      confirmar: "Remover o cartão", perigo: true,
    }))) return;
    try { await removerCartao(); avisar("ok", "Cartão removido."); onMudou(); } catch (e) { avisar("erro", e instanceof Error ? e.message : String(e)); }
  }

  return (
    <section className="bloco">
      <header>
        <h3>Cartão e compra automática<Dica>o cartão paga a mensalidade no vencimento e, se você quiser, compra créditos quando eles acabam</Dica></h3>
        {dono && cartao && (
          <span className="ct-cab-acoes">
            <button type="button" className="link" onClick={() => setTrocando(true)}>Trocar cartão</button>
            <button type="button" className="link ct-remover" onClick={remover}>Remover</button>
          </span>
        )}
      </header>
      {!cartao ? (
        <div className="ct-vazio">
          <p>Nenhum cartão cadastrado. {dono ? "Cadastre um para a mensalidade sair sozinha e os créditos serem repostos quando acabarem." : "Só o dono da empresa cadastra o cartão."}</p>
          {dono && <button type="button" className="principal" onClick={() => setTrocando(true)}>Cadastrar cartão</button>}
        </div>
      ) : (
        <>
          <div className="ct-salvo">
            <span className="ct-mini" aria-hidden="true">{(cartao.bandeira ?? "").slice(0, 4).toUpperCase() || "▭"}</span>
            <div>
              <b>{rotuloCartao(cartao)}</b>
              <small>validade {cartao.validade ?? "—"}{cartao.titular ? ` · ${cartao.titular}` : ""}</small>
            </div>
            <span className="ct-selo">{cartao.reutilizavel ? "Mensalidade e créditos" : "Mensalidade"}</span>
          </div>
          {cartao.recusa_em && (
            <div className="aviso-erro-pagina" role="alert">
              A última compra automática foi recusada ({new Date(cartao.recusa_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}): {cartao.recusa_motivo}. {dono ? "Troque o cartão ou compre por Pix." : ""}
            </div>
          )}
          {!cartao.reutilizavel && (
            <p className="sub ct-nota">Este cartão paga a mensalidade. Comprar créditos com ele (na hora ou automático) ainda não está disponível; os créditos continuam por Pix, boleto ou cartão na página de pagamento.</p>
          )}
          {cartao.reutilizavel && venda.length > 0 && (
            <div className="ct-recargas">
              {venda.map((k) => <LinhaRecarga key={k.chave} k={k} atual={creditos?.recarga?.[k.chave]} dono={dono} onMudou={onMudou} />)}
            </div>
          )}
        </>
      )}
      {trocando && (
        <Gaveta olho="Pagamento" titulo={cartao ? "Trocar o cartão" : "Cartão de crédito"} onFechar={() => setTrocando(false)}>
          <FormCartao contato={cobranca?.contato} carteirasVenda={cartao ? undefined : venda} botao={cartao ? "Usar este cartão" : "Cadastrar cartão"}
            onSalvo={async (r, recarga) => {
              await ligarRecargaPadrao(venda, r, recarga);
              avisar("ok", textoSalvo(r, recarga));
              setTrocando(false);
              onMudou();
            }} />
        </Gaveta>
      )}
    </section>
  );
}

/** Uma carteira: ligada, quantos comprar e o limite do mês. */
function LinhaRecarga({ k, atual, dono, onMudou }: { k: Carteira; atual?: RecargaCarteira; dono: boolean; onMudou: () => void }) {
  const minimo = minimoDe(k.precos) ?? 1;
  const [ativo, setAtivo] = useState(atual?.ativo ?? false);
  const [qtd, setQtd] = useState(String(atual?.quantidade ?? padraoRecarga(k)));
  const [limite, setLimite] = useState(atual?.limite_periodo != null ? String(atual.limite_periodo).replace(".", ",") : "");
  const [salvando, setSalvando] = useState(false);
  const n = Math.floor(Number(qtd));
  const cot = n >= minimo ? cotar(k.precos, n) : null;
  const lim = limite.trim() === "" ? null : Number(limite.replace(/\./g, "").replace(",", "."));
  const mudou = ativo !== (atual?.ativo ?? false) || n !== (atual?.quantidade ?? padraoRecarga(k)) || lim !== (atual?.limite_periodo ?? null);
  const erro = !(n >= minimo) ? `Mínimo de ${minimo}.` : lim !== null && (!(lim > 0) || (cot && lim < cot.total)) ? "O limite precisa cobrir ao menos uma compra." : null;

  async function salvar() {
    if (erro && ativo) return;
    setSalvando(true);
    try { await definirRecarga(k.chave, ativo, n, ativo ? lim : null); avisar("ok", ativo ? `Compra automática de ${nomeCredito(k)} ligada.` : `Compra automática de ${nomeCredito(k)} desligada.`); onMudou(); }
    catch (e) { avisar("erro", e instanceof Error ? e.message : String(e)); }
    finally { setSalvando(false); }
  }

  return (
    <div className={`ct-recarga${ativo ? " ligada" : ""}`}>
      <label className="ct-chave">
        <input type="checkbox" checked={ativo} disabled={!dono} onChange={(e) => setAtivo(e.target.checked)} />
        <span><b>{k.nome}</b><small>{ativo ? `quando acabarem, compra ${n || "?"}${cot ? ` por ${fmtPreco(cot.total)}` : ""}` : "desligada: quando acabarem, você compra à mão"}</small></span>
      </label>
      {ativo && (
        <div className="ct-recarga-campos">
          <label><Rotulo>Quantos comprar</Rotulo>
            <input type="number" min={minimo} max={1000} value={qtd} disabled={!dono} onChange={(e) => setQtd(e.target.value)} />
          </label>
          <label><Rotulo dica="vazio = sem limite. Conta o que a compra automática gastou desde a última renovação dos créditos.">Limite por mês (R$)</Rotulo>
            <input inputMode="decimal" placeholder="sem limite" value={limite} disabled={!dono} onChange={(e) => setLimite(e.target.value)} />
          </label>
        </div>
      )}
      {atual?.ativo && atual.gasto_periodo > 0 && <small className="sub">Gasto neste mês: {fmtPreco(atual.gasto_periodo)}{atual.limite_periodo ? ` de ${fmtPreco(atual.limite_periodo)}` : ""}</small>}
      {ativo && erro && <span className="erro-campo">{erro}</span>}
      {dono && mudou && <button type="button" className="principal" disabled={salvando || (ativo && !!erro)} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</button>}
    </div>
  );
}

// ================================================================== a compra automática acontecendo

/**
 * Carteira zerada com a compra automática ligada e cartão que compra: pede ao
 * servidor (que decide de novo, com a empresa travada). No máximo uma vez por
 * minuto por tela; o resultado vira um aviso e recarrega os créditos.
 */
export function useRecargaAutomatica(creditos: Creditos | null | undefined, recarregar: () => void): void {
  const ultima = useRef(0);
  useEffect(() => {
    if (!creditos?.cartao?.reutilizavel || !creditos.recarga) return;
    const zeradas = creditos.carteiras.filter((k) => creditos.recarga?.[k.chave]?.ativo && disponivel(k) === 0);
    if (!zeradas.length || Date.now() - ultima.current < 60_000) return;
    ultima.current = Date.now();
    recargaAutomatica().then((r) => {
      const ok = r.compras.filter((c) => c.ok);
      const falhou = r.compras.filter((c) => !c.ok);
      if (ok.length) avisar("ok", `Seus créditos acabaram e a compra automática repôs: ${ok.map((c) => c.descricao).join(" e ")}, no cartão.`);
      for (const c of falhou) avisar("erro", `A compra automática (${c.descricao}) foi recusada no cartão: ${c.erro}`);
      if (r.compras.length) recarregar();
    }).catch(() => null);
  }, [creditos]); // eslint-disable-line react-hooks/exhaustive-deps
}
