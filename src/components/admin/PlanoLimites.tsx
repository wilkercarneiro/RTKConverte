// Aba "Plano e limites" da empresa: O QUE ela usa e QUANTO, numa tela só.
//
// Cada linha diz o que o plano dá, o que foi definido só para esta empresa e o
// que VALE AGORA (sem ter de deduzir). Nada grava ao clicar: as mudanças ficam
// num rascunho e vão juntas em "Salvar alterações".
//
// Por baixo, as mesmas regras de sempre: exceção de recurso (escritorio_recursos,
// 0024) e limite da empresa (escritorio_limites, 0027).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  atualizarEmpresa, definirLimiteEmpresa, definirRecursoEmpresa, matrizPlanos, recursosDaEmpresa,
} from "../../lib/admin";
import type { CreditosEmpresa, Empresa, RecursoEmpresa } from "../../lib/admin";
import { recursoDe } from "../../lib/recursos";
import type { DadosAdmin } from "./PainelAdmin";
import { Dica } from "../ui";
import { Carregando } from "./comum";

type Acesso = "plano" | "liberar" | "bloquear";
interface Limite { modo: "plano" | "empresa"; valor: string }
interface Rascunho { plano: string; acesso: Record<string, Acesso>; limite: Record<string, Limite> }

const fmtLim = (n: number | null) => (n === null ? "sem limite" : `${n} por mês`);
const numero = (v: string): number | null => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));

