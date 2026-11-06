// Avisa os buscadores do IndexNow (Bing, Yandex, Seznam, Naver) que as URLs
// do sitemap publicado mudaram. O Bing alimenta a busca do ChatGPT e do
// Copilot, então indexar rápido lá também conta para GEO.
//
// Rode DEPOIS que o deploy estiver no ar (lê o sitemap de produção):
//   node scripts/indexnow.mjs            → todas as URLs do sitemap
//   node scripts/indexnow.mjs /blog/x/   → só as URLs passadas
//
// A chave é pública por desenho: o arquivo public/<chave>.txt prova a posse.

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://vertces.com.br";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const chave = readdirSync(join(RAIZ, "public")).map((f) => f.match(/^([0-9a-f]{32})\.txt$/)?.[1]).find(Boolean);
if (!chave) { console.error("Chave do IndexNow não encontrada em public/<chave>.txt"); process.exit(1); }

let urls = process.argv.slice(2).map((u) => (u.startsWith("http") ? u : SITE + u));
if (!urls.length) {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
const conf = await fetch(`${SITE}/${chave}.txt`);
if (!conf.ok || (await conf.text()).trim() !== chave) { console.error("O arquivo da chave ainda não está no ar; publique antes."); process.exit(1); }

const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: "vertces.com.br", key: chave, keyLocation: `${SITE}/${chave}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${r.status} ${r.statusText} (${urls.length} URLs)`);
if (r.status >= 400) process.exit(1);
