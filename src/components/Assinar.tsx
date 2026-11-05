// Autocadastro (migração 0040): a página pública #/assinar, aberta sem login
// pelo link de cadastro (/cadastro/?plano=<id>&ciclo=anual → /app/#/assinar?…).
// Três passos numa tela só:
//   1. Seus dados  — empresa (ou o seu nome), CPF/CNPJ, responsável, WhatsApp,
//                    e-mail de acesso, senha e o aceite dos termos;
//   2. Plano       — os planos à venda e o período (mensal, semestral, anual);
//                    "Criar conta e ir para o pagamento" cria a conta (função
//                    `cobranca`, ação pública cadastro_criar) e já entra com ela;
//   3. Pagamento   — Pix ou cartão em até N vezes (PagamentoCadastro).
// Quem confere tudo é o servidor; aqui a validação é só para avisar cedo.
import { useEffect, useMemo, useState } from "react";
import { supabase, ErroFuncao } from "../lib/supabase";
import { criarCadastro, minhaCobranca, planosDoCadastro } from "../lib/cobranca";
import type { CadastroPlanos, MinhaCobranca, PlanoAVenda } from "../lib/cobranca";
import { SUPORTE_WHATSAPP, VERSAO_TERMOS } from "../lib/config";
import {
  formatarDocumento, formatarTelefone, problemasDoCadastro, soDigitos,
} from "../../supabase/functions/_shared/cnpj.ts";
import {
  cicloDe, ciclosAtivos, economia, maxParcelas, MESES, NOME_CICLO, valorDoPeriodo,
} from "../../supabase/functions/_shared/parcelas.ts";
import type { Ciclo } from "../../supabase/functions/_shared/parcelas.ts";
import { fmtReais } from "../../supabase/functions/_shared/precos.ts";
import { textoCreditos } from "../../supabase/functions/_shared/mensagens_cobranca.ts";
import { PagamentoCadastro, pagaPeloSite } from "./PagamentoCadastro";
import { Dica, Rotulo } from "./ui";
import { Logo } from "./Logo";
import "./assinar.css";

const GUARDADO = "vertces.assinar";
interface Campos {
  empresa: string; documento: string; responsavel: string; telefone: string; email: string;
  senha: string; senha2: string; aceite: boolean; site: string;
}
const VAZIO: Campos = { empresa: "", documento: "", responsavel: "", telefone: "", email: "", senha: "", senha2: "", aceite: false, site: "" };

/** O que foi digitado volta se a página recarregar (nunca a senha). */
function lerGuardado(): Partial<Campos> {
  try { return JSON.parse(sessionStorage.getItem(GUARDADO) ?? "{}") as Partial<Campos>; } catch { return {}; }
}
function guardar(f: Campos): void {
  try {
    const { empresa, documento, responsavel, telefone, email } = f;
    sessionStorage.setItem(GUARDADO, JSON.stringify({ empresa, documento, responsavel, telefone, email }));
  } catch { /* sem storage: só não lembra */ }
}

/** "crédito geral extra: R$ 70,00 · crédito de CAR extra: a partir de R$ 9,90" */
function textoExtra(p: PlanoAVenda): string {
  return p.creditos
    .filter((k) => (p.extra[k.tipo] ?? []).length)
    .map((k) => {
      const precos = p.extra[k.tipo].map((f) => Number(f.preco));
      const menor = Math.min(...precos);
      const nome = k.nome.replace(/^Créditos\s+/i, "crédito ").replace(/gerais$/i, "geral");
      return `${nome} extra: ${precos.length > 1 ? "a partir de " : ""}${fmtReais(menor)}`;
    })
    .join(" · ");
}

