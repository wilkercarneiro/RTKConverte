// Configurações → Minha conta: nome e telefone de quem está logado, o papel na
// empresa, a senha e "sair de todos os aparelhos". Qualquer pessoa da equipe
// corrige o próprio perfil (RPC atualizar_meu_perfil, 0029).
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { listarMembros } from "../../lib/equipe";
import type { Membro } from "../../lib/equipe";
import { PERMISSOES } from "../../lib/permissoes";
import { TrocarSenhaCartao } from "../TrocarSenha";
import { avisar, confirmar, Dica, Esqueleto } from "../ui";

export function MinhaConta() {
  const [eu, setEu] = useState<Membro | null>(null);
  const [email, setEmail] = useState<string>("");
  const [f, setF] = useState({ nome: "", telefone: "" });
  const [salvando, setSalvando] = useState(false);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? "");
      try {
        const m = (await listarMembros()).find((x) => x.user_id === data.user?.id) ?? null;
        setEu(m);
        setF({ nome: m?.nome ?? "", telefone: m?.telefone ?? "" });
      } catch { /* sem equipe: só a senha */ }
      setCarregado(true);
    })();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.nome.trim().length < 2) { avisar("erro", "Informe o seu nome."); return; }
    setSalvando(true);
    const { error } = await supabase.rpc("atualizar_meu_perfil", { p_nome: f.nome.trim(), p_telefone: f.telefone.trim() });
    setSalvando(false);
    if (error) avisar("erro", /atualizar_meu_perfil|schema cache|does not exist/i.test(error.message)
      ? "O perfil fica editável depois da atualização do banco (0029)." : error.message);
    else avisar("ok", "Perfil salvo. O nome novo aparece na barra lateral ao recarregar.");
  }

  async function sairDeTudo() {
    if (!(await confirmar({ titulo: "Sair de todos os aparelhos?", texto: "Todas as sessões abertas com a sua conta (inclusive esta) são encerradas. Use se esqueceu o Vertces aberto em outro computador.", confirmar: "Sair de todos" }))) return;
    await supabase.auth.signOut({ scope: "global" });
  }

  if (!carregado) return <section className="bloco"><Esqueleto linhas={3} rotulo="Carregando a sua conta…" /></section>;
  const qtd = eu ? (eu.papel === "dono" ? PERMISSOES.length : eu.permissoes.length) : 0;

  return (
    <>
      <section className="bloco">
        <header>
          <h3>Meu perfil<Dica>como o seu nome aparece na barra lateral, na auditoria e nos chamados de suporte</Dica></h3>
          {eu && <span className="desc">{eu.papel === "dono" ? "Dono da empresa" : eu.cargo || "Equipe"}</span>}
        </header>
        <form onSubmit={salvar}>
          <div className="grade">
            <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome e sobrenome" disabled={!eu} /></label>
            <label>Telefone<input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="(00) 00000-0000" inputMode="tel" disabled={!eu} /></label>
            <label><span className="titulo-campo">E-mail de acesso<Dica>é o seu login; para trocar, fale com quem gerencia a equipe</Dica></span><input value={email} readOnly disabled /></label>
            <label>Permissões<input value={eu ? (eu.papel === "dono" ? "Todas (dono)" : `${qtd} de ${PERMISSOES.length}`) : "—"} readOnly disabled /></label>
          </div>
          {eu && (
            <div className="rodape-bloco">
              <button type="submit" className="principal" disabled={salvando}>{salvando ? "Salvando…" : "Salvar perfil"}</button>
            </div>
          )}
        </form>
      </section>
      <TrocarSenhaCartao />
      <section className="bloco">
        <header><h3>Sessões<Dica>encerra o acesso em todos os computadores e celulares onde a sua conta está aberta</Dica></h3></header>
        <div className="rodape-bloco sem-margem">
          <span className="sub">Esqueceu o Vertces aberto em outro computador?</span>
          <span className="esticar" />
          <button type="button" onClick={sairDeTudo}>Sair de todos os aparelhos</button>
        </div>
      </section>
    </>
  );
}
