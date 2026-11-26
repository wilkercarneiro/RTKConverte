// O pagamento do autocadastro (migração 0040 + ação pagar_cadastro): o período
// (mensal, semestral, anual), Pix ou cartão em até N vezes. Aparece no passo 3
// do #/assinar e na tela "Falta o pagamento" de quem se cadastrou pelo site.
//
// A conta mostrada aqui é a mesma que o servidor faz (_shared/parcelas.ts), mas
// quem decide o valor é a função: daqui vai só a escolha. Pix: o QR na tela e a
// liberação sozinha (confere a cada 15 s). Cartão: aprovado entra; em análise,
// espera; recusado, a mensagem do Asaas e o que foi digitado fica (menos o CVV).
import { useEffect, useRef, useState } from "react";
import { conferirPagamentos, minhaCobranca, pagarCadastro } from "../lib/cobranca";
import type { MinhaCobranca, ResultadoPagarCadastro } from "../lib/cobranca";
import type { CicloCadastro as Ciclo } from "../../supabase/functions/_shared/parcelas.ts";
import {
  ciclosAtivos, economia, MESES, NOME_CICLO, normalizarRegras, opcoesDeParcelas, valorDoPeriodo,
} from "../../supabase/functions/_shared/parcelas.ts";
import type { Parcelamento } from "../../supabase/functions/_shared/parcelas.ts";
import {
  cupomDe, descontaMensalidade, mensalidadeComCupom, mesesGratis, primeiroPagamento, textosDoCupom,
} from "../../supabase/functions/_shared/cupons.ts";
import type { Cupom } from "../../supabase/functions/_shared/cupons.ts";
import { fmtReais } from "../../supabase/functions/_shared/precos.ts";
import { FormCartao } from "./Cartao";
import { Dica } from "./ui";
import "./assinar.css";

/** A empresa do autocadastro esperando o 1º pagamento (a tela nova); o resto segue na tela de antes. */
export function pagaPeloSite(c: MinhaCobranca | null | undefined): boolean {
  return !!c && c.origem === "site" && c.status === "aguardando_pagamento" && !!c.sou_dono && !!c.pagamento_online
    && (c.situacao === "sem_assinatura" || c.situacao === "aguardando") && Number(c.mensalidade ?? 0) > 0;
}

/** "6x de R$ 49,98 sem juros" · "7x de R$ 48,12 (total R$ 336,84)" · "1x de R$ 299,90 (à vista)" */
export function rotuloParcela(p: Parcelamento): string {
  if (p.n === 1) return `1x de ${fmtReais(p.total)} (à vista)`;
  return p.juros ? `${p.n}x de ${fmtReais(p.parcela)} (total ${fmtReais(p.total)})` : `${p.n}x de ${fmtReais(p.parcela)} sem juros`;
}

const mesesTxt = (n: number) => (n === 1 ? "1 mês" : `${n} meses`);

/** 0052: como fica a renovação com o cupom ("R$ 239,92 nas próximas 2 cobranças e depois R$ 299,90"). */
export function textoRenovacao(periodo: string, valorPeriodo: number, cupom: Cupom | null): string {
  const n = mesesGratis(cupom);
  if (n > 0) return `A 1ª mensalidade (${fmtReais(valorPeriodo)}) vence daqui a ${mesesTxt(n)}; depois, renovação ${periodo}.`;
  if (!descontaMensalidade(cupom)) return `Renovação ${periodo}: ${fmtReais(valorPeriodo)}.`;
  const com = mensalidadeComCupom(valorPeriodo, cupom);
  if (cupom!.mensalidade_vezes === null) return `Renovação ${periodo}: ${fmtReais(com)} (o desconto do cupom vale em todas).`;
  const resto = cupom!.mensalidade_vezes - 1;
  return resto > 0
    ? `Renovação ${periodo}: ${fmtReais(com)} na${resto > 1 ? `s próximas ${resto} cobranças` : " próxima cobrança"} e depois ${fmtReais(valorPeriodo)}.`
    : `Renovação ${periodo}: ${fmtReais(valorPeriodo)}.`;
}

