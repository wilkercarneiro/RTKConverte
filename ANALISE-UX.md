# Revisão de experiência do RTKConverte

Diagnóstico e mudanças aplicadas sob três princípios: **design centrado no
usuário**, **redução de carga cognitiva por divulgação progressiva** e
**interfaces preditivas**.

O usuário aqui é um operador de escritório de georreferenciamento que repete o
mesmo processo dezenas de vezes por mês, sob risco de retrabalho caro (o SIGEF
rejeita e o serviço volta). Isso guiou toda a priorização: **antecipar o próximo
passo** vale mais que enfeite visual, e **não perder trabalho** vale mais que
qualquer atalho.

---

## 1. Problemas encontrados

| # | Problema | Onde | Princípio ferido |
|---|---|---|---|
| 1 | ~25 campos num único grid, dos quais só 5 bloqueiam a geração — o obrigatório competia visualmente com `Lado`, `Parcela número`, `Tipo pessoa` | Conferência bloco 1 | carga cognitiva |
| 2 | Trilha anunciava 5 etapas, mas tudo era uma rolagem só; e havia **duas numerações concorrentes** ("Bloco 3" + "Etapa 2" dentro de um bloco numerado 4) | Conferência | modelo mental |
| 3 | Nada dizia em que ponto do processo o serviço estava nem o que fazer em seguida | Conferência, Peças | preditivo |
| 4 | Sem autossalvamento: uma aba fechada perdia toda a conferência, inclusive a confrontação | Conferência, Peças, Cliente | centrado no usuário |
| 5 | "fuso ambíguo" era só um texto de alerta — não oferecia a decisão | Conferência | preditivo |
| 6 | UF pedida a cada serviço, mesmo com o município já no acervo | Conferência, Upload | preditivo |
| 7 | TRT digitado à mão mesmo existindo TRT padrão no cadastro do RT | Conferência, Peças | preditivo |
| 8 | Feedback só no rodapé fixo; num formulário longo o "salvo" passava batido | todas | visibilidade de estado |
| 9 | `confirm()` nativo para excluir: bloqueia a aba e vira clique reflexo em OK | Dashboard, Cadastros | prevenção de erro |
| 10 | Método de posicionamento: um select por linha — 60 vértices, 60 cliques | Conferência | eficiência |
| 11 | Zona de arraste era `div` com `onClick`: inalcançável por teclado | Upload | acessibilidade |
| 12 | Nenhum `:focus-visible`; linhas de tabela clicáveis sem papel nem teclado | global | acessibilidade |
| 13 | Lista de serviços só distinguia rascunho/gerado — nada sobre planta ou peças | Dashboard | visibilidade |
| 14 | 15 campos de RT/requerente exibidos mesmo vindos do cadastro | Conferência 3B, Peças | carga cognitiva |
| 15 | Sem retomada: reabrir o sistema exigia procurar o serviço em andamento | Dashboard | preditivo |

---

## 2. O que foi implementado

### Primitivas novas

- **[src/components/ui.tsx](src/components/ui.tsx)** — `Secao` (divulgação
  progressiva sobre `<details>` nativo, com selo de preenchimento), `ProximaAcao`,
  `Passos` (trilha navegável), `Avisos` (toasts), `StatusSalvamento`,
  `BotaoPerigo` (confirmação inline) e `irPara`.
- **[src/lib/ux.ts](src/lib/ux.ts)** — `useAutosave`, `useAvisos`,
  `contarPreenchidos`, `inferirUf`, `lembrar`/`guardar`.

Duas decisões que evitam armadilhas conhecidas:

- `Secao` usa `<details>` de propósito: teclado, leitor de tela e o Ctrl+F do
  navegador (que expande a seção ao achar texto dentro) funcionam sem JS.
- `abrirEm` **só abre, nunca fecha**. Fechar por mudança de estado arrancaria a
  seção de baixo do operador no instante em que ele desmarca um checkbox que
  vive lá dentro.

### Divulgação progressiva

Campos obrigatórios **nunca** entram em seção recolhida — a lista de pendências
precisa poder apontar para algo visível. Em Conferência ficaram à vista Cliente,
Credenciado, Detentor, CPF, Denominação, Município e UF; recolheram-se
"Responsável técnico e TRT", "Registro, cartório e natureza" (7 campos),
"Identificação da parcela" (3), "Espólio" e, na etapa de peças, "Segundo
requerente" e "Dados do RT". Cada seção mostra `3 de 7`, o nome do RT ou
`é espólio` no selo, então não é preciso abrir para saber o que tem dentro.
Peças técnicas e a página do Cliente receberam o mesmo tratamento.

### Interfaces preditivas

- **Cartão "próxima ação"** em Conferência e Peças: calcula o estágio real
  (pendências → gerar documentos → enviar PDF → satélite → planta → peças) e
  entrega o botão daquele passo.
- **UF inferida** do município pelo histórico de serviços, com aviso "sugerida
  pelo histórico — confira" (sugere, não decide sozinho).
- **TRT** preenchido com o do RT escolhido, sem nunca sobrescrever digitação.
- **Fuso ambíguo** virou botões dos candidatos, não um texto de alerta.
- **UF do upload** lembrada entre sessões (`localStorage`).
- **Dashboard**: cartão "continuar de onde parou" com o serviço inacabado mais
  recente e o que falta nele; três marcadores por linha (documentos · planta ·
  peças), derivados de `documentos_gerados` numa consulta só.

### Não perder trabalho

`useAutosave` grava 1,5 s após a última tecla — inclusive os vértices, porque a
confrontação mora neles. **Suspenso enquanto uma rotina do servidor está no ar:**
gerar/corrigir gravam e releem o serviço, e uma escrita concorrente sobrescreveria
o que acabou de voltar. Indicador "salvo 14:32 / salvando… / não salvo" no topo.

### Acessibilidade e prevenção de erro

`:focus-visible` global; `prefers-reduced-motion`; linhas de tabela com
`role`/`tabIndex`/Enter; dropzone do upload alcançável por teclado; `aria-busy`
nas zonas em processamento; `confirm()` nativo substituído por confirmação
inline em Dashboard e Cadastros; botões de planta desabilitados com `title`
explicando o porquê, em vez de falhar depois do clique.

### Eficiência

Método de posicionamento em massa ("aplicar a todos"), sem perder o ajuste por
linha. Em Peças, os trechos sem descritivo ficam com a borda âmbar — a fila de
trabalho fica visível sem contar item por item.

---

## 3. Validação

`npx tsc --noEmit` limpo · `npm run build` OK · 49/49 testes do motor passando
(`node --test tests/*.test.mjs`).

**Não houve verificação visual no navegador** — as mudanças foram validadas por
tipo, build e testes. Vale uma passada manual no fluxo completo de um serviço
real antes de considerar encerrado.

---

## 4. O que ficou de fora

- **Login** não foi tocado (tela de um campo, sem problema identificado).
- **Numeração dos blocos**: os rótulos duplicados ("Etapa 2/3A/3B") saíram, mas
  os blocos de planta e peças seguem numerados 5 e 6 na mesma página — uma
  renumeração completa exigiria decidir se planta e peças são um passo ou dois.
- **Nenhuma máscara de entrada** em CPF/CNPJ, matrícula e CEP: são campos que
  hoje aceitam qualquer formato e vão direto para os documentos. É o próximo
  ganho óbvio de prevenção de erro, mas muda dado que já está gravado — precisa
  de decisão sobre normalizar o acervo existente.
- **Divisão de código** (`bundle` de 597 kB num único chunk) é performance, não
  UX de tela, e ficou fora do escopo desta passada.
