// Troca de senha. Obrigatória no primeiro acesso (a empresa recebe a senha
// padrão do cadastro feito no painel) e disponível em Configurações.
import { useState } from "react";
import { trocarSenha } from "../lib/conta";
import { problemaDaSenha } from "../../supabase/functions/_shared/cnpj.ts";
import { supabase } from "../lib/supabase";
import { Logo } from "./Logo";

function FormSenha({ onOk, rotulo }: { onOk: () => void; rotulo: string }) {
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const p = problemaDaSenha(nova);
    if (p) { setErro(p); return; }
    if (nova !== conf) { setErro("As duas senhas não são iguais."); return; }
    setSalvando(true);
    const r = await trocarSenha(nova);
    setSalvando(false);
    if (r) setErro(r);
    else { setNova(""); setConf(""); onOk(); }
  }

  return (
    <form onSubmit={salvar}>
      <label>Senha nova<input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" required /></label>
      <label>Repita a senha nova<input type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" required /></label>
      <p className="sub" style={{ margin: 0 }}>Pelo menos 8 caracteres, com letras e números.</p>
      <button type="submit" className="principal" disabled={salvando}>{salvando ? "Salvando…" : rotulo}</button>
      {erro && <div className="erro" style={{ margin: 0 }}>{erro}</div>}
    </form>
  );
}

/** Tela cheia antes do sistema: quem entrou com a senha padrão cria a própria. */
export function TrocarSenhaObrigatoria({ email, onOk }: { email: string | null; onOk: () => void }) {
  return (
    <div className="centro">
      <div className="login-box" style={{ textAlign: "left" }}>
        <Logo size={28} />
        <h2 style={{ marginTop: 14 }}>Crie a sua senha</h2>
        <p>Bem-vindo ao Vértice{email ? <>, <b>{email}</b></> : null}. Você entrou com a senha provisória do cadastro. Para continuar, crie uma senha só sua.</p>
        <FormSenha onOk={onOk} rotulo="Salvar e entrar" />
        <p className="sub" style={{ marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>Sair</a>
        </p>
      </div>
    </div>
  );
}

/** Bloco de Configurações. */
export function TrocarSenhaCartao() {
  const [ok, setOk] = useState(false);
  return (
    <section className="bloco">
      <header>
        <h3>Senha de acesso</h3>
        <span className="desc">a senha com que você entra no Vértice</span>
      </header>
      <div className="form-senha">
        <FormSenha onOk={() => setOk(true)} rotulo="Trocar senha" />
        {ok && <div className="ok" style={{ marginTop: 10 }}>Senha trocada.</div>}
      </div>
    </section>
  );
}
