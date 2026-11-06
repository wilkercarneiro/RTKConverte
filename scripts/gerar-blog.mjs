// Gera o blog estático do Vertces depois do `vite build`.
//
// Entrada: content/blog/*.md (frontmatter JSON entre linhas `---` + Markdown).
// Saída em dist/:
//   blog/index.html, blog/<slug>/index.html, blog/categoria/<cat>/index.html,
//   blog/feed.xml, sitemap.xml, robots.txt, llms.txt, llms-full.txt
// e, no dist/index.html já gerado pelo Vite, o FAQPage (lido das <details>
// da própria landing, para nunca divergir do texto visível) e o link do RSS.
//
// Por que estático: Google e os robôs das IAs (GPTBot, PerplexityBot,
// ClaudeBot…) leem HTML pronto; muitos não executam JavaScript.
//
// Regras que derrubam o build (de propósito): frontmatter inválido, campo
// obrigatório faltando, slug repetido, categoria desconhecida e link interno
// para um post que não existe.
//
// Uso: node scripts/gerar-blog.mjs [--dist dist]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const argDist = process.argv.indexOf("--dist");
const DIST = join(RAIZ, argDist > -1 ? process.argv[argDist + 1] : "dist");
const CONTEUDO = join(RAIZ, "content", "blog");
const SITE = "https://vertces.com.br";
const OG_PADRAO = `${SITE}/site/og.png`;
const HOJE = new Date().toISOString().slice(0, 10);

export const CATEGORIAS = {
  "funcionalidades": { nome: "Funcionalidades", desc: "Como o Vertces resolve cada etapa do trabalho: memorial, planilha SIGEF, planta, peças técnicas, loteamento, CAR e mais." },
  "guias-tecnicos": { nome: "Guias técnicos", desc: "Referência para agrimensores, topógrafos e engenheiros: NTGIR, SIGEF, vértices, fusos UTM, precisão e confrontantes." },
  "legislacao-e-prazos": { nome: "Legislação e prazos", desc: "Prazos do georreferenciamento, mudanças no SIGEF, desmembramento e as leis que regem o imóvel rural." },
  "para-proprietarios": { nome: "Para proprietários", desc: "Georreferenciamento explicado para quem tem terra: custo, prazo, venda, usucapião e o que pedir ao profissional." },
  "mercado": { nome: "Mercado e gestão", desc: "Como escolher software, organizar o escritório de georreferenciamento e trabalhar com mais margem." },
};

// ── utilidades ───────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const semTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const slugify = (s) => semTags(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataBr = (iso) => { const [a, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };
const gravar = (rel, conteudo) => { const p = join(DIST, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, conteudo); };
const urlPost = (slug) => `/blog/${slug}/`;
const urlCat = (cat) => `/blog/categoria/${cat}/`;

