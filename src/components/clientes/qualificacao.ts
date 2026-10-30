// Cadastro do cliente: máscaras, validação leve, completude e a qualificação
// como ela sai nos documentos (memorial, requerimento, cartas).
//
// O cliente vira o DETENTOR dos serviços dele — por isso a qualificação
// completa importa: o que falta aqui sai em branco no documento.
import type { Cliente } from "../../lib/types";
import { cnpjValido, formatarCnpj, formatarTelefone, soDigitos } from "../../../supabase/functions/_shared/cnpj.ts";

export { emailValido, formatarTelefone, soDigitos } from "../../../supabase/functions/_shared/cnpj.ts";

export type TipoPessoa = "PF" | "PJ";

/** Tipo gravado; sem ele (clientes antigos), deduz pelo documento. */
export function tipoDe(c: Pick<Cliente, "tipo_pessoa" | "cpf_cnpj">): TipoPessoa {
  if (c.tipo_pessoa === "PF" || c.tipo_pessoa === "PJ") return c.tipo_pessoa;
  return soDigitos(c.cpf_cnpj ?? "").length === 14 ? "PJ" : "PF";
}

/** 12345678909 → 123.456.789-09 (parcial enquanto digita). */
export function formatarCpf(entrada: string): string {
  const c = soDigitos(entrada).slice(0, 11);
  return c
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function cpfValido(entrada: string): boolean {
  const c = soDigitos(entrada);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** Máscara do documento pelo tipo (PF = CPF, PJ = CNPJ). */
export const formatarDoc = (v: string, tipo: TipoPessoa): string =>
  tipo === "PJ" ? formatarCnpj(v) : formatarCpf(v);

/** null = vazio (não é erro); false = preenchido e inválido. */
export function docValido(v: string | null | undefined, tipo: TipoPessoa): boolean | null {
  const d = soDigitos(v ?? "");
  if (!d) return null;
  return tipo === "PJ" ? cnpjValido(d) : cpfValido(d);
}

/** Para o aviso do campo: incompleto (faltam dígitos) é diferente de dígito errado. */
export function docEstado(v: string | null | undefined, tipo: TipoPessoa): "vazio" | "incompleto" | "invalido" | "ok" {
  const d = soDigitos(v ?? "");
  if (!d) return "vazio";
  if (d.length < (tipo === "PJ" ? 14 : 11)) return "incompleto";
  return docValido(d, tipo) ? "ok" : "invalido";
}

/** Texto do aviso do campo de documento (null = nada a avisar). `digitando` cala o "incompleto". */
export function avisoDoc(v: string | null | undefined, tipo: TipoPessoa, digitando: boolean): string | null {
  const e = docEstado(v, tipo);
  const nome = tipo === "PJ" ? "CNPJ" : "CPF";
  if (e === "invalido") return `${nome} com dígito verificador errado`;
  if (e === "incompleto" && !digitando) return `${nome} incompleto`;
  return null;
}

export function formatarCep(v: string): string {
  const c = soDigitos(v).slice(0, 8);
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

/** Link do WhatsApp (wa.me) para um telefone brasileiro; null sem número válido. */
export function linkWhatsApp(tel: string | null | undefined): string | null {
  const t = soDigitos(tel ?? "").replace(/^55(?=\d{10,11}$)/, "");
  return t.length === 10 || t.length === 11 ? `https://wa.me/55${t}` : null;
}

export const telefoneFmt = (t: string | null | undefined): string => (t ? formatarTelefone(t) || t : "");

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
  "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

// Estado civil e regime: grava a CHAVE; o texto sai no gênero de quem é.
export const ESTADOS_CIVIS: { chave: string; m: string; f: string }[] = [
  { chave: "solteiro", m: "solteiro", f: "solteira" },
  { chave: "casado", m: "casado", f: "casada" },
  { chave: "uniao_estavel", m: "em união estável", f: "em união estável" },
  { chave: "divorciado", m: "divorciado", f: "divorciada" },
  { chave: "separado", m: "separado judicialmente", f: "separada judicialmente" },
  { chave: "viuvo", m: "viúvo", f: "viúva" },
];
export const ROTULO_ESTADO_CIVIL: Record<string, string> = {
  solteiro: "Solteiro(a)", casado: "Casado(a)", uniao_estavel: "União estável",
  divorciado: "Divorciado(a)", separado: "Separado(a) judicialmente", viuvo: "Viúvo(a)",
};
export const REGIMES: { chave: string; texto: string; rotulo: string }[] = [
  { chave: "comunhao_parcial", texto: "comunhão parcial de bens", rotulo: "Comunhão parcial" },
  { chave: "comunhao_universal", texto: "comunhão universal de bens", rotulo: "Comunhão universal" },
  { chave: "separacao_total", texto: "separação total de bens", rotulo: "Separação total (convencional)" },
  { chave: "separacao_obrigatoria", texto: "separação obrigatória de bens", rotulo: "Separação obrigatória" },
  { chave: "participacao_final", texto: "participação final nos aquestos", rotulo: "Participação final nos aquestos" },
];
export const ORIGENS: { chave: string; rotulo: string }[] = [
  { chave: "indicacao", rotulo: "Indicação" },
  { chave: "gprol", rotulo: "GPROL" },
  { chave: "site", rotulo: "Site" },
  { chave: "redes", rotulo: "Redes sociais" },
  { chave: "parceiro", rotulo: "Cartório ou parceiro" },
  { chave: "retorno", rotulo: "Cliente antigo" },
  { chave: "outro", rotulo: "Outro" },
];

/** Casado ou em união estável: pede regime e cônjuge. */
export const temConjuge = (c: Pick<Cliente, "estado_civil">): boolean =>
  c.estado_civil === "casado" || c.estado_civil === "uniao_estavel";

const vazio = (v: unknown) => v == null || String(v).trim() === "";

/** Campo que falta para os documentos saírem completos (com o id do campo no formulário). */
export interface Falta { campo: string; rotulo: string }

/**
 * O que falta no cadastro para o memorial/requerimento/cartas saírem sem
 * lacuna. Telefone e e-mail não entram: não vão para os documentos.
 */
export function completude(c: Cliente): { pct: number; faltam: Falta[]; total: number } {
  const itens: [boolean, Falta][] = [];
  const add = (ok: boolean, campo: string, rotulo: string) => itens.push([ok, { campo, rotulo }]);
  const tipo = tipoDe(c);
  if (tipo === "PJ") {
    add(docValido(c.cpf_cnpj, "PJ") === true, "cpf_cnpj", "CNPJ");
    add(!vazio(c.endereco), "endereco", "endereço da sede");
    add(!vazio(c.cidade) && !vazio(c.uf), "cidade", "cidade e UF");
    add(!vazio(c.representante_nome), "representante_nome", "representante legal");
    add(docValido(c.representante_cpf, "PF") === true, "representante_cpf", "CPF do representante");
  } else {
    add(docValido(c.cpf_cnpj, "PF") === true, "cpf_cnpj", "CPF");
    add(!vazio(c.rg), "rg", "RG");
    add(!vazio(c.rg_orgao), "rg_orgao", "órgão emissor do RG");
    add(!vazio(c.estado_civil), "estado_civil", "estado civil");
    add(!vazio(c.profissao), "profissao", "profissão");
    add(!vazio(c.endereco), "endereco", "endereço");
    add(!vazio(c.cidade) && !vazio(c.uf), "cidade", "cidade e UF");
    if (temConjuge(c)) {
      add(!vazio(c.conjuge_nome), "conjuge_nome", "nome do cônjuge");
      add(docValido(c.conjuge_cpf, "PF") === true, "conjuge_cpf", "CPF do cônjuge");
      if (c.estado_civil === "casado") add(!vazio(c.regime_bens), "regime_bens", "regime de bens");
    }
  }
  if (c.is_espolio) {
    add(!vazio(c.inventariante_nome), "inventariante_nome", "inventariante");
    add(docValido(c.inventariante_cpf, "PF") === true, "inventariante_cpf", "CPF do inventariante");
  }
  const feitos = itens.filter(([ok]) => ok).length;
  return { pct: itens.length ? Math.round((feitos / itens.length) * 100) : 100, faltam: itens.filter(([ok]) => !ok).map(([, f]) => f), total: itens.length };
}

/** Trecho da qualificação; `falta` = lacuna (aparece marcada na prévia, sai fora da cópia). */
export interface Trecho { t: string; falta?: boolean }

function enderecoCompleto(c: Cliente): string {
  const cidade = [c.cidade?.trim(), c.uf?.trim()].filter(Boolean).join("-");
  const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  const end = c.endereco?.trim() ?? "";
  // endereço digitado já TERMINANDO na cidade ("…, Irecê-BA"): não repete.
  // "Fazenda Santa Bárbara, zona rural" em Santa Bárbara não termina nela.
  const cid = sem(c.cidade ?? "");
  const repete = !!cid && new RegExp(`${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*[-/,]\\s*[A-Z]{2})?\\.?$`).test(sem(end));
  return [end, repete ? "" : cidade, c.cep ? `CEP ${formatarCep(c.cep)}` : ""].filter(Boolean).join(", ");
}

/**
 * A qualificação do detentor como sai no memorial e no requerimento:
 * "JOSÉ DA SILVA, brasileiro, casado sob o regime de comunhão parcial de bens
 * com MARIA DA SILVA, agricultor, portador do RG nº … SSP/BA, inscrito no CPF
 * sob o nº …, residente e domiciliado em …". No gênero de quem é.
 */
export function qualificacao(c: Cliente): Trecho[] {
  const tipo = tipoDe(c);
  const out: Trecho[] = [];
  const txt = (t: string) => out.push({ t });
  const lacuna = (t: string) => out.push({ t, falta: true });
  const nome = (c.nome || "").trim().toUpperCase();

  if (tipo === "PJ") {
    txt(`${nome || "RAZÃO SOCIAL"}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº `);
    if (docValido(c.cpf_cnpj, "PJ") !== null) txt(formatarCnpj(c.cpf_cnpj!)); else lacuna("CNPJ");
    txt(", com sede em ");
    const end = enderecoCompleto(c);
    if (end) txt(end); else lacuna("endereço da sede");
    txt(", neste ato representada por ");
    if (c.representante_nome?.trim()) txt(c.representante_nome.trim().toUpperCase()); else lacuna("representante legal");
    txt(", inscrito no CPF sob o nº ");
    if (c.representante_cpf?.trim()) txt(formatarCpf(c.representante_cpf)); else lacuna("CPF do representante");
    txt(".");
    return out;
  }

  const f = c.genero === "F";
  const o = f ? "a" : "o";
  if (c.is_espolio) txt("ESPÓLIO DE ");
  txt(nome || "NOME DO CLIENTE");
  const nac = (c.nacionalidade ?? "").trim().toLowerCase();
  txt(`, ${!nac || /^brasileir[oa]$/.test(nac) ? `brasileir${o}` : nac}`);

  const ec = ESTADOS_CIVIS.find((e) => e.chave === c.estado_civil);
  txt(", ");
  if (!ec) lacuna("estado civil");
  else if (c.estado_civil === "casado") {
    txt(f ? ec.f : ec.m);
    const reg = REGIMES.find((r) => r.chave === c.regime_bens);
    txt(" sob o regime de ");
    if (reg) txt(reg.texto); else lacuna("regime de bens");
    txt(" com ");
    if (c.conjuge_nome?.trim()) txt(c.conjuge_nome.trim().toUpperCase()); else lacuna("nome do cônjuge");
    if (c.conjuge_cpf?.trim()) txt(`, inscrit${f ? "o" : "a"} no CPF sob o nº ${formatarCpf(c.conjuge_cpf)}`);
  } else if (c.estado_civil === "uniao_estavel") {
    txt("convivente em união estável com ");
    if (c.conjuge_nome?.trim()) txt(c.conjuge_nome.trim().toUpperCase()); else lacuna("nome do(a) companheiro(a)");
    if (c.conjuge_cpf?.trim()) txt(`, inscrit${f ? "o" : "a"} no CPF sob o nº ${formatarCpf(c.conjuge_cpf)}`);
  } else txt(f ? ec.f : ec.m);

  txt(", ");
  if (c.profissao?.trim()) txt(c.profissao.trim().toLowerCase()); else lacuna("profissão");

  txt(`, portador${f ? "a" : ""} do RG nº `);
  if (c.rg?.trim()) txt(c.rg.trim()); else lacuna("RG");
  if (c.rg_orgao?.trim()) txt(` ${c.rg_orgao.trim().toUpperCase()}`); else { txt(" "); lacuna("órgão emissor"); }

  txt(`, inscrit${o} no CPF sob o nº `);
  if (c.cpf_cnpj?.trim()) txt(formatarCpf(c.cpf_cnpj)); else lacuna("CPF");

  txt(`, residente e domiciliad${o} em `);
  const end = enderecoCompleto(c);
  if (end) txt(end); else lacuna("endereço");

  if (c.is_espolio) {
    txt(", neste ato representado pelo inventariante ");
    if (c.inventariante_nome?.trim()) txt(c.inventariante_nome.trim().toUpperCase()); else lacuna("inventariante");
    if (c.inventariante_cpf?.trim()) txt(`, CPF nº ${formatarCpf(c.inventariante_cpf)}`);
    if (c.inventariante_rg?.trim()) txt(`, RG nº ${c.inventariante_rg.trim()}`);
  }
  txt(".");
  return out;
}

/** Texto para copiar: as lacunas saem como "____". */
export const qualificacaoTexto = (c: Cliente): string =>
  qualificacao(c).map((p) => (p.falta ? "________" : p.t)).join("");

/** Iniciais do primeiro e do último nome. */
export function iniciaisDe(nome: string): string {
  return nome.trim().split(/\s+/).filter((_, i, a) => i === 0 || i === a.length - 1)
    .map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/** Tom do avatar, fixo por nome (seis tons da paleta). */
export function tomAvatar(nome: string): number {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** "hoje", "ontem", "há 5 dias", "há 3 meses". */
export function relativo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso); const hoje = new Date();
  t.setHours(0, 0, 0, 0); hoje.setHours(0, 0, 0, 0);
  const d = Math.round((hoje.getTime() - t.getTime()) / 86_400_000);
  if (d <= 0) return "hoje";
  if (d === 1) return "ontem";
  if (d < 14) return `há ${d} dias`;
  if (d < 60) return `há ${Math.round(d / 7)} semanas`;
  if (d < 365) return `há ${Math.round(d / 30)} meses`;
  const a = Math.round(d / 365);
  return `há ${a} ${a === 1 ? "ano" : "anos"}`;
}

export const dataCurta = (iso?: string | null): string => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

/** "out. 2026" */
export const mesAno = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(" de ", " ") : "—";
