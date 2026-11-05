// Supabase falso, em memória, para rodar as Edge Functions REAIS no Node.
// Implementa só o que as funções usam: auth.getUser, rpc, from().select/
// insert/update com eq/or/gte/not/order/limit/single/maybeSingle/count, e
// storage upload/download. Tudo o que é gravado fica em globalThis.__banco.
// Cada rpc chamada fica em `__banco.chamadasRpc` (nome e argumentos), e a
// resposta pode ser uma função dos argumentos — para o teste conferir o que a
// função mandou ao banco (ex.: o contorno do imóvel) e responder conforme.
import { randomUUID } from "node:crypto";

export function bancoNovo() {
  globalThis.__banco = { tabelas: {}, storage: {}, rpc: { meu_escritorio: [{ id: "esc-1" }], tem_permissao: true, sou_superadmin: false }, usuario: "user-1" };
  return globalThis.__banco;
}
const banco = () => globalThis.__banco ?? bancoNovo();
const tabela = (t) => (banco().tabelas[t] ??= []);

class Consulta {
  constructor(t) { this.t = t; this.op = "select"; this.filtros = []; this.ordem = null; this.lim = null; this.modo = "lista"; this.cabeca = false; this.retornar = false; }
  select(_c, opts) { if (this.op === "select") this.op = "select"; else this.retornar = true; if (opts?.head) this.cabeca = true; this.contar = !!opts?.count; return this; }
  insert(linhas) { this.op = "insert"; this.dados = Array.isArray(linhas) ? linhas : [linhas]; return this; }
  update(v) { this.op = "update"; this.dados = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filtros.push((r) => r[c] === v); return this; }
  gte(c, v) { this.filtros.push((r) => r[c] >= v); return this; }
  not(c, op, v) { if (op === "is" && v === null) this.filtros.push((r) => r[c] !== null && r[c] !== undefined); return this; }
  or(expr) {
    const partes = expr.split(",").map((p) => { const [c, op, ...v] = p.split("."); return { c, op, v: v.join(".") }; });
    this.filtros.push((r) => partes.some((p) => (p.op === "eq" ? r[p.c] === p.v : p.op === "is" && p.v === "null" ? r[p.c] == null : false)));
    return this;
  }
  order(c, o) { this.ordem = { c, asc: o?.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.modo = "single"; return this; }
  maybeSingle() { this.modo = "maybe"; return this; }
  then(ok, falha) { return Promise.resolve().then(() => this.executar()).then(ok, falha); }
  executar() {
    const linhas = tabela(this.t);
    let alvo;
    if (this.op === "insert") {
      const novas = this.dados.map((d) => ({ id: d.id ?? randomUUID(), created_at: new Date().toISOString(), ...structuredClone(d) }));
      linhas.push(...novas);
      alvo = novas;
    } else {
      alvo = linhas.filter((r) => this.filtros.every((f) => f(r)));
      if (this.op === "update") { for (const r of alvo) Object.assign(r, structuredClone(this.dados)); }
      if (this.op === "delete") { banco().tabelas[this.t] = linhas.filter((r) => !alvo.includes(r)); }
    }
    if (this.ordem) alvo = [...alvo].sort((a, b) => ((a[this.ordem.c] > b[this.ordem.c]) - (a[this.ordem.c] < b[this.ordem.c])) * (this.ordem.asc ? 1 : -1));
    if (this.lim !== null) alvo = alvo.slice(0, this.lim);
    if (this.cabeca) return { data: null, count: alvo.length, error: null };
    const copia = structuredClone(alvo);
    if (this.modo === "single") return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { message: `esperava 1 linha, veio ${copia.length}` } };
    if (this.modo === "maybe") return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null, count: copia.length };
  }
}

export function createClient() {
  return {
    auth: { getUser: async () => ({ data: { user: banco().usuario ? { id: banco().usuario } : null }, error: banco().usuario ? null : { message: "sem sessão" } }) },
    rpc: async (nome, args) => {
      (banco().chamadasRpc ??= []).push({ nome, args: structuredClone(args ?? null) });
      if (!(nome in banco().rpc)) return { data: null, error: { message: `rpc ${nome} inexistente` } };
      const v = banco().rpc[nome];
      return { data: typeof v === "function" ? v(args) : v, error: null };
    },
    from: (t) => new Consulta(t),
    storage: {
      from: (bucket) => ({
        upload: async (caminho, blob) => { banco().storage[`${bucket}/${caminho}`] = new Uint8Array(await blob.arrayBuffer()); return { data: { path: caminho }, error: null }; },
        download: async (caminho) => {
          const b = banco().storage[`${bucket}/${caminho}`];
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
}
