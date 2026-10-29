// Configurações do painel: a senha padrão das contas novas.
import { useEffect, useState } from "react";
import { lerSenhaPadrao, salvarSenhaPadrao } from "../../lib/admin";
import { problemaDaSenha } from "../../../supabase/functions/_shared/cnpj.ts";
import { Topo } from "./comum";
import { Dica } from "../ui";

export function ConfigAdmin() {
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  useEffect(() => { lerSenhaPadrao().then(setSenha).catch((e) => setMsg({ tipo: "erro", texto: String(e.message ?? e) })); }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const p = problemaDaSenha(senha);
    if (p) { setMsg({ tipo: "erro", texto: p }); return; }
    try { await salvarSenhaPadrao(senha); setMsg({ tipo: "ok", texto: "Senha padrão salva. Vale para as próximas contas criadas." }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  return (
    <>
      <Topo olho="Sistema" titulo="Configurações" />
      <form className="sa-card" onSubmit={salvar} style={{ maxWidth: 640 }}>
        <header><h3>Senha padrão das contas novas<Dica>
          Toda empresa e todo usuário cadastrados aqui entram com esta senha e o sistema pede uma senha própria no primeiro acesso.
          Ela também é a senha usada em “Redefinir senha”.
        </Dica></h3></header>
        {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
        <div className="sa-campos">
          <label>Senha padrão<input className="mono" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        </div>
        <div className="sa-rodape-form"><button type="submit" className="principal">Salvar</button></div>
      </form>
    </>
  );
}