/**
 * O 1º pagamento explicado: o plano do período, a adesão (0044, uma vez só), o
 * que o cupom tira de cada um (0052) e o total, com o texto da adesão que o
 * superadmin escreveu no painel. Sem adesão e sem cupom, não aparece.
 */
export function ResumoAdesao({ plano, periodo, valorPeriodo, adesao, texto, cupom = null }: {
  plano: string | null; periodo: string; valorPeriodo: number; adesao: number; texto: string;
  /** 0052: o cupom aplicado (valorPeriodo e adesao são os cheios) */
  cupom?: Cupom | null;
}) {
  if (!(adesao > 0) && !cupom) return null;
  const pp = primeiroPagamento(valorPeriodo, adesao, cupom);
  const menosPeriodo = valorPeriodo - pp.periodo;
  // (inclui a adesão que, sozinha abaixo do mínimo do Asaas, ficou isenta)
  const menosAdesao = adesao - pp.adesao;
  const [txtAdesao, txtMensal] = cupom
    ? [textosDoCupom({ ...cupom, mensalidade_tipo: null })[0], textosDoCupom({ ...cupom, adesao_tipo: null })[0]]
    : [undefined, undefined];
  return (
    <div className={`as-adesao${cupom ? " com-cupom" : ""}`} aria-label={cupom ? "Primeiro pagamento com o cupom" : "Taxa de adesão"}>
      {pp.meses_gratis > 0 ? (
        // isenção: o período não é descontado, a 1ª cobrança é que vem depois (no anual, 3 meses grátis ≠ um ano de desconto)
        <>
          <span className="as-adesao-linha"><span>Plano{plano ? ` ${plano}` : ""} ({periodo}): {fmtReais(valorPeriodo)}</span><b>{fmtReais(0)} agora</b></span>
          <span className="as-adesao-linha desconto"><span>Cupom {cupom!.codigo}: {(txtMensal ?? "").toLowerCase()}</span>
            <b>1ª cobrança em {pp.meses_gratis === 1 ? "1 mês" : `${pp.meses_gratis} meses`}</b></span>
        </>
      ) : (
        <span className="as-adesao-linha"><span>Plano{plano ? ` ${plano}` : ""} ({periodo})</span><b>{fmtReais(valorPeriodo)}</b></span>
      )}
      {pp.meses_gratis === 0 && menosPeriodo > 0.004 && (
        <span className="as-adesao-linha desconto"><span>Cupom {cupom!.codigo}: {txtMensal?.toLowerCase() ?? "desconto"}</span><b>− {fmtReais(menosPeriodo)}</b></span>
      )}
      {adesao > 0 && <span className="as-adesao-linha"><span>Taxa de adesão (pagamento único)</span><b>{fmtReais(adesao)}</b></span>}
      {adesao > 0 && menosAdesao > 0.004 && (
        <span className="as-adesao-linha desconto"><span>Cupom {cupom!.codigo}: {(txtAdesao ?? "desconto na adesão").toLowerCase()}</span><b>− {fmtReais(menosAdesao)}</b></span>
      )}
      <span className="as-adesao-linha total"><span>{pp.total > 0 ? "Primeiro pagamento" : "A pagar agora"}</span><b>{fmtReais(pp.total)}</b></span>
      <p>
        {adesao > 0 && <><b>O que é a adesão?</b> {texto} </>}
        {textoRenovacao(periodo, valorPeriodo, cupom)}
      </p>
    </div>
  );
}

type Estado = "escolher" | "pix" | "analise" | "pago";

