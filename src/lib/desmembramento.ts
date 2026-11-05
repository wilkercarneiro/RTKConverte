// DESMEMBRAMENTO: uma ou mais áreas saem do imóvel, cada uma com a área que a
// pessoa digita e no nome de quem a adquire; o que sobra fica como ÁREA
// REMANESCENTE, com o proprietário.
//
// Por baixo é a mesma divisão da partilha (motor → prancheta → glebas →
// serviço completo de cada parte). Muda só de onde vem a fração de cada parte
// — da área digitada, não de "partes iguais" — e o nome e o papel de cada uma.
// As regras disso moram aqui, puras (sem React e sem banco): a prancheta e a
// etapa Documentos usam as mesmas, e o teste prende o comportamento.
//
// Tudo é guardado no jsonb servicos.divisao (sem migração): `tipo` diz que é
// desmembramento e `remanescente` é a posição da área remanescente na ordem
// das partes/glebas salvas. Divisão sem `tipo` é partilha, como sempre foi.
import type { Gleba, ParametrosDivisao, Servico, Vertice } from "./types.ts";
import { entradaDoServico, servicoDaParte, type InfoParte } from "./divisao_servico.ts";
import { areaAssinada, type Pt } from "./loteamento/geom.ts";

export type PapelArea = "remanescente" | "desmembrada" | "parte";

export const ROTULO_PAPEL: Record<PapelArea, string> = {
  remanescente: "Remanescente",
  desmembrada: "Desmembrada",
  parte: "Parte",
};

export const NOME_REMANESCENTE = "ÁREA REMANESCENTE";
export const nomeDesmembrada = (n: number): string => `ÁREA DESMEMBRADA ${String(n).padStart(2, "0")}`;

/** A divisão é um desmembramento? Sem `tipo` (tudo o que foi gravado antes) é partilha. */
export function ehDesmembramento(d: ParametrosDivisao | null | undefined): boolean {
  return d?.tipo === "desmembramento";
}

/** O papel da área na posição k (ordem das glebas salvas). Na partilha toda área é "parte". */
export function papelDaArea(d: ParametrosDivisao | null | undefined, k: number): PapelArea {
  if (!ehDesmembramento(d)) return "parte";
  return d!.remanescente === k ? "remanescente" : "desmembrada";
}

/**
 * Os nomes que o sistema dá às áreas: a remanescente é "ÁREA REMANESCENTE" e as
 * outras "ÁREA DESMEMBRADA 01", "02"… na ordem, pulando a remanescente.
 */
export function nomesAutomaticos(n: number, remanescente: number | null): string[] {
  let k = 0;
  return Array.from({ length: n }, (_, i) => (i === remanescente ? NOME_REMANESCENTE : nomeDesmembrada(++k)));
}

// "PARTE 3" é o nome que a prancheta dá a uma parte nova antes de saber o papel
const RE_AUTOMATICO = /^(?:PARTE \d+|[ÁA]REA REMANESCENTE|[ÁA]REA DESMEMBRADA \d+)$/;

/** Nome em branco ou dado pelo sistema: segue o papel da área até a pessoa digitar outro. */
export function ehNomeAutomatico(nome: string | null | undefined): boolean {
  const t = (nome ?? "").trim().toUpperCase();
  return !t || RE_AUTOMATICO.test(t);
}

/** O nome que vale para a área k: o digitado, ou o automático do papel dela. */
export function nomeDaArea(nome: string | null | undefined, k: number, n: number, remanescente: number | null): string {
  return ehNomeAutomatico(nome) ? nomesAutomaticos(n, remanescente)[k] : nome!.trim();
}

/** Troca o papel da área k num clique. No máximo uma remanescente: marcar outra tira a anterior. */
export function trocarPapel(remanescente: number | null, k: number, papel: "remanescente" | "desmembrada"): number | null {
  if (papel === "remanescente") return k;
  return remanescente === k ? null : remanescente;
}

