# Plano de reestruturação — três modalidades de serviço

Base: [AUDITORIA-ARQUITETURA.md](AUDITORIA-ARQUITETURA.md). Nada aqui foi
implementado ainda.

## Decisões fechadas

| Questão | Decisão |
|---|---|
| O que é "gleba" | Sub-polígonos desenhados DENTRO do perímetro — uma planta, N glebas |
| Conferência consome numeração oficial? | **Não.** Códigos provisórios; a alocação oficial só acontece se virar serviço completo |
| Serviço 2 (peças do PDF do SIGEF) | Mantido como entrada secundária, fora dos três cartões |
| "Memória tabular" da conferência | O **Memorial Tabular DOCX** (peça 2), alimentado pelo cálculo do sistema |

## Princípio inegociável

> **`modalidade = 'completo'` e `tem_glebas = false` tem de executar exatamente o
> mesmo código de hoje.** Toda ramificação nova entra como guarda que, desligada,
> devolve o caminho atual byte a byte.

Consequências práticas:

- Nenhuma assinatura existente de função do motor muda de forma incompatível —
  campos novos entram **opcionais**, com o `undefined` reproduzindo o
  comportamento atual (é assim que a folha A4 entra sem tocar em A1/A3).
- Nenhum `if (tipo === 'pecas')` existente é reescrito. `tipo` continua
  significando "de onde vêm os dados".
- Cada fase entra e é publicada sozinha; se uma quebrar, as anteriores seguem.

## Modelo de dados

Modalidade e glebas são **eixos independentes** — foi isso que decidiu não criar
um caminho novo para gleba (ver §5 da auditoria):

```sql
alter table servicos
  add column modalidade text not null default 'completo',
  add column tem_glebas boolean not null default false;

alter table servicos
  add constraint servicos_modalidade_check
  check (modalidade in ('completo','conferencia'));

create table glebas (
  id         uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  ordem      int  not null,
  nome       text not null,
  -- anel em coordenadas UTM do fuso do serviço: [[e,n], ...]
  anel       jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
create index on glebas (servico_id);
```

Os três cartões da tela são combinações, não três tipos:

| Cartão | `modalidade` | `tem_glebas` |
|---|---|---|
| Serviço completo | `completo` | `false` |
| Conferência de área | `conferencia` | `false` |
| Serviço com gleba | `completo` | `true` |

Todos os serviços de hoje caem em `('completo', false)` pelo default — **zero
migração de dados**.

---

## Fase 0 — Fundação (aditiva, risco zero)

Nada ramifica ainda; só passa a existir.

- migration acima;
- `src/lib/types.ts`: `modalidade`, `tem_glebas` em `Servico`; interface `Gleba`;
- teste garantindo que serviço sem `modalidade` explícita continua `completo`.

**Risco:** nenhum. Colunas com default, tabela nova sem leitor.

---

## Fase 1 — Casca e navegação

Nova estrutura de tela, mesmo motor por baixo.

- `src/App.tsx` — roteamento por hash (`#/inicio`, `#/clientes`, `#/servicos`,
  `#/servico/:id`, `#/config`). Hoje é `useState`: atualizar a página perde a
  tela e o botão voltar do navegador não funciona.
- `src/components/AppShell.tsx` **(novo)** — barra superior fixa: logo ·
  Clientes · Serviços · Configurações · Sair.
- `src/components/Inicio.tsx` **(novo)** — os três cartões + linha secundária
  "já tenho o PDF do SIGEF → peças técnicas".
- `Dashboard.tsx` se parte em `Clientes.tsx` e `Servicos.tsx` (as duas abas de
  hoje viram telas de primeiro nível). A lista, o filtro, a barra de progresso e
  o cartão "continuar de onde parou" são movidos, não reescritos.
- `ClientePage.tsx` — passa a receber uma única prop `onNovoServico(modalidade)`
  no lugar de `onNovoGeo`/`onNovoPecas`. Hoje cada modalidade nova precisa ser
  plugada em dois lugares (§1 da auditoria).

Os três cartões, nesta fase, **caem todos no fluxo atual** — só gravam
`modalidade`/`tem_glebas` no serviço. A conferência ainda se comporta como
completo; é a Fase 2 que a diferencia.

**Risco:** médio-baixo, e todo no front-end. O motor não é tocado. Erro aqui é
visível na hora (tela não abre), não corrompe documento.

---

## Fase 2 — Conferência de área

### 2.1 Códigos provisórios

`gerar-documentos` hoje chama a RPC `alocar_contadores`, que incrementa os
contadores do credenciado de forma irreversível (§4.2 da auditoria).

- quando `modalidade = 'conferencia'`, **pular a RPC** e alocar com prefixo
  provisório (`PROV-M-001`…), sem tocar em `credenciados`;
- ao promover uma conferência a serviço completo: limpar `codigo` dos vértices
  não-manuais e deixar a alocação oficial rodar normalmente;
