// Planos: o que cada um cobra, quantos créditos dá e o que libera.
//
//   - cartões dos planos: mensalidade, créditos por mês de cada carteira (geral,
//     CAR…) e o preço do crédito extra por faixa — "Editar" abre o formulário
//   - matriz planos × recursos: o que cada plano libera. Célula listrada = o
//     plano ainda não decidiu (recurso novo): vale o padrão do catálogo, ou
//     bloqueado no plano que não libera recursos novos (o Só CAR).
//
// Tudo aqui pode ser trocado só para uma empresa, na página dela (Plano e créditos).
// Regras no banco: 0024 (planos, recursos) e 0034 (carteiras, preços, mensalidade).
import { useEffect, useMemo, useState } from "react";
import {
  creditosDosPlanos, excluirPlano, matrizPlanos, precosDosPlanos, salvarCreditosPlano, salvarMatrizPlano, salvarPlano, salvarPrecos,
} from "../../lib/admin";
import type { Plano } from "../../lib/admin";
import type { Faixa } from "../../lib/creditos";
import { fmtPreco } from "../../lib/creditos";
import { faixasEmTexto } from "../../../supabase/functions/_shared/precos.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { Carregando, ICO, Ico, Topo } from "./comum";
import { EditorFaixas, faixasParaTexto, mesmasFaixas, problemaDoTexto, reais, textoParaFaixas } from "./Faixas";
import type { FaixaTexto } from "./Faixas";

type Matriz = Record<string, Record<string, boolean>>; // plano → recurso → liberado
type PorMes = Record<string, Record<string, number | null>>; // plano → carteira → créditos/mês
type Precos = Record<string, Record<string, Faixa[]>>; // plano → carteira → faixas

/** Plano em edição: os números são texto até salvar. */
interface Edicao {
  plano: Partial<Plano>;
  mensal: string;
  usuarios: string;
  /** carteira → créditos por mês ("" = sem limite) */
  porMes: Record<string, string>;
  precos: Record<string, FaixaTexto[]>;
}

const qtdMes = (n: number | null | undefined) => (n === null ? "sem limite" : String(n ?? 0));

