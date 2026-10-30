// Equipe da empresa: quem acessa, com que permissões, e o que cada um fez.
//
// O dono (e quem ele autorizar com "Gerenciar a equipe") adiciona pessoas com
// cargo, descrição do que fazem e telefone. A senha é sorteada pelo sistema ou
// definida por quem cadastra, com ou sem troca obrigatória no primeiro acesso,
// e aparece UMA vez para ser passada à pessoa. Marca as permissões por perfil
// ou uma a uma, desativa sem apagar, troca a senha e remove. O banco confere
// tudo de novo (0025/0029). As abas Uso, Acessos e Auditoria (0026/0029)
// mostram quanto cada um usa, de onde entra e quem fez o quê: ver Auditoria.tsx.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EstadoEscritorio } from "../lib/escritorio";
import {
  apagarConta, criarMembro, forcaDaSenha, listarMembros, mensagemDeAcesso, novaSenha,
  podeAdicionar, problemaDaSenha, salvarMembro,
} from "../lib/equipe";
import type { Membro, PodeAdicionar, SenhaEscolhida } from "../lib/equipe";
import { PERFIS, PERMISSOES, temPermissao } from "../lib/permissoes";
import type { ChavePermissao } from "../lib/permissoes";
import { temRecurso } from "../lib/recursos";
import { emailValido } from "../../supabase/functions/_shared/cnpj.ts";
import { avisar, confirmar, Dica, Gaveta, Rotulo } from "./ui";
import { AcessosEquipe, AuditoriaEmpresa, UsoEquipe } from "./Auditoria";

const iniciais = (s: string) =>
  s.split(/[\s@._-]+/).filter(Boolean).filter((_, i, a) => i === 0 || i === a.length - 1).map((w) => w[0]?.toUpperCase()).join("") || "?";

function quando(d: string | null): string {
  if (!d) return "nunca entrou";
  const dias = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (dias <= 0) return "entrou hoje";
  if (dias === 1) return "entrou ontem";
  return dias < 30 ? `entrou há ${dias} dias` : `entrou em ${new Date(d).toLocaleDateString("pt-BR")}`;
}