// ── leitura dos posts ────────────────────────────────────────────────────
function lerPosts() {
  if (!existsSync(CONTEUDO)) return [];
  const erros = [];
  const posts = [];
  for (const arq of readdirSync(CONTEUDO).filter((f) => f.endsWith(".md")).sort()) {
    const bruto = readFileSync(join(CONTEUDO, arq), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const m = bruto.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { erros.push(`${arq}: sem frontmatter entre linhas ---`); continue; }
    let fm;
    try { fm = JSON.parse(m[1]); } catch (e) { erros.push(`${arq}: frontmatter não é JSON válido (${e.message})`); continue; }
    for (const campo of ["titulo", "descricao", "slug", "data", "categoria", "palavraChave", "resumo"]) {
      if (!fm[campo] || typeof fm[campo] !== "string") erros.push(`${arq}: falta "${campo}"`);
    }
    if (fm.categoria && !CATEGORIAS[fm.categoria]) erros.push(`${arq}: categoria desconhecida "${fm.categoria}"`);
    if (fm.slug && `${fm.slug}.md` !== arq) erros.push(`${arq}: o slug "${fm.slug}" difere do nome do arquivo`);
    if (fm.data && !/^\d{4}-\d{2}-\d{2}$/.test(fm.data)) erros.push(`${arq}: data fora do formato AAAA-MM-DD`);
    if (fm.rascunho) continue;
    posts.push({ ...fm, atualizado: fm.atualizado || fm.data, faq: fm.faq || [], fontes: fm.fontes || [], palavrasRelacionadas: fm.palavrasRelacionadas || [], corpoMd: m[2].trim(), arquivo: arq });
  }
  const vistos = new Set();
  for (const p of posts) { if (vistos.has(p.slug)) erros.push(`slug repetido: ${p.slug}`); vistos.add(p.slug); }
  if (erros.length) { console.error("[blog] erros:\n  " + erros.join("\n  ")); process.exit(1); }
  // não publica post com data futura (permite deixar posts agendados)
  return posts.filter((p) => p.data <= HOJE).sort((a, b) => (b.data + b.titulo).localeCompare(a.data + a.titulo, "pt-BR"));
}

// ── Markdown → HTML ──────────────────────────────────────────────────────
function renderizar(post, slugs, erros) {
  const sumario = [];
  const usados = new Set();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const texto = this.parser.parseInline(tokens);
        if (depth === 1) depth = 2; // o H1 é o título do post
        let id = slugify(texto) || "secao";
        while (usados.has(id)) id += "-2";
        usados.add(id);
        if (depth === 2) sumario.push({ id, texto: semTags(texto) });
        return `<h${depth} id="${id}">${texto}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const texto = this.parser.parseInline(tokens);
        const t = title ? ` title="${esc(title)}"` : "";
        if (/^https?:\/\//.test(href) && !href.startsWith(SITE)) {
          return `<a href="${esc(href)}"${t} target="_blank" rel="noopener">${texto}</a>`;
        }
        const rel = href.startsWith(SITE) ? href.slice(SITE.length) || "/" : href;
        const mPost = rel.match(/^\/blog\/([a-z0-9-]+)\/?(#.*)?$/);
        if (mPost && mPost[1] !== "categoria" && !slugs.has(mPost[1])) erros.push(`${post.arquivo}: link interno quebrado ${href}`);
        return `<a href="${esc(rel)}"${t}>${texto}</a>`;
      },
      table(token) {
        const cab = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const linhas = token.rows.map((r) => "<tr>" + r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("") + "</tr>").join("\n");
        return `<div class="tabela" role="region" tabindex="0" aria-label="Tabela"><table><thead><tr>${cab}</tr></thead><tbody>${linhas}</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(post.corpoMd);
  const palavras = semTags(html).split(/\s+/).filter(Boolean).length;
  return { html, sumario, palavras, minutos: Math.max(2, Math.round(palavras / 200)) };
}

// ── pedaços de página ────────────────────────────────────────────────────
const MARCA_SVG = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 22 14 5l10 17" fill="none" stroke="#7BD3A6" stroke-width="2.6" stroke-linejoin="round"/><circle cx="14" cy="5" r="3" fill="#7BD3A6"/><circle cx="4" cy="22" r="2.4" fill="currentColor"/><circle cx="24" cy="22" r="2.4" fill="currentColor"/></svg>`;

function cabeca({ titulo, descricao, url, tipo = "website", ld, extra = "" }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}" />
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
<meta name="theme-color" content="#0E3B2B" />
<link rel="canonical" href="${SITE}${url}" />
<link rel="alternate" type="application/rss+xml" title="Blog do Vertces" href="${SITE}/blog/feed.xml" />
<meta property="og:type" content="${tipo}" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:site_name" content="Vertces" />
<meta property="og:title" content="${esc(titulo)}" />
<meta property="og:description" content="${esc(descricao)}" />
<meta property="og:url" content="${SITE}${url}" />
<meta property="og:image" content="${OG_PADRAO}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
${extra}<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/blog/blog.css" />
<script type="application/ld+json">${ldJson(ld)}</script>
</head>
<body>
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<header class="topo">
  <div class="w topo-in">
    <a class="logo" href="/" aria-label="Vertces, página inicial">${MARCA_SVG}<span>Vertces</span></a>
    <nav class="nav" aria-label="Principal">
      <a href="/#servicos">Serviços</a>
      <a href="/#loteamento">Loteamento</a>
      <a href="/#car">CAR</a>
      <a href="/blog/" aria-current="${url.startsWith("/blog/") ? "page" : "false"}">Blog</a>
      <a href="/app/">Entrar</a>
    </nav>
    <a class="bt bt-p" href="/#contato">Agendar demonstração</a>
  </div>
</header>
`;
}

function rodape() {
  const cats = Object.entries(CATEGORIAS).map(([k, c]) => `<a href="${urlCat(k)}">${esc(c.nome)}</a>`).join("");
  return `<footer class="rod">
  <div class="w rod-in">
    <div>
      <a class="logo" href="/">${MARCA_SVG}<span>Vertces</span></a>
      <p>Georreferenciamento do levantamento à certificação. Sistema web para escritórios, agrimensores e engenheiros credenciados no INCRA.</p>
    </div>
    <nav aria-label="Categorias do blog"><strong>Blog</strong>${cats}</nav>
    <nav aria-label="Vertces"><strong>Vertces</strong><a href="/#como">Como funciona</a><a href="/#servicos">Serviços</a><a href="/#documentos">Documentos</a><a href="/#contato">Agendar demonstração</a><a href="/app/#/termos">Termos de uso</a><a href="/app/#/privacidade">Privacidade</a></nav>
  </div>
  <p class="w rod-c">© ${new Date().getFullYear()} Vertces · <a href="/blog/feed.xml">RSS</a> · <a href="/llms.txt">llms.txt</a></p>
</footer>
</body>
</html>
`;
}

const cta = `<aside class="cta" aria-label="Conheça o Vertces">
  <p class="cta-k">Vertces</p>
  <p class="cta-t">Do TXT do levantamento ao processo pronto para o SIGEF e o cartório.</p>
  <p class="cta-d">Memorial, planilha ODS, planta A1/A3 e as peças técnicas com o logo do seu escritório, conferindo a sobreposição com os vizinhos certificados antes de protocolar. Sistema web, sem instalar nada.</p>
  <p class="cta-b"><a class="bt bt-p" href="/#contato">Agendar uma demonstração</a><a class="bt bt-s" href="/cadastro/">Assinar pelo site</a></p>
</aside>`;

function cartao(p) {
  return `<li class="card"><a href="${urlPost(p.slug)}">
    <span class="card-cat">${esc(CATEGORIAS[p.categoria].nome)}</span>
    <span class="card-t">${esc(p.titulo)}</span>
    <span class="card-d">${esc(p.descricao)}</span>
    <span class="card-m">${p.minutos} min de leitura</span>
  </a></li>`;
}

const ORG = { "@type": "Organization", "@id": `${SITE}/#org`, name: "Vertces", url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/favicon.svg` } };

// ── página do post ───────────────────────────────────────────────────────
function paginaPost(p, todos) {
  const url = urlPost(p.slug);
  const cat = CATEGORIAS[p.categoria];
  const relacionados = [
    ...todos.filter((o) => o.slug !== p.slug && o.categoria === p.categoria),
    ...todos.filter((o) => o.slug !== p.slug && o.categoria !== p.categoria),
  ].slice(0, 3);
  const graph = [
    {
      "@type": "BlogPosting", "@id": `${SITE}${url}#post`, headline: p.titulo, description: p.descricao,
      datePublished: p.data, dateModified: p.atualizado, inLanguage: "pt-BR", url: `${SITE}${url}`,
      mainEntityOfPage: `${SITE}${url}`, image: OG_PADRAO, articleSection: cat.nome, wordCount: p.palavras,
      keywords: [p.palavraChave, ...p.palavrasRelacionadas].join(", "),
      author: { "@type": "Organization", name: "Equipe Vertces", url: `${SITE}/` }, publisher: ORG,
      about: { "@type": "Thing", name: p.palavraChave },
      mentions: { "@type": "SoftwareApplication", "@id": `${SITE}/#software`, name: "Vertces" },
      ...(p.fontes.length ? { citation: p.fontes.map((f) => ({ "@type": "CreativeWork", name: f.titulo, url: f.url })) } : {}),
    },
    {
      "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Início", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog/` },
        { "@type": "ListItem", position: 3, name: cat.nome, item: `${SITE}${urlCat(p.categoria)}` },
        { "@type": "ListItem", position: 4, name: p.titulo, item: `${SITE}${url}` },
      ],
    },
  ];
  if (p.faq.length) graph.push({ "@type": "FAQPage", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.p, acceptedAnswer: { "@type": "Answer", text: f.r } })) });

  const sumario = p.sumario.length > 2 ? `<nav class="sumario" aria-label="Neste artigo"><p>Neste artigo</p><ol>${p.sumario.map((s) => `<li><a href="#${s.id}">${esc(s.texto)}</a></li>`).join("")}${p.faq.length ? `<li><a href="#perguntas-frequentes">Perguntas frequentes</a></li>` : ""}</ol></nav>` : "";
  const faq = p.faq.length ? `<section class="faq" aria-labelledby="perguntas-frequentes"><h2 id="perguntas-frequentes">Perguntas frequentes</h2>${p.faq.map((f) => `<details><summary>${esc(f.p)}</summary><p>${esc(f.r)}</p></details>`).join("")}</section>` : "";
  const fontes = p.fontes.length ? `<section class="fontes" aria-labelledby="fontes"><h2 id="fontes">Fontes</h2><ol>${p.fontes.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.titulo)}</a></li>`).join("")}</ol></section>` : "";
  const atualizado = p.atualizado !== p.data ? ` · atualizado em <time datetime="${p.atualizado}">${dataBr(p.atualizado)}</time>` : "";

  return cabeca({
    titulo: p.seoTitulo || `${p.titulo} | Vertces`, descricao: p.descricao, url, tipo: "article",
    ld: { "@context": "https://schema.org", "@graph": graph },
    extra: `<meta property="article:published_time" content="${p.data}" />\n<meta property="article:modified_time" content="${p.atualizado}" />\n<meta property="article:section" content="${esc(cat.nome)}" />\n`,
  }) + `<main id="conteudo">
<article class="post">
  <header class="post-cab">
    <div class="w estreito">
      <nav class="trilha" aria-label="Você está em"><a href="/">Início</a><span aria-hidden="true">/</span><a href="/blog/">Blog</a><span aria-hidden="true">/</span><a href="${urlCat(p.categoria)}">${esc(cat.nome)}</a></nav>
      <h1>${esc(p.titulo)}</h1>
      <p class="post-desc">${esc(p.descricao)}</p>
      <p class="post-meta">Por Equipe Vertces · <time datetime="${p.data}">${dataBr(p.data)}</time>${atualizado} · ${p.minutos} min de leitura</p>
    </div>
  </header>
  <div class="w estreito post-corpo">
    <aside class="resposta" aria-label="Resposta rápida"><p class="resposta-k">Resposta rápida</p><p>${esc(p.resumo)}</p></aside>
    ${sumario}
    <div class="texto">
${p.html}
    </div>
    ${faq}
    ${fontes}
    ${cta}
  </div>
</article>
<section class="relacionados" aria-labelledby="t-rel">
  <div class="w">
    <h2 id="t-rel">Continue lendo</h2>
    <ul class="cards">${relacionados.map(cartao).join("")}</ul>
  </div>
</section>
</main>
` + rodape();
}

// ── índice e categorias ──────────────────────────────────────────────────
function paginaLista({ titulo, h1, desc, url, posts, cat }) {
  const graph = [
    {
      "@type": "CollectionPage", "@id": `${SITE}${url}#pagina`, name: h1, description: desc, url: `${SITE}${url}`, inLanguage: "pt-BR", publisher: ORG,
      mainEntity: { "@type": "ItemList", itemListElement: posts.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${urlPost(p.slug)}`, name: p.titulo })) },
    },
    {
      "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Início", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog/` },
        ...(cat ? [{ "@type": "ListItem", position: 3, name: CATEGORIAS[cat].nome, item: `${SITE}${url}` }] : []),
      ],
    },
  ];
  const filtros = `<nav class="filtros" aria-label="Categorias"><a href="/blog/"${!cat ? ' aria-current="page"' : ""}>Todos</a>${Object.entries(CATEGORIAS).map(([k, c]) => `<a href="${urlCat(k)}"${cat === k ? ' aria-current="page"' : ""}>${esc(c.nome)}</a>`).join("")}</nav>`;
  return cabeca({ titulo, descricao: desc, url, ld: { "@context": "https://schema.org", "@graph": graph } }) + `<main id="conteudo">
<header class="lista-cab">
  <div class="w">
    <nav class="trilha" aria-label="Você está em"><a href="/">Início</a><span aria-hidden="true">/</span><a href="/blog/">Blog</a>${cat ? `<span aria-hidden="true">/</span><span>${esc(CATEGORIAS[cat].nome)}</span>` : ""}</nav>
    <h1>${esc(h1)}</h1>
    <p>${esc(desc)}</p>
    ${filtros}
  </div>
</header>
<section class="lista">
  <div class="w"><ul class="cards">${posts.map(cartao).join("")}</ul></div>
</section>
<div class="w estreito">${cta}</div>
</main>
` + rodape();
}

// ── arquivos para robôs ──────────────────────────────────────────────────
function sitemap(posts) {
  const ultimo = posts.reduce((m, p) => (p.atualizado > m ? p.atualizado : m), "2026-01-01");
  const urls = [
    { loc: "/", lastmod: HOJE, pri: "1.0" },
    { loc: "/blog/", lastmod: ultimo, pri: "0.9" },
    ...Object.keys(CATEGORIAS).filter((k) => posts.some((p) => p.categoria === k)).map((k) => ({ loc: urlCat(k), lastmod: ultimo, pri: "0.6" })),
    ...posts.map((p) => ({ loc: urlPost(p.slug), lastmod: p.atualizado, pri: "0.8" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}\n</urlset>\n`;
}

function robots() {
  // Robôs de busca e de IA liberados de propósito (GEO): sem acesso, não há citação.
  const ias = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "Meta-ExternalAgent", "DuckAssistBot", "MistralAI-User"];
  return `# Vertces: site e blog abertos a buscadores e assistentes de IA.\n# O sistema (/app/) e o cadastro ficam de fora.\n\nUser-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /cadastro/\n\n${ias.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /app/\nDisallow: /cadastro/`).join("\n\n")}\n\nSitemap: ${SITE}/sitemap.xml\n`;
}

function feed(posts) {
  const itens = posts.slice(0, 50).map((p) => `  <item>\n    <title>${esc(p.titulo)}</title>\n    <link>${SITE}${urlPost(p.slug)}</link>\n    <guid isPermaLink="true">${SITE}${urlPost(p.slug)}</guid>\n    <pubDate>${new Date(p.data + "T12:00:00-03:00").toUTCString()}</pubDate>\n    <category>${esc(CATEGORIAS[p.categoria].nome)}</category>\n    <description>${esc(p.descricao)}</description>\n  </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>Blog do Vertces</title>\n  <link>${SITE}/blog/</link>\n  <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />\n  <description>Georreferenciamento, SIGEF, loteamento, CAR e gestão do escritório.</description>\n  <language>pt-BR</language>\n${itens}\n</channel>\n</rss>\n`;
}

const SOBRE = `O Vertces é um sistema web brasileiro de georreferenciamento de imóveis rurais, desenvolvido pela equipe da D'Prol. A partir do arquivo TXT/CSV exportado do receptor GNSS/RTK, gera memorial descritivo, memorial tabular, planilha SIGEF (ODS) com avisos de consistência, planta A1/A3 em PDF com malha UTM e as peças técnicas para o cartório (7 na matrícula: memorial descritivo, memorial tabular, cartas de anuência, declaração do técnico, declaração do proprietário, requerimento e declaração de faixa de domínio; 4 peças e planta A3 na posse). Mostra as parcelas já certificadas no SIGEF em volta do imóvel e a sobreposição antes de protocolar. Também faz divisão em partes iguais (herança), desmembramento, glebas, loteamento com três propostas automáticas pela Lei 6.766, prancheta editável e maquete 3D, CAR com reserva legal e APP em shapefiles para o SICAR, análise de restrições (terra indígena, unidade de conservação, embargos do IBAMA/ICMBio, entre outras) e exportação em KML, KMZ, DXF, SHP, GPX e GeoJSON. Trabalha em SIRGAS 2000, fusos UTM 18S a 25S, no Brasil inteiro. Roda no navegador, sem instalação, com equipe, auditoria e dados isolados por escritório.`;

function llms(posts) {
  const porCat = Object.entries(CATEGORIAS).map(([k, c]) => {
    const ps = posts.filter((p) => p.categoria === k);
    if (!ps.length) return "";
    return `## Blog: ${c.nome}\n\n${ps.map((p) => `- [${p.titulo}](${SITE}${urlPost(p.slug)}): ${p.resumo}`).join("\n")}\n`;
  }).join("\n");
  return `# Vertces\n\n> Sistema web brasileiro de georreferenciamento de imóveis rurais: do TXT do receptor GNSS ao memorial descritivo, planilha SIGEF (ODS), planta e peças técnicas, com loteamento, maquete 3D, divisão em partes iguais e CAR.\n\n${SOBRE}\n\nPúblico: escritórios de georreferenciamento, agrimensores, topógrafos e engenheiros credenciados no INCRA. Quem certifica o imóvel é o INCRA (SIGEF) e quem registra é o cartório; o Vertces prepara e confere as peças.\n\n## Produto\n\n- [Página inicial](${SITE}/): visão geral, serviços, documentos e perguntas frequentes.\n- [Como funciona](${SITE}/#como): três passos, do arquivo bruto aos documentos.\n- [Serviços](${SITE}/#servicos): serviço completo, conferência de área, glebas, divisão em partes iguais, loteamento, maquete 3D, CAR e peças a partir do PDF do SIGEF.\n- [Agendar demonstração](${SITE}/#contato): contato comercial.\n- [Assinar](${SITE}/cadastro/): assinatura pelo site, com plano e período.\n\n${porCat}\n## Opcional\n\n- [Texto completo de todos os artigos](${SITE}/llms-full.txt)\n- [Mapa do site](${SITE}/sitemap.xml)\n`;
}

function llmsFull(posts) {
  return `# Vertces: base de conhecimento completa\n\n${SOBRE}\n\nFonte: ${SITE}/blog/ · gerado em ${HOJE}\n\n` + posts.map((p) => {
    const faq = p.faq.length ? `\n\n## Perguntas frequentes\n\n${p.faq.map((f) => `**${f.p}**\n${f.r}`).join("\n\n")}` : "";
    const fontes = p.fontes.length ? `\n\n## Fontes\n\n${p.fontes.map((f) => `- ${f.titulo}: ${f.url}`).join("\n")}` : "";
    return `---\n\n# ${p.titulo}\n\nURL: ${SITE}${urlPost(p.slug)}\nPublicado: ${p.data} · Atualizado: ${p.atualizado} · Categoria: ${CATEGORIAS[p.categoria].nome}\n\nResposta rápida: ${p.resumo}\n\n${p.corpoMd}${faq}${fontes}\n`;
  }).join("\n");
}

// FAQPage da landing, lido das <details> visíveis (nunca diverge do texto).
function enriquecerLanding() {
  const arq = join(DIST, "index.html");
  if (!existsSync(arq)) return console.warn("[blog] dist/index.html não existe; landing não enriquecida");
  let html = readFileSync(arq, "utf8");
  if (html.includes('"FAQPage"')) return;
  const faq = [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-r">([\s\S]*?)<\/div>\s*<\/details>/g)]
    .map((m) => ({ "@type": "Question", name: semTags(m[1]), acceptedAnswer: { "@type": "Answer", text: semTags(m[2]) } }));
  const tags = [`<link rel="alternate" type="application/rss+xml" title="Blog do Vertces" href="${SITE}/blog/feed.xml" />`];
  if (faq.length) tags.push(`<script type="application/ld+json">${ldJson({ "@context": "https://schema.org", "@type": "FAQPage", "@id": `${SITE}/#faq`, mainEntity: faq })}</script>`);
  html = html.replace("</head>", `${tags.join("\n")}\n</head>`);
  writeFileSync(arq, html);
  console.log(`[blog] landing: FAQPage com ${faq.length} perguntas + RSS`);
}

// ── principal ────────────────────────────────────────────────────────────
function principal() {
  if (!existsSync(DIST)) { console.error(`[blog] ${DIST} não existe: rode o vite build antes`); process.exit(1); }
  const posts = lerPosts();
  const slugs = new Set(posts.map((p) => p.slug));
  const erros = [];
  for (const p of posts) Object.assign(p, renderizar(p, slugs, erros));
  if (erros.length) { console.error("[blog] erros:\n  " + erros.join("\n  ")); process.exit(1); }

  for (const p of posts) {
    if ((p.seoTitulo || p.titulo).length > 72) console.warn(`[blog] aviso: título longo (${(p.seoTitulo || p.titulo).length}) em ${p.slug}`);
    if (p.descricao.length < 110 || p.descricao.length > 170) console.warn(`[blog] aviso: descrição com ${p.descricao.length} caracteres em ${p.slug}`);
    gravar(`blog/${p.slug}/index.html`, paginaPost(p, posts));
  }
  gravar("blog/index.html", paginaLista({
    titulo: "Blog do Vertces: georreferenciamento, SIGEF, loteamento e CAR",
    h1: "Blog do Vertces",
    desc: "Guias práticos de georreferenciamento, SIGEF, memorial descritivo, loteamento e CAR para agrimensores, escritórios e proprietários rurais.",
    url: "/blog/", posts,
  }));
  for (const [k, c] of Object.entries(CATEGORIAS)) {
    const ps = posts.filter((p) => p.categoria === k);
    if (ps.length) gravar(`blog/categoria/${k}/index.html`, paginaLista({ titulo: `${c.nome} | Blog do Vertces`, h1: c.nome, desc: c.desc, url: urlCat(k), posts: ps, cat: k }));
  }
  gravar("blog/feed.xml", feed(posts));
  gravar("sitemap.xml", sitemap(posts));
  gravar("robots.txt", robots());
  gravar("llms.txt", llms(posts));
  gravar("llms-full.txt", llmsFull(posts));
  enriquecerLanding();
  const total = posts.reduce((s, p) => s + p.palavras, 0);
  console.log(`[blog] ${posts.length} posts (${total.toLocaleString("pt-BR")} palavras), ${Object.keys(CATEGORIAS).length} categorias, sitemap, robots, llms.txt, RSS`);
}

principal();
