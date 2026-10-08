import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Logo } from "./Logo";
import { TERMOS_PUBLICADOS } from "../lib/config";

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
    if (error) setErro(error.message);
    else onOk();
  }

  // Redefinição pelo próprio Supabase: manda o link para o e-mail digitado.
  // Sem e-mail não há para onde mandar — o aviso pede o campo em vez de errar.
  async function esqueci(e: React.MouseEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim()) { setAviso("Digite o e-mail acima e clique de novo em \"Esqueci a senha\"."); return; }
    setCarregando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
    setCarregando(false);
    if (error) setErro(error.message);
    else setAviso(`Enviamos um link de redefinição para ${email.trim()}.`);
  }

  return (
    <div className="login">
      <div className="login-lado">
        <div className="marca" style={{ padding: 0 }}><Logo size={28} /><span className="marca-nome" style={{ fontSize: 20 }}>Vértice</span></div>
        <div>
          <h1>Do levantamento à certificação.</h1>
          <p>Memorial descritivo, planilha SIGEF, planta e as sete peças técnicas, gerados a partir do TXT da máquina.</p>
        </div>
        <div className="rodape"><span>SIRGAS2000</span><span>INCRA · SIGEF</span><span>Fusos 18S–25S</span></div>
      </div>
      <div className="login-form">
        <div className="login-box">
          <h2>Entrar</h2>
          <p>{cadastroAberto ? <>Ainda não tem conta? <a href="#/cadastro">Criar conta</a></> : "Use o e-mail de operador cadastrado."}</p>
          <form onSubmit={entrar}>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
            <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" /></label>
            <button type="submit" className="principal" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
            <a href="#" className="esqueci" onClick={esqueci}>Esqueci a senha</a>
            {aviso && <div className="ok" style={{ margin: 0 }}>{aviso}</div>}
            {erro && <div className="erro" style={{ margin: 0 }}>{erro}</div>}
          </form>
          {TERMOS_PUBLICADOS && <p className="sub legal-links"><a href="#/termos">Termos de Uso</a> · <a href="#/privacidade">Privacidade</a></p>}
        </div>
      </div>
    </div>
  );
}