export function Planos({ d }: { d: DadosAdmin }) {
  const [base, setBase] = useState<Matriz | null>(null);
  const [rascunho, setRascunho] = useState<Matriz>({});
  const [porMes, setPorMes] = useState<PorMes>({});
  const [precos, setPrecos] = useState<Precos>({});
  const [editando, setEditando] = useState<Edicao | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const [linhas, pm, pr] = await Promise.all([matrizPlanos(), creditosDosPlanos().catch(() => ({})), precosDosPlanos().catch(() => ({}))]);
    const m: Matriz = {};
    for (const l of linhas) (m[l.plano_id] ??= {})[l.recurso_chave] = l.liberado;
    setBase(m);
    setPorMes(pm);
    setPrecos(pr);
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
  // célula ainda não decidida: o padrão do catálogo, ou bloqueado no plano que não libera recursos novos
  const padraoDe = (p: Plano, padrao: boolean) => (p.libera_recursos_novos === false ? false : padrao);
  const alternar = (p: Plano, r: string, padrao: boolean) => {
    const atual = valor(p.id, r) ?? padraoDe(p, padrao);
    setRascunho((x) => ({ ...x, [p.id]: { ...(x[p.id] ?? {}), [r]: !atual } }));
  };

  async function salvarMatriz() {
    setSalvando(true); setMsg(null);
    try {
      for (const [p, v] of Object.entries(rascunho)) await salvarMatrizPlano(p, v);
      await carregar();
      setMsg({ tipo: "ok", texto: "Planos salvos. As empresas veem a mudança no próximo acesso (ou ao recarregar a página)." });
    } catch (e) { setMsg({ tipo: "erro", texto: String(e instanceof Error ? e.message : e) }); }
    finally { setSalvando(false); }
  }

  function editar(p?: Plano) {
    const id = p?.id ?? "";
    setEditando({
      plano: p ?? { nome: "", descricao: "", cor: "#178552", ativo: true, libera_recursos_novos: true },
      mensal: p?.preco_mensal != null ? Number(p.preco_mensal).toFixed(2).replace(".", ",") : "",
      usuarios: p?.limite_usuarios ? String(p.limite_usuarios) : "",
      // plano novo começa com 0 em cada carteira (não "sem limite")
      porMes: Object.fromEntries(d.tipos.map((t) => [t.chave, !p ? "0" : porMes[id]?.[t.chave] === null ? "" : String(porMes[id]?.[t.chave] ?? 0)])),
      precos: Object.fromEntries(d.tipos.map((t) => [t.chave, faixasParaTexto(precos[id]?.[t.chave] ?? [])])),
    });
  }

  async function gravarPlano(e: Edicao) {
    if (!e.plano.nome?.trim()) return;
    const erroPreco = d.tipos.map((t) => problemaDoTexto(e.precos[t.chave] ?? [])).find(Boolean);
    if (erroPreco) { setMsg({ tipo: "erro", texto: erroPreco }); return; }
    const mensal = e.mensal.trim() === "" ? null : reais(e.mensal);
    if (mensal !== null && !(mensal >= 0)) { setMsg({ tipo: "erro", texto: "Mensalidade inválida." }); return; }
    setMsg(null);
    try {
      const novo = await salvarPlano({
        ...e.plano, nome: e.plano.nome, ordem: e.plano.ordem ?? (d.planos.length + 1) * 10,
        preco_mensal: mensal, limite_usuarios: e.usuarios ? Math.max(1, Number(e.usuarios)) : null,
      });
      // plano novo nasce com a decisão explícita = padrão de cada recurso
      if (!e.plano.id) await salvarMatrizPlano(novo.id, Object.fromEntries(recursos.map((r) => [r.chave, padraoDe(novo, r.padrao)])));
      for (const t of d.tipos) {
        const v = e.porMes[t.chave] ?? "";
        const n = v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)));
        if (!e.plano.id || n !== porMes[novo.id]?.[t.chave]) await salvarCreditosPlano(novo.id, t.chave, n);
        const antes = faixasParaTexto(precos[novo.id]?.[t.chave] ?? []);
        if (!mesmasFaixas(antes, e.precos[t.chave] ?? [])) await salvarPrecos({ plano: novo.id }, t.chave, textoParaFaixas(e.precos[t.chave] ?? []));
      }
      setEditando(null);
      await Promise.all([d.recarregar(), carregar()]);
      setMsg({ tipo: "ok", texto: `${novo.nome} salvo. Empresas com assinatura no Asaas continuam com o valor antigo até você atualizar a cobrança na página de cada uma.` });
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  async function apagar(p: Plano) {
    const n = d.empresas.filter((e) => e.plano_id === p.id).length;
    if (n > 0) { setMsg({ tipo: "erro", texto: `${p.nome} tem ${n} empresa(s). Mude o plano delas antes, ou só tire o plano do cadastro.` }); return; }
    if (!(await confirmar({ titulo: `Excluir o plano ${p.nome}?`, texto: "O plano sai do catálogo. Nenhuma empresa está nele.", confirmar: "Excluir", perigo: true }))) return;
    try { await excluirPlano(p.id); setEditando(null); await Promise.all([d.recarregar(), carregar()]); }
    catch (e) { setMsg({ tipo: "erro", texto: String(e instanceof Error ? e.message : e) }); }
  }

  const ativos = d.planos.filter((p) => p.ativo);
  const fora = d.planos.filter((p) => !p.ativo);

  return (
    <>
      <Topo olho="Catálogo" titulo="Planos" sub="Mensalidade, créditos e o que cada plano libera. O que for combinado só com uma empresa fica na página dela.">
        <button onClick={() => editar()}><Ico d={ICO.mais} /> Novo plano</button>
      </Topo>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      {editando && <FormPlano e={editando} d={d} onChange={setEditando} onCancelar={() => setEditando(null)}
        onSalvar={() => gravarPlano(editando)} onExcluir={editando.plano.id ? () => apagar(editando.plano as Plano) : undefined} />}

      <div className="sa-planos">
        {ativos.map((p) => <CartaoPlano key={p.id} p={p} d={d} porMes={porMes[p.id] ?? {}} precos={precos[p.id] ?? {}} onEditar={() => editar(p)} />)}
      </div>
      {fora.length > 0 && (
        <details className="sa-planos-fora">
          <summary>{fora.length} plano(s) fora do cadastro de empresa nova<Dica>quem já está neles continua igual; não aparecem para empresa nova</Dica></summary>
          <div className="sa-planos">
            {fora.map((p) => <CartaoPlano key={p.id} p={p} d={d} porMes={porMes[p.id] ?? {}} precos={precos[p.id] ?? {}} onEditar={() => editar(p)} />)}
          </div>
        </details>
      )}

      {!base ? <Carregando /> : (
        <section className="sa-card" style={{ padding: "8px 8px 4px", marginTop: 18 }}>
          <header style={{ padding: "8px 10px 0", display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0, flex: 1 }}>O que cada plano libera<Dica>ligue e desligue. Exceções por empresa ficam na página da empresa.</Dica></h3>
            {mudancas > 0 && <button onClick={() => setRascunho({})} disabled={salvando}>Descartar</button>}
            <button className="principal" onClick={salvarMatriz} disabled={!mudancas || salvando}>
              {salvando ? "Salvando…" : mudancas ? `Salvar ${mudancas} mudança(s)` : "Tudo salvo"}
            </button>
          </header>
          <div className="sa-tabela-wrap">
            <table className="sa-matriz">
              <thead>
                <tr>
                  <th>Recurso</th>
                  {d.planos.map((p) => (
                    <th key={p.id} style={p.ativo ? undefined : { opacity: 0.6 }}>
                      <div className="sa-plano-cab">
                        <span className="cor" style={{ background: p.cor }} />
                        <b>{p.nome}</b>
                        <small>{d.empresas.filter((e) => e.plano_id === p.id).length} empresa(s){p.ativo ? "" : " · fora do cadastro"}</small>
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
                          const padrao = padraoDe(p, r.padrao);
                          return (
                            <td key={p.id} className="c" style={mudou ? { background: "#FFF9E8" } : undefined}>
                              <button type="button" role="switch" aria-checked={v ?? padrao}
                                className={v === undefined ? "sa-switch indefinido" : "sa-switch"}
                                title={v === undefined ? `Ainda não decidido: ${padrao ? "liberado" : "bloqueado"} (${p.libera_recursos_novos === false ? "o plano não libera recursos novos" : "padrão do catálogo"})` : undefined}
                                aria-label={`${r.nome} no plano ${p.nome}`}
                                onClick={() => alternar(p, r.chave, r.padrao)} />
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

function CartaoPlano({ p, d, porMes, precos, onEditar }: {
  p: Plano; d: DadosAdmin; porMes: Record<string, number | null>; precos: Record<string, Faixa[]>; onEditar: () => void;
}) {
  const empresas = d.empresas.filter((e) => e.plano_id === p.id).length;
  return (
    <section className="sa-card sa-plano-cartao" style={{ borderTopColor: p.cor }}>
      <header>
        <div>
          <h3>{p.nome}</h3>
          <small className="sub">{empresas} empresa(s){p.libera_recursos_novos === false ? " · recursos novos bloqueados" : ""}</small>
        </div>
        <button type="button" onClick={onEditar}>Editar</button>
      </header>
      <div className="sa-plano-preco">
        {p.preco_mensal != null ? <><b>{fmtPreco(Number(p.preco_mensal))}</b><span>/mês</span></> : <span className="sa-falta">mensalidade não definida</span>}
      </div>
      <ul className="sa-plano-creditos">
        {d.tipos.map((t) => (
          <li key={t.chave}>
            <b>{qtdMes(t.chave in porMes ? porMes[t.chave] : undefined)}</b> {t.nome.charAt(0).toLowerCase() + t.nome.slice(1)} por mês
            <small>{precos[t.chave]?.length ? `extra: ${faixasEmTexto(precos[t.chave]).join(" · ")}` : "sem venda de extra"}</small>
          </li>
        ))}
      </ul>
      {p.descricao && <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>{p.descricao}</p>}
    </section>
  );
}

function FormPlano({ e, d, onChange, onCancelar, onSalvar, onExcluir }: {
  e: Edicao; d: DadosAdmin; onChange: (e: Edicao) => void; onCancelar: () => void; onSalvar: () => void; onExcluir?: () => void;
}) {
  const p = e.plano;
  const set = (x: Partial<Plano>) => onChange({ ...e, plano: { ...p, ...x } });
  return (
    <form className="sa-card" style={{ marginBottom: 18 }} onSubmit={(ev) => { ev.preventDefault(); onSalvar(); }}>
      <header><h3>{p.id ? `Editar ${p.nome}` : "Novo plano"}</h3></header>
      <div className="sa-campos">
        <label>Nome<input value={p.nome ?? ""} onChange={(x) => set({ nome: x.target.value })} required autoFocus /></label>
        <label><Rotulo dica="vazio = não definida; sem mensalidade a empresa não recebe link de pagamento">Mensalidade (R$)</Rotulo>
          <input inputMode="decimal" placeholder="não definida" value={e.mensal} onChange={(x) => onChange({ ...e, mensal: x.target.value })} />
        </label>
        <label>Situação
          <select value={p.ativo === false ? "0" : "1"} onChange={(x) => set({ ativo: x.target.value === "1" })}>
            <option value="1">No cadastro de empresa nova</option><option value="0">Fora do cadastro</option>
          </select>
        </label>
        <label><Rotulo dica="vazio = sem limite; a empresa não ativa ninguém além disso">Limite de usuários ativos</Rotulo>
          <input type="number" min={1} placeholder="sem limite" value={e.usuarios} onChange={(x) => onChange({ ...e, usuarios: x.target.value })} />
        </label>
        <label><Rotulo dica="o que entrar no sistema depois: liberado (segue o padrão do recurso) ou bloqueado até você decidir">Recursos novos</Rotulo>
          <select value={p.libera_recursos_novos === false ? "0" : "1"} onChange={(x) => set({ libera_recursos_novos: x.target.value === "1" })}>
            <option value="1">Liberados</option><option value="0">Bloqueados até decidir</option>
          </select>
        </label>
        <label>Cor<input type="color" value={p.cor ?? "#178552"} onChange={(x) => set({ cor: x.target.value })} style={{ padding: 4 }} /></label>
        <label className="largo">Descrição<input value={p.descricao ?? ""} onChange={(x) => set({ descricao: x.target.value })} placeholder="Para quem é este plano" /></label>
      </div>
      <div className="sa-carteiras-form">
        {d.tipos.map((t) => (
          <fieldset key={t.chave}>
            <legend>{t.nome}{t.descricao && <Dica>{t.descricao}</Dica>}</legend>
            <label><Rotulo dica="vazio = sem limite; 0 = o plano não dá estes créditos">Créditos por mês</Rotulo>
              <input type="number" min={0} placeholder="sem limite" value={e.porMes[t.chave] ?? ""}
                onChange={(x) => onChange({ ...e, porMes: { ...e.porMes, [t.chave]: x.target.value } })} />
            </label>
            <div className="sa-rotulo-faixas"><Rotulo dica="a primeira linha é a compra mínima; mais linhas = preço menor para quantidades maiores">Preço do crédito extra</Rotulo></div>
            <EditorFaixas rotulo={`${t.nome} extras`} valor={e.precos[t.chave] ?? []}
              onChange={(v) => onChange({ ...e, precos: { ...e.precos, [t.chave]: v } })} />
          </fieldset>
        ))}
      </div>
      <div className="sa-rodape-form">
        {onExcluir && <button type="button" className="fantasma" onClick={onExcluir} style={{ marginRight: "auto" }}>Excluir plano</button>}
        <button type="button" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="principal">Salvar plano</button>
      </div>
    </form>
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