export function PagamentoCadastro({ cobranca, vigiar = true, onConfirmado }: {
  cobranca: MinhaCobranca;
  /** confere o pagamento a cada 15 s enquanto o Pix ou a análise do cartão esperam */
  vigiar?: boolean;
  /** pagou: quem mostra a tela troca o título ("Falta o pagamento" não vale mais) */
  onConfirmado?: () => void;
}) {
  const regras = normalizarRegras(cobranca.regras);
  const ativos = ciclosAtivos(regras);
  const mensalidade = Number(cobranca.mensalidade ?? 0);
  const ultimo = cobranca.ultimo_pagamento;
  const [ciclo, setCiclo] = useState<Ciclo>(cobranca.ciclo && (ativos as string[]).includes(cobranca.ciclo) ? (cobranca.ciclo as Ciclo) : (ativos[0] ?? "MONTHLY"));
  const [forma, setForma] = useState<"pix" | "cartao">("pix");
  const [n, setN] = useState(1);
  const [estado, setEstado] = useState<Estado>(ultimo?.status === "AWAITING_RISK_ANALYSIS" ? "analise" : "escolher");
  const [pix, setPix] = useState<ResultadoPagarCadastro | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(ultimo?.status === "REPROVADO"
    ? "O último pagamento no cartão não foi aprovado na análise do Asaas e não foi cobrado. Tente o Pix ou outro cartão." : null);
  const [copiado, setCopiado] = useState(false);
  const [conferindo, setConferindo] = useState(false);

  // o período e, só no 1º pagamento, a adesão (0044), com o cupom do cadastro (0052): o servidor faz a mesma conta
  const cupom = cupomDe(cobranca.cupom);
  const periodoCheio = valorDoPeriodo(mensalidade, ciclo, regras.ciclos[ciclo].desconto);
  const pp = primeiroPagamento(periodoCheio, regras.adesao, cupom);
  const periodo = pp.periodo;
  const total = pp.total;
  const opcoes = opcoesDeParcelas(total, ciclo, regras);
  const escolhida = opcoes[Math.min(n, opcoes.length) - 1];
  const temJuros = opcoes.some((p) => p.juros);

  // Pix gerado antes (voltou à tela): mostra o mesmo, sem criar outro
  useEffect(() => {
    // (com adesão o Pix é avulso: não há assinatura, só o link)
    if (cobranca.situacao === "aguardando" && cobranca.link && estado === "escolher"
      && (cobranca.assinatura || cobranca.ultimo_pagamento?.forma === "PIX")) void gerarPix(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pagou (Pix, ou a análise do cartão aprovou): entra sozinho
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  useEffect(() => { if (estado === "pago") onConfirmado?.(); }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!vigiar || (estado !== "pix" && estado !== "analise")) return;
    const t = setInterval(() => { void conferir(false); }, 15_000);
    return () => clearInterval(t);
  }, [vigiar, estado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function conferir(manual: boolean) {
    if (manual) setConferindo(true);
    try {
      await conferirPagamentos().catch(() => null);
      const c = await minhaCobranca();
      if (c?.status === "ativo") { setEstado("pago"); return; }
      if (estadoRef.current === "analise" && c?.ultimo_pagamento?.status === "REPROVADO") {
        setEstado("escolher");
        setErro("O pagamento no cartão não foi aprovado na análise do Asaas e não foi cobrado. Tente o Pix ou outro cartão.");
      } else if (manual) {
        setErro(estadoRef.current === "analise"
          ? "Ainda em análise. Esta tela libera sozinha quando o Asaas aprovar."
          : "O pagamento ainda não apareceu. O Pix confirma em segundos depois de pago; esta tela libera sozinha.");
      }
    } finally {
      if (manual) setConferindo(false);
    }
  }

  function trocarCiclo(c: Ciclo) {
    if (c === ciclo || gerando) return;
    setCiclo(c);
    setN((atual) => Math.min(atual, opcoesDeParcelas(primeiroPagamento(valorDoPeriodo(mensalidade, c, regras.ciclos[c].desconto), regras.adesao, cupom).total, c, regras).length));
    // o Pix gerado era de outro valor
    if (estado === "pix") { setPix(null); setEstado("escolher"); }
    setErro(null);
  }

  function resultado(r: ResultadoPagarCadastro) {
    if (r.ativou || r.pago || r.ja_ativa) { setEstado("pago"); return true; }
    if (r.em_analise) { setEstado("analise"); return true; }
    return false;
  }

  async function gerarPix(silencioso = false) {
    setGerando(true); setErro(null);
    try {
      const r = await pagarCadastro({ forma: "pix", ciclo: silencioso && cobranca.ciclo ? cobranca.ciclo : ciclo });
      if (resultado(r)) return;
      setPix(r);
      setEstado("pix");
      setForma("pix");
    } catch (x) {
      if (!silencioso) setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    if (!pix?.pix?.payload) return;
    try { await navigator.clipboard.writeText(pix.pix.payload); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
    catch { setErro("Não deu para copiar: selecione o código e copie à mão."); }
  }

  if (estado === "pago") {
    return (
      <div className="as-resultado ok" role="status">
        <span className="as-selo-ok" aria-hidden="true">✓</span>
        <h3>Pagamento confirmado — sua conta está liberada</h3>
        <p>Pronto: o plano já está valendo. Avisamos também no WhatsApp.</p>
        <button type="button" className="principal" onClick={() => { location.hash = "#/"; location.reload(); }}>Entrar no Vertces</button>
      </div>
    );
  }
  if (estado === "analise") {
    return (
      <div className="as-resultado analise" role="status">
        <span className="spinner" aria-hidden="true" />
        <h3>Pagamento em análise</h3>
        <p>O Asaas está conferindo a compra no cartão (costuma levar alguns minutos; no máximo 48 horas). Assim que aprovar, esta tela libera sozinha e avisamos no WhatsApp.</p>
        {erro && <p className="sub">{erro}</p>}
        <button type="button" onClick={() => conferir(true)} disabled={conferindo}>{conferindo ? "Conferindo…" : "Conferir agora"}</button>
      </div>
    );
  }

  return (
    <div className="as-pagamento">
      {ativos.length > 1 && (
        <div className="as-periodos" role="radiogroup" aria-label="Período" style={{ ["--periodos" as string]: ativos.length } as React.CSSProperties}>
          {ativos.map((c) => {
            const v = valorDoPeriodo(mensalidade, c, regras.ciclos[c].desconto);
            return (
              <button key={c} type="button" role="radio" aria-checked={c === ciclo} className={`as-periodo${c === ciclo ? " sel" : ""}`} onClick={() => trocarCiclo(c)}>
                <b>{NOME_CICLO[c]}</b>
                <span>{fmtReais(v)}</span>
                {regras.ciclos[c].desconto > 0 && <em>−{String(regras.ciclos[c].desconto).replace(".", ",")}%</em>}
              </button>
            );
          })}
        </div>
      )}
      <div className="as-total">
        <span>{cobranca.plano ? <>Plano <b>{cobranca.plano}</b> · </> : null}{NOME_CICLO[ciclo].toLowerCase()}</span>
        <b>{periodo !== periodoCheio && <s className="as-riscado">{fmtReais(periodoCheio)}</s>}{fmtReais(periodo)}</b>
        {MESES[ciclo] > 1 && periodo > 0 && (
          <small>
            equivale a {fmtReais(periodo / MESES[ciclo])}/mês
            {economia(mensalidade, ciclo, regras.ciclos[ciclo].desconto) > 0 && <> · economia de {fmtReais(economia(mensalidade, ciclo, regras.ciclos[ciclo].desconto))}</>}
          </small>
        )}
        {cupom && <small className="as-cupom-nota">Cupom <b>{cupom.codigo}</b> aplicado no cadastro.</small>}
      </div>

      <ResumoAdesao plano={cobranca.plano ?? null} periodo={NOME_CICLO[ciclo].toLowerCase()} valorPeriodo={periodoCheio} adesao={regras.adesao} texto={regras.adesao_texto} cupom={cupom} />

      {!(total > 0) && (
        // 0052: o cupom zerou o 1º pagamento (a conta normalmente já entra no cadastro; isto é a volta de segurança)
        <div className="as-acao">
          <button type="button" className="principal" disabled={gerando} onClick={() => gerarPix()}>{gerando ? "Liberando…" : "Liberar a conta (nada a pagar agora)"}</button>
        </div>
      )}

      {total > 0 && <div className="as-formas" role="radiogroup" aria-label="Forma de pagamento">
        <button type="button" role="radio" aria-checked={forma === "pix"} className={`as-forma${forma === "pix" ? " sel" : ""}`} onClick={() => setForma("pix")}>
          <b>Pix</b><small>libera em segundos</small>
        </button>
        <button type="button" role="radio" aria-checked={forma === "cartao"} className={`as-forma${forma === "cartao" ? " sel" : ""}`} onClick={() => setForma("cartao")}>
          <b>Cartão de crédito</b>
          <small>{opcoes.length > 1 ? `em até ${opcoes.length}x${regras.parcelas_sem_juros > 1 ? ` · até ${Math.min(regras.parcelas_sem_juros, opcoes.length)}x sem juros` : ""}` : "à vista"}</small>
        </button>
      </div>}

      {erro && <div className="aviso-erro-pagina" role="alert">{erro}</div>}

      {total > 0 && forma === "pix" && (estado === "pix" && pix ? (
        <div className="as-pix">
          {pix.pix?.encodedImage
            ? <img src={`data:image/png;base64,${pix.pix.encodedImage}`} alt="QR Code do Pix" width={220} height={220} />
            : <p className="sub">O QR Code não veio agora: use a página de pagamento.</p>}
          <div className="as-pix-lado">
            <b>Pix de {fmtReais(pix.valor ?? total)}</b>
            {pix.pix?.payload && (
              <label className="as-copia">
                <span>Pix copia e cola</span>
                <span className="as-copia-linha">
                  <input readOnly className="mono" value={pix.pix.payload} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar"}</button>
                </span>
              </label>
            )}
            <p className="as-esperando"><span className="spinner" aria-hidden="true" /> Esperando o pagamento: esta tela libera sozinha.</p>
            <span className="as-pix-acoes">
              <button type="button" onClick={() => conferir(true)} disabled={conferindo}>{conferindo ? "Conferindo…" : "Já paguei"}</button>
              {pix.link && <a className="link" href={pix.link} target="_blank" rel="noreferrer">Abrir a página de pagamento</a>}
            </span>
          </div>
        </div>
      ) : (
        <div className="as-acao">
          <button type="button" className="principal" disabled={gerando} onClick={() => gerarPix()}>
            {gerando ? "Gerando o Pix…" : `Gerar o Pix de ${fmtReais(total)}`}
          </button>
        </div>
      ))}

      {total > 0 && forma === "cartao" && (
        <div className="as-cartao">
          {opcoes.length > 1 && (
            <label className="as-parcelas">
              <span>Parcelas{temJuros && <Dica>até {regras.parcelas_sem_juros}x sem juros; acima disso, juros de {String(regras.juros_mes).replace(".", ",")}% ao mês (Tabela Price), já somados no total</Dica>}</span>
              <select value={escolhida.n} onChange={(e) => setN(Number(e.target.value))}>
                {opcoes.map((p) => <option key={p.n} value={p.n}>{rotuloParcela(p)}</option>)}
              </select>
            </label>
          )}
          <FormCartao contato={cobranca.contato}
            botao={escolhida.n === 1 ? `Pagar ${fmtReais(escolhida.total)} no cartão` : `Pagar ${fmtReais(escolhida.total)} em ${escolhida.n}x`}
            enviar={async (cartao, titular) => {
              const r = await pagarCadastro({ forma: "cartao", ciclo, parcelas: escolhida.n, cartao, titular });
              if (!resultado(r)) setEstado("analise");
            }} />
        </div>
      )}
    </div>
  );
}