export function Assinar({ plano: planoUrl, ciclo: cicloUrl, passoInicial }: {
  plano?: string; ciclo?: string;
  /** só o laboratório (#/lab/assinar/plano) abre direto no passo 2 */
  passoInicial?: 1 | 2;
}) {
  const [dados, setDados] = useState<CadastroPlanos | null | undefined>(undefined);
  const [passo, setPasso] = useState<1 | 2 | 3>(passoInicial ?? 1);
  // conectado com outra conta: pergunta antes de trocar
  const [outraConta, setOutraConta] = useState<string | null | undefined>(undefined);
  const [cobranca, setCobranca] = useState<MinhaCobranca | null>(null);
  const [f, setF] = useState<Campos>(() => ({ ...VAZIO, ...lerGuardado() }));
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [plano, setPlano] = useState<string | null>(planoUrl ?? null);
  const [ciclo, setCiclo] = useState<Ciclo>(cicloDe(cicloUrl) ?? "MONTHLY");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; entrar?: boolean } | null>(null);
  // pagou no passo 3: os três passos ficam feitos
  const [pago, setPago] = useState(false);
  const etapa = pago ? 4 : passo;

  useEffect(() => {
    planosDoCadastro().then((d) => {
      setDados(d);
      const ativos = ciclosAtivos(d.regras);
      setCiclo((c) => (ativos.includes(c) ? c : ativos[0] ?? "MONTHLY"));
      setPlano((p) => (p && d.planos.some((x) => x.id === p) ? p : d.planos.length === 1 ? d.planos[0].id : null));
    }).catch(() => setDados(null));
    // já conectado: a dona que voltou para pagar vai direto ao pagamento
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { setOutraConta(null); return; }
      const c = await minhaCobranca();
      if (pagaPeloSite(c)) { setCobranca(c); setPasso(3); setOutraConta(null); return; }
      setOutraConta(data.session.user.email ?? "");
    }).catch(() => setOutraConta(null));
  }, []);
  useEffect(() => { guardar(f); }, [f]);

  const problemas = useMemo(() => {
    const p = problemasDoCadastro({ ...f, aceite_termos: f.aceite });
    if (!p.senha && f.senha !== f.senha2) p.senha2 = "As senhas não conferem.";
    return p;
  }, [f]);
  const msg = (k: string) => (tocado[k] && problemas[k] ? <span className="erro-campo">{problemas[k]}</span> : null);
  const toque = (k: string) => () => setTocado((x) => ({ ...x, [k]: true }));
  const campo = (k: keyof Campos, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const escolhido = dados?.planos.find((p) => p.id === plano) ?? null;
  const ativos = dados ? ciclosAtivos(dados.regras) : [];

  function continuar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(Object.fromEntries(["empresa", "documento", "responsavel", "telefone", "email", "senha", "senha2", "aceite_termos"].map((k) => [k, true])));
    if (Object.keys(problemas).length) return;
    setErro(null);
    setPasso(2);
  }

  async function criar() {
    if (!escolhido) { setErro({ texto: "Escolha um plano." }); return; }
    setEnviando(true); setErro(null);
    try {
      await criarCadastro({
        empresa: f.empresa.trim(), documento: soDigitos(f.documento), responsavel: f.responsavel.trim(), email: f.email.trim(),
        telefone: soDigitos(f.telefone), senha: f.senha, plano_id: escolhido.id, ciclo, aceite_termos: f.aceite,
        versao_termos: VERSAO_TERMOS, site: f.site,
      });
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.senha });
      if (error) {
        setErro({ texto: "A conta foi criada, mas não deu para entrar agora. Entre com o e-mail e a senha para pagar.", entrar: true });
        return;
      }
      try { sessionStorage.removeItem(GUARDADO); } catch { /* nada */ }
      setCobranca(await minhaCobranca());
      setPasso(3);
    } catch (x) {
      const status = x instanceof ErroFuncao ? x.status : 0;
      setErro({ texto: x instanceof Error ? x.message : String(x), entrar: status === 409 });
    } finally {
      setEnviando(false);
    }
  }

  async function sair() {
    await supabase.auth.signOut();
    setOutraConta(null);
  }

  const zap = SUPORTE_WHATSAPP ? <> pelo <a href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a></> : null;

  return (
    <div className="as-pagina">
      <header className="as-topo">
        <a className="as-marca" href="/" aria-label="Vertces"><Logo size={26} /><b>Vertces</b></a>
        {passo < 3 && <span>Já tem conta? <a href="#/">Entrar</a></span>}
      </header>

      <main className="as-caixa">
        <ol className="as-passos" aria-label="Passos do cadastro">
          {["Seus dados", "Plano", "Pagamento"].map((nome, i) => (
            <li key={nome} className={etapa === i + 1 ? "atual" : etapa > i + 1 ? "feito" : ""} aria-current={etapa === i + 1 ? "step" : undefined}>
              <span>{etapa > i + 1 ? "✓" : i + 1}</span>{nome}
            </li>
          ))}
        </ol>

        {dados === undefined || outraConta === undefined ? (
          <p className="sub as-carregando"><span className="spinner" aria-hidden="true" /> Carregando…</p>
        ) : passo === 3 ? (
          <section>
            <h1>{pago ? "Tudo certo: a conta está liberada" : "Falta o pagamento para liberar o acesso"}</h1>
            {!pago && <p className="as-sub">A conta {cobranca?.empresa ? <>da <b>{cobranca.empresa}</b> </> : ""}está criada. Pague o primeiro período e entre na hora.</p>}
            {cobranca && pagaPeloSite(cobranca)
              ? <PagamentoCadastro cobranca={cobranca} onConfirmado={() => setPago(true)} />
              : <p className="nota-permissao">A conta está criada. <a href="#/">Entre com o e-mail e a senha</a> para pagar.</p>}
          </section>
        ) : outraConta ? (
          <section>
            <h1>Você já está conectado</h1>
            <p className="as-sub">Esta janela está com a conta <b>{outraConta || "atual"}</b>. Para criar uma conta nova, saia primeiro.</p>
            <div className="as-botoes">
              <a className="botao-download" href="#/">Entrar no sistema</a>
              <button type="button" className="principal" onClick={sair}>Sair e criar outra conta</button>
            </div>
          </section>
        ) : !dados || !dados.aberto || !dados.planos.length ? (
          <section>
            <h1>O cadastro pelo site está fechado no momento</h1>
            <p className="as-sub">Fale com o Vertces{zap} para assinar. Se já tem conta, <a href="#/">entre por aqui</a>.</p>
          </section>
        ) : passo === 1 ? (
          <form onSubmit={continuar} noValidate>
            <h1>Assine o Vertces</h1>
            <p className="as-sub">
              {escolhido ? <>Plano <b>{escolhido.nome}</b> · {NOME_CICLO[ciclo].toLowerCase()}. </> : null}
              Comece pelos seus dados: o e-mail e a senha são o seu acesso.
            </p>
            <div className="grade">
              <label><Rotulo dica="é o nome que sai no memorial e na planta; quem trabalha por conta própria usa o próprio nome">Empresa ou seu nome</Rotulo>
                <input value={f.empresa} maxLength={120} autoComplete="organization" onChange={(e) => campo("empresa", e.target.value)} onBlur={toque("empresa")} />
                {msg("empresa")}
              </label>
              <label><Rotulo>CPF ou CNPJ</Rotulo>
                <input inputMode="numeric" className="mono" value={f.documento} placeholder="000.000.000-00"
                  onChange={(e) => campo("documento", formatarDocumento(e.target.value))} onBlur={toque("documento")} />
                {msg("documento")}
              </label>
              <label><Rotulo>Responsável</Rotulo>
                <input value={f.responsavel} maxLength={120} autoComplete="name" onChange={(e) => campo("responsavel", e.target.value)} onBlur={toque("responsavel")} />
                {msg("responsavel")}
              </label>
              <label><Rotulo dica="para o aviso de pagamento confirmado e as cobranças">WhatsApp</Rotulo>
                <input inputMode="tel" autoComplete="tel" value={f.telefone} placeholder="(71) 99999-0000"
                  onChange={(e) => campo("telefone", formatarTelefone(e.target.value))} onBlur={toque("telefone")} />
                {msg("telefone")}
              </label>
              <label className="largo"><Rotulo dica="é o seu login no Vertces">E-mail de acesso</Rotulo>
                <input type="email" autoComplete="username" value={f.email} onChange={(e) => campo("email", e.target.value)} onBlur={toque("email")} />
                {msg("email")}
              </label>
              <label><Rotulo dica="8 caracteres ou mais, com letras e números">Senha</Rotulo>
                <input type="password" autoComplete="new-password" value={f.senha} onChange={(e) => campo("senha", e.target.value)} onBlur={toque("senha")} />
                {msg("senha")}
              </label>
              <label><Rotulo>Repita a senha</Rotulo>
                <input type="password" autoComplete="new-password" value={f.senha2} onChange={(e) => campo("senha2", e.target.value)} onBlur={toque("senha2")} />
                {msg("senha2")}
              </label>
            </div>
            {/* robô preenche; gente não vê (o servidor recusa se vier preenchido) */}
            <div className="as-isca" aria-hidden="true">
              <label>Site<input tabIndex={-1} autoComplete="off" name="site_empresa" value={f.site} onChange={(e) => campo("site", e.target.value)} /></label>
            </div>
            <label className="as-aceite">
              <input type="checkbox" checked={f.aceite} onChange={(e) => { campo("aceite", e.target.checked); toque("aceite_termos")(); }} />
              <span>Li e aceito os <a href="#/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e a <a href="#/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</span>
            </label>
            {msg("aceite_termos")}
            <div className="as-botoes">
              <button type="submit" className="principal">Continuar: escolher o plano</button>
            </div>
          </form>
        ) : (
          <section>
            <h1>Escolha o plano</h1>
            <p className="as-sub">Os créditos do plano renovam todo mês. Pague por Pix ou no cartão{maxParcelas(dados.regras, "YEARLY") > 1 ? `, em até ${maxParcelas(dados.regras, "YEARLY")}x no anual` : ""}.</p>
            {ativos.length > 1 && (
              <div className="as-periodos" role="radiogroup" aria-label="Período" style={{ ["--periodos" as string]: ativos.length } as React.CSSProperties}>
                {ativos.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={c === ciclo} className={`as-periodo${c === ciclo ? " sel" : ""}`} onClick={() => setCiclo(c)}>
                    <b>{NOME_CICLO[c]}</b>
                    <span>{maxParcelas(dados.regras, c) > 1 ? `até ${maxParcelas(dados.regras, c)}x no cartão` : "Pix ou cartão"}</span>
                    {dados.regras.ciclos[c].desconto > 0 && <em>−{String(dados.regras.ciclos[c].desconto).replace(".", ",")}%</em>}
                  </button>
                ))}
              </div>
            )}
            <div className="as-planos" role="radiogroup" aria-label="Plano">
              {dados.planos.map((p) => {
                const total = valorDoPeriodo(p.mensalidade, ciclo, dados.regras.ciclos[ciclo].desconto);
                const eco = economia(p.mensalidade, ciclo, dados.regras.ciclos[ciclo].desconto);
                const creditos = textoCreditos(p.creditos.map((k) => ({ nome: k.nome, por_mes: k.por_mes })));
                const extra = textoExtra(p);
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={p.id === plano} className={`as-plano${p.id === plano ? " sel" : ""}`}
                    style={{ borderTopColor: p.cor }} onClick={() => { setPlano(p.id); setErro(null); }}>
                    <span className="as-plano-nome">{p.nome}</span>
                    {p.descricao && <small className="as-plano-desc">{p.descricao}</small>}
                    <span className="as-plano-preco"><b>{fmtReais(p.mensalidade)}</b>/mês</span>
                    {MESES[ciclo] > 1 && (
                      <small className="as-plano-periodo">
                        {NOME_CICLO[ciclo].toLowerCase()}: {fmtReais(total)}{eco > 0 && <> · economia de {fmtReais(eco)}</>}
                      </small>
                    )}
                    <ul>
                      {creditos && <li>{creditos.charAt(0).toUpperCase() + creditos.slice(1)}</li>}
                      {extra && <li>{extra.charAt(0).toUpperCase() + extra.slice(1)}</li>}
                      {p.limite_usuarios && <li>Até {p.limite_usuarios} {p.limite_usuarios === 1 ? "usuário" : "usuários"}</li>}
                    </ul>
                  </button>
                );
              })}
            </div>
            {escolhido && (
              <div className="as-total">
                <span>Plano <b>{escolhido.nome}</b> · {NOME_CICLO[ciclo].toLowerCase()}
                  <Dica>o acesso é liberado quando o pagamento confirmar; no cartão, acima de {dados.regras.parcelas_sem_juros}x há juros de {String(dados.regras.juros_mes).replace(".", ",")}% ao mês, mostrados antes de pagar</Dica>
                </span>
                <b>{fmtReais(valorDoPeriodo(escolhido.mensalidade, ciclo, dados.regras.ciclos[ciclo].desconto))}</b>
                <small>Pix ou cartão{maxParcelas(dados.regras, ciclo) > 1 ? ` em até ${maxParcelas(dados.regras, ciclo)}x` : ""}</small>
              </div>
            )}
            {erro && (
              <div className="aviso-erro-pagina" role="alert">
                {erro.texto}{erro.entrar && <> <a href="#/">Entrar</a></>}
              </div>
            )}
            <div className="as-botoes">
              <button type="button" className="fantasma" onClick={() => { setPasso(1); setErro(null); }} disabled={enviando}>Voltar</button>
              <button type="button" className="principal" onClick={criar} disabled={enviando || !escolhido}>
                {enviando ? "Criando a conta…" : "Criar conta e ir para o pagamento"}
              </button>
            </div>
          </section>
        )}
      </main>
      <footer className="as-rodape">Pagamento processado pelo Asaas. O Vertces não guarda o número do cartão.</footer>
    </div>
  );
}