/**
 * O que cada área grava na gleba ao salvar: o nome que vale e, na
 * remanescente, ninguém no lugar do proprietário (nem denominação própria) —
 * ela fica com o dono do imóvel.
 */
export function infosDoDesmembramento(linhas: InfoParte[], n: number, remanescente: number | null): InfoParte[] {
  return Array.from({ length: n }, (_, k) => {
    const l = linhas[k] ?? { nome: "", herdeiro: "", cpf: "", denominacao: "" };
    const nome = nomeDaArea(l.nome, k, n, remanescente);
    return k === remanescente
      ? { nome, herdeiro: "", cpf: "", denominacao: "" }
      : { ...l, nome };
  });
}

// ---------------------------------------------------------------------------
// áreas digitadas → frações do motor
// ---------------------------------------------------------------------------

/** A menor área que o desmembramento aceita (1 m²): abaixo disso não há o que medir. */
export const AREA_MINIMA_HA = 0.0001;

/** Área do perímetro (m²) como os documentos medem (com o publicador, nos pontos arredondados a 0,001"). */
export function areaDoPerimetroM2(vertices: Vertice[], publicar?: (p: Pt) => Pt): number {
  return Math.abs(areaAssinada(entradaDoServico(vertices, [1], false, publicar).anel));
}

/** Arredonda a 2 algarismos significativos: 4,7123 → 4,7; 0,0371 → 0,037; 123,4 → 120. */
function redondo(v: number): number {
  if (!(v > 0)) return 0;
  return Number(v.toPrecision(2));
}

/** A área com que nasce uma área desmembrada: 10% do imóvel, arredondada. */
export function areaInicialDesmembrada(totalHa: number): number {
  return redondo(totalHa * 0.1) || totalHa * 0.1;
}

/** A remanescente fica com o que sobra: total menos as desmembradas. */
export function comResto(areasHa: number[], remanescente: number | null, totalHa: number): number[] {
  if (remanescente === null || remanescente < 0 || remanescente >= areasHa.length) return [...areasHa];
  const outras = areasHa.reduce((s, a, i) => (i === remanescente ? s : s + a), 0);
  return areasHa.map((a, i) => (i === remanescente ? totalHa - outras : a));
}

/** Frações (em %, somando 100) para o motor e a prancheta, a partir das áreas (ha). */
export function percentuais(areasHa: number[]): number[] {
  const soma = areasHa.reduce((s, a) => s + Math.max(0, a), 0) || 1;
  return areasHa.map((a) => (Math.max(0, a) / soma) * 100);
}

/** De volta: a área (ha) de cada posição a partir das frações em %. */
export function areasDasFracoes(pct: number[], totalHa: number): number[] {
  const soma = pct.reduce((s, p) => s + p, 0) || 1;
  return pct.map((p) => (p / soma) * totalHa);
}

/** Como um desmembramento novo começa: uma área desmembrada (10% do imóvel, arredondada) e a remanescente com o resto. */
export function inicioDoDesmembramento(totalHa: number): { areasHa: number[]; remanescente: number } {
  const a = areaInicialDesmembrada(totalHa);
  return { areasHa: [a, totalHa - a], remanescente: 1 };
}

export interface MudancaDeAreas {
  areasHa: number[];
  remanescente: number | null;
  /** a posição que entrou (acrescentar) ou saiu (retirar) */
  pos: number;
}

/**
 * Mais uma área desmembrada. Ela sai da remanescente (com o tamanho de
 * começo, ou metade do que sobra, o que for menor) e entra logo antes dela
 * quando a remanescente é a última — a remanescente continua no fim da lista.
 * Sem remanescente, sai da maior área. null = não sobra área para mais uma.
 */
