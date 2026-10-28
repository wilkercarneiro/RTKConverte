// Cadastro self-service: cria a conta e, com "novo escritório", o escritório
// com quem se cadastra como dono (trigger ao_criar_usuario no banco). O
// Supabase manda o e-mail de confirmação; só depois dele a conta entra.
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { VERSAO_TERMOS } from "../lib/config";
import { Logo } from "./Logo";

export function Cadastro() {
  const [novoEscritorio, setNovoEscritorio] = useState(true);
  const [escritorio, setEscritorio] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novoEscritorio && !escritorio.trim()) { setErro("Informe o nome do escritório."); return; }
    if (senha.length < 8) { setErro("A senha precisa de pelo menos 8 caracteres."); return; }
    if (senha !== senha2) { setErro("As senhas não conferem."); return; }
    if (!aceite) { setErro("Para criar a conta, aceite os Termos de Uso e a Política de Privacidade."); return; }
    setCarregando(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        emailRedirectTo: `${location.origin}/app/`,
        data: {
          ...(novoEscritorio ? { escritorio_nome: escritorio.trim() } : {}),
          termos_versao: VERSAO_TERMOS,
        },
      },
    });
    setCarregando(false);
    if (error) { setErro(traduzir(error.message)); return; }
    // Com confirmação de e-mail ligada (o padrão), não há sessão até o clique no link.
    if (!data.session) setEnviado(email.trim());
  }

  return (
    <div className="login">
      <div className="login-lado">
        <div className="marca" style={{ padding: 0 }}><Logo size={28} /><span className="marca-nome" style={{ fontSize: 20 }}>Vértice</span></div>
        <div>
          <h1>Do levantamento à certificação.</h1>
          <p>Crie a conta do seu escritório e gere o primeiro memorial a partir do TXT do receptor.</p>
        </div>
        <div className="rodape"><span>SIRGAS2000</span><span>INCRA · SIGEF</span><span>Fusos 18S–25S</span></div>
      </div>
      <div className="login-form">
        <div className="login-box">
          {enviado ? (
            <>
              <h2>Confirme seu e-mail</h2>
              <p>Enviamos um link para <b>{enviado}</b>. Clique nele para ativar a conta e entrar.</p>
              <p className="sub">Não chegou em alguns minutos? Veja a caixa de spam.</p>
              <a href="#/">← Voltar para a entrada</a>
            </>
          ) : (
            <>
              <h2>Criar conta</h2>
              <p>Já tem conta? <a href="#/">Entrar</a></p>
              <form onSubmit={cadastrar}>
                <div className="escolha-cadastro" role="radiogroup" aria-label="Tipo de conta">
                  <label><input type="radio" checked={novoEscritorio} onChange={() => setNovoEscritorio(true)} /> Novo escritório</label>
                  <label><input type="radio" checked={!novoEscritorio} onChange={() => setNovoEscritorio(false)} /> Vou entrar na equipe de um escritório</label>
                </div>
                {novoEscritorio ? (
                  <label>Nome do escritório
                    <input value={escritorio} onChange={(e) => setEscritorio(e.target.value)} maxLength={120} required placeholder="ex.: Geo Topografia" />
                  </label>
                ) : (
                  <p className="sub" style={{ margin: 0 }}>Depois de confirmar o e-mail, peça ao dono do escritório para adicionar você em Configurações → Equipe.</p>
                )}
                <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
                <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
                <label>Repita a senha<input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
                <label className="aceite">
                  <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
                  <span>Li e aceito os <a href="#/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e a <a href="#/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</span>
                </label>
                <button type="submit" className="principal" disabled={carregando}>{carregando ? "Criando..." : "Criar conta"}</button>
                {erro && <div className="erro" style={{ margin: 0 }}>{erro}</div>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** As mensagens do Supabase Auth chegam em inglês. */
function traduzir(msg: string): string {
  if (/already registered|already been registered/i.test(msg)) return "Este e-mail já tem conta. Use \"Entrar\" ou \"Esqueci a senha\".";
  if (/signups not allowed|signup is disabled/i.test(msg)) return "O cadastro está fechado no momento. Fale com o suporte.";
  if (/password/i.test(msg) && /characters|weak|short/i.test(msg)) return "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
  if (/rate limit|too many/i.test(msg)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (/invalid.*email/i.test(msg)) return "E-mail inválido.";
  return msg;
}
