// Fecho de imports de uma edge function: os arquivos do repositório que ela
// carrega (index.ts + tudo o que ele importa por caminho relativo, de novo e de
// novo). Na VPS cada função tem a SUA cópia do _shared, só com o que usa — e
// faltar um módulo novo derruba a função no boot (foi o que aconteceu com a
// gerar-planta em 28/10, sem o sigef_glebas.ts). Publicar = copiar o fecho.
//
//   node scripts/fecho-imports.mjs gerar-documentos [gerar-planta …]
//   node scripts/fecho-imports.mjs --json gerar-documentos
//   node scripts/fecho-imports.mjs --desde 7231285 gerar-documentos   # só o que mudou desde o commit no ar
//
// Saída: um caminho por linha (relativo à raiz do repo). Imports de pacote
// ("pdf-lib", "npm:…", "jsr:…", URL) não entram: vêm do deno.json da função.
// ATENÇÃO: na VPS, módulo usado só como TIPO é um esboço (`export {}`) — publique
// com --desde (só o que mudou) por cima da pasta baixada da VPS, nunca o fecho
// inteiro (ver scripts/publicar-travas.sh e a memória rtkconverte-vps).
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const iDesde = args.indexOf("--desde");
const desde = iDesde >= 0 ? args[iDesde + 1] : null;
const funcoes = args.filter((a, i) => !a.startsWith("--") && !(iDesde >= 0 && i === iDesde + 1));
const mudados = desde
  ? new Set(execFileSync("git", ["diff", "--name-only", `${desde}..HEAD`, "--", "supabase/functions"], { cwd: raiz, encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean))
  : null;
if (!funcoes.length) {
  console.error("uso: node scripts/fecho-imports.mjs [--json] <função> [<função>…]");
  process.exit(2);
}

const RE_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function fecho(entrada) {
  const vistos = new Set();
  const fila = [entrada];
  while (fila.length) {
    const arq = fila.pop();
    if (vistos.has(arq)) continue;
    vistos.add(arq);
    const fonte = readFileSync(arq, "utf8");
    for (const m of fonte.matchAll(RE_IMPORT)) {
      const esp = m[1] ?? m[2] ?? m[3];
      if (!esp || !(esp.startsWith("./") || esp.startsWith("../"))) continue;
      const alvo = resolve(dirname(arq), esp);
      if (!existsSync(alvo)) throw new Error(`${relative(raiz, arq)} importa ${esp}, que não existe`);
      fila.push(alvo);
    }
  }
  return [...vistos].map((a) => relative(raiz, a).replace(/\\/g, "/")).sort();
}

const saida = {};
for (const f of funcoes) {
  const idx = join(raiz, "supabase", "functions", f, "index.ts");
  if (!existsSync(idx)) { console.error(`função ${f} não existe`); process.exit(1); }
  saida[f] = fecho(idx);
  if (mudados) saida[f] = saida[f].filter((p) => mudados.has(p));
  const fora = saida[f].filter((p) => !p.startsWith("supabase/functions/"));
  if (fora.length) {
    // código de src/ na função: só a `entregar` faz isso, e ela vai empacotada
    console.error(`aviso: ${f} importa código de fora de supabase/functions (${fora.length} arquivos) — empacote (scripts/empacotar-entregar.mjs)`);
  }
}
if (json) console.log(JSON.stringify(saida, null, 2));
else for (const [f, lista] of Object.entries(saida)) { console.log(`# ${f}`); for (const p of lista) console.log(p); }