- os documentos da conferência saem marcados como **PRÉVIA** — um memorial com
  código provisório não pode ser confundido com o oficial.

### 2.2 Etapas ocultas

Na `Conferencia`, quando `modalidade = 'conferencia'`: escondem-se os blocos
`bloco-sigef`, `bloco-planta` e `bloco-pecas`, e a trilha de `Passos` cai de 5
para 3. Não é `display:none` — os blocos não são montados, para que nenhum
handler de SIGEF fique acessível.

### 2.3 Folha A4

`planta.ts` já desenha **sempre** em A1 e reduz no fim (§4.3 da auditoria).

- `DadosPlanta.folha?: "A1" | "A3" | "A4"`;
- `undefined` → regra atual (`posse ? "A3" : "A1"`), preservando tudo que existe;
- A4 = fator `min(297/841, 210/594) ≈ 0,3531`;
- rodapé `"01 001 A4"`.

### 2.4 Memorial Tabular sem PDF do SIGEF

`gerar-pecas` exige `pdf_base64` na linha 54, e a peça 2 é montada a partir de
`LinhaSigef[]`.

A boa notícia é que `LinhaSigef` (`codigo`, `lon`, `lat`, `alt`, `vante`,
`azimute`, `dist`, `confrontacao`) tem **correspondência 1:1** com o que
`geometriaDoCalculo` já produz para a planta (`VerticePlanta`). O trabalho é um
adaptador `sigefDoCalculo(calc, servico, rt, cred)` — dezenas de linhas, não um
gerador novo — e liberar o `pdf_base64` obrigatório quando a origem é o cálculo.

> **Ressalva a registrar no documento gerado:** azimutes e distâncias do cálculo
> saem do plano re-projetado do sistema (`calcularSegmentos`), que é a mesma
> fonte do Memorial Descritivo que o sistema já emite — mas **não** são os
> valores SGL que o SIGEF devolve depois de certificar. Por isso o tabular da
> conferência sai carimbado como prévia, e o fluxo completo continua regerando a
> partir do PDF.

**Risco:** o item 2.1 é o delicado — mexe na função que gera memorial e planilha
do fluxo que funciona. Mitigação: a ramificação é `if (modalidade === 'conferencia')`
em volta de um bloco que hoje já é condicional (`precisaAlocar`), e entra com
teste que prova que um serviço `completo` continua alocando igual.

---

## Fase 3 — Glebas

A parte mais cara, e a única que mexe no desenho.

### 3.1 Editor

Novo bloco em `Conferencia`, entre confrontantes e a geração da planta, montado
só quando `tem_glebas`. Cada gleba: nome, anel de pontos, área calculada.
Entrada dos pontos: seleção de vértices existentes do perímetro + pontos livres
(E/N), reaproveitando o `MapaSVG` para visualizar.

### 3.2 Desenho

- `DadosPlanta.glebas?: { nome: string; areaFmt: string; anel: { e: number; n: number }[] }[]`;
- nova passada em `planta.ts` **depois** do polígono principal: contorno de cada
  gleba, rótulo com nome e área no centroide;
- as linhas das glebas entram em `obstaculos`, senão os rótulos de confrontante
  passam por cima delas;
- **o enquadramento não muda**: as glebas são internas ao perímetro, então a
  bounding box continua saindo só de `vs`. É o que mantém a planta do serviço
  completo idêntica.

### 3.3 A decidir na hora

O quadro analítico lista os vértices do perímetro. Se cada gleba precisa do seu
próprio quadro, a folha A1 pode não comportar — isso se resolve com a primeira
planta real, não no papel.

**Risco:** alto, mas **contido**: todo o código novo está atrás de
`if (d.glebas?.length)`. Serviço sem gleba não entra em nenhuma linha nova.

---

## Fase 4 — Deploy e verificação

- `npx supabase functions deploy` das functions tocadas (ver
  `scripts/deploy-functions.sh`);
- conferir o bundle publicado, como em [PLANO-ESTRADAS-PLANTA.md](PLANO-ESTRADAS-PLANTA.md)
  — o deploy manual deste projeto já saiu de sincronia uma vez;
- regerar um serviço `completo` real e comparar com a planta anterior: **tem de
  sair igual**.

---

---

## Execução — 2026-08-07

### O que ficou pronto

| Fase | Estado | Onde |
|---|---|---|
| 0 · fundação | feito | `0011_modalidades_e_glebas.sql` (aplicada), `types.ts`, `tests/nao_regressao_completo.test.mjs` |
| 1 · casca | feito | `AppShell`, `Inicio`, `Clientes`, `Servicos`, `lib/rota.ts`, `lib/modalidades.ts` |
| 2 · conferência | feito | folha A4, códigos `PROV-`, tabular via `sigefDoCalculo`, gate em `Conferencia` |
| 3 · glebas | feito | `GlebasEditor`, tabela `glebas`, desenho em `planta.ts` |
| 4 · deploy | parcial | `gerar-documentos` e `gerar-planta` publicadas; `gerar-pecas` pendente |