export function acrescentarArea(areasHa: number[], remanescente: number | null, totalHa: number): MudancaDeAreas | null {
  const n = areasHa.length;
  const doador = remanescente ?? areasHa.reduce((m, a, i) => (a > areasHa[m] ? i : m), 0);
  const nova = Math.min(areaInicialDesmembrada(totalHa), redondo(areasHa[doador] / 2) || areasHa[doador] / 2);
  if (!(nova >= AREA_MINIMA_HA) || areasHa[doador] - nova < AREA_MINIMA_HA) return null;
  if (remanescente === null) {
    const out = areasHa.map((a, i) => (i === doador ? a - nova : a));
    return { areasHa: [...out, nova], remanescente: null, pos: n };
  }
  const pos = remanescente === n - 1 ? remanescente : n;
  const out = [...areasHa];
  out.splice(pos, 0, nova);
  const rem = pos <= remanescente ? remanescente + 1 : remanescente;
  return { areasHa: comResto(out, rem, totalHa), remanescente: rem, pos };
}

/**
 * Uma área desmembrada a menos: a última que não é a remanescente. A área dela
 * volta para a remanescente (ou, sem remanescente, para a vizinha).
 * null = só restam duas áreas.
 */
export function retirarArea(areasHa: number[], remanescente: number | null, totalHa: number): MudancaDeAreas | null {
  const n = areasHa.length;
  if (n <= 2) return null;
  let pos = n - 1;
  if (pos === remanescente) pos--;
  const out = areasHa.filter((_, i) => i !== pos);
  if (remanescente === null) {
    const viz = Math.min(pos, out.length - 1);
    out[viz] += areasHa[pos];
    return { areasHa: out, remanescente: null, pos };
  }
  const rem = pos < remanescente ? remanescente - 1 : remanescente;
  return { areasHa: comResto(out, rem, totalHa), remanescente: rem, pos };
}

export type AreaDigitada =
  | { ok: true; areasHa: number[]; /** sem remanescente: a área que absorveu a diferença */ ajustada?: number }
  | { ok: false; erro: string };

const fmtHa = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/**
 * A pessoa digitou a área (ha) da área k. Com remanescente, ela fica com o que
 * sobra; sem remanescente, a diferença sai da maior das outras (as áreas têm
 * de somar o imóvel). Recusa o que não cabe, dizendo por quê.
 */
export function aplicarAreaDigitada(areasHa: number[], k: number, valorHa: number, remanescente: number | null, totalHa: number): AreaDigitada {
  if (!(valorHa > 0) || !Number.isFinite(valorHa)) return { ok: false, erro: "Digite uma área maior que zero (em hectares)." };
  if (valorHa < AREA_MINIMA_HA) return { ok: false, erro: "A área precisa ter pelo menos 1 m² (0,0001 ha)." };
  if (k === remanescente) return { ok: false, erro: "A área remanescente fica com o que sobra: digite a área das áreas desmembradas." };
  const novo = areasHa.map((a, i) => (i === k ? valorHa : a));
  if (remanescente !== null) {
    const out = comResto(novo, remanescente, totalHa);
    if (out[remanescente] < AREA_MINIMA_HA) {
      const desm = out.reduce((s, a, i) => (i === remanescente ? s : s + a), 0);
      return { ok: false, erro: `As áreas desmembradas somariam ${fmtHa(desm)} ha e o imóvel tem ${fmtHa(totalHa)} ha: não sobraria área remanescente.` };
    }
    return { ok: true, areasHa: out };
  }
  const dif = valorHa - areasHa[k];
  let j = -1;
  novo.forEach((a, i) => { if (i !== k && (j < 0 || a > novo[j])) j = i; });
  if (j < 0 || novo[j] - dif < AREA_MINIMA_HA) {
    return { ok: false, erro: `Sem área remanescente as áreas têm de somar o imóvel (${fmtHa(totalHa)} ha) e não há de onde tirar ${fmtHa(Math.abs(dif))} ha. Marque uma área como remanescente.` };
  }
  novo[j] -= dif;
  return { ok: true, areasHa: novo, ajustada: j };
}

