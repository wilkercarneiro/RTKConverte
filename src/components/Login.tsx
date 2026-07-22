import { useState } from "react";
import { supabase } from "../lib/supabase";

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
    <div className="login-box">
      <h1>RTKConverte</h1>
      <p>Gerador de Memorial INCRA + Planilha SIGEF</p>
      <form onSubmit={entrar}>
        <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        <button type="submit" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
        {erro && <div className="erro">{erro}</div>}
      </form>
    </div>
  );
}