export function PlanoLimites({ e, d, cred, onSalvo }: {
  e: Empresa; d: DadosAdmin; cred: CreditosEmpresa | null; onSalvo: (texto: string) => Promise<void>;
}) {
  const [recursos, setRecursos] = useState<RecursoEmpresa[] | null>(null);
  const [matriz, setMatriz] = useState<{ plano_id: string; recurso_chave: string; liberado: boolean; limite_mes?: number | null }[]>([]);
  const [inicial, setInicial] = useState<Rascunho | null>(null);
  const [r, setR] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [rec, mat] = await Promise.all([recursosDaEmpresa(e.id), matrizPlanos()]);
    setRecursos(rec);
    setMatriz(mat);
  }, [e.id]);
  useEffect(() => { carregar().catch((x) => setErro(String(x.message ?? x))); }, [carregar]);

  // rascunho nasce do que está gravado
  useEffect(() => {
    if (!recursos || !cred) return;
    const acesso: Record<string, Acesso> = {};
    for (const l of recursos) acesso[l.chave] = l.excecao === null ? "plano" : l.excecao ? "liberar" : "bloquear";
    const limite: Record<string, Limite> = {};
    for (const k of ["total", ...recursos.filter((l) => l.chave.startsWith("servico.")).map((l) => l.chave)]) {
      limite[k] = k in cred.negociado ? { modo: "empresa", valor: cred.negociado[k] === null ? "" : String(cred.negociado[k]) } : { modo: "plano", valor: "" };
    }
    const base = { plano: e.plano_id ?? "", acesso, limite };
    setInicial(base);
    setR(base);
  }, [recursos, cred, e.plano_id]);

  const porChave = useMemo(() => new Map(d.recursos.map((x) => [x.chave, x])), [d.recursos]);
  if (!r || !inicial || !recursos || !cred) return erro ? <div className="sa-aviso erro">{erro}</div> : <Carregando />;

  // o que o plano ESCOLHIDO NO RASCUNHO dá (trocar o plano já mostra o efeito)
  const plano = d.planos.find((p) => p.id === r.plano);
  const linhaPlano = (k: string) => matriz.find((m) => m.plano_id === r.plano && m.recurso_chave === k);
  const acessoDoPlano = (k: string) => linhaPlano(k)?.liberado ?? porChave.get(k)?.padrao ?? true;
  const limiteDoPlano = (k: string): number | null =>
    !plano ? null : k === "total" ? plano.limite_servicos_mes ?? null : linhaPlano(k)?.limite_mes ?? null;
  const acessoVale = (k: string) => (r.acesso[k] === "plano" ? acessoDoPlano(k) : r.acesso[k] === "liberar");
  const limiteVale = (k: string) => (r.limite[k]?.modo === "empresa" ? numero(r.limite[k].valor) : limiteDoPlano(k));

  const mudancas = [
    r.plano !== inicial.plano ? 1 : 0,
    ...Object.keys(r.acesso).map((k) => (r.acesso[k] !== inicial.acesso[k] ? 1 : 0)),
    ...Object.keys(r.limite).map((k) => (mudouLimite(r.limite[k], inicial.limite[k]) ? 1 : 0)),
  ].reduce((a, b) => a + b, 0);

  const setAcesso = (k: string, v: Acesso) => setR({ ...r, acesso: { ...r.acesso, [k]: v } });
  const setLimite = (k: string, v: Limite) => setR({ ...r, limite: { ...r.limite, [k]: v } });

  async function salvar() {
    if (!r || !inicial) return;
    setSalvando(true); setErro(null);
    try {
      if (r.plano !== inicial.plano) await atualizarEmpresa(e.id, { plano_id: r.plano || null });
      for (const k of Object.keys(r.acesso)) {
        if (r.acesso[k] !== inicial.acesso[k]) await definirRecursoEmpresa(e.id, k, r.acesso[k] === "plano" ? null : r.acesso[k] === "liberar");
      }
      for (const k of Object.keys(r.limite)) {
        const v = r.limite[k];
        if (mudouLimite(v, inicial.limite[k])) await definirLimiteEmpresa(e.id, k, v.modo === "empresa" ? numero(v.valor) : null, v.modo === "plano");
      }
      await carregar();
      await onSalvo(`${mudancas} alteração(ões) salva(s). A empresa vê no próximo acesso (ou ao recarregar a página).`);
    } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
    finally { setSalvando(false); }
  }

  const mes = new Date(`${cred.mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });
  const servicos = recursos.filter((l) => l.chave.startsWith("servico."));
  const outros = recursos.filter((l) => !l.chave.startsWith("servico."));
  const nome = (k: string) => porChave.get(k)?.nome ?? recursoDe(k)?.nome ?? k;
  const totalVale = limiteVale("total");

  return (
    <div className="sa-grade">
      {erro && <div className="sa-aviso erro">{erro}</div>}

      <section className="sa-card">
        <header><h3>Plano e créditos por mês<Dica>1 crédito = 1 serviço aberto (o arquivo de entrada enviado). O limite renova todo dia 1º. Apagar um serviço não devolve o crédito.</Dica></h3></header>
        <div className="sa-campos">
          <label>Plano
            <select value={r.plano} onChange={(x) => setR({ ...r, plano: x.target.value })}>
              {d.planos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
              <option value="">Sem plano</option>
            </select>
          </label>
          <CampoLimite rotulo="Créditos por mês (todos os serviços)" doPlano={limiteDoPlano("total")} valor={r.limite.total} onChange={(v) => setLimite("total", v)} />
        </div>
        <p className="sa-vale">
          <b>Vale agora:</b> {totalVale === null ? "sem limite de serviços por mês" : `até ${totalVale} serviço(s) por mês, somando todos`}
          {` · usados em ${mes}: ${cred.total.usado}`}
          {r.limite.total.modo === "empresa" && <span className="sa-pill neutro">definido para esta empresa</span>}
        </p>
      </section>

      <section className="sa-card">
        <header><h3>Serviços<Dica>Acesso: se a empresa enxerga o serviço. Limite por mês: quantos daquele serviço ela abre no mês; vale junto com o total acima (o que acabar primeiro).</Dica></h3></header>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela sa-limites">
            <thead><tr><th>Serviço</th><th>Acesso</th><th>Limite por mês</th><th>Usados em {mes}</th><th>Vale agora</th></tr></thead>
            <tbody>
              {servicos.map((l) => {
                const k = l.chave;
                const libera = acessoVale(k);
                const lim = limiteVale(k);
                const s = cred.servicos[k];
                return (
                  <tr key={k} className={mudouLinha(r, inicial, k) ? "mudou" : undefined}>
                    <td><b>{nome(k)}</b></td>
                    <td data-rotulo="Acesso"><CampoAcesso doPlano={acessoDoPlano(k)} valor={r.acesso[k]} onChange={(v) => setAcesso(k, v)} rotulo={nome(k)} /></td>
                    <td data-rotulo="Limite por mês">{libera
                      ? <CampoLimite doPlano={limiteDoPlano(k)} valor={r.limite[k]} onChange={(v) => setLimite(k, v)} rotulo={`Limite de ${nome(k)}`} compacto />
                      : <span className="sub">—</span>}</td>
                    <td data-rotulo={`Usados em ${mes}`}>{s ? s.usado : 0}</td>
                    <td>{libera
                      ? <span className="sa-pill ativo">{lim === null ? "Liberado, sem limite" : `Liberado, até ${lim}/mês`}</span>
                      : <span className="sa-pill cancelado">Bloqueado</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {outros.length > 0 && (
        <section className="sa-card">
          <header><h3>Outros recursos<Dica>funções que não abrem serviço e não gastam crédito</Dica></h3></header>
          <div className="sa-tabela-wrap">
            <table className="sa-tabela sa-limites">
              <thead><tr><th>Recurso</th><th>Acesso</th><th>Vale agora</th></tr></thead>
              <tbody>
                {outros.map((l) => (
                  <tr key={l.chave} className={r.acesso[l.chave] !== inicial.acesso[l.chave] ? "mudou" : undefined}>
                    <td><b>{nome(l.chave)}</b>{porChave.get(l.chave)?.descricao && <Dica>{porChave.get(l.chave)!.descricao}</Dica>}</td>
                    <td data-rotulo="Acesso"><CampoAcesso doPlano={acessoDoPlano(l.chave)} valor={r.acesso[l.chave]} onChange={(v) => setAcesso(l.chave, v)} rotulo={nome(l.chave)} /></td>
                    <td>{acessoVale(l.chave) ? <span className="sa-pill ativo">Liberado</span> : <span className="sa-pill cancelado">Bloqueado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className={`sa-barra-salvar${mudancas ? " ativa" : ""}`} role="region" aria-label="Salvar alterações">
        <span>{mudancas ? `${mudancas} alteração(ões) não salva(s)` : "Nenhuma alteração pendente"}</span>
        <button type="button" onClick={() => setR(inicial)} disabled={!mudancas || salvando}>Descartar</button>
        <button type="button" className="principal" onClick={salvar} disabled={!mudancas || salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</button>
      </div>
    </div>
  );
}

const mudouLimite = (a?: Limite, b?: Limite) =>
  !!a && !!b && (a.modo !== b.modo || (a.modo === "empresa" && a.valor.trim() !== b.valor.trim()));
const mudouLinha = (r: Rascunho, i: Rascunho, k: string) => r.acesso[k] !== i.acesso[k] || mudouLimite(r.limite[k], i.limite[k]);

function CampoAcesso({ doPlano, valor, onChange, rotulo }: { doPlano: boolean; valor: Acesso; onChange: (v: Acesso) => void; rotulo: string }) {
  return (
    <select value={valor} onChange={(x) => onChange(x.target.value as Acesso)} aria-label={`Acesso a ${rotulo}`}>
      <option value="plano">Como no plano ({doPlano ? "liberado" : "bloqueado"})</option>
      <option value="liberar">Liberar só para esta empresa</option>
      <option value="bloquear">Bloquear só para esta empresa</option>
    </select>
  );
}

function CampoLimite({ rotulo, doPlano, valor, onChange, compacto }: {
  rotulo: string; doPlano: number | null; valor: Limite; onChange: (v: Limite) => void; compacto?: boolean;
}) {
  const select = (
    <select value={valor.modo} aria-label={rotulo} onChange={(x) => {
      const modo = x.target.value as Limite["modo"];
      // passar a definir começa do número do plano, para só ajustar
      onChange({ modo, valor: modo === "empresa" && valor.valor === "" && doPlano !== null ? String(doPlano) : valor.valor });
    }}>
      <option value="plano">Como no plano ({fmtLim(doPlano)})</option>
      <option value="empresa">Definir para esta empresa</option>
    </select>
  );
  const numeroCampo = valor.modo === "empresa" && (
    <input type="number" min={0} placeholder="sem limite" value={valor.valor} aria-label={`${rotulo}: quantidade`}
      onChange={(x) => onChange({ ...valor, valor: x.target.value })} />
  );
  if (compacto) return <div className="sa-limite-linha">{select}{numeroCampo}{valor.modo === "empresa" && <span className="sub">por mês</span>}</div>;
  return (
    <>
      <label>{rotulo}{select}</label>
      {valor.modo === "empresa" && <label>Quantidade por mês (vazio = sem limite){numeroCampo}</label>}
    </>
  );
}
