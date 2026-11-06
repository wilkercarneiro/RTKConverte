// Configurações → Autocadastro (migração 0040): o link de cadastro com pagamento.
//   - abrir ou fechar; os períodos à venda e o desconto de cada um; as parcelas
//     sem juros, o máximo e os juros acima disso; o WhatsApp que recebe "novo
//     cadastro";
//   - a taxa de adesão (0044): o valor (0 = sem adesão) e a explicação que a
//     pessoa lê no cadastro; vai somada só ao 1º pagamento;
//   - o link de cadastro (geral e um por plano) para copiar, abrir ou mandar.
// Quem confere e grava é a função `cobranca` (autocadastro_salvar); a conta das
// parcelas é a mesma da tela de pagamento (_shared/parcelas.ts).
import { useState } from "react";
import { salvarAutocadastro } from "../../lib/cobranca";
import type { Autocadastro as Regras, StatusPagamentos } from "../../lib/cobranca";
import {
  CICLOS, LIMITE_TEXTO_ADESAO, maxParcelas, NOME_CICLO, normalizarRegras, parcelamento, problemaDasRegras, TEXTO_ADESAO_PADRAO,
  totalComAdesao, valorDoPeriodo,
} from "../../../supabase/functions/_shared/parcelas.ts";
import type { Ciclo } from "../../../supabase/functions/_shared/parcelas.ts";
import { formatarTelefone, soDigitos } from "../../../supabase/functions/_shared/cnpj.ts";
import { fmtReais } from "../../../supabase/functions/_shared/precos.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { Dica, Rotulo } from "../ui";
import { copiar } from "./comum";

type Msg = { tipo: "ok" | "erro"; texto: string } | null;
const num = (v: number) => String(v).replace(".", ",");

