// Dados do cliente e do imóvel no loteamento: o que sai no carimbo da planta,
// no memorial do loteamento e nos memoriais/plantas dos lotes (proprietário,
// CPF/CNPJ, denominação, matrícula, município, responsável técnico e TRT).
//
// Os documentos saem do servidor (função `entregar`), que lê o SERVIÇO do
// banco: por isso cada mudança aqui é gravada em `servicos` (com espera de
// 0,8 s) e `salvar()` é aguardado antes de qualquer geração.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UFS, rotuloRT } from "../../lib/domains";
import type { Cliente, RT, Servico } from "../../lib/types";
import { Dica } from "../ui";

/** Campos do serviço que esta seção edita. */
export const CAMPOS_CLIENTE = [
  "cliente_id", "detentor_nome", "detentor_cpf", "denominacao", "matricula", "municipio", "uf", "rt_id", "credenciado_id", "trt",
] as const;
type Campo = (typeof CAMPOS_CLIENTE)[number];
type Dados = Pick<Servico, Campo>;

export interface DadosClienteRef {
  /** grava o que ainda está esperando; resolve quando o banco confirmou */
  salvar: () => Promise<void>;
}

interface Credenciado { id: string; nome: string; prefixo_vertice: string }

interface Props {
  servico: Servico;
  onMudar: (patch: Partial<Servico>) => void;
}

const dadosDe = (s: Servico): Dados => Object.fromEntries(CAMPOS_CLIENTE.map((c) => [c, s[c] ?? null])) as Dados;

export const DadosCliente = forwardRef<DadosClienteRef, Props>(function DadosCliente({ servico, onMudar }, ref) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [rts, setRts] = useState<RT[]>([]);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [estado, setEstado] = useState<"salvo" | "salvando" | "pendente" | "erro">("salvo");
  const [erro, setErro] = useState<string | null>(null);
  const pendente = useRef<Partial<Dados>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emCurso = useRef<Promise<void> | null>(null);

  useEffect(() => {
    supabase.from("clientes").select().order("nome").then(({ data }) => setClientes((data as Cliente[]) ?? []));
    supabase.from("responsaveis_tecnicos").select().then(({ data }) => setRts((data as RT[]) ?? []));
    supabase.from("credenciados").select("id, nome, prefixo_vertice").then(({ data }) => setCredenciados((data as Credenciado[]) ?? []));
  }, []);

  async function gravar(): Promise<void> {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (emCurso.current) await emCurso.current;
    const patch = pendente.current;
    if (!Object.keys(patch).length) return;
    pendente.current = {};
    setEstado("salvando");
    const p = (async () => {
      const { error } = await supabase.from("servicos").update(patch).eq("id", servico.id);
      if (error) {
        // volta para a fila: a próxima mudança (ou a geração) tenta de novo
        pendente.current = { ...patch, ...pendente.current };
        setEstado("erro");
        setErro(error.message);
        throw new Error(`Os dados do cliente não foram salvos: ${error.message}`);
      }
      setErro(null);
      setEstado(Object.keys(pendente.current).length ? "pendente" : "salvo");
    })();
    emCurso.current = p.finally(() => { emCurso.current = null; }).catch(() => undefined);
    return p;
  }

  useImperativeHandle(ref, () => ({ salvar: gravar }));
  // ao sair da tela, o que estava esperando é gravado
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void gravar().catch(() => undefined); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function mudar(patch: Partial<Dados>) {
    onMudar(patch);
    pendente.current = { ...pendente.current, ...patch };
    setEstado("pendente");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void gravar().catch(() => undefined); }, 800);
  }

  const d = dadosDe(servico);
  const txt = (c: Campo) => (e: React.ChangeEvent<HTMLInputElement>) => mudar({ [c]: e.target.value || null } as Partial<Dados>);
  const faltam = [!d.detentor_nome && "proprietário", !d.detentor_cpf && "CPF/CNPJ", !d.municipio && "município"].filter(Boolean) as string[];

  return (
    <section className="bloco lot-dados-cliente">
      <header>
        <h3>Cliente e imóvel<Dica>Sai no carimbo da planta, no memorial do loteamento e nos memoriais e plantas de cada lote. Fica gravado no serviço.</Dica></h3>
        <span className={`desc lot-dados-estado ${estado}`}>
          {estado === "salvo" ? "salvo" : estado === "salvando" ? "salvando…" : estado === "pendente" ? "alterado" : "não salvo"}
        </span>
      </header>
      {faltam.length > 0 && <p className="lot-dica">Falta {faltam.join(", ")}: sem isso o campo sai em branco (—) na planta e nos memoriais.</p>}
      {erro && <div className="lot-alerta erro">{erro}</div>}
      <div className="grade">
        <label><span>Cliente<Dica>Escolher o cliente cadastrado preenche o proprietário e o CPF/CNPJ.</Dica></span>
          <select value={d.cliente_id ?? ""} onChange={(e) => {
            const cli = clientes.find((c) => c.id === e.target.value) ?? null;
            mudar({ cliente_id: cli?.id ?? null, ...(cli ? { detentor_nome: cli.nome, detentor_cpf: cli.cpf_cnpj } : {}) });
          }}>
            <option value="">— (digitar abaixo)</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label>Proprietário
          <input value={d.detentor_nome ?? ""} onChange={txt("detentor_nome")} placeholder="Nome completo ou razão social" />
        </label>
        <label>CPF/CNPJ
          <input className="mono" value={d.detentor_cpf ?? ""} onChange={txt("detentor_cpf")} placeholder="000.000.000-00" />
        </label>
        <label>Denominação do imóvel
          <input value={d.denominacao ?? ""} onChange={txt("denominacao")} placeholder="Fazenda, sítio, gleba…" />
        </label>
        <label>Matrícula
          <input className="mono" value={d.matricula ?? ""} onChange={txt("matricula")} />
        </label>
        <label>Município
          <input value={d.municipio ?? ""} onChange={txt("municipio")} />
        </label>
        <label>UF
          <select value={d.uf ?? ""} onChange={(e) => mudar({ uf: e.target.value || null })}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label>Responsável técnico
          <select value={d.rt_id ?? ""} onChange={(e) => mudar({ rt_id: e.target.value || null })}>
            <option value="">—</option>
            {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
          </select>
        </label>
        <label>Credenciado
          <select value={d.credenciado_id ?? ""} onChange={(e) => mudar({ credenciado_id: e.target.value || null })}>
            <option value="">—</option>
            {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
          </select>
        </label>
        <label>ART/TRT
          <input className="mono" value={d.trt ?? ""} onChange={txt("trt")} />
        </label>
      </div>
    </section>
  );
});
