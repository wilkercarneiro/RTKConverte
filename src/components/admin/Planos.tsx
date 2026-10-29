// Planos × recursos: a matriz do que cada plano libera. Sem preço — o valor é
// combinado na reunião; o plano só decide o que a empresa enxerga.
//
// Célula listrada = o plano ainda não decidiu (recurso novo): vale o padrão do
// catálogo. Qualquer clique grava uma decisão explícita.
import { useEffect, useMemo, useState } from "react";
import { excluirPlano, matrizPlanos, salvarMatrizPlano, salvarPlano } from "../../lib/admin";
import type { Plano } from "../../lib/admin";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { Carregando, ICO, Ico, Topo } from "./comum";

type Matriz = Record<string, Record<string, boolean>>; // plano → recurso → liberado

export function Planos({ d }: { d: DadosAdmin }) {
  const [base, setBase] = useState<Matriz | null>(null);
  const [rascunho, setRascunho] = useState<Matriz>({});
  const [editando, setEditando] = useState<Partial<Plano> | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const linhas = await matrizPlanos();
    const m: Matriz = {};
    for (const l of linhas) (m[l.plano_id] ??= {})[l.recurso_chave] = l.liberado;
    setBase(m);
    setRascunho({});
  }
  useEffect(() => { carregar().catch((e) => setMsg({ tipo: "erro", texto: String(e.message ?? e) })); }, []);

  const recursos = d.recursos.filter((r) => r.ativo);
  const grupos = useMemo(() => {
    const g = new Map<string, typeof recursos>();
    for (const r of recursos) g.set(r.grupo, [...(g.get(r.grupo) ?? []), r]);
    return [...g];
  }, [recursos]);
  const mudancas = Object.values(rascunho).reduce((s, x) => s + Object.keys(x).length, 0);

  const valor = (p: string, r: string): boolean | undefined => rascunho[p]?.[r] ?? base?.[p]?.[r];
  const alternar = (p: string, r: string, padrao: boolean) => {
    const atual = valor(p, r) ?? padrao;
    setRascunho((x) => ({ ...x, [p]: { ...(x[p] ?? {}), [r]: !atual } }));
  };

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      for (const [p, v] of Object.entries(rascunho)) await salvarMatrizPlano(p, v);
      await carregar();
      setMsg({ tipo: "ok", texto: "Planos salvos. As empresas veem a mudança no próximo acesso (ou ao recarregar a página)." });
    } catch (e) { setMsg({ tipo: "erro", texto: String(e instanceof Error ? e.message : e) }); }
    finally { setSalvando(false); }
  }

  async function gravarPlano(p: Partial<Plano>) {
    if (!p.nome?.trim()) return;
    try {
      const novo = await salvarPlano({ ...p, nome: p.nome, ordem: p.ordem ?? (d.planos.length + 1) * 10 });
      // plano novo nasce com a decisão explícita = padrão de cada recurso
      if (!p.id) await salvarMatrizPlano(novo.id, Object.fromEntries(recursos.map((r) => [r.chave, r.padrao])));
      setEditando(null);
      await Promise.all([d.recarregar(), carregar()]);
    } catch (e) { setMsg({ tipo: "erro", texto: String(e instanceof Error ? e.message : e) }); }
  }

  async function apagar(p: Plano) {
    const n = d.empresas.filter((e) => e.plano_id === p.id).length;
    if (n > 0) { setMsg({ tipo: "erro", texto: `${p.nome} tem ${n} empresa(s). Mude o plano delas antes, ou só desative o plano.` }); return; }
    if (!(await confirmar({ titulo: `Excluir o plano ${p.nome}?`, texto: "O plano sai do catálogo. Nenhuma empresa está nele.", confirmar: "Excluir", perigo: true }))) return;
    try { await excluirPlano(p.id); setEditando(null); await Promise.all([d.recarregar(), carregar()]); }
    catch (e) { setMsg({ tipo: "erro", texto: String(e instanceof Error ? e.message : e) }); }
  }

  return (
    <>
      <Topo olho="Catálogo" titulo="Planos" sub="Ligue e desligue o que cada plano libera. Exceções por empresa ficam na página da empresa.">
        {mudancas > 0 && <button onClick={() => setRascunho({})} disabled={salvando}>Descartar</button>}
        <button onClick={() => setEditando({ nome: "", descricao: "", cor: "#178552", ativo: true })}><Ico d={ICO.mais} /> Novo plano</button>
        <button className="principal" onClick={salvar} disabled={!mudancas || salvando}>
          {salvando ? "Salvando…" : mudancas ? `Salvar ${mudancas} mudança(s)` : "Tudo salvo"}
        </button>
      </Topo>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      {editando && (
        <form className="sa-card" style={{ marginBottom: 18 }} onSubmit={(e) => { e.preventDefault(); gravarPlano(editando); }}>
          <header><h3>{editando.id ? `Editar ${editando.nome}` : "Novo plano"}</h3></header>
          <div className="sa-campos">
            <label>Nome<input value={editando.nome ?? ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} required autoFocus /></label>
            <label>Cor<input type="color" value={editando.cor ?? "#178552"} onChange={(e) => setEditando({ ...editando, cor: e.target.value })} style={{ padding: 4 }} /></label>
            <label>Situação
              <select value={editando.ativo === false ? "0" : "1"} onChange={(e) => setEditando({ ...editando, ativo: e.target.value === "1" })}>
                <option value="1">Ativo (aparece no cadastro de empresa)</option><option value="0">Inativo</option>
              </select>
            </label>
            <label><Rotulo dica="vazio = sem limite; a empresa não ativa ninguém além disso">Limite de usuários ativos</Rotulo>
              <input type="number" min={1} placeholder="sem limite" value={editando.limite_usuarios ?? ""}
                onChange={(e) => setEditando({ ...editando, limite_usuarios: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
            </label>
            <label className="largo">Descrição<input value={editando.descricao ?? ""} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} placeholder="Para quem é este plano" /></label>
          </div>
          <div className="sa-rodape-form">
            {editando.id && <button type="button" className="fantasma" onClick={() => apagar(editando as Plano)} style={{ marginRight: "auto" }}>Excluir plano</button>}
            <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
            <button type="submit" className="principal">Salvar plano</button>
          </div>
        </form>
      )}

      {!base ? <Carregando /> : (
        <section className="sa-card" style={{ padding: "8px 8px 4px" }}>
          <div className="sa-tabela-wrap">
            <table className="sa-matriz">
              <thead>
                <tr>
                  <th>Recurso</th>
                  {d.planos.map((p) => (
                    <th key={p.id}>
                      <div className="sa-plano-cab">
                        <span className="cor" style={{ background: p.cor }} />
                        <b>{p.nome}</b>
                        <small>{d.empresas.filter((e) => e.plano_id === p.id).length} empresa(s){p.ativo ? "" : " · inativo"}</small>
                        <small>{p.limite_usuarios ? `até ${p.limite_usuarios} usuário(s)` : "usuários sem limite"}</small>
                        <button type="button" onClick={() => setEditando(p)}>Editar</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map(([g, itens]) => (
                  <GrupoLinhas key={g} grupo={g} colunas={d.planos.length}>
                    {itens.map((r) => (
                      <tr key={r.chave}>
                        <td className="rec">
                          <b>{r.nome}</b>
                          {d.planos.some((p) => base[p.id]?.[r.chave] === undefined) && <> <span className="sa-novo">decidir</span></>}
                          {r.descricao && <Dica>{r.descricao}</Dica>}
                        </td>
                        {d.planos.map((p) => {
                          const v = valor(p.id, r.chave);
                          const mudou = rascunho[p.id]?.[r.chave] !== undefined;
                          return (
                            <td key={p.id} className="c" style={mudou ? { background: "#FFF9E8" } : undefined}>
                              <button type="button" role="switch" aria-checked={v ?? r.padrao}
                                className={v === undefined ? "sa-switch indefinido" : "sa-switch"}
                                title={v === undefined ? `Ainda não decidido: segue o padrão (${r.padrao ? "liberado" : "bloqueado"})` : undefined}
                                aria-label={`${r.nome} no plano ${p.nome}`}
                                onClick={() => alternar(p.id, r.chave, r.padrao)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </GrupoLinhas>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function GrupoLinhas({ grupo, colunas, children }: { grupo: string; colunas: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="grupo"><td colSpan={colunas + 1}>{grupo}</td></tr>
      {children}
    </>
  );
}