async function copiar(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

export function Equipe({ escritorio }: { escritorio: EstadoEscritorio }) {
  const empresa = escritorio.estado === "ok" ? escritorio.escritorio.nome : "sua empresa";
  const souDono = escritorio.estado === "ok" && escritorio.escritorio.papel === "dono";
  const gerencio = temPermissao("equipe.gerenciar");
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"pessoas" | "uso" | "acessos" | "historico">("pessoas");
  const [vaga, setVaga] = useState<PodeAdicionar | null>(null);
  const [gaveta, setGaveta] = useState<{ tipo: "nova" } | { tipo: "membro"; m: Membro } | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setMembros(await listarMembros());
      if (gerencio) setVaga(await podeAdicionar().catch(() => null));
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [gerencio]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (membros ?? []).filter((m) => !q || [m.nome, m.email, m.cargo, m.descricao].some((x) => x?.toLowerCase().includes(q)));
  }, [membros, busca]);
  const ativos = (membros ?? []).filter((m) => m.ativo).length;

  if (!temRecurso("empresa.equipe")) {
    return (
      <div className="pagina eq">
        <Cabeca empresa={empresa} />
        <div className="eq-aviso">O plano da sua empresa não inclui equipe com vários usuários. Fale com o suporte do Vertces para incluir.</div>
      </div>
    );
  }

  return (
    <div className="pagina eq">
      <Cabeca empresa={empresa}>
        {gerencio && (
          <button className="principal" onClick={() => setGaveta({ tipo: "nova" })} disabled={vaga ? !vaga.ok : false}
            title={vaga && !vaga.ok ? vaga.motivo : undefined}>
            + Adicionar pessoa
          </button>
        )}
      </Cabeca>

      <div className="eq-resumo">
        <div className="eq-kpi"><b>{membros ? ativos : "–"}</b><span>{ativos === 1 ? "pessoa ativa" : "pessoas ativas"}</span></div>
        {vaga?.limite ? (
          <div className="eq-kpi eq-kpi-limite">
            <div className="eq-trilho" aria-hidden="true"><i style={{ width: `${Math.min(100, (ativos / vaga.limite) * 100)}%` }} /></div>
            <span>{ativos} de {vaga.limite} usuários do plano</span>
          </div>
        ) : null}
        <div className="eq-kpi"><b>{membros ? membros.filter((m) => m.senha_provisoria).length : "–"}</b><span>ainda sem senha própria</span></div>
        {gerencio && vaga && !vaga.ok && <div className="eq-aviso eq-aviso-curto">{vaga.motivo}</div>}
      </div>

      {gerencio && (
        <nav className="eq-abas" aria-label="Seções da equipe">
          <button className={aba === "pessoas" ? "ativo" : ""} onClick={() => setAba("pessoas")}>Pessoas</button>
          <button className={aba === "uso" ? "ativo" : ""} onClick={() => setAba("uso")}>Uso da equipe</button>
          <button className={aba === "acessos" ? "ativo" : ""} onClick={() => setAba("acessos")}>Acessos</button>
          <button className={aba === "historico" ? "ativo" : ""} onClick={() => setAba("historico")}>Auditoria</button>
        </nav>
      )}

      {aba === "historico" && gerencio ? <AuditoriaEmpresa membros={membros} />
        : aba === "uso" && gerencio ? <UsoEquipe />
        : aba === "acessos" && gerencio ? <AcessosEquipe membros={membros} /> : (
        <>
          {(membros?.length ?? 0) > 6 && (
            <input className="eq-busca" type="search" placeholder="Buscar por nome, e-mail, cargo ou função" value={busca}
              onChange={(e) => setBusca(e.target.value)} aria-label="Buscar na equipe" />
          )}
          {erro ? (
            <div className="eq-aviso">Não foi possível carregar a equipe: {erro} <button onClick={carregar}>Tentar de novo</button></div>
          ) : !membros ? (
            <div className="eq-grade" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="eq-cartao eq-esqueleto" />)}</div>
          ) : (
            <div className="eq-grade">
              {visiveis.map((m) => (
                <CartaoMembro key={m.user_id} m={m} podeGerenciar={gerencio}
                  onAbrir={() => setGaveta({ tipo: "membro", m })} />
              ))}
            </div>
          )}
          {!gerencio && <p className="sub eq-rodape">Só quem gerencia a equipe adiciona pessoas e muda permissões.</p>}
        </>
      )}

      {gaveta?.tipo === "nova" && (
        <GavetaNova souDono={souDono} empresa={empresa} onFechar={() => setGaveta(null)} onPronto={carregar} />
      )}
      {gaveta?.tipo === "membro" && (
        <GavetaMembro m={gaveta.m} souDono={souDono} empresa={empresa} onFechar={() => setGaveta(null)} onPronto={carregar} />
      )}
    </div>
  );
}

function Cabeca({ empresa, children }: { empresa: string; children?: React.ReactNode }) {
  return (
    <header className="eq-cabeca">
      <div>
        <span className="eq-olho">Empresa</span>
        <h1>Equipe</h1>
        <p>Quem acessa os dados da empresa ({empresa}) e o que cada pessoa pode fazer.</p>
      </div>
      {children && <div className="eq-acoes">{children}</div>}
    </header>
  );
}

