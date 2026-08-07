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

## Rede de proteção

1. **Teste de não-regressão antes de tudo.** Um teste que roda o fluxo `completo`
   de ponta a ponta (FAZENDA SALGADA VELHA, dados reais já no repositório) e
   fixa área, perímetro, códigos alocados, trechos e nº de arestas de via. Ele
   entra na Fase 0 e roda em todas as outras — é o que prova que nada quebrou.
2. **Uma fase, um deploy.** Nada de publicar as três juntas.
3. **Os 74 testes atuais continuam verdes** em cada fase.
