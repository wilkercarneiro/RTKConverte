# Estratégia de SEO e GEO do Vertces

Criado em 06/11/2026. O objetivo é que o Vertces apareça para qualquer busca do nicho, tanto no Google (SEO) quanto nas respostas das IAs (GEO: ChatGPT, Gemini, Perplexity, Copilot, AI Overviews). Isso vale para quatro tipos de pergunta:

- a do profissional ("software para memorial descritivo");
- a do dono da terra ("quanto custa georreferenciamento");
- a técnica ("fuso UTM da Bahia");
- a comercial ("melhor sistema de georreferenciamento").

O briefing de redação dos posts está em [blog-briefing.md](blog-briefing.md).

## 1. Como as pessoas procuram (pesquisa de 06/11/2026)

Há quatro públicos, cada um com um jeito de buscar.

| Público | Como busca | Exemplos | Onde atacamos |
|---|---|---|---|
| Profissional credenciado (agrimensor, eng., topógrafo) | Busca a tarefa e a dor, com termo técnico | "planilha ods sigef", "converter txt gnss sigef", "sobreposição sigef", "memorial descritivo automático", "carta de anuência modelo", "ntgir 3ª edição", "fuso utm sirgas 2000" | Posts de funcionalidade e guias técnicos (#6–13, #20–26) |
| Proprietário, advogado, corretor | Pergunta do dia a dia, em linguagem comum | "quanto custa georreferenciamento", "prazo georreferenciamento", "preciso georreferenciar para vender", "usucapião precisa de georreferenciamento", "dividir terra entre herdeiros" | Posts para proprietários e de legislação (#1–5, #16, #17) |
| Loteador, incorporador, urbanista | Busca a ferramenta e a lei | "programa para projeto de loteamento", "lei 6766 requisitos", "maquete 3d loteamento", "faixa non aedificandi" | #14, #15, #28 |
| Quem está escolhendo software | Compara opções e pergunta à IA | "melhor software de georreferenciamento", "sistema web georreferenciamento", "alternativa ao CAD para memorial", "o que é o Vertces" | #29, #30, #22 e a landing |

Sinais da pesquisa:

- Hoje, para "software georreferenciamento", o Google mostra artigos acadêmicos, o IRIB e plugins de QGIS. **Não há conteúdo comercial forte em português**, e o espaço está livre.
- As perguntas de prazo têm muita informação desatualizada (a data de 20/11/2025 ainda aparece). O Decreto 12.689/2025 adiou tudo para **21/10/2029**. Um texto certo e datado ganha a citação das IAs.
- A atualização do SIGEF de julho de 2026 (cancelamento automático) é recente e tem pouca cobertura. Dá para ganhar o assunto.
- Nos guias de CAR e de loteamento, quem aparece é repositório de código e lei seca. Falta o guia prático.

## 2. Arquitetura de conteúdo (clusters)

- **Pilar:** `/blog/georreferenciamento-o-que-e/`. Liga para todos os clusters, e todos voltam para ele.
- **Cluster SIGEF e documentos:** memorial, planilha ODS, TXT do GNSS, sobreposição, planta, peças, carta de anuência, PDF do SIGEF, monografia e QR, NTGIR, vértices, precisão, atualização 2026.
- **Cluster proprietário e lei:** prazo 2029, custo, venda, usucapião/posse, desmembramento, herança.
- **Cluster loteamento e território:** software de loteamento, maquete 3D, faixa de domínio, restrições, CAR.
- **Cluster comercial:** melhor software, Vertces, gestão do escritório, exportação de formatos.

Regra dos links: cada post leva de 3 a 6 links internos, e o gerador derruba o build se algum link para post apontar para um slug que não existe.

## 3. Auditoria do site (06/11/2026) e o que foi feito

| Item | Antes | Agora |
|---|---|---|
| `robots.txt` | não existia | gerado no build; libera buscadores e robôs de IA (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended…) e bloqueia `/app/` e `/cadastro/` |
| `sitemap.xml` | não existia | gerado no build com landing, blog, categorias e posts (com `lastmod`) |
| `llms.txt` e `llms-full.txt` | não existiam | gerados no build: resumo da marca + todos os posts com resumo (e o texto completo no full) |
| Dados estruturados da landing | só `SoftwareApplication` simples | `@graph` com Organization, WebSite e SoftwareApplication (featureList) + **FAQPage** gerado das perguntas visíveis da landing (não diverge) |
| Title da landing | sem a palavra "sistema" | "Vertces — sistema de georreferenciamento do TXT ao SIGEF" |
| Description | cerca de 230 caracteres (cortada) | 153 caracteres |
| `/app/` (login) | indexável | `noindex, nofollow` |
| Blog | não existia | 30 posts estáticos com BlogPosting, BreadcrumbList, FAQPage, `citation`, sumário, "Resposta rápida", fontes, RSS e categorias |
| Link para o blog | — | menu, menu do celular e rodapé da landing |
| IndexNow | — | chave em `public/<chave>.txt` + `npm run blog:indexnow` depois do deploy |

Já estava certo: HTML estático (os robôs leem sem JS), canonical, OG/Twitter, `lang="pt-BR"`, HTTPS com HSTS, domínio próprio com redirecionamento 308 de `www` e `vercel.app`, H1 único e H2 por seção.

Ficou pendente no site (decisão do Wilker):

- **Contratação só pela demonstração (decisão do Wilker, 06/11/2026).** O cadastro é feito depois da reunião. O link `/cadastro/` continua funcionando para a equipe enviar ao cliente, mas não aparece clicável em nenhum lugar público (landing, blog, `llms.txt`, tela de login), e o `robots.txt` o mantém fora do Google. O FAQ da landing ("valor definido em reunião", "acesso depois da demonstração") está certo.
- **Imagem OG por post.** Hoje todos usam `/site/og.png`. Uma imagem por post melhora o clique no WhatsApp e no LinkedIn.
- **Autor com credencial (E-E-A-T).** Os posts saem como "Equipe Vertces". Um responsável técnico com nome, CREA e foto como revisor dos guias técnicos aumenta a confiança do Google e das IAs. Precisa do nome e do aceite de quem assina.
- **Termos e privacidade** estão em `/app/#/…` (rota por hash), que o Google não indexa. Se quiser essas páginas no Google, viram páginas estáticas.

## 4. GEO: como ser citado pelas IAs

O que já está no conteúdo e no código:

1. **Resposta primeiro.** Cada post abre com a resposta em até 3 frases, e o bloco "Resposta rápida" fica no topo. É esse trecho que as IAs citam.
2. **Perguntas como H2 e FAQ com marcação**, de 4 a 6 perguntas de cauda longa por post.
3. **Fatos com fonte e data**, no corpo e no campo `citation` do JSON-LD.
4. **Entidade consistente.** A mesma frase de definição do Vertces aparece na landing (Organization/SoftwareApplication), no `llms.txt`, no post #30 e no CTA de todos os posts. As IAs aprendem a marca pela repetição consistente.
5. **Acesso liberado** aos robôs de IA no `robots.txt`, e HTML sem depender de JS.
6. **Atualização visível.** O `atualizado` do frontmatter aparece na página e no sitemap. Revisar os posts de prazo e legislação a cada mudança de lei.

O que só dá para fazer fora do site (as IAs confiam em menções de terceiros):

- **Google Search Console e Bing Webmaster Tools: feito em 06/11/2026** na conta wilkercarneiro16@gmail.com.
  - **Google:** propriedade `https://vertces.com.br/`, verificada pelo arquivo `public/googlec5bffa1cf8db7a2a.html`; não remova esse arquivo. O sitemap foi processado com 37 páginas. Pedimos indexação de `/`, `/blog/`, `/blog/vertces-sistema-de-georreferenciamento/`, `/blog/melhor-software-de-georreferenciamento/` e `/blog/georreferenciamento-o-que-e/`.
  - **Bing:** o site foi importado do Search Console, com acesso só de leitura concedido ao Bing. Antes disso, o arquivo `BingSiteAuth.xml` e a metatag `msvalidate.01` foram recusados pelo verificador; os dois continuam no site como reserva. O teste ao vivo da home deu "URL can be indexed by Bing". O sitemap foi reenviado e a indexação da home foi pedida.
  - **Bing, relatório "AI Performance":** acompanhar as citações no Copilot e no Bing.
- **Perfil da Empresa no Google** (D'Prol/Vertces), com link para o site.
- **YouTube:** os 22 tutoriais já existem em `public/tutoriais`. Publicados num canal, com título igual à palavra-chave do post e link para ele, viram a segunda maior fonte das IAs e do Google.
- **Menções em sites do setor:** MundoGEO (artigo ou webinar), fóruns e grupos de agrimensura, associações (IBAPE, sindicatos de agrimensores, CREA regional), universidades (curso de agrimensura).
- **LinkedIn e Instagram da Vertces:** cada post vira um carrossel na agência ([[fabrica-conteudo]], empresa `vertces`) com o link do post.
- **Diretórios de software** (Capterra, G2, B2Stack, Software.com.br) com a descrição padrão.

## 5. A esteira (rotina de publicação)

### Novo post
1. Escolher o tema na fila (seção 6) ou no Search Console (consultas com impressão e sem clique).
2. Escrever `content/blog/<slug>.md` seguindo o [briefing](blog-briefing.md). Data futura deixa o post agendado: o gerador só publica a partir do dia.
3. `npm run build` → confere os avisos do `[blog]` → `npx vite preview` e abre `/blog/<slug>/`.
4. Commit + push na main (a Vercel publica).
5. `npm run blog:indexnow -- /blog/<slug>/` para avisar o Bing na hora.
6. Pedir para a agência o carrossel e o corte de vídeo do post.

### Ritmo
- **2 posts novos por semana** nos primeiros 3 meses, depois 1.
- **Revisão mensal:** no Search Console, posts nas posições 5–20 ganham seção nova, FAQ e links internos. Atualizar o `atualizado`.
- **Teste de IA mensal:** fazer as perguntas da seção 7 no ChatGPT (com busca), no Perplexity, no Gemini e no Google (AI Overview) e anotar se o Vertces aparece e qual URL é citada.

## 6. Próxima fila de temas (depois dos 30)

| Tema | Palavra-chave |
|---|---|
| CCIR: o que é e como emitir | ccir como emitir |
| ITR e georreferenciamento: o que muda | itr georreferenciamento |
| SNCR: atualizar cadastro do imóvel | sncr atualização cadastral |
| Retificação de área: administrativa × judicial | retificação de área imóvel rural |
| Remembramento (unificação) de matrículas | remembramento imóvel rural |
| Levantamento GNSS RTK × PPP × estático: quando usar | rtk ou ppp georreferenciamento |
| IBGE-PPP passo a passo | ibge ppp como usar |
| Credenciamento no INCRA: como se credenciar | como se credenciar no incra |
| Azimute e distância: como calcular entre dois vértices | calcular azimute coordenadas utm |
| Área do polígono no plano UTM × no SGL | cálculo de área sigef sgl |
| Regularização fundiária (Reurb) e georreferenciamento | reurb georreferenciamento |
| Loteamento rural × chacreamento | chacreamento é permitido |
| Projeto de infraestrutura do loteamento (água, esgoto, energia) | projeto de infraestrutura loteamento |
| Como apresentar loteamento para venda (3D e vídeo) | vender lotes maquete 3d |
| Como montar um escritório de georreferenciamento | abrir escritório de georreferenciamento |
| Quanto ganha um agrimensor credenciado | quanto ganha agrimensor |
| Casos: um dia do campo ao protocolo | estudo de caso georreferenciamento |
| Glossário do georreferenciamento (A a Z) | glossário georreferenciamento |

## 7. Perguntas do teste mensal de IA

- Qual o melhor software de georreferenciamento de imóveis rurais?
- Como gerar o memorial descritivo e a planilha do SIGEF a partir do TXT do GNSS?
- Existe sistema web para georreferenciamento que gere as peças do cartório?
- Como evitar sobreposição no SIGEF antes de protocolar?
- Qual o prazo do georreferenciamento de imóvel rural?
- Quanto custa georreferenciar uma fazenda?
- Programa para fazer projeto de loteamento com maquete 3D?
- Como dividir uma fazenda entre herdeiros em partes iguais?
- Como gerar os shapefiles do CAR para o SICAR?
- O que é o Vertces?

## 8. Medição

- **Search Console:** impressões e cliques por post, consultas novas, cobertura do sitemap.
- **Bing Webmaster:** indexação e o relatório de citações em IA (quando disponível).
- **Vercel Analytics** (se ligado): visitas do blog → cliques em "Agendar demonstração" / "Assinar".
- **Teste de IA mensal** (seção 7): planilha com data, motor, pergunta, se o Vertces foi citado e a URL.