function CartaoMembro({ m, podeGerenciar, onAbrir }: { m: Membro; podeGerenciar: boolean; onAbrir: () => void }) {
  const nome = m.nome || m.email.split("@")[0];
  const qtd = m.papel === "dono" ? PERMISSOES.length : m.permissoes.length;
  return (
    <article className={m.ativo ? "eq-cartao" : "eq-cartao eq-inativo"}>
      <div className="eq-topo">
        <span className="eq-avatar" aria-hidden="true">{iniciais(m.nome || m.email)}</span>
        <div className="eq-quem">
          <b title={nome}>{nome}</b>
          <span title={m.email}>{m.email}</span>
        </div>
      </div>
      <div className="eq-selos">
        {m.papel === "dono" && <span className="eq-selo dono">Dono</span>}
        {m.cargo && <span className="eq-selo">{m.cargo}</span>}
        {!m.ativo && <span className="eq-selo off">Desativado</span>}
        {m.ativo && m.senha_provisoria && <span className="eq-selo pendente">Senha provisória</span>}
      </div>
      <p className={m.descricao ? "eq-descricao" : "eq-descricao vazia"} title={m.descricao ?? undefined}>
        {m.descricao || (podeGerenciar ? "Sem descrição do que faz na empresa." : "—")}
      </p>
      <div className="eq-perms">
        <div className="eq-barra" aria-hidden="true"><i style={{ width: `${(qtd / PERMISSOES.length) * 100}%` }} /></div>
        <span>{m.papel === "dono" ? "Todas as permissões" : qtd === 0 ? "Só consulta" : `${qtd} de ${PERMISSOES.length} permissões`}</span>
      </div>
      <div className="eq-pe">
        <span className="sub">{quando(m.ultimo_acesso)}</span>
        {podeGerenciar && <button onClick={onAbrir}>Gerenciar</button>}
      </div>
    </article>
  );
}

