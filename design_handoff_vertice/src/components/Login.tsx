import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Logo } from "./Logo";

export function Login({ onOk }: { onOk: () => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) setErro(error.message);
    else onOk();
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
          <p>Use o e-mail de operador cadastrado.</p>
          <form onSubmit={entrar}>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
            <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" /></label>
            <button type="submit" className="principal" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
            {erro && <div className="erro">{erro}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}
