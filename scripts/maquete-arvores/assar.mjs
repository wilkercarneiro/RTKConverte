// Assa as árvores da Poly Haven (CC0) em atlas de impostor para a maquete 3D.
//
//   node scripts/maquete-arvores/assar.mjs            (baixa o que faltar e assa todas)
//   node scripts/maquete-arvores/assar.mjs rua        (só uma)
//
// Saída: public/maquete/arvores/<id>-cor.webp, <id>-normal.webp e arvores.json.
// Os modelos (centenas de MB) ficam em scripts/maquete-arvores/.modelos (fora do Git).
// Precisa do playwright-core (PLAYWRIGHT_CORE=<caminho do index.mjs>) e do Chrome instalado.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const MODELOS = path.join(AQUI, ".modelos");
const SAIDA = path.join(RAIZ, "public/maquete/arvores");

/** Espécies da maquete. `folhas` pinta a copa (ipê florido) a partir do mesmo modelo. */
export const ARVORES = [
  { id: "rua", modelo: "tree_small_02", nome: "árvore de calçada" },
  { id: "copa", modelo: "island_tree_01", nome: "copa larga" },
  { id: "jacaranda", modelo: "jacaranda_tree", nome: "sombra grande" },
  { id: "conifera", modelo: "fir_sapling_medium", no: "fir_sapling_medium_a_LOD0", nome: "conífera" },
  // arbustos dos jardins (atlas menor: de perto ocupam pouco da tela)
  { id: "arbusto", modelo: "searsia_lucida", no: "searsia_lucida_a_LOD0", nome: "arbusto", celula: 256 },
  { id: "arbusto2", modelo: "searsia_lucida", no: "searsia_lucida_e_LOD0", nome: "arbusto baixo", celula: 256 },
  { id: "arbusto3", modelo: "searsia_lucida", no: "searsia_lucida_c_LOD0", nome: "arbusto médio", celula: 256 },
  // o ipê (amarelo e rosa) não tem atlas: a maquete pinta a copa da árvore de rua (arvores3d.ts).
  // Para ver a versão assada: { id: "ipe-amarelo", modelo: "tree_small_02", folhas: [0.98, 0.74, 0.08] }
];
const N = 8, CELULA = 384, CELULA_NORMAL = 128;

async function baixar(modelo) {
  const dir = path.join(MODELOS, modelo);
  const gltf = path.join(dir, `${modelo}_1k.gltf`);
  if (fs.existsSync(gltf)) return;
  console.log("baixando", modelo);
  const lista = await (await fetch(`https://api.polyhaven.com/files/${modelo}`)).json();
  const g = lista.gltf["1k"].gltf;
  const itens = [[path.basename(g.url), g.url], ...Object.entries(g.include).map(([p, x]) => [p, x.url])];
  for (const [p, u] of itens) {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${u}: ${r.status}`);
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), Buffer.from(await r.arrayBuffer()));
  }
}

function servidor() {
  const tipos = { ".html": "text/html", ".js": "text/javascript", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".jpg": "image/jpeg", ".png": "image/png" };
  const s = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f;
    if (u === "/") f = path.join(AQUI, "assar.html");
    else if (u.startsWith("/three/")) f = path.join(RAIZ, "node_modules/three", u.slice(7));
    else if (u.startsWith("/modelos/")) f = path.join(MODELOS, u.slice(9));
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": tipos[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => s.listen(0, () => r(s)));
}

const so = process.argv[2];
const lista = ARVORES.filter((a) => !so || a.id === so);
for (const a of lista) await baixar(a.modelo);
const pw = process.env.PLAYWRIGHT_CORE ?? "D:/DadosApps/Temp/claude/d--RTKConverte/502a3917-4c5f-4623-969c-68fadd57d938/scratchpad/pw/node_modules/playwright-core/index.mjs";
const { chromium } = await import(pathToFileURL(pw).href);
const srv = await servidor();
const porta = srv.address().port;
// GPU de verdade quando houver (os modelos têm milhões de triângulos); SwiftShader como reserva
const browser = await chromium.launch({ channel: "chrome", args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=d3d11"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:${porta}/`);
await page.waitForFunction(() => window.pronto === true);
fs.mkdirSync(SAIDA, { recursive: true });
const metaArq = path.join(SAIDA, "arvores.json");
const metas = fs.existsSync(metaArq) ? JSON.parse(fs.readFileSync(metaArq, "utf8")) : {};
for (const a of lista) {
  const t0 = Date.now();
  const r = await page.evaluate((cfg) => window.assar(cfg), { modelo: a.modelo, no: a.no, N, celula: a.celula ?? CELULA, celulaNormal: CELULA_NORMAL, folhas: a.folhas });
  const grava = (nome, dataUrl) => fs.writeFileSync(path.join(SAIDA, nome), Buffer.from(dataUrl.split(",")[1], "base64"));
  grava(`${a.id}-cor.webp`, r.cor);
  // o ipê é a árvore de rua pintada: a normal é a mesma (a maquete lê a de "rua")
  if (!a.folhas) grava(`${a.id}-normal.webp`, r.normal);
  metas[a.id] = { ...r.meta, nome: a.nome, fonte: `Poly Haven ${a.modelo} (CC0)` };
  console.log(a.id, r.meta, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.writeFileSync(metaArq, JSON.stringify(metas, null, 2) + "\n");
await browser.close();
srv.close();
