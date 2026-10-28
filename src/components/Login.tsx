import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Logo } from "./Logo";
import { TERMOS_PUBLICADOS } from "../lib/config";

/** Mensagens do Supabase Auth em português, sem jargão. */
export function traduzirErroLogin(msg: string, status?: number): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Este e-mail ainda não foi confirmado. Abra o link que enviamos para a sua caixa de entrada.";
  if (status === 429 || m.includes("rate limit") || m.includes("too many") || m.includes("security purposes"))
    return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (m.includes("user not found")) return "Não encontramos uma conta com este e-mail.";
  if (m.includes("user is banned") || m.includes("banned")) return "Este acesso está bloqueado. Fale com quem administra a sua empresa.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Digite um e-mail válido.";
  return msg;
}

export function Login({ onOk, cadastroAberto = false }: { onOk: () => void; cadastroAberto?: boolean }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    setAviso(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) setErro(traduzirErroLogin(error.message, error.status));
    else onOk();
  }

  // Redefinição pelo próprio Supabase: manda o link para o e-mail digitado.
  // Sem e-mail não há para onde mandar — o aviso pede o campo em vez de errar.
  async function esqueci() {
    setErro(null);
    if (!email.trim()) { setAviso("Digite o e-mail acima e clique de novo em \"Esqueci a senha\"."); return; }
    setCarregando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/app/` });
    setCarregando(false);
    if (error) setErro(traduzirErroLogin(error.message, error.status));
    else setAviso(`Enviamos um link de redefinição para ${email.trim()}.`);
  }

  return (
    <div className="login">
      <div className="login-lado">
        <div className="marca login-marca"><Logo size={28} /><span className="marca-nome">Vértice</span></div>
        <div>
          <h1>Do levantamento à certificação.</h1>
          <p>Memorial descritivo, planilha SIGEF, planta e as sete peças técnicas, gerados a partir do TXT da máquina.</p>
        </div>
        <div className="rodape"><span>SIRGAS2000</span><span>INCRA · SIGEF</span><span>Fusos 18S–25S</span></div>
      </div>
      <div className="login-form">
        <div className="login-box">
          <h2>Entrar</h2>
          <p>{cadastroAberto ? <>Ainda não tem conta? <a href="#/cadastro">Criar conta</a></> : "Use o e-mail e a senha da sua conta no Vértice."}</p>
          <form onSubmit={entrar}>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
            <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" /></label>
            <button type="submit" className="principal" disabled={carregando}>{carregando ? "Entrando…" : "Entrar"}</button>
            <button type="button" className="esqueci-botao" onClick={esqueci} disabled={carregando}>Esqueci a senha</button>
            {aviso && <div className="ok" role="status">{aviso}</div>}
            {erro && <div className="erro" role="alert">{erro}</div>}
          </form>
          {TERMOS_PUBLICADOS && <p className="sub legal-links"><a href="#/termos">Termos de Uso</a> · <a href="#/privacidade">Privacidade</a></p>}
        </div>
      </div>
    </div>
  );
}