/** "2,5", "2.5" ou "1.234,5678" → número (ha); NaN se não for número. */
export function lerHectares(texto: string): number {
  const t = texto.trim().replace(/\s|ha$/gi, "");
  if (!t) return NaN;
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^\d*\.?\d+$/.test(n) ? Number(n) : NaN;
}

// ---------------------------------------------------------------------------
// "Destacar a área pela frente / fundo / lateral": onde a área desmembrada fica
//
// O motor corta faixas paralelas a partir de um lado (azimute das divisas +
// "Outro lado"). Para a área encostar no lado escolhido, as divisas correm
// paralelas a ele e a primeira faixa nasce nele. A frente é o trecho de
// estrada mais comprido do perímetro (o mesmo ehEstrada da partilha); o fundo
// é o oposto; as laterais, à esquerda e à direita de quem entra pela estrada.
// ---------------------------------------------------------------------------

export type LadoDoImovel = "frente" | "fundo" | "esquerda" | "direita";

export const ROTULO_LADO: Record<LadoDoImovel, string> = {
  frente: "Frente (estrada)",
  fundo: "Fundo",
  esquerda: "Lateral esquerda",
  direita: "Lateral direita",
};

/**
 * Para onde a frente do imóvel "olha": a normal para FORA do trecho contínuo
 * de estrada mais comprido (média das normais dos lados, pelo comprimento).
 * null = nenhum lado é estrada, ou o imóvel inteiro é cercado por ela.
 */
export function normalDaFrente(anel: readonly Pt[], estrada: readonly boolean[] | undefined): Pt | null {
  const n = anel.length;
  if (n < 3 || !estrada?.some(Boolean) || estrada.every(Boolean)) return null;
  const antiHorario = areaAssinada([...anel]) > 0;
  const lado = (i: number) => {
    const a = anel[i], b = anel[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    // anel anti-horário: o lado de fora fica à direita de quem anda nele
    return { L, nx: L ? (antiHorario ? dy : -dy) / L : 0, ny: L ? (antiHorario ? -dx : dx) / L : 0 };
  };
  // trechos contíguos de estrada, começando depois de um lado que não é estrada
  const inicio = estrada.findIndex((e) => !e);
  let melhor: { L: number; nx: number; ny: number } | null = null;
  let atual: { L: number; nx: number; ny: number } | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (inicio + k) % n;
    if (!estrada[i]) { atual = null; continue; }
    const l = lado(i);
    atual = atual ?? { L: 0, nx: 0, ny: 0 };
    atual.L += l.L; atual.nx += l.nx * l.L; atual.ny += l.ny * l.L;
    if (!melhor || atual.L > melhor.L) melhor = atual;
  }
  if (!melhor) return null;
  const m = Math.hypot(melhor.nx, melhor.ny);
  return m > 1e-9 ? [melhor.nx / m, melhor.ny / m] : null;
}

/** O azimute no intervalo do motor, [0, 180): passar de 180 é varrer do outro lado. */
export function normalizarDirecao(azimute: number, inverter: boolean): { azimute: number; inverter: boolean } {
  let az = ((azimute % 360) + 360) % 360;
  let inv = inverter;
  if (az >= 180) { az -= 180; inv = !inv; }
  return { azimute: Math.round(az * 100) / 100, inverter: inv };
}

/**
 * A direção das divisas (azimute + "Outro lado") com que a PRIMEIRA faixa do
 * motor nasce encostada no lado escolhido: divisas paralelas a ele, faixas
 * avançando dele para dentro do imóvel (o `u` do motor de divisao.ts).
 */