Verde em toda parte: **99 testes**, `tsc -b --force`, `deno check` nas três
functions, `vite build`.

### Smoke contra a produção

`scripts/smoke_modalidades.mjs` cria dois serviços descartáveis com o mesmo anel,
gera os documentos dos dois e apaga:

```
CONFERÊNCIA    folha A4 · provisório · PROV-P-0000 · contadores 4554/14416/900 → 4554/14416/900
COMPLETO       folha A1 · oficial    · DSBN-P-14416 · contadores 4554/14416/900 → 4558/14444/900
área idêntica nos dois: 6,7238 ha
```

A conferência não encostou na numeração; o completo consumiu exatamente 4 M e
28 P, como antes da reestruturação.

### Rodada 2 — editor visual e defeitos da primeira planta com glebas

**Editor visual** (`MapaGlebas.tsx` + `lib/glebas.ts`). Montar uma gleba que
acompanha 12 vértices custava 12 cliques numa fileira de chips que não dizia
onde cada vértice ficava. Agora o contorno é montado sobre a própria figura:

| gesto | efeito |
|---|---|
| clique num vértice | acrescenta aquele vértice |
| **shift + clique** | acrescenta o TRECHO INTEIRO até ele, pelo caminho mais curto do perímetro |
| **arrastar no vazio** | retângulo de seleção — entram todos os vértices dentro |
| clique no vazio | ponto livre naquela coordenada |
| arrastar uma alça | move o ponto, grudando no vértice do perímetro a menos de 12 px |
| duplo clique numa alça | remove o ponto |

O mapa desenha as faixas de domínio em vermelho como saem na planta — sem isso
não é reconhecível como a planta e não há razão para confiar nele.

**Divisas sobrepostas.** Desenhar gleba por gleba fazia a divisa entre duas
vizinhas sair duas vezes (o tracejado de uma caindo no vão da outra, parecendo
linha cheia mal impressa) e, sobre a linha dupla vermelha da estrada, três. Agora
cada traço tem uma chave — o par de extremos, sem ordem — e só é desenhado uma
vez. As arestas da poligonal entram já marcadas como usadas: onde a gleba encosta
no perímetro, quem manda é o traço do perímetro.

**Nomes empilhados.** O rótulo ia no centroide, sem olhar o vizinho. Agora
procura lugar entre 25 candidatos em volta do centroide, exige estar DENTRO da
própria gleba (senão o nome de uma acaba dentro da outra, nomeando a errada) e
cede no tamanho — 11 → 9,5 → 8 → 7 pt — antes de ceder na posição.

**Estado preservado entre gerações.** A imagem de satélite e o PDF do SIGEF viviam
só no estado do React: fechar a aba obrigava a reenviar os dois para regerar
qualquer coisa. Passam a morar em `gerados/{servico_id}/entrada/`. A leitura é
preguiçosa — ao abrir a tela só se lista a pasta; o arquivo desce quando for de
fato gerar.

### Pendências

1. ~~`gerar-pecas` precisa de um redeploy.~~ **Resolvido.** O smoke tinha pegado um
   bug de runtime: o filtro `apenas` recortava também o conjunto de TEMPLATES, e
   `gerarPecasXml` lê `tpl["1"]`, `tpl["2"]`… sem guarda — a peça que sobrava
   quebrava por causa das que não foram baixadas. Corrigido (baixa todas, filtra
   na emissão) e publicado; o smoke agora sai com
   `peças: 2 - Memorial Tabular | vértices: 32`.
2. **O smoke queimou numeração real, uma vez.** O teste do serviço completo passa pela RPC
   `alocar_contadores` de verdade — é o que se está provando — e consumiu
   M 4555-4558 e P 14417-14444, que nenhum imóvel usará. Nenhum vértice real está
   nessa faixa (conferido). Para devolver:
   ```sql
   update credenciados set contador_m = 4554, contador_p = 14416, contador_v = 900
   where prefixo_vertice = 'DSBN' and contador_m = 4558 and contador_p = 14444;
   ```
   O script passou a devolver sozinho e já o faz nas corridas seguintes
   (`numeração devolvida: 4575/14601 → 4571/14573`); só a primeira corrida ficou
   sem devolução, e desde então serviços reais avançaram os contadores, então
   aquela faixa não é mais recuperável sem risco. São 4 M e 28 P perdidos.
3. **Front-end não publicado.** `npm run build` passa; o deploy na Vercel continua
   fora deste trabalho.

## Rede de proteção

1. **Teste de não-regressão antes de tudo.** Um teste que roda o fluxo `completo`
   de ponta a ponta (FAZENDA SALGADA VELHA, dados reais já no repositório) e
   fixa área, perímetro, códigos alocados, trechos e nº de arestas de via. Ele
   entra na Fase 0 e roda em todas as outras — é o que prova que nada quebrou.
2. **Uma fase, um deploy.** Nada de publicar as três juntas.
3. **Os 74 testes atuais continuam verdes** em cada fase.
