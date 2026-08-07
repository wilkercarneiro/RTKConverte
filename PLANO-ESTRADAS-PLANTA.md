# Auditoria: plantas saindo sem as linhas vermelhas de estrada

Data: 2026-08-07 · Serviços afetados: FAZENDA SALGADA VELHA (`ccd9927b`), e todo
serviço cuja faixa de domínio esteja marcada apenas por `tipo_limite = 'LA3'`.

## Sintoma

Nem a planta gerada antes do envio ao SIGEF (`gerar-documentos`, tipo
`planta_pdf_sistema`) nem a gerada depois (`gerar-planta` com o PDF do SIGEF)
desenham a linha dupla vermelha da faixa de domínio.

## Cadeia causal

O desenho depende de `TrechoPlanta.isEstrada` (`_shared/planta.ts:519`), que vem
de `ehVia` do trecho. `ehVia` pode ser ligado por dois caminhos:

1. `eh_via = true` no vértice M (checkbox "faixa de domínio pública");
2. `tipo_limite = 'LA3'` — limite artificial de faixa de domínio, que vale
   sozinho (`ehViaPorLimite`).

### A. Deploy defasado — causa direta do sintoma relatado

- `ehViaPorLimite` entrou em `_shared/servico.ts` no commit `6165e29`
  (2026-08-05 19:27 UTC).
- `gerar-planta` (v31) e `gerar-documentos` (v18) foram publicadas em
  **2026-08-05 18:22 UTC**, ~65 min ANTES.
- O bundle publicado foi inspecionado: não contém `ehViaPorLimite` nem a string
  `LA3`; tem `ehVia: v.conf.ehVia ?? false`, sem o fallback.

Ou seja: **em produção o caminho 2 não existe**.

### B. A tela nunca grava `eh_via` quando o limite é LA3

`Conferencia.tsx:776-778` e `PecasServico.tsx:439-441` renderizam o checkbox
`checked={t.eh_via || ehViaPorLimite(t.tipo_limite)} disabled={ehViaPorLimite(...)}`.
Com LA3 o usuário vê "marcado", não consegue desmarcar e **nada é gravado**:
`eh_via` continua `false` no banco. Por isso a tela mostrava a estrada certa e o
PDF saía sem ela.

Confirmado nos dados: SALGADA VELHA tem 3 vértices M — dois com `tipo_limite='LA3'`
(`LINHA FERREA`, `ESTRADA VICINAL`) e **`eh_via = false` em todos os três**.

### C. Fluxo pós-SIGEF perde o LA3 mesmo com o código local — bug real

Em `_shared/reconciliacao.ts` o fallback LA3 não é aplicado em nenhum dos três
pontos que decidem a via:

| Local | Código | Efeito |
|---|---|---|
| `montarTrechosDoSigef` item 1 | `ehVia: !!t.eh_via` | trecho LA3 do fluxo `pecas` não vira via |
| `montarTrechosDoSigef` item 2 | `ehVia: !!v.eh_via` | trecho LA3 do fluxo `geo` não vira via |

Publicar o deploy sozinho NÃO resolveria a planta pós-SIGEF: ela não passa por
`montarServico`, então nunca via o fallback.

`reconciliarVerticesBancoComSigef` grava `eh_via: !!correspondente.eh_via` de
volta na tabela — e a reconciliação **apaga e reinsere** `vertices`
(`gerar-planta/index.ts:86-87`). Isso foi deixado como está de propósito:
`tipo_limite` atravessa a reconciliação intacto, então derivar a via no consumo
basta e evita denormalizar (`eh_via` continua significando "o usuário marcou o
checkbox", não "o SIGEF classificou como LA3").

## Plano de ação

1. **[código]** `reconciliacao.ts`: aplicar `ehViaPorLimite(tipo_limite)` nos
   três pontos acima, importando a regra de `servico.ts` (fonte única) em vez de
   criar uma quarta cópia.
2. **[código]** `pecas.ts`: reexportar `ehViaPorLimite` de `servico.ts`,
   eliminando a cópia duplicada no back-end.
3. **[teste]** Regressão com os dados reais da SALGADA VELHA: LA3 + `eh_via=false`
   tem de sair como via nos DOIS fluxos, e a reconciliação tem de preservar isso.
4. **[deploy]** Republicar `gerar-planta`, `gerar-documentos` e `gerar-pecas`
   (esta última está em produção desde 2026-07-28 e não tem nenhuma das duas
   correções de faixa de domínio dos commits `8794278` e `6165e29`).
5. **[verificação]** Regerar as plantas dos serviços afetados e conferir.

### Estado da execução

| Passo | Estado |
|---|---|
| 1. `reconciliacao.ts` com fallback LA3 | feito |
| 2. `pecas.ts` reexportando a regra única | feito |
| 3. `tests/salgada_velha_la3.test.mjs` | feito — 74 testes passando, `tsc -b` limpo |
| 4. deploy | **pendente** — `bash scripts/deploy-functions.sh` (exige `npx supabase login`) |
| 5. verificação | pendente, depende do passo 4 |

O deploy não pôde ser executado aqui: não há credencial do Supabase na máquina
(`supabase projects list` → `Unauthorized`) e `supabase login` é interativo.

## Achados adicionais (fora do escopo do sintoma, não alterados)

- **Prévia da tela pode apontar o trecho errado.** `segmentosDeVia`
  (`src/lib/trechos.ts:107`) e `MapaSVG` percorrem os vértices na ordem do banco,
  sem a normalização para sentido horário que `montarServico` faz
  (`inverterSentido`). Em levantamento anti-horário — como o da SALGADA VELHA —
  a prévia marca a via em um trecho e o PDF em outro. É defeito de *qual* trecho,
  não de *ter ou não* linha vermelha.
- **`LA3` vs `LA[34567]`.** A migration `0002` e `tests/gerador.test.mjs` tratam
  `^LA[34567]` como faixa de domínio; todo o runtime usa só `^LA3`. Hoje o banco
  só tem `LA1`, `LA3` e `null`, então não há impacto — a regra não foi alargada
  para não marcar trecho indevidamente.
- **SALGADA VELHA sairá com quase todo o perímetro em vermelho** (31 de 32
  arestas), porque os dois trechos LA3 cobrem praticamente todo o anel: só há 3
  vértices M e o trecho `LA1` (POSSE) cobre uma única aresta. Isso é o que a
  confrontação cadastrada diz — se estiver errado, é dado, não código.