export function direcaoParaLado(nFrente: Pt, lado: LadoDoImovel): { azimute: number; inverter: boolean } {
  const dentro: Pt = [-nFrente[0], -nFrente[1]];          // de quem entra pela estrada
  const esquerda: Pt = [-dentro[1], dentro[0]];           // à esquerda de quem entra
  const fora: Pt = lado === "frente" ? nFrente : lado === "fundo" ? dentro : lado === "esquerda" ? esquerda : [-esquerda[0], -esquerda[1]];
  // o motor mede as faixas por u = [cos r, −sin r] (r = azimute): a primeira faixa é a de menor u
  const u: Pt = [-fora[0], -fora[1]];
  const teta = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return normalizarDirecao(-teta, false);
}

/** As direções a tentar, da ideal para as vizinhas (a forma pode não deixar a ideal). */
export function direcoesPerto(ideal: { azimute: number; inverter: boolean }, passos = [5, 10, 15, 20, 25, 30, 40]): { azimute: number; inverter: boolean }[] {
  const out = [ideal];
  for (const p of passos) for (const s of [p, -p]) out.push(normalizarDirecao(ideal.azimute + s, ideal.inverter));
  return out;
}

/** Uma tentativa do motor numa direção: se cortou, por que não e quanto da 1ª faixa dá para a estrada. */
export interface TentativaDeLado { ok: boolean; motivo?: string; frenteEstradaM?: number }

/**
 * A direção que destaca a área pelo lado escolhido: a ideal e, se a forma não
 * deixar (divisa que entra e sai duas vezes), as vizinhas, até 40°. Pela
 * frente, só vale a que deixa a área com frente para a estrada. Devolve a
 * tentativa aceita, a direção e quanto ela girou da ideal — ou o motivo de
 * nenhuma servir (a divisão atual fica como está).
 */
export function escolherDirecao<T extends TentativaDeLado>(
  nFrente: Pt, lado: LadoDoImovel, tentar: (d: { azimute: number; inverter: boolean }) => T,
): { ok: true; t: T; direcao: { azimute: number; inverter: boolean }; giro: number } | { ok: false; motivo: string } {
  const ideal = direcaoParaLado(nFrente, lado);
  let motivo = "";
  for (const d of direcoesPerto(ideal)) {
    const t = tentar(d);
    if (!t.ok) { motivo ||= t.motivo ?? ""; continue; }
    if (lado === "frente" && !((t.frenteEstradaM ?? 0) > 0.5)) { motivo ||= "nenhuma direção perto da estrada deixa a área com frente para ela"; continue; }
    const dif = Math.abs(d.azimute - ideal.azimute) % 180;
    return { ok: true, t, direcao: d, giro: Math.round(Math.min(dif, 180 - dif) * 100) / 100 };
  }
  return { ok: false, motivo: motivo || "a forma do imóvel não deixa" };
}

/**
 * A ordem das faixas do motor para destacar a área k: ela primeiro (encostada
 * no lado escolhido), as outras desmembradas na ordem delas e a remanescente
 * por último — ela fica com o resto do imóvel.
 */
export function ordemParaDestacar(n: number, k: number, remanescente: number | null): number[] {
  const outras = Array.from({ length: n }, (_, i) => i).filter((i) => i !== k && i !== remanescente);
  return [k, ...outras, ...(remanescente !== null && remanescente !== k && remanescente < n ? [remanescente] : [])];
}

// ---------------------------------------------------------------------------
// o serviço de cada área (o GEO dela)
// ---------------------------------------------------------------------------

/** A gleba como o serviço da área a vê: a remanescente é do proprietário, com o nome do imóvel e o da área. */
export function glebaComPapel(g: Gleba, papel: PapelArea): Gleba {
  return papel === "remanescente" ? { ...g, denominacao: null, detentor_nome: null, detentor_cpf: null } : g;
}

/**
 * O cabeçalho do serviço completo de uma área. Desmembrada: no nome do
 * adquirente (em branco = o proprietário), denominação "<IMÓVEL> - ÁREA
 * DESMEMBRADA 01" ou a digitada. Remanescente: com o proprietário e
 * "<IMÓVEL> - ÁREA REMANESCENTE". Partilha: o mesmo de sempre (servicoDaParte).
 */
