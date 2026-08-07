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

### Veredicto: bug do sistema, não erro do usuário

Verificação feita em 2026-08-07 sobre o serviço mais recente
(`915ee577-43ae-4d92-8d68-6b0181f0f1d9`, FAZENDA SALGADA VELHA, reimportado às
15:14 UTC; plantas geradas 15:16 e 15:19 UTC):

- **O cadastro está certo.** Os dois trechos de via estão marcados com
  `tipo_limite = 'LA3'` — `ESTRADA VICINAL` (ordem 3) e `LINHA FERREA`
  (ordem 14) — que é a única forma que a tela permite (com LA3 o checkbox fica
  marcado e desabilitado). Os 4 vértices M estão bem distribuídos: cada via
  ocupa exatamente uma aresta.
- **A produção continua com o código antigo.** `gerar-planta` segue na v31 e
  `gerar-documentos` na v18, ambas de 2026-08-05 18:22 UTC, com o mesmo
  `ezbr_sha256` de antes. O deploy do passo 4 nunca aconteceu.
- **Com o código corrigido o desenho sai certo.** `scripts/diag_estradas.mjs`
  sobre este mesmo anel produz 2 arestas vermelhas, exatamente as marcadas:
  `DSBN-M-4542→DSBN-M-4543` e `DSBN-P-14312→DSBN-M-4544`.

### Estado da execução

| Passo | Estado |
|---|---|
| 1. `reconciliacao.ts` com fallback LA3 | feito |
| 2. `pecas.ts` reexportando a regra única | feito |
| 3. `tests/salgada_velha_la3.test.mjs` | feito — 74 testes passando, `tsc -b` limpo |
| 4. deploy | feito em 2026-08-07 ~16:51 UTC |
| 5. verificação | feito — bundle publicado confere |

#### Deploy

| Function | Antes | Depois | `ezbr_sha256` |
|---|---|---|---|
| `gerar-planta` | v31 | **v32** | `dfd559…` → `14e72b…` |
| `gerar-documentos` | v18 | **v19** | `c4c4a2…` → `294eab…` |
| `gerar-pecas` | v11 | **v12** | `6ad9c9…` → `246c26…` |

#### Verificação do bundle publicado

`get_edge_function('gerar-planta')` agora contém os três pontos de decisão, que
antes não existiam em produção:

```
ehVia: (v.conf.ehVia ?? false) || ehViaPorLimite(v.conf.tipoLimite)   // fluxo 'geo'
ehVia: !!t.eh_via || ehViaPorLimite(t.tipo_limite)                    // SIGEF, item 1
ehVia: !!v.eh_via || ehViaPorLimite(v.tipo_limite)                    // SIGEF, item 2
/^LA3\b/
```

Falta apenas **regerar as plantas** dos serviços afetados pela tela.

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