function Permissoes({ marcadas, onMudar, souDono, bloqueadas = [] }: {
  marcadas: string[]; onMudar: (p: string[]) => void; souDono: boolean; bloqueadas?: string[];
}) {
  const set = new Set(marcadas);
  const grupos = [...new Set(PERMISSOES.map((p) => p.grupo))];
  const perfil = PERFIS.find((pf) => pf.permissoes.length === set.size && pf.permissoes.every((x) => set.has(x)));
  return (
    <div className="eq-permissoes">
      <div className="eq-perfis" role="group" aria-label="Perfis prontos">
        {PERFIS.filter((pf) => souDono || !pf.permissoes.includes("equipe.gerenciar")).map((pf) => (
          <button type="button" key={pf.nome} className={perfil?.nome === pf.nome ? "ativo" : ""}
            onClick={() => onMudar(pf.permissoes)} title={pf.descricao}>
            <b>{pf.nome}</b><span>{pf.descricao}</span>
          </button>
        ))}
      </div>
      {grupos.map((g) => (
        <fieldset key={g} className="eq-grupo">
          <legend>{g}</legend>
          {PERMISSOES.filter((p) => p.grupo === g).map((p) => {
            const travada = (p.chave === "equipe.gerenciar" && !souDono) || bloqueadas.includes(p.chave);
            return (
              <label key={p.chave} className={travada ? "eq-perm travada" : "eq-perm"}>
                <span className="tx"><b>{p.nome}<Dica>{p.descricao}</Dica></b></span>
                <input type="checkbox" role="switch" className="eq-switch" checked={set.has(p.chave)} disabled={travada}
                  onChange={(e) => {
                    const n = new Set(set);
                    if (e.target.checked) n.add(p.chave); else n.delete(p.chave);
                    onMudar([...n]);
                  }} />
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function CartaoAcesso({ nome, empresa, login, senha, trocar = true }: { nome: string; empresa: string; login: string; senha: string; trocar?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const texto = mensagemDeAcesso({ nome, empresa, login, senha, trocar });
  return (
    <div className="eq-acesso">
      <p>Passe estes dados para <b>{nome || login}</b>. A senha aparece só agora{trocar ? ": no primeiro acesso o sistema pede uma senha própria." : "."}</p>
      <dl>
        <dt>Endereço</dt><dd>{location.origin}/app/</dd>
        <dt>Login</dt><dd>{login}</dd>
        <dt>{trocar ? "Senha provisória" : "Senha"}</dt><dd className="eq-senha">{senha}</dd>
      </dl>
      <div className="eq-acesso-acoes">
        <button className="principal" onClick={async () => setCopiado(await copiar(texto))}>{copiado ? "Copiado ✓" : "Copiar mensagem de acesso"}</button>
        <a className="botao-download" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
      </div>
    </div>
  );
}

type SenhaForm = SenhaEscolhida & { modo: "auto" | "definir" };

/** Sugestão para o campo (em branco, quem sorteia é o servidor). */
function sortearSenha(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ", numeros = "23456789";
  const b = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(b, (x) => (letras + numeros)[x % (letras.length + numeros.length)]);
  s[0] = letras[b[0] % letras.length]; s[11] = numeros[b[11] % numeros.length];
  return s.join("");
}

const problemaDoForm = (v: SenhaForm): string | null => {
  if (v.modo === "auto") return null;
  const p = problemaDaSenha(v.senha ?? "");
  return p ? `Senha: ${p}` : null;
};

/** Como a senha nasce: sorteada pelo sistema ou escolhida por quem cadastra. */
function CampoSenha({ valor, onMudar }: { valor: SenhaForm; onMudar: (v: SenhaForm) => void }) {
  const [ver, setVer] = useState(false);
  const senha = valor.senha ?? "";
  const forca = forcaDaSenha(senha);
  const problema = senha ? problemaDaSenha(senha) : null;
  return (
    <div className="eq-senha-campo">
      <div className="eq-modo" role="radiogroup" aria-label="Como criar a senha">
        <button type="button" role="radio" aria-checked={valor.modo === "auto"} className={valor.modo === "auto" ? "ativo" : ""}
          onClick={() => onMudar({ modo: "auto", senha: undefined, trocar: true })}>
          <b>Gerar automaticamente</b><span>O sistema cria uma senha forte</span>
        </button>
        <button type="button" role="radio" aria-checked={valor.modo === "definir"} className={valor.modo === "definir" ? "ativo" : ""}
          onClick={() => onMudar({ ...valor, modo: "definir", senha })}>
          <b>Definir a senha</b><span>Você escolhe a senha da pessoa</span>
        </button>
      </div>
      {valor.modo === "definir" && (
        <div className="eq-senha-def">
          <div className="eq-senha-linha">
            <input type={ver ? "text" : "password"} value={senha} autoComplete="new-password" placeholder="8+ letras e números"
              aria-label="Senha" aria-invalid={!!problema} onChange={(e) => onMudar({ ...valor, senha: e.target.value })} />
            <button type="button" className="fantasma" onClick={() => setVer((v) => !v)}>{ver ? "Ocultar" : "Mostrar"}</button>
            <button type="button" onClick={() => { setVer(true); onMudar({ ...valor, senha: sortearSenha() }); }}>Sugerir</button>
          </div>
          <div className="eq-forca" data-forca={forca} aria-hidden="true"><i /><i /><i /><i /></div>
          <small className={problema ? "eq-forca-tx ruim" : "eq-forca-tx"}>
            {!senha ? "Escolha uma senha" : problema ?? ["", "Fraca", "Razoável", "Boa", "Forte"][forca]}
          </small>
        </div>
      )}
      <label className="eq-ativo eq-trocar">
        <span className="tx"><b>Pedir para trocar no primeiro acesso<Dica>Recomendado: a pessoa cria uma senha que só ela sabe. Desmarque se a empresa controla as senhas de acesso.</Dica></b></span>
        <input type="checkbox" role="switch" className="eq-switch" checked={valor.trocar} onChange={(e) => onMudar({ ...valor, trocar: e.target.checked })} />
      </label>
    </div>
  );
}

function GavetaNova({ souDono, empresa, onFechar, onPronto }: { souDono: boolean; empresa: string; onFechar: () => void; onPronto: () => void }) {
  const [f, setF] = useState({ nome: "", email: "", cargo: "", descricao: "", telefone: "", permissoes: PERFIS[0].permissoes as string[] });
  const [senha, setSenha] = useState<SenhaForm>({ modo: "auto", trocar: true });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ login: string; senha: string; trocar?: boolean } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (f.nome.trim().length < 2) { setErro("Informe o nome da pessoa."); return; }
    if (!emailValido(f.email)) { setErro("E-mail inválido."); return; }
    const ruim = problemaDoForm(senha);
    if (ruim) { setErro(ruim); return; }
    setEnviando(true);
    try {
      const r = await criarMembro({
        ...f, email: f.email.trim().toLowerCase(), senha: senha.modo === "definir" ? senha.senha : undefined, trocar: senha.trocar,
      });
      setCriado({ login: r.login, senha: r.senha, trocar: r.trocar ?? senha.trocar });
      avisar("ok", `${f.nome.trim()} entrou na equipe.`);
      onPronto();
    } catch (x) { setErro(x instanceof Error ? x.message : String(x)); }
    finally { setEnviando(false); }
  }

  if (criado) {
    return (
      <Gaveta titulo="Acesso criado" olho="Equipe" onFechar={onFechar} rodape={<button onClick={onFechar}>Concluir</button>}>
        <CartaoAcesso nome={f.nome.trim()} empresa={empresa} login={criado.login} senha={criado.senha} trocar={criado.trocar} />
      </Gaveta>
    );
  }
  return (
    <Gaveta titulo="Adicionar pessoa" olho="Equipe" onFechar={onFechar}
      rodape={<>
        <button type="button" onClick={onFechar} disabled={enviando}>Cancelar</button>
        <button type="submit" form="eq-nova" className="principal" disabled={enviando}>{enviando ? "Criando acesso…" : "Criar acesso"}</button>
      </>}>
      <form id="eq-nova" onSubmit={salvar} className="eq-form" noValidate>
        {erro && <div className="erro" role="alert">{erro}</div>}
        <div className="eq-campos">
          <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus placeholder="Nome e sobrenome" /></label>
          <label>Cargo<input value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} placeholder="Ex.: Topógrafo, Projetista" /></label>
          <label><Rotulo dica="é o login de acesso ao Vertces">E-mail de acesso</Rotulo><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="pessoa@empresa.com.br" /></label>
          <label>Telefone<input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="(00) 00000-0000" inputMode="tel" /></label>
          <label className="largo"><Rotulo dica="o que a pessoa faz na empresa: aparece no cartão da equipe">Descrição</Rotulo>
            <textarea rows={2} value={f.descricao} maxLength={500} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: Faz o levantamento em campo e envia os TXT do GNSS" />
          </label>
        </div>
        <h3 className="eq-h3">Senha de acesso</h3>
        <CampoSenha valor={senha} onMudar={setSenha} />
        <h3 className="eq-h3">O que esta pessoa pode fazer</h3>
        <Permissoes marcadas={f.permissoes} souDono={souDono} onMudar={(p) => setF({ ...f, permissoes: p })} />
      </form>
    </Gaveta>
  );
}

function GavetaMembro({ m, souDono, empresa, onFechar, onPronto }: { m: Membro; souDono: boolean; empresa: string; onFechar: () => void; onPronto: () => void }) {
  const [f, setF] = useState({ nome: m.nome ?? "", cargo: m.cargo ?? "", descricao: m.descricao ?? "", telefone: m.telefone ?? "", permissoes: m.permissoes, ativo: m.ativo });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState<{ login: string; senha: string; trocar?: boolean } | null>(null);
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [nova, setNova] = useState<SenhaForm>({ modo: "definir", senha: "", trocar: false });
  const ehDono = m.papel === "dono";
  // ninguém se tranca fora: quem gerencia não tira de si a permissão
  const [eu, setEu] = useState(false);
  useEffect(() => {
    import("../lib/supabase").then(({ supabase }) => supabase.auth.getUser()).then(({ data }) => setEu(data.user?.id === m.user_id));
  }, [m.user_id]);
  const bloqueadas: ChavePermissao[] = eu ? ["equipe.gerenciar"] : [];

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      await salvarMembro({ user_id: m.user_id, ...f });
      avisar("ok", `Acesso de ${f.nome || m.email} atualizado.`);
      onPronto();
      onFechar();
    } catch (x) { setErro(x instanceof Error ? x.message : String(x)); }
    finally { setSalvando(false); }
  }

  async function trocarSenha() {
    const ruim = problemaDoForm(nova);
    if (ruim) { setErro(ruim); return; }
    if (!(await confirmar({ titulo: "Trocar a senha?", texto: `A senha atual de ${m.nome || m.email} deixa de valer na hora.`, confirmar: "Trocar senha" }))) return;
    setErro(null);
    try {
      const r = await novaSenha(m.user_id, { senha: nova.modo === "definir" ? nova.senha : undefined, trocar: nova.trocar });
      setSenha({ ...r, trocar: r.trocar ?? nova.trocar });
      onPronto();
    } catch (x) { setErro(x instanceof Error ? x.message : String(x)); }
  }

  async function remover() {
    if (!(await confirmar({ titulo: "Remover da equipe?", texto: `A conta de ${m.nome || m.email} é apagada e o acesso acaba na hora. Os serviços e documentos da empresa continuam. Para só pausar, use "Acesso ativo".`, confirmar: "Remover", perigo: true }))) return;
    try { await apagarConta(m.user_id); avisar("ok", `${m.nome || m.email} saiu da equipe.`); onPronto(); onFechar(); }
    catch (x) { setErro(x instanceof Error ? x.message : String(x)); }
  }

  if (senha) {
    return (
      <Gaveta titulo="Senha nova" olho={m.nome || m.email} onFechar={onFechar} rodape={<button onClick={onFechar}>Concluir</button>}>
        <CartaoAcesso nome={m.nome ?? ""} empresa={empresa} login={senha.login} senha={senha.senha} trocar={senha.trocar} />
      </Gaveta>
    );
  }
  return (
    <Gaveta titulo={m.nome || m.email} olho={ehDono ? "Dono da empresa" : "Gerenciar acesso"} onFechar={onFechar}
      rodape={<>
        {!ehDono && !eu && <button type="button" className="fantasma eq-perigo" onClick={remover}>Remover</button>}
        {!ehDono && !trocandoSenha && <button type="button" onClick={() => setTrocandoSenha(true)}>Trocar senha</button>}
        <button type="button" className="principal" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </>}>
      {erro && <div className="erro" role="alert">{erro}</div>}
      <div className="eq-campos">
        <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} disabled={ehDono && !eu} /></label>
        <label>Cargo<input value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} disabled={ehDono && !eu} placeholder="Ex.: Topógrafo" /></label>
        <label>E-mail de acesso<input value={m.email} disabled readOnly /></label>
        <label>Telefone<input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} disabled={ehDono && !eu} placeholder="(00) 00000-0000" inputMode="tel" /></label>
        <label className="largo"><Rotulo dica="o que a pessoa faz na empresa: aparece no cartão da equipe">Descrição</Rotulo>
          <textarea rows={2} maxLength={500} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} disabled={ehDono && !eu}
            placeholder="Ex.: Confere os TXT, gera as plantas e acompanha o SIGEF" />
        </label>
      </div>
      <dl className="eq-fatos">
        <div><dt>Na equipe desde</dt><dd>{new Date(m.desde).toLocaleDateString("pt-BR")}</dd></div>
        <div><dt>Último acesso</dt><dd>{m.ultimo_acesso ? new Date(m.ultimo_acesso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "nunca entrou"}</dd></div>
        <div><dt>Senha</dt><dd>{m.senha_provisoria ? "provisória" : "própria"}</dd></div>
      </dl>
      {trocandoSenha && !ehDono && (
        <section className="eq-trocar-senha">
          <h3 className="eq-h3">Nova senha</h3>
          <CampoSenha valor={nova} onMudar={setNova} />
          <div className="eq-trocar-acoes">
            <button type="button" className="fantasma" onClick={() => setTrocandoSenha(false)}>Cancelar</button>
            <button type="button" className="principal" onClick={trocarSenha}>Trocar a senha</button>
          </div>
        </section>
      )}
      {ehDono ? (
        <p className="eq-nota">O dono tem todas as permissões e não pode ser desativado.</p>
      ) : (
        <>
          <label className={eu ? "eq-ativo travada" : "eq-ativo"}>
            <span className="tx"><b>Acesso ativo</b><small>{f.ativo ? "A pessoa entra normalmente." : "A pessoa não entra mais; a conta e o histórico ficam guardados."}</small></span>
            <input type="checkbox" role="switch" className="eq-switch" checked={f.ativo} disabled={eu} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          </label>
          <h3 className="eq-h3">Permissões</h3>
          <Permissoes marcadas={f.permissoes} souDono={souDono} bloqueadas={bloqueadas} onMudar={(p) => setF({ ...f, permissoes: eu ? [...new Set([...p, "equipe.gerenciar"])] : p })} />
        </>
      )}
    </Gaveta>
  );
}