export function servicoDaArea(servico: Servico, g: Gleba, papel: PapelArea): Partial<Servico> {
  return servicoDaParte(servico, glebaComPapel(g, papel));
}

/** Quem recebe a área (o nome que sai nos documentos dela). */
export function quemRecebe(servico: Pick<Servico, "detentor_nome">, g: Gleba, papel: PapelArea): string {
  const dela = glebaComPapel(g, papel);
  return (dela.detentor_nome ?? "").trim() || (servico.detentor_nome ?? "").trim();
}

// ---------------------------------------------------------------------------
// o serviço da área ACOMPANHA a divisão
//
// O serviço de cada área é criado uma vez (e gasta o crédito dela) — mas a
// divisão pode mudar depois: a divisa andou, o adquirente foi digitado, a área
// trocou de nome. Gerar os documentos de novo sem levar isso ao serviço da área
// sairia com o desenho e o dono antigos. Só o que vem da divisão é levado: o
// resto do cabeçalho (RG, endereço, gênero…) é de quem abriu o serviço da área.
// ---------------------------------------------------------------------------

/** Os dados da pessoa que mudam juntos quando quem recebe a área muda. */
const CAMPOS_DA_PESSOA = [
  "detentor_nome", "detentor_cpf", "detentor_rg", "detentor_genero", "endereco_detentor",
  "requerente2_nome", "requerente2_cpf", "requerente2_genero",
  "is_espolio", "inventariante_nome", "inventariante_cpf", "inventariante_rg",
] as const;

const txt = (v: unknown) => String(v ?? "").trim();

/**
 * O que atualizar no cabeçalho do serviço da área para ele seguir a divisão
 * (null = nada). Denominação e CPF vão sozinhos; trocou quem recebe, vai a
 * pessoa inteira como servicoDaArea a monta (o RG e o endereço do dono antigo
 * não servem ao novo).
 */
export function mudancasNoCabecalho(
  atual: Partial<Pick<Servico, "denominacao" | "detentor_nome" | "detentor_cpf">> | null | undefined,
  esperado: Partial<Servico>,
): Partial<Servico> | null {
  if (!atual) return null;
  if (txt(atual.detentor_nome) !== txt(esperado.detentor_nome)) {
    const patch: Record<string, unknown> = { denominacao: esperado.denominacao ?? null };
    for (const k of CAMPOS_DA_PESSOA) patch[k] = (esperado as Record<string, unknown>)[k] ?? (k === "is_espolio" ? false : null);
    return patch as Partial<Servico>;
  }
  const patch: Partial<Servico> = {};
  if (txt(atual.denominacao) !== txt(esperado.denominacao)) patch.denominacao = esperado.denominacao ?? null;
  if (txt(atual.detentor_cpf) !== txt(esperado.detentor_cpf)) patch.detentor_cpf = esperado.detentor_cpf ?? null;
  return Object.keys(patch).length ? patch : null;
}

type VerticeDesenho = Pick<Vertice, "e" | "n" | "tipo" | "codigo">;
const chaveDoVertice = (v: VerticeDesenho) =>
  `${v.e === null ? "-" : Number(v.e).toFixed(3)}|${v.n === null ? "-" : Number(v.n).toFixed(3)}|${v.tipo}|${v.codigo ?? ""}`;

/**
 * O serviço da área ainda tem o desenho da divisão? Mesmos pontos, na mesma
 * ordem, com o mesmo tipo e código (o código muda quando a divisão renumera o
 * imóvel). A confrontação não entra: o que foi descrito no serviço da área fica.
 */
export function mesmoDesenho(atuais: readonly VerticeDesenho[], novos: readonly VerticeDesenho[]): boolean {
  return atuais.length === novos.length && atuais.every((v, i) => chaveDoVertice(v) === chaveDoVertice(novos[i]));
}
