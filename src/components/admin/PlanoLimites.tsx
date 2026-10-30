// Aba "Plano e créditos" da empresa: O QUE ela usa, QUANTO e POR QUANTO, numa
// tela só.
//
// Cada linha diz o que o plano dá, o que foi combinado só com esta empresa e o
// que VALE AGORA (sem ter de deduzir). Nada grava ao clicar: as mudanças ficam
// num rascunho e vão juntas em "Salvar alterações".
//
// Por baixo: plano e mensalidade (escritorios), créditos por mês de cada
// carteira (escritorio_creditos), preço do crédito extra por faixa
// (precos_credito) e exceção de recurso (escritorio_recursos). Mensalidade nova
// numa empresa com assinatura no Asaas vai junto para lá (cobranca).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  atualizarEmpresa, creditosDosPlanos, definirCreditosEmpresa, definirRecursoEmpresa, matrizPlanos, precosDosPlanos, recursosDaEmpresa, salvarPrecos,
} from "../../lib/admin";
import type { CreditosEmpresa, Empresa, RecursoEmpresa } from "../../lib/admin";
import { atualizarAssinatura } from "../../lib/cobranca";
import { diaMes, fmtPreco } from "../../lib/creditos";
import type { Faixa } from "../../lib/creditos";
import { recursoDe } from "../../lib/recursos";
import { faixasEmTexto } from "../../../supabase/functions/_shared/precos.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { Dica } from "../ui";
import { Carregando } from "./comum";
import { EditorFaixas, faixasParaTexto, mesmasFaixas, problemaDoTexto, reais, textoParaFaixas } from "./Faixas";
import type { FaixaTexto } from "./Faixas";

type Acesso = "plano" | "liberar" | "bloquear";
type Modo = "plano" | "empresa";
interface Rascunho {
  plano: string;
  mensal: { modo: Modo; valor: string };
  porMes: Record<string, { modo: Modo; valor: string }>;
  precos: Record<string, { modo: Modo; faixas: FaixaTexto[] }>;
  acesso: Record<string, Acesso>;
}

const fmtMes = (n: number | null) => (n === null ? "sem limite" : `${n} por mês`);
const numero = (v: string): number | null => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));
const ASSINATURA_VIVA = new Set(["aguardando", "em_dia", "atrasada"]);

