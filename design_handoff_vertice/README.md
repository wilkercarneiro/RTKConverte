# Handoff: Rebrand RTKConverte → Vértice

## Visão geral
Novo nome, identidade visual e layout do sistema de georreferenciamento. Referência viva: `Vértice.dc.html` (abra no navegador; é um protótipo clicável com todas as telas e o guia da marca).

## Sobre os arquivos
- `Vértice.dc.html` + `support.js` — **referência de design** em HTML. Não é código de produção; serve para conferir medidas, cores e comportamento.
- `src/` e `index.html`, `public/favicon.svg` — **arquivos prontos para substituir** os equivalentes no repositório `wilkercarneiro/RTKConverte`. Mantêm todos os nomes de classe existentes, então o restante do app (Conferencia, PecasServico, Clientes…) já recebe o novo visual sem edição.

Fidelidade: **alta** (cores, tipografia, espaçamentos e estados finais).

## Passo a passo
1. Copie `index.html`, `public/favicon.svg`, `src/styles.css`, `src/components/AppShell.tsx`, `src/components/Login.tsx`, `src/components/Logo.tsx` por cima dos atuais.
2. Em `App.tsx`, passe o usuário à casca (opcional): `<AppShell rota={rota} ir={ir} usuario={{ nome: session.user.email }}>`.
3. Troque textos "RTKConverte" restantes por "Vértice" (`README.md`, títulos de documentos se houver).
4. Rode `npm run dev` e percorra as telas; ajustes finos por componente estão listados abaixo.

## Ajustes por componente (para chegar ao protótipo)
- **Inicio.tsx** — trocar `.inicio-cabeca h1` por saudação ("Bom dia, {nome}.") e subtítulo com data + contagem de serviços em andamento; envolver os cartões num `<div>` com `<div className="rotulo-secao">Novo serviço</div>`; adicionar lista "Recentes" reaproveitando a tabela de Servicos (`.tabela-wrap .tabela-vertices.dash-lista`); no cartão `.retomar`, trocar o rótulo textual por `.progresso-servico` (5 pontos: feitos, `.atual`, restantes) + frase "falta …". Ícones dos cartões: substituir emoji por SVG de traço 1.8px dentro de `.cs-icone` (paths no protótipo).
- **Conferencia.tsx** — a mudança principal do redesign: **uma etapa por vez** em vez da rolagem única.
  - Cabeçalho `.topo`: `← Serviços` · `<h1 className="titulo">{denominacao}</h1>` · chip da modalidade · `.arquivo` (nome do TXT) · `StatusSalvamento` · `.esticar` · Fuso UTM. O `<Passos>` entra como último filho do `.topo` (ocupa a linha toda e vira abas).
  - Estado `etapa: "dados" | "confrontantes" | "vertices" | "documentos"`; `Passos` recebe `onClick` que troca a etapa (em vez de `irPara`). Renderizar só o bloco da etapa ativa dentro de `<div className="conferencia-corpo">`; botões "← anterior / próxima →" (`button` e `button.escuro`) no fim de cada etapa.
  - Bloco 1 (Dados): campos obrigatórios em `.grade`; as quatro `<Secao>` agrupadas num `<div className="secoes">` (viram linhas de uma lista).
  - Confrontantes: `.confrontantes` já empilha em telas estreitas; o mapa fica `position: sticky`. Substituir os campos CNS/Matrícula visíveis por uma linha de resumo + link "editar campos" que expande.
  - Vértices: "Método em massa" e "+ Vértice pré-existente" vão para a linha `.acoes-vertices`; a coluna "Tipo" usa `.chip.M/.P/.V` fixo (troca por clique), não `<select>`.
  - Rodapé `.preview`: o parágrafo do memorial fica em 1 linha (`.paragrafo`); um botão "prévia do memorial" alterna `.aberto`.
- **ProximaAcao** — sem mudança de código; agora é a faixa escura.
- **HistoricoDocs.tsx** — sem mudança de código; o CSS reorganiza em grade (versão · data · botões).
- **Upload.tsx** — remover o SVG inline colorido (o CSS já pinta); "← Início" usa `button.fantasma`; adicionar botão "Simular envio" não é necessário (era só do protótipo).
- **Clientes.tsx / Servicos.tsx** — trocar o `<header>` do `.bloco` por `<div className="pagina-cabeca">` com `<h1>`, `.sub` de contagem, `<div className="busca"><svg…/><input/></div>` e o botão principal; remover emojis dos títulos.
- **Configuracoes.tsx** — usar `.pagina` + `.pagina-cabeca` em vez de `.conferencia`/`.topo`.

## Tokens
Cores: floresta #0E3B2B · ação #178552 (hover #126B42) · destaque #7BD3A6 · tinta #E4F3EB · texto #12201A / #5B6B63 / #8A978F · fundo #F4F6F5 · bordas #E3E8E5 / #D5DDD8 · atenção #B7791F (fundo #FBF3E3) · erro #B93A3A (fundo #FBEAEA). Modalidades: Conferência #EAF0FB/#1E40AF, Gleba #F3EAFB/#6B21A8, Peças #FBF3E3/#7A5410.
Tipografia: Bricolage Grotesque 600 (títulos: 44/34/30/22/18px), Figtree 400–700 (UI 14px, rótulos 12.5px 600), Fira Code (coordenadas, códigos, medidas, 13px).
Raios: 9px controles · 12px cartões pequenos · 14px cartões · 999px chips. Sombras quase nulas; destaque por borda.
Barra lateral 232px; conteúdo com padding 40px 48px; grade de formulário `repeat(auto-fit, minmax(200px,1fr))` gap 18px 20px.

## Marca
Nome **Vértice** (alternativas consideradas: Marco, Demarca). Símbolo: três vértices ligados, o do topo em #7BD3A6 (`Logo.tsx`, `favicon.svg`). Frase: "Do levantamento à certificação."
