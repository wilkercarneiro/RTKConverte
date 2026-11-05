// Empacota a função `entregar` num arquivo só (esbuild), para a VPS.
//
// A função usa o MESMO código das telas (src/lib/car, src/lib/loteamento) e as
// bibliotecas do site (pdf-lib, jszip, proj4, clipper-lib, supabase-js). Em vez
// de copiar a árvore de pastas para o servidor, sai um pacote único:
//   build/funcoes/entregar/index.ts   — o pacote (ESM; o edge runtime lê .ts)
//   build/funcoes/entregar/deno.json  — import map vazio (tudo está dentro)
//
//   node scripts/empacotar-entregar.mjs
import { build } from "esbuild";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "build", "funcoes", "entregar");
mkdirSync(saida, { recursive: true });

await build({
  entryPoints: [join(raiz, "supabase", "functions", "entregar", "index.ts")],
  outfile: join(saida, "index.ts"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // o edge runtime é Deno: os globais Deno.* ficam como estão
  define: { "import.meta.env": "{}" },
  legalComments: "none",
  minify: false,
  logLevel: "warning",
  banner: { js: "// GERADO por scripts/empacotar-entregar.mjs — não edite à mão.\n// deno-lint-ignore-file\n// @ts-nocheck" },
});
writeFileSync(join(saida, "deno.json"), JSON.stringify({ imports: {} }, null, 2) + "\n");
console.log(`entregar: ${(statSync(join(saida, "index.ts")).size / 1024).toFixed(0)} KB em ${saida}`);