export function PlanoLimites({ e, d, cred, onSalvo }: {
  e: Empresa; d: DadosAdmin; cred: CreditosEmpresa | null; onSalvo: (texto: string) => Promise<void>;
}) {
  const [recursos, setRecursos] = useState<RecursoEmpresa[] | null>(null);
  const [matriz, setMatriz] = useState<{ plano_id: string; recurso_chave: string; liberado: boolean }[]>([]);
  const [porMesPlanos, setPorMesPlanos] = useState<Record<string, Record<string, number | null>>>({});
  const [precosPlanos, setPrecosPlanos] = useState<Record<string, Record<string, Faixa[]>>>({});
  const [inicial, setInicial] = useState<Rascunho | null>(null);
  const [r, setR] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [rec, mat, pm, pr] = await Promise.all([recursosDaEmpresa(e.id), matrizPlanos(), creditosDosPlanos(), precosDosPlanos()]);
    setRecursos(rec);
    setMatriz(mat);
    setPorMesPlanos(pm);
    setPrecosPlanos(pr);
  }, [e.id]);
  useEffect(() => { carregar().catch((x) => setErro(String(x.message ?? x))); }, [carregar]);

  // rascunho nasce do que está gravado
  useEffect(() => {
    if (!recursos || !cred) return;
    const acesso: Record<string, Acesso> = {};
    for (const l of recursos) acesso[l.chave] = l.excecao === null ? "plano" : l.excecao ? "liberar" : "bloquear";
    const em = cred.empresa;
    const base: Rascunho = {
      plano: e.plano_id ?? "",
      mensal: em.mensalidade === null ? { modo: "plano", valor: "" } : { modo: "empresa", valor: Number(em.mensalidade).toFixed(2).replace(".", ",") },
      porMes: Object.fromEntries(d.tipos.map((t) => [t.chave, t.chave in em.por_mes
        ? { modo: "empresa" as Modo, valor: em.por_mes[t.chave] === null ? "" : String(em.por_mes[t.chave]) }
        : { modo: "plano" as Modo, valor: "" }])),
      precos: Object.fromEntries(d.tipos.map((t) => [t.chave, t.chave in em.precos
        ? { modo: "empresa" as Modo, faixas: faixasParaTexto(em.precos[t.chave]) }
        : { modo: "plano" as Modo, faixas: [] }])),
      acesso,
    };
    setInicial(base);
    setR(base);
  }, [recursos, cred, e.plano_id, d.tipos]);

  const porChave = useMemo(() => new Map(d.recursos.map((x) => [x.chave, x])), [d.recursos]);
  if (!r || !inicial || !recursos || !cred) return erro ? <div className="sa-aviso erro">{erro}</div> : <Carregando />;

  // o que o plano ESCOLHIDO NO RASCUNHO dá (trocar o plano já mostra o efeito)
  const plano = d.planos.find((p) => p.id === r.plano);
  const linhaPlano = (k: string) => matriz.find((m) => m.plano_id === r.plano && m.recurso_chave === k);
  const acessoDoPlano = (k: string) => linhaPlano(k)?.liberado ?? (plano?.libera_recursos_novos === false ? false : porChave.get(k)?.padrao ?? true);
  const acessoVale = (k: string) => (r.acesso[k] === "plano" ? acessoDoPlano(k) : r.acesso[k] === "liberar");
  const mensalDoPlano = plano?.preco_mensal ?? null;
  const mensalVale = r.mensal.modo === "empresa" ? (r.mensal.valor.trim() === "" ? 0 : reais(r.mensal.valor)) : mensalDoPlano;
  // sem plano = sem limite; plano sem a carteira = 0
  const porMesDoPlano = (t: string): number | null => (!plano ? null : t in (porMesPlanos[plano.id] ?? {}) ? porMesPlanos[plano.id][t] : 0);
  const porMesVale = (t: string) => (r.porMes[t]?.modo === "empresa" ? numero(r.porMes[t].valor) : porMesDoPlano(t));
  const precosDoPlano = (t: string): Faixa[] => (plano ? precosPlanos[plano.id]?.[t] ?? [] : []);
  const precosValem = (t: string): Faixa[] => (r.precos[t]?.modo === "empresa" && !problemaDoTexto(r.precos[t].faixas) ? textoParaFaixas(r.precos[t].faixas) : precosDoPlano(t));

  const mudouMensal = r.mensal.modo !== inicial.mensal.modo || (r.mensal.modo === "empresa" && r.mensal.valor.trim() !== inicial.mensal.valor.trim());
  const mudouPorMes = (t: string) => r.porMes[t].modo !== inicial.porMes[t].modo || (r.porMes[t].modo === "empresa" && r.porMes[t].valor.trim() !== inicial.porMes[t].valor.trim());
  const mudouPreco = (t: string) => r.precos[t].modo !== inicial.precos[t].modo || (r.precos[t].modo === "empresa" && !mesmasFaixas(r.precos[t].faixas, inicial.precos[t].faixas));
  const mudancas = [
    r.plano !== inicial.plano ? 1 : 0,
    mudouMensal ? 1 : 0,
    ...d.tipos.map((t) => (mudouPorMes(t.chave) ? 1 : 0) + (mudouPreco(t.chave) ? 1 : 0)),
    ...Object.keys(r.acesso).map((k) => (r.acesso[k] !== inicial.acesso[k] ? 1 : 0)),
  ].reduce((a, b) => a + b, 0);

  const set = (x: Partial<Rascunho>) => setR({ ...r, ...x });

  async function salvar() {
    if (!r || !inicial) return;
    const erroPreco = d.tipos.map((t) => (r.precos[t.chave].modo === "empresa" ? problemaDoTexto(r.precos[t.chave].faixas) : null)).find(Boolean);
    if (erroPreco) { setErro(erroPreco); return; }
    if (r.mensal.modo === "empresa" && r.mensal.valor.trim() !== "" && !(reais(r.mensal.valor) >= 0)) { setErro("Mensalidade inválida."); return; }
    setSalvando(true); setErro(null);
    const mensalAntes = e.mensalidade ?? null;
    try {
      if (r.plano !== inicial.plano || mudouMensal) {
        await atualizarEmpresa(e.id, {
          ...(r.plano !== inicial.plano ? { plano_id: r.plano || null } : {}),
          ...(mudouMensal ? { mensalidade: r.mensal.modo === "plano" ? null : (r.mensal.valor.trim() === "" ? 0 : reais(r.mensal.valor)) } : {}),
        });
      }
      for (const t of d.tipos) {
        const k = t.chave;
        if (mudouPorMes(k)) await definirCreditosEmpresa(e.id, k, r.porMes[k].modo === "empresa" ? numero(r.porMes[k].valor) : null, r.porMes[k].modo === "plano");
        if (mudouPreco(k)) await salvarPrecos({ empresa: e.id }, k, r.precos[k].modo === "empresa" ? textoParaFaixas(r.precos[k].faixas) : null);
      }
      for (const k of Object.keys(r.acesso)) {
        if (r.acesso[k] !== inicial.acesso[k]) await definirRecursoEmpresa(e.id, k, r.acesso[k] === "plano" ? null : r.acesso[k] === "liberar");
      }
      let extra = "";
      // a mensalidade que vale mudou e há assinatura no Asaas: leva o valor novo para lá
      if (mensalVale !== mensalAntes && e.cobranca && ASSINATURA_VIVA.has(e.cobranca) && mensalVale !== null && mensalVale > 0) {
        try { await atualizarAssinatura(e.id); extra = ` A assinatura no Asaas passou para ${fmtPreco(mensalVale)}.`; }
        catch (x) { extra = ` Atenção: a assinatura no Asaas não foi atualizada (${x instanceof Error ? x.message : x}); use “Atualizar valor no Asaas” na aba Cobrança.`; }
      }
      await carregar();
      await onSalvo(`${mudancas} alteração(ões) salva(s). A empresa vê no próximo acesso (ou ao recarregar a página).${extra}`);
    } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
    finally { setSalvando(false); }
  }

  const servicos = recursos.filter((l) => l.chave.startsWith("servico."));
  const outros = recursos.filter((l) => !l.chave.startsWith("servico."));
  const nome = (k: string) => porChave.get(k)?.nome ?? recursoDe(k)?.nome ?? k;

  return (
    <div className="sa-grade">
      {erro && <div className="sa-aviso erro">{erro}</div>}

      <section className="sa-card">
        <header><h3>Plano e mensalidade<Dica>a mensalidade é cobrada pelo Asaas (aba Cobrança). 0 = sem cobrança.</Dica></h3></header>
        <div className="sa-campos">
          <label>Plano
            <select value={r.plano} onChange={(x) => set({ plano: x.target.value })}>
              {d.planos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (fora do cadastro)"}</option>)}
              <option value="">Sem plano</option>
            </select>
          </label>
          <label>Mensalidade
            <select value={r.mensal.modo} aria-label="Mensalidade" onChange={(x) => {
              const modo = x.target.value as Modo;
              set({ mensal: { modo, valor: modo === "empresa" && !r.mensal.valor && mensalDoPlano !== null ? Number(mensalDoPlano).toFixed(2).replace(".", ",") : r.mensal.valor } });
            }}>
              <option value="plano">Como no plano ({mensalDoPlano === null ? "não definida" : fmtPreco(Number(mensalDoPlano))})</option>
              <option value="empresa">Definir para esta empresa</option>
            </select>
          </label>
          {r.mensal.modo === "empresa" && (
            <label>Valor só desta empresa (R$)
              <input inputMode="decimal" placeholder="0 = sem cobrança" value={r.mensal.valor} onChange={(x) => set({ mensal: { ...r.mensal, valor: x.target.value } })} />
            </label>
          )}
        </div>
        <p className="sa-vale">
          <b>Vale agora:</b> {mensalVale === null ? "mensalidade não definida" : mensalVale === 0 ? "sem mensalidade" : `${fmtPreco(mensalVale)} por mês`}
          {r.mensal.modo === "empresa" && <span className="sa-pill neutro">só desta empresa</span>}
        </p>
      </section>

      <section className="sa-card">
        <header><h3>Créditos<Dica>1 crédito = 1 serviço aberto (o arquivo de entrada enviado). Os do mês renovam no dia {cred.periodo.dia} ({diaMes(cred.periodo.renova_em)}); os extras não vencem. O CAR gasta primeiro os de CAR e, acabou, usa um geral se o cliente aceitar.</Dica></h3></header>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela sa-limites">
            <thead><tr><th>Carteira</th><th>Créditos por mês</th><th>Preço do crédito extra</th><th>Usados no mês</th><th>Vale agora</th></tr></thead>
            <tbody>
              {d.tipos.map((t) => {
                const k = t.chave;
                const pm = r.porMes[k];
                const pr = r.precos[k];
                const c = cred.carteiras.find((x) => x.chave === k);
                const vale = porMesVale(k);
                const precos = precosValem(k);
                return (
                  <tr key={k} className={mudouPorMes(k) || mudouPreco(k) ? "mudou" : undefined}>
                    <td><b>{t.nome}</b>{t.descricao && <Dica>{t.descricao}</Dica>}</td>
                    <td data-rotulo="Créditos por mês">
                      <div className="sa-limite-linha">
                        <select value={pm.modo} aria-label={`${t.nome}: créditos por mês`} onChange={(x) => {
                          const modo = x.target.value as Modo;
                          const doPlano = porMesDoPlano(k);
                          set({ porMes: { ...r.porMes, [k]: { modo, valor: modo === "empresa" && pm.valor === "" && doPlano !== null ? String(doPlano) : pm.valor } } });
                        }}>
                          <option value="plano">Como no plano ({fmtMes(porMesDoPlano(k))})</option>
                          <option value="empresa">Definir para esta empresa</option>
                        </select>
                        {pm.modo === "empresa" && (
                          <input type="number" min={0} placeholder="sem limite" value={pm.valor} aria-label={`${t.nome}: quantidade por mês`}
                            onChange={(x) => set({ porMes: { ...r.porMes, [k]: { ...pm, valor: x.target.value } } })} />
                        )}
                      </div>
                    </td>
                    <td data-rotulo="Preço do crédito extra">
                      <select value={pr.modo} aria-label={`${t.nome}: preço do extra`} onChange={(x) => {
                        const modo = x.target.value as Modo;
                        set({ precos: { ...r.precos, [k]: { modo, faixas: modo === "empresa" && !pr.faixas.length ? faixasParaTexto(precosDoPlano(k)) : pr.faixas } } });
                      }}>
                        <option value="plano">Como no plano</option>
                        <option value="empresa">Definir para esta empresa</option>
                      </select>
                      {pr.modo === "empresa"
                        ? <EditorFaixas rotulo={`${t.nome} extras`} valor={pr.faixas} onChange={(v) => set({ precos: { ...r.precos, [k]: { ...pr, faixas: v } } })} />
                        : <small className="sub sa-faixas-texto">{precosDoPlano(k).length ? faixasEmTexto(precosDoPlano(k)).join(" · ") : "não está à venda"}</small>}
                    </td>
                    <td data-rotulo="Usados no mês">{c ? c.usado : 0}{c && c.extra > 0 && <div className="sub" style={{ fontSize: 12 }}>+ {c.extra} extra(s) no saldo</div>}</td>
                    <td>
                      <span className="sa-pill ativo">{vale === null ? "Sem limite" : `${vale}/mês`}</span>
                      <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>{precos.length ? `extra a partir de ${fmtPreco(Math.min(...precos.map((f) => Number(f.preco))))}` : "sem venda de extra"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sa-card">
        <header><h3>Serviços<Dica>se a empresa enxerga o serviço. Bloqueado, ele some do Início e o banco recusa.</Dica></h3></header>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela sa-limites">
            <thead><tr><th>Serviço</th><th>Acesso</th><th>Vale agora</th></tr></thead>
            <tbody>
              {servicos.map((l) => (
                <tr key={l.chave} className={r.acesso[l.chave] !== inicial.acesso[l.chave] ? "mudou" : undefined}>
                  <td><b>{nome(l.chave)}</b></td>
                  <td data-rotulo="Acesso"><CampoAcesso doPlano={acessoDoPlano(l.chave)} valor={r.acesso[l.chave]} onChange={(v) => set({ acesso: { ...r.acesso, [l.chave]: v } })} rotulo={nome(l.chave)} /></td>
                  <td>{acessoVale(l.chave) ? <span className="sa-pill ativo">Liberado</span> : <span className="sa-pill cancelado">Bloqueado</span>}</td>
                </tr>
              ))}
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
                    <td data-rotulo="Acesso"><CampoAcesso doPlano={acessoDoPlano(l.chave)} valor={r.acesso[l.chave]} onChange={(v) => set({ acesso: { ...r.acesso, [l.chave]: v } })} rotulo={nome(l.chave)} /></td>
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

function CampoAcesso({ doPlano, valor, onChange, rotulo }: { doPlano: boolean; valor: Acesso; onChange: (v: Acesso) => void; rotulo: string }) {
  return (
    <select value={valor} onChange={(x) => onChange(x.target.value as Acesso)} aria-label={`Acesso a ${rotulo}`}>
      <option value="plano">Como no plano ({doPlano ? "liberado" : "bloqueado"})</option>
      <option value="liberar">Liberar só para esta empresa</option>
      <option value="bloquear">Bloquear só para esta empresa</option>
    </select>
  );
}
