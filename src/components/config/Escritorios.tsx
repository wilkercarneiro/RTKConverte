// Configurações → Escritórios (0050): os escritórios adicionais da empresa.
//
// O plano Empresarial permite escritórios adicionais. Cada um é um espaço
// próprio — serviços, clientes, cadastros, configurações e equipe — que usa o
// plano e os créditos da matriz e soma o preço dele à mensalidade. Aqui o dono
// cria, entra, renomeia, desativa (sai da mensalidade, os dados ficam) e
// reativa. No plano sem escritórios, a aba mostra o que o Empresarial inclui.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  contaDaMensalidade, criarEscritorio, definirEscritorio, entrarNoEscritorio, meusEscritorios, sincronizarMensalidade,
} from "../../lib/escritorios";
import type { EscritorioAdicional, MeusEscritorios } from "../../lib/escritorios";
import { fmtPreco } from "../../lib/creditos_regras";
import { dataBr } from "../../../supabase/functions/_shared/mensagens_cobranca.ts";
import { abrirSuporte } from "../suporte/SuporteChat";
import { avisar, confirmar, Dica, EstadoErro, Esqueleto } from "../ui";
import "./config.css";

const ICO = {
  predio: "M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h2a2 2 0 0 1 2 2v10M9 7h2M9 11h2M9 15h2",
  mais: "M12 5v14M5 12h14",
  entrar: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  lapis: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  pausa: "M10 15V9M14 15V9M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  volta: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  check: "M20 6 9 17l-5-5",
};
const Ico = ({ d, t = 16 }: { d: string; t?: number }) => (
  <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function Escritorios() {
  const [dados, setDados] = useState<MeusEscritorios | null | undefined>(undefined);
  const [falha, setFalha] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function carregar() {
    setFalha(null);
    try { setDados(await meusEscritorios()); }
    catch (e) { setFalha(String(e instanceof Error ? e.message : e)); }
  }
  useEffect(() => { void carregar(); }, []);

  // A lista mudou: a mensalidade nova vai para o Asaas e o seletor do topo é relido.
  async function depoisDeMudar(texto: string) {
    let extra = "";
    try {
      const r = await sincronizarMensalidade();
      if (r.sincronizado && r.valor != null) extra = ` A mensalidade passa a ser ${fmtPreco(Number(r.valor))} (já atualizada na cobrança).`;
    } catch {
      extra = " A cobrança será ajustada pela equipe do Vertces.";
    }
    avisar("ok", texto + extra);
    dispatchEvent(new CustomEvent("vertces:escritorios-mudaram"));
    await carregar();
  }

  async function criar(ev: FormEvent) {
    ev.preventDefault();
    const n = nome.trim();
    if (n.length < 2 || !dados) return;
    const ok = await confirmar({
      titulo: `Criar o escritório ${n}?`,
      texto: `Ele soma ${fmtPreco(Number(dados.preco ?? 0))} por mês à mensalidade, a partir de agora. Usa o plano e os créditos da ${dados.matriz?.nome ?? "empresa"}; serviços, clientes e equipe ficam separados.`,
      confirmar: "Criar escritório",
    });
    if (!ok) return;
    setOcupado("novo");
    try {
      await criarEscritorio(n);
      setCriando(false); setNome("");
      await depoisDeMudar(`Escritório ${n} criado. Entre nele pelo seletor no alto do menu.`);
    } catch (e) { avisar("erro", String(e instanceof Error ? e.message : e)); }
    finally { setOcupado(null); }
  }

  async function renomear(ev: FormEvent) {
    ev.preventDefault();
    if (!renomeando) return;
    setOcupado(renomeando.id);
    try {
      await definirEscritorio(renomeando.id, { nome: renomeando.nome });
      setRenomeando(null);
      avisar("ok", "Nome do escritório atualizado.");
      dispatchEvent(new CustomEvent("vertces:escritorios-mudaram"));
      await carregar();
    } catch (e) { avisar("erro", String(e instanceof Error ? e.message : e)); }
    finally { setOcupado(null); }
  }

  async function alternar(f: EscritorioAdicional) {
    const ativo = f.status === "ativo";
    const ok = await confirmar(ativo
      ? { titulo: `Desativar ${f.nome}?`, texto: `Ninguém entra mais nele e ele sai da mensalidade (− ${fmtPreco(Number(dados?.preco ?? 0))}/mês). Os serviços, clientes e a equipe ficam guardados: reativando, tudo volta.`, confirmar: "Desativar", perigo: true }
      : { titulo: `Reativar ${f.nome}?`, texto: `Volta a somar ${fmtPreco(Number(dados?.preco ?? 0))} por mês à mensalidade, com tudo como estava.`, confirmar: "Reativar" });
    if (!ok) return;
    setOcupado(f.id);
    try {
      await definirEscritorio(f.id, { ativo: !ativo });
      await depoisDeMudar(ativo ? `${f.nome} desativado.` : `${f.nome} reativado.`);
    } catch (e) { avisar("erro", String(e instanceof Error ? e.message : e)); }
    finally { setOcupado(null); }
  }

  async function entrar(id: string | null) {
    setOcupado(id ?? "matriz");
    try { await entrarNoEscritorio(id); }
    catch (e) { avisar("erro", String(e instanceof Error ? e.message : e)); setOcupado(null); }
  }

  if (falha) return <EstadoErro titulo="Não foi possível carregar os escritórios" mensagem={falha} onTentar={carregar} />;
  if (dados === undefined) return <Esqueleto linhas={3} rotulo="Carregando os escritórios…" />;
  if (dados === null) return <p className="sub">Os escritórios adicionais ainda não estão disponíveis neste servidor.</p>;
  if (!dados.disponivel) {
    return (
      <section className="bloco">
        <p className="sub" style={{ margin: 0 }}>Só o dono da empresa cuida dos escritórios adicionais.</p>
      </section>
    );
  }

  const limite = dados.limite ?? 0;
  const ativos = dados.ativos ?? 0;
  const preco = Number(dados.preco ?? 0);
  const lista = dados.escritorios ?? [];
  const vagas = Math.max(0, limite - ativos);
  const conta = contaDaMensalidade(dados.mensalidade, (v) => fmtPreco(v));
  const naMatriz = !dados.em_uso || dados.em_uso === dados.matriz?.id;

  if (limite === 0 && lista.length === 0) {
    return (
      <section className="esc-oferta">
        <span className="esc-oferta-icone"><Ico d={ICO.predio} t={26} /></span>
        <div>
          <span className="pu-olho">Plano Empresarial</span>
          <h2>Mais de um escritório, um sistema só</h2>
          <p>
            No Empresarial, os créditos são <b>ilimitados</b> e a empresa pode abrir até <b>2 escritórios adicionais</b>
            {" "}(R$ 99,90 por mês cada): cada um com serviços, clientes e equipe próprios, usando o plano da matriz.
            Você troca de escritório no alto do menu.
          </p>
        </div>
        <button type="button" className="pu-cta"
          onClick={() => abrirSuporte({ novo: true, categoria: "financeiro", assunto: `Quero o plano Empresarial para a ${dados.matriz?.nome ?? "empresa"}` })}>
          Quero o Empresarial
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="pu-heroi">
        <div>
          <span className="pu-olho">Escritórios adicionais</span>
          <h2>{ativos} de {limite} em uso</h2>
          <p>{dados.plano ? `Plano ${dados.plano} · ` : ""}{fmtPreco(preco)} por mês cada · o plano e os créditos são os da matriz</p>
        </div>
        <button type="button" className="pu-cta" disabled={vagas === 0 || ocupado !== null}
          title={vagas === 0 ? "Todos os escritórios do plano estão em uso: desative um para criar outro" : undefined}
          onClick={() => { setCriando(true); setRenomeando(null); }}>
          <Ico d={ICO.mais} /> Novo escritório
        </button>
      </section>

      {dados.mensalidade?.total != null && Number(dados.mensalidade.total) > 0 && (
        <div className="esc-conta">
          <span>Mensalidade</span>
          <b>{fmtPreco(Number(dados.mensalidade.total))}</b>
          <small>{conta ?? "sem escritórios adicionais ativos"}</small>
        </div>
      )}

      {criando && (
        <form className="bloco esc-form" onSubmit={criar}>
          <label>
            <span>Nome do escritório</span>
            <input autoFocus value={nome} maxLength={120} placeholder="Ex.: Filial Feira de Santana" onChange={(e) => setNome(e.target.value)} />
          </label>
          <p className="sub">Nasce com os dados da empresa (razão social, CNPJ, endereço), que você pode trocar nas Configurações dele. Soma {fmtPreco(preco)}/mês.</p>
          <div className="esc-form-acoes">
            <button type="button" onClick={() => { setCriando(false); setNome(""); }}>Cancelar</button>
            <button type="submit" className="principal" disabled={nome.trim().length < 2 || ocupado !== null}>
              {ocupado === "novo" ? "Criando…" : "Criar escritório"}
            </button>
          </div>
        </form>
      )}

      <div className="esc-grade">
        <article className={`esc-cartao matriz${naMatriz ? " atual" : ""}`}>
          <header>
            <span className="esc-icone"><Ico d={ICO.predio} /></span>
            <div><h3>{dados.matriz?.nome}</h3><small>Matriz · paga a mensalidade</small></div>
            {naMatriz && <span className="esc-selo atual">Você está aqui</span>}
          </header>
          {dados.matriz?.servicos !== undefined && (
            <dl className="esc-numeros">
              <div><dt>Serviços</dt><dd>{dados.matriz.servicos}</dd></div>
              <div><dt>Últimos 30 dias</dt><dd>{dados.matriz.servicos_30d ?? 0}</dd></div>
              <div><dt>Equipe</dt><dd>{dados.matriz.usuarios ?? 0}</dd></div>
            </dl>
          )}
          <footer>
            {!naMatriz && (
              <button type="button" className="principal" disabled={ocupado !== null} onClick={() => entrar(null)}>
                <Ico d={ICO.entrar} /> {ocupado === "matriz" ? "Entrando…" : "Voltar à matriz"}
              </button>
            )}
          </footer>
        </article>

        {lista.map((f) => {
          const ativo = f.status === "ativo";
          const aqui = dados.em_uso === f.id;
          return (
            <article key={f.id} className={`esc-cartao${ativo ? "" : " parado"}${aqui ? " atual" : ""}`}>
              <header>
                <span className="esc-icone"><Ico d={ICO.predio} /></span>
                {renomeando?.id === f.id ? (
                  <form className="esc-renomear" onSubmit={renomear}>
                    <input autoFocus value={renomeando.nome} maxLength={120} aria-label="Novo nome do escritório"
                      onChange={(e) => setRenomeando({ id: f.id, nome: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Escape") setRenomeando(null); }} />
                    <button type="submit" className="principal" aria-label="Salvar o nome" disabled={renomeando.nome.trim().length < 2}><Ico d={ICO.check} /></button>
                  </form>
                ) : (
                  <div><h3>{f.nome}</h3><small>criado em {dataBr(f.criado_em.slice(0, 10))}</small></div>
                )}
                {aqui ? <span className="esc-selo atual">Você está aqui</span>
                  : <span className={`esc-selo ${ativo ? "ativo" : "parado"}`}>{ativo ? "Ativo" : f.status === "cancelado" ? "Encerrado" : "Desativado"}</span>}
              </header>
              <dl className="esc-numeros">
                <div><dt>Serviços</dt><dd>{f.servicos}</dd></div>
                <div><dt>Últimos 30 dias</dt><dd>{f.servicos_30d}</dd></div>
                <div><dt>Equipe<Dica>pessoas com acesso só a este escritório; você entra em todos</Dica></dt><dd>{f.usuarios}</dd></div>
              </dl>
              <footer>
                {ativo && !aqui && (
                  <button type="button" className="principal" disabled={ocupado !== null} onClick={() => entrar(f.id)}>
                    <Ico d={ICO.entrar} /> {ocupado === f.id ? "Entrando…" : "Entrar"}
                  </button>
                )}
                {f.status !== "cancelado" && (
                  <>
                    <button type="button" className="fantasma" disabled={ocupado !== null} onClick={() => setRenomeando({ id: f.id, nome: f.nome })}>
                      <Ico d={ICO.lapis} /> Renomear
                    </button>
                    <button type="button" className="fantasma" disabled={ocupado !== null || (!ativo && vagas === 0)}
                      title={!ativo && vagas === 0 ? "Todos os escritórios do plano estão em uso" : undefined}
                      onClick={() => alternar(f)}>
                      <Ico d={ativo ? ICO.pausa : ICO.volta} /> {ativo ? "Desativar" : "Reativar"}
                    </button>
                  </>
                )}
              </footer>
            </article>
          );
        })}

        {Array.from({ length: criando ? Math.max(0, vagas - 1) : vagas }, (_, i) => (
          <button key={`vaga-${i}`} type="button" className="esc-vaga" disabled={ocupado !== null}
            onClick={() => { setCriando(true); setRenomeando(null); }}>
            <Ico d={ICO.mais} t={22} />
            <b>Escritório disponível</b>
            <small>incluso no plano · {fmtPreco(preco)}/mês quando ativo</small>
          </button>
        ))}
      </div>

      <section className="bloco esc-como">
        <header><h3>Como funciona</h3></header>
        <ul>
          <li><b>Espaço próprio.</b> Cada escritório tem serviços, clientes, responsáveis, modelos e equipe separados.</li>
          <li><b>Plano e créditos da matriz.</b> Os recursos e o saldo de créditos são um só para a empresa inteira.</li>
          <li><b>Você entra em todos.</b> Troque de escritório no alto do menu; quem é da equipe de um escritório entra só nele.</li>
          <li><b>Desativar não apaga.</b> O escritório desativado sai da mensalidade e guarda tudo para quando voltar.</li>
        </ul>
      </section>
    </>
  );
}