export function Autocadastro({ st, d, onSalvo }: { st: StatusPagamentos; d: DadosAdmin | null; onSalvo: (a: Regras) => void }) {
  // normalizado: um servidor de antes da 0044 não manda a adesão (vale o padrão)
  const atual = {
    ...normalizarRegras(st.autocadastro ?? {}),
    whatsapp_avisos: st.autocadastro?.whatsapp_avisos ?? null, parcelado_value: !!st.autocadastro?.parcelado_value,
  };
  const [aberto, setAberto] = useState(atual.cadastro_aberto);
  const [semJuros, setSemJuros] = useState(String(atual.parcelas_sem_juros));
  const [max, setMax] = useState(String(atual.parcelas_max));
  const [juros, setJuros] = useState(num(atual.juros_mes));
  const [ciclos, setCiclos] = useState(() => Object.fromEntries(CICLOS.map((c) => [c, { ativo: atual.ciclos[c].ativo, desconto: num(atual.ciclos[c].desconto) }])) as Record<Ciclo, { ativo: boolean; desconto: string }>);
  const [avisos, setAvisos] = useState(atual.whatsapp_avisos ? formatarTelefone(atual.whatsapp_avisos) : "");
  const [comValue, setComValue] = useState(!!atual.parcelado_value);
  const [adesao, setAdesao] = useState(num(atual.adesao));
  const [adesaoTexto, setAdesaoTexto] = useState(atual.adesao_texto);
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const pedido = {
    cadastro_aberto: aberto, parcelas_sem_juros: semJuros, parcelas_max: max, juros_mes: juros, ciclos,
    // "1.500,00" e "500,5" (vírgula = decimal) ou "500.50"; vazio = sem adesão
    adesao: adesao.trim() === "" ? "0" : adesao.includes(",") ? adesao.trim().replace(/\./g, "").replace(",", ".") : adesao.trim(),
    adesao_texto: adesaoTexto,
  };
  const problema = problemaDasRegras(pedido) ?? (soDigitos(avisos) && soDigitos(avisos).length < 10 ? "WhatsApp dos avisos: DDD + número." : null);
  const regras = normalizarRegras(pedido);
  const ciclo = (c: Ciclo, campo: "ativo" | "desconto", v: boolean | string) => setCiclos((x) => ({ ...x, [c]: { ...x[c], [campo]: v } }));

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (problema) { setMsg({ tipo: "erro", texto: problema }); return; }
    setOcupado(true); setMsg(null);
    try {
      const r = await salvarAutocadastro({ ...regras, whatsapp_avisos: soDigitos(avisos), parcelado_value: comValue });
      onSalvo(r.autocadastro);
      setMsg({ tipo: "ok", texto: r.autocadastro.cadastro_aberto ? "Salvo. O link de cadastro está aberto." : "Salvo. O link de cadastro está fechado." });
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  const base = `${location.origin}/cadastro/`;
  const planos = (d?.planos ?? []).filter((p) => p.ativo && p.vende_no_site && Number(p.preco_mensal ?? 0) > 0);
  // um exemplo com o 1º plano: o que a pessoa vê no maior parcelamento do anual
  const exemplo = planos[0] && regras.ciclos.YEARLY.ativo ? (() => {
    const periodo = valorDoPeriodo(Number(planos[0].preco_mensal), "YEARLY", regras.ciclos.YEARLY.desconto);
    const total = totalComAdesao(periodo, regras.adesao);
    const p = parcelamento(total, maxParcelas(regras, "YEARLY"), regras);
    const conta = regras.adesao > 0 ? `${fmtReais(periodo)} + adesão ${fmtReais(regras.adesao)} = ${fmtReais(total)}` : fmtReais(total);
    return `${planos[0].nome}, anual (${conta}): ${p.n}x de ${fmtReais(p.parcela)}${p.juros ? ` = ${fmtReais(p.total)} com juros` : " sem juros"}`;
  })() : null;

  async function copiarLink(chave: string, link: string) {
    if (await copiar(link)) { setCopiado(chave); setTimeout(() => setCopiado(null), 2500); }
  }

  return (
    <form className="sa-card" onSubmit={salvar}>
      <header>
        <h3>Autocadastro (link de cadastro)<Dica>
          A pessoa abre o link, preenche os dados, escolhe o plano e o período e paga por Pix ou cartão (parcelado).
          Pagou, a conta é liberada sozinha. Só aparecem os planos marcados “Vende no autocadastro” em Planos.
        </Dica></h3>
        <span className={`sa-pill ${atual.cadastro_aberto && st.asaas.configurado ? "ativo" : "neutro"}`} style={{ marginLeft: "auto" }}>
          {!st.asaas.configurado ? "Fechado (sem Asaas)" : atual.cadastro_aberto ? "Aberto" : "Fechado"}
        </span>
      </header>
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}
      {!st.asaas.configurado && <div className="sa-aviso info">Ligue os pagamentos (Asaas) acima: sem eles o link de cadastro fica fechado, mesmo marcado como aberto.</div>}
      <div className="sa-campos" style={{ marginTop: 12 }}>
        <label>Cadastro pelo site
          <select value={aberto ? "1" : "0"} onChange={(e) => setAberto(e.target.value === "1")}>
            <option value="1">Aberto</option><option value="0">Fechado</option>
          </select>
        </label>
        <label><Rotulo dica="recebe “novo cadastro pelo site” e os avisos de estorno de parcela; vazio = ninguém">WhatsApp dos avisos</Rotulo>
          <input inputMode="tel" placeholder="(71) 99999-0000" value={avisos} onChange={(e) => setAvisos(formatarTelefone(e.target.value))} />
        </label>
        {CICLOS.map((c) => (
          <label key={c}><Rotulo dica={c === "MONTHLY" ? "à vista: Pix ou cartão 1x" : `cartão em até ${maxParcelas(regras, c)}x`}>{NOME_CICLO[c]}</Rotulo>
            <select value={ciclos[c].ativo ? "1" : "0"} onChange={(e) => ciclo(c, "ativo", e.target.value === "1")}>
              <option value="1">À venda</option><option value="0">Fora do site</option>
            </select>
          </label>
        ))}
        {(["SEMIANNUALLY", "YEARLY"] as Ciclo[]).map((c) => (
          <label key={`d-${c}`}><Rotulo dica="sobre mensalidade × meses; 0 = sem desconto">Desconto no {NOME_CICLO[c].toLowerCase()} (%)</Rotulo>
            <input inputMode="decimal" value={ciclos[c].desconto} disabled={!ciclos[c].ativo} onChange={(e) => ciclo(c, "desconto", e.target.value)} />
          </label>
        ))}
        <label><Rotulo dica="o Asaas divide o total, sem acréscimo">Parcelas sem juros</Rotulo>
          <input type="number" min={1} max={12} value={semJuros} onChange={(e) => setSemJuros(e.target.value)} />
        </label>
        <label><Rotulo dica="nunca passa dos meses do período: semestral até 6x, anual até 12x">Máximo de parcelas</Rotulo>
          <input type="number" min={1} max={12} value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label><Rotulo dica="Tabela Price, só acima das parcelas sem juros; a pessoa vê o total antes de pagar">Juros ao mês (%)</Rotulo>
          <input inputMode="decimal" value={juros} onChange={(e) => setJuros(e.target.value)} />
        </label>
      </div>
      {exemplo && !problema && <p className="sub" style={{ margin: "10px 0 0" }}>Exemplo: {exemplo}.</p>}

      <h4 style={{ margin: "18px 0 8px", fontSize: 14 }}>Taxa de adesão<Dica>
        Cobrada uma vez só, somada ao primeiro pagamento de quem se cadastra pelo link (Pix, cartão à vista ou parcelada junto com o período).
        As renovações cobram só o plano. Empresas criadas aqui no painel não pagam adesão. Mudar o valor vale para os próximos pagamentos;
        um Pix já gerado com o valor antigo é trocado quando a pessoa gera de novo.
      </Dica></h4>
      <div className="sa-campos">
        <label><Rotulo dica="em reais; 0 = sem adesão">Valor da adesão (R$)</Rotulo>
          <input inputMode="decimal" value={adesao} onChange={(e) => setAdesao(e.target.value)} placeholder="500,00" />
        </label>
        <label style={{ gridColumn: "span 2" }}><Rotulo dica={`aparece no cadastro e na tela de pagamento, com o valor; até ${LIMITE_TEXTO_ADESAO} caracteres; vazio = o texto padrão`}>O que é a adesão (texto para o cliente)</Rotulo>
          <textarea rows={3} maxLength={LIMITE_TEXTO_ADESAO} value={adesaoTexto} placeholder={TEXTO_ADESAO_PADRAO}
            onChange={(e) => setAdesaoTexto(e.target.value)} />
        </label>
      </div>
      {regras.adesao > 0
        ? <p className="sub" style={{ margin: "8px 0 0" }}>O cliente vê: “Taxa de adesão (pagamento único): {fmtReais(regras.adesao)}. {regras.adesao_texto}”</p>
        : <p className="sub" style={{ margin: "8px 0 0" }}>Sem adesão: o primeiro pagamento é só o plano.</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <div className="sa-fatura">
          <span>Link de cadastro</span>
          <a href={base} target="_blank" rel="noreferrer">{base}</a>
          <button type="button" onClick={() => copiarLink("geral", base)}>{copiado === "geral" ? "Copiado ✓" : "Copiar"}</button>
        </div>
        {planos.map((p) => {
          const link = `${base}?plano=${p.id}`;
          const texto = `Assine o Vertces no plano ${p.nome}: ${link}`;
          return (
            <div key={p.id} className="sa-fatura">
              <span>{p.nome}</span>
              <a href={link} target="_blank" rel="noreferrer">{link}</a>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => copiarLink(p.id, link)}>{copiado === p.id ? "Copiado ✓" : "Copiar"}</button>
                <button type="button" onClick={() => window.open(link, "_blank", "noopener")}>Abrir</button>
                <button type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener")}>WhatsApp</button>
              </span>
            </div>
          );
        })}
        {!planos.length && <p className="sub" style={{ margin: 0 }}>Nenhum plano à venda no site: marque “Vende no autocadastro” em Planos.</p>}
        <p className="sub" style={{ margin: 0 }}>Para já abrir no período: acrescente <code>&amp;ciclo=anual</code> (ou <code>semestral</code>, <code>mensal</code>) ao link do plano.</p>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="sub">Avançado</summary>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 13.5 }}>
          <input type="checkbox" checked={comValue} onChange={(e) => setComValue(e.target.checked)} style={{ width: "auto", height: "auto", marginTop: 3 }} />
          <span>Mandar o campo <code>value</code> (o valor da parcela) na compra parcelada no cartão.
            <Dica>A documentação do Asaas marca o campo como obrigatório, mas os exemplos de parcelamento não o mandam. O sistema tenta sem ele e, se a conta recusar por isso, repete uma vez com ele e liga esta opção sozinho.</Dica></span>
        </label>
      </details>

      <div className="sa-rodape-form">
        <button type="submit" className="principal" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar o autocadastro"}</button>
      </div>
    </form>
  );
}
