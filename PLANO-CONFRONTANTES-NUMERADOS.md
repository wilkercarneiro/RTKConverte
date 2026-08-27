# Confrontantes numerados na planta

Objetivo: em divisas curtas o bloco de texto do vizinho fica maior que o vão dele
e os nomes empilham. A saída é o operador marcar confrontantes para saírem
**numerados**: no desenho fica só `1`, `2`, `3`… no meio da divisa, e o texto
completo vai para um **quadro de confrontantes na parte de baixo da planta**.

---

## 1. Auditoria — como está hoje

### Onde a confrontação vive

| Fluxo | Fonte da verdade | Tela |
|---|---|---|
| `geo` (TXT → memorial/planilha/planta) | colunas do próprio vértice **M** em `vertices` (`descritivo`, `apelido_txt`, `tipo_limite`, `eh_via`, `cns`, `matricula`) | [Conferencia.tsx:196-212](src/components/Conferencia.tsx#L196-L212) deriva `trechosOrdenados` dos M |
| `pecas` (PDF do SIGEF → 7 peças) | tabela `trechos_confrontantes`, ancorada por `codigo_inicio` | [PecasServico.tsx:421-455](src/components/PecasServico.tsx#L421-L455) |

`trechos_confrontantes` **não** é usada pelo fluxo `geo` desde a migração
[0002_confrontacao_no_vertice.sql](supabase/migrations/0002_confrontacao_no_vertice.sql).
Ver `ARQUITETURA-TRECHOS.md`.

### Como o rótulo chega ao PDF

1. `montarServico` → `ServicoCalculado.trechosOrdenados` (`TrechoServico`)
   — [servico.ts:36-44,140-160](supabase/functions/_shared/servico.ts#L36-L44)
2. `geometriaDoCalculo` → `TrechoPlanta[]` (`descritivo`, `isEstrada`, `isRio`,
   `inicioIdx`, `fimIdx`) — [planta_dados.ts:130-145](supabase/functions/_shared/planta_dados.ts#L130-L145)
3. Fluxo SIGEF: `montarTrechosDoSigef` → mesma estrutura
   — [reconciliacao.ts:95-140](supabase/functions/_shared/reconciliacao.ts#L95-L140)
4. `gerarPlantaPdf` desenha — [planta.ts:855-1037](supabase/functions/_shared/planta.ts#L855-L1037)

Duas Edge Functions consomem isso: [gerar-planta](supabase/functions/gerar-planta/index.ts)
(planta oficial, pós-SIGEF) e [gerar-documentos](supabase/functions/gerar-documentos/index.ts)
(planta do sistema, pré-SIGEF, com `folha`/`conferencia`/`exibir`/`glebas`).

### O motor de rótulo (a causa do empilhamento)

Em [planta.ts:855-1037](supabase/functions/_shared/planta.ts#L855-L1037):

- trechos **contíguos de mesmo `descritivo`** já viram um rótulo só (`grupos`);
- o bloco é **centrado no meio geométrico** da divisa, empurrado para fora por
  `AFAST = max(22, 5,2% da diagonal)`;
- largura `maxW = min(310, max(90, 0,8 × comprimento da divisa))` — **é aqui que
  a divisa curta obriga a quebrar em muitas linhas**;
- a busca testa `DESLS × AFASTS × ESCALAS` (7 × 10 × 11 = 770 candidatos) e cede
  corpo até 70 %; sem candidato livre cai em `menosPior` — **é o caso que o
  usuário vê: dois blocos altos, um por cima do outro**.

Reduzir o texto a um dígito elimina o problema na raiz: a caixa passa de
~310×90 pt para ~20×20 pt.

### Layout da folha

| | A1 / A3 (`simples = false`) | A4 (`simples = true`, conferência) |
|---|---|---|
| Desenho | `dArea = {x:60, y:60, w: sbX-100, h: H-120}` | `dArea.y = 20 + SELO_H(156) + FAIXA_H(380) + 16` |
| Direita | barra lateral 720 pt: quadro analítico · situação · carimbo · planimétrico · rodapé | — |
| Rodapé | — | carimbo + situação + selo de 6 campos |

Canto inferior esquerdo do desenho já tem `legendaRet` (300 × 124 pt), reservado
em `ocupado` **antes** de posicionar rótulo nenhum — [planta.ts:746-750](supabase/functions/_shared/planta.ts#L746-L750).
É o precedente exato para reservar o quadro novo.

### Precedente de campo opcional por serviço

[0013_conferencia_campos_opcionais.sql](supabase/migrations/0013_conferencia_campos_opcionais.sql)
+ `DadosPlanta.exibir` + `<fieldset>` no bloco de conferência — mesmo padrão a
seguir (default preserva o comportamento antigo).

### Testes existentes

`tests/planta.test.mjs`, `folha_e_glebas.test.mjs`, `rotulos_sem_invadir.test.mjs`,
`nao_regressao_completo.test.mjs`, `planta_conferencia.test.mjs`;
diagnóstico visual em `scripts/diag_rotulos.mjs` (usa `DiagPlanta`).

---

## 2. Decisões de projeto

1. **A marcação é por confrontante, persistida junto da confrontação** — no
   vértice M (`geo`) e no trecho (`pecas`). Nada de estado paralelo.
2. **O número é calculado em `planta.ts`, não no banco.** O banco guarda só o
   booleano `numerado`. Assim os dois fluxos (cálculo e SIGEF) produzem
   exatamente a mesma numeração, e mover/remover um trecho renumera sozinho.
3. **Um número por confrontante distinto**, não por trecho: mesmo `descritivo`
   em duas divisas separadas do anel = mesmo número (o vizinho é um só). Ordem =
   primeira aparição no anel, começando em 1.
4. **Via/rio marcado como numerado é ignorado** — o nome da estrada acompanha o
   traço e não é um bloco de vizinho.
5. **O quadro vai numa faixa reservada no rodapé da área de desenho, calculada
   ANTES da escala.** Não disputa espaço com o motor de colisão; a escala se
   ajusta sozinha. Só existe quando há pelo menos um numerado — planta sem
   numeração sai **byte a byte idêntica**.

---

## 3. Plano de implementação

### Passo 1 — Banco (`supabase/migrations/0014_confrontante_numerado.sql`)

```sql
alter table vertices
  add column if not exists numerado boolean not null default false;
alter table trechos_confrontantes
  add column if not exists numerado boolean not null default false;
comment on column vertices.numerado is
  'Confrontação sai NUMERADA na planta: no desenho fica só o número e o texto vai ao quadro do rodapé.';
```

### Passo 2 — Tipos e transporte (sem lógica)

| Arquivo | Mudança |
|---|---|
| [src/lib/types.ts](src/lib/types.ts) | `Vertice.numerado: boolean`; `Trecho.numerado: boolean` |
| [servico.ts](supabase/functions/_shared/servico.ts) | `ServicoInput.vertices[].numerado?`; `TrechoServico.numerado: boolean` |
| [planta.ts](supabase/functions/_shared/planta.ts) | `TrechoPlanta.numerado?: boolean` |
| [planta_dados.ts](supabase/functions/_shared/planta_dados.ts) | `geometriaDoCalculo` repassa `numerado` |
| [reconciliacao.ts](supabase/functions/_shared/reconciliacao.ts) | `TrechoSigef.numerado`; lê das 2 fontes (trecho e vértice M) |
| [gerar-planta/index.ts](supabase/functions/gerar-planta/index.ts) | `numerado: v.numerado` no `ServicoInput`; repasse no ramo SIGEF |
| [gerar-documentos/index.ts](supabase/functions/gerar-documentos/index.ts) | idem |
| [src/lib/trechos.ts](src/lib/trechos.ts) | `Confrontacao.numerado`; `SEM_CONFRONTACAO.numerado = false`; `moverConfrontacao` leva junto |

### Passo 3 — Numeração (`planta.ts`, função pura nova)

```
numerarConfrontantes(trechos) -> Map<descritivoNormalizado, number>
```

- percorre `d.trechos` na ordem do anel;
- pula `isEstrada`/`isRio` e `descritivo` vazio;
- só entra quem tem `numerado === true`;
- chave = `descritivo.trim().toUpperCase()`; primeira aparição ganha o próximo
  número. Exportada para teste unitário.

### Passo 4 — Faixa do quadro (`planta.ts`, antes de `dArea`)

- `listaNum = [...mapa]` ordenada pelo número;
- se vazia → **nada muda** (`FAIXA_NUM_H = 0`);
- senão, altura estimada: `linhas por entrada × 11 pt`, em **colunas** de
  ~340 pt (2 colunas em A3, 3 em A1), + 22 pt de título;
- subtrai de `dArea.h` e soma a `dArea.y` **antes** de `mPorPtMin`/`escala`, para
  o desenho reencaixar sozinho. No A4 a faixa entra acima de `SELO_H + FAIXA_H`.

### Passo 5 — Desenho do número no lugar do bloco

Dentro do laço de `grupos` ([planta.ts:874](supabase/functions/_shared/planta.ts#L874)),
depois de calcular `mx/my/nx/ny`:

```
se numero != null:
  desenha "N" em corpo 17 bold, centrado em (mx + nx·AFAST, my + ny·AFAST),
  com disco branco de raio 11 e borda preta (não some sobre a malha),
  usa a MESMA busca (AFASTS × DESLS, sem ESCALAS) contra `obstaculos`/`ocupado`,
  empurra o ret em `ocupado`/`rotulosTrecho` e segue para o próximo grupo.
```

O restante do laço (bloco de texto) fica intacto para quem não está numerado —
os dois modos convivem na mesma planta.

### Passo 6 — Quadro "CONFRONTANTES" no rodapé

Desenhado no fim, junto da legenda ([planta.ts:1501](supabase/functions/_shared/planta.ts#L1501)),
na faixa reservada no passo 4: moldura, título `CONFRONTANTES`, e por entrada
`N - <linhas do descritivo unidas por " · ">`, com `textoFit` na largura da
coluna. Estouro de coluna → reduz corpo até 6,5 pt (a altura já foi reservada).

### Passo 7 — Tela: Conferência (fluxo `geo`)

Em [Conferencia.tsx:982-1063](src/components/Conferencia.tsx#L982-L1063):

- botão no `<header>` do bloco 2: **"🔢 Adicionar numeração"**, alterna
  `modoNumeracao` (estado local);
- com o modo ligado, cada `.trecho` ganha `☑ numerar este confrontante`
  (`setTrecho(t, { numerado })`), desabilitado quando `eh_via`/rio;
- badge `1` `2` `3`… no cartão e na `.legenda` do mapa, com a **mesma função de
  numeração** portada para `src/lib/trechos.ts` (uma regra, dois lados) —
  `numerarConfrontantes` em `src/lib/trechos.ts` e reexportada/duplicada em
  `planta.ts` no mesmo espírito de `ehViaPorLimite`;
- `salvar()` já faz upsert de `vertices` com spread — a coluna vai junto sem
  mexer no código;
- contador no `<span className="desc">`: `… · N numerado(s)`.

### Passo 8 — Tela: Peças (fluxo `pecas`)

Mesmo botão e checkbox em [PecasServico.tsx:421-455](src/components/PecasServico.tsx#L421-L455);
incluir `numerado: t.numerado` no insert de `salvar()` ([PecasServico.tsx:145](src/components/PecasServico.tsx#L145)).

### Passo 9 — CSS

`.trecho .badge-num` (círculo escuro, número branco) e `.legenda .item .badge-num`
em [src/styles.css:364-386](src/styles.css#L364-L386).

### Passo 10 — Testes

Novo `tests/planta_numerada.test.mjs`:

1. `numerarConfrontantes` — sequência, dedupe por descritivo, via/rio fora,
   começa em 1 com um só marcado;
2. **não regressão**: nenhum `numerado` → PDF idêntico ao atual (mesmo padrão de
   `folha_e_glebas.test.mjs`);
3. PDF com 1 e com N numerados: gera sem erro, tamanho > 0, nas 3 folhas;
4. via `DiagPlanta`: com todos numerados, `sobrepostos === 0` no caso de divisa
   curta que hoje empilha (fixture `salgada_velha` ou `LAGOA SECA`).

Rodar também `nao_regressao_completo`, `rotulos_sem_invadir`, `planta_conferencia`.

### Passo 11 — Deploy

Aplicar a migração e **republicar `gerar-planta` e `gerar-documentos`** — o
bundle publicado diverge do repositório; conferir o publicado antes de concluir.

---

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Faixa nova encolhe o desenho e muda a escala de plantas antigas | Faixa só existe com ≥1 numerado; sem numeração o caminho é o de hoje |
| Número solto não diz de quem é a divisa se o quadro não for lido | Quadro sempre sai quando há numeração; número em disco branco com borda, corpo 17 |
| Mesmo vizinho em duas divisas separadas | Numeração por `descritivo`, não por trecho — mesmo número nos dois pontos |
| Divergência entre a numeração da tela e a do PDF | Uma função só, espelhada como `ehViaPorLimite`/`ehRioPorLimite`, com teste nos dois lados |
| Aba antiga sem a coluna regravando vértices | O upsert já é por `id` estável desde a migração 0002; default `false` |

---

## 5. O que foi implementado

Todos os passos 1–10 estão no repositório. O passo 11 (migração e redeploy) não
foi executado — ver a ressalva no fim.

| Passo | Arquivo |
|---|---|
| 1 | [0014_confrontante_numerado.sql](supabase/migrations/0014_confrontante_numerado.sql) |
| 2 | [types.ts](src/lib/types.ts), [servico.ts](supabase/functions/_shared/servico.ts), [reconciliacao.ts](supabase/functions/_shared/reconciliacao.ts), [planta_dados.ts](supabase/functions/_shared/planta_dados.ts), [gerar-planta](supabase/functions/gerar-planta/index.ts), [gerar-documentos](supabase/functions/gerar-documentos/index.ts) |
| 3–6 | [planta.ts](supabase/functions/_shared/planta.ts) — `numerarConfrontantes`, `medirQuadroNumerados`, disco no lugar do bloco, quadro no rodapé |
| 7 | [Conferencia.tsx](src/components/Conferencia.tsx) |
| 8 | [PecasServico.tsx](src/components/PecasServico.tsx) |
| 9 | [styles.css](src/styles.css) — `.badge-num` |
| 10 | [planta_numerada.test.mjs](tests/planta_numerada.test.mjs) (14 testes) + [amostra_numerada.mjs](scripts/amostra_numerada.mjs) |

### Uma decisão que o plano não previa

**Marcar é um ato sobre o CONFRONTANTE, não sobre o trecho.** A decisão 3 do
plano (um número por confrontante distinto) só fecha se a MARCA também for por
confrontante: o desenho procura o número pelo descritivo, então marcar um trecho
de um vizinho que ocupa duas divisas separadas numeraria as duas no PDF, mas só
uma teria o selo na tela. As duas telas passaram a propagar a marca para todas as
divisas do mesmo confrontante (`marcarNumeracao`), e o teste
*"marcar o confrontante numera-o em toda divisa dele"* trava esse contrato.

### Verificação

- `node --test "tests/*.test.mjs"` — 187 passam (13 novos), incluindo o lacre de
  não-regressão: **sem nenhum marcado, o PDF é byte a byte o de antes**.
- `npm run build` e `npx tsc -b --force` limpos.
- `node scripts/amostra_numerada.mjs` gera a mesma planta com e sem numeração.
  Conferido no texto extraído do PDF: com numeração, `FAZENDA KAGADOS` aparece
  **só no quadro do rodapé** (não mais no desenho), enquanto `ESTRADA VICINAL`
  continua saindo por extenso sobre o próprio traço. `diag.sobrepostos = 0` e
  `diag.deslocados = 0` nos dois casos.

### Pendente — e por que não foi feito

O passo 11 pede aplicar a migração 0014 e **republicar `gerar-planta` e
`gerar-documentos`**. Sem isso a coluna não existe e a marca não é gravada: a
tela mostra o número e a planta sai como sempre saiu.

Não foi executado porque a árvore de trabalho tem OUTRAS alterações em curso
(`geo.ts`, `pecas.ts`, `texto.ts`, `MapaSVG.tsx`, `MapaGlebas.tsx` e dois testes
novos). Um redeploy agora publicaria esse trabalho junto, e a decisão de quando
publicá-lo não é desta mudança.
