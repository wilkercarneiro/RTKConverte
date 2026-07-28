# Arquitetura: confrontação ancorada no vértice M

## O defeito que motivou a mudança

Planta FAZENDA LAGOA SECA (serviço `74238a85`): a ESTRADA VICINAL foi desenhada de
`DSBN-P-13806` a `DSBN-P-13810` em vez de `DSBN-M-3704` a `DSBN-M-3705`, pintando linha
dupla vermelha em dois trechos sem estrada.

Causa: `trechos_confrontantes.vertice_inicio_ordem` é um **inteiro posicional** dentro de
uma lista mutável de vértices. As seis âncoras estavam uniformemente 2 posições antes do M
correto:

| âncora gravada | vértice que pegou | M correto |
| --- | --- | --- |
| 0 | P-13806 | M-3704 |
| 7 | P-13810 | M-3705 |
| 12 | P-13814 | M-3706 |
| 15 | P-13816 | M-3707 |
| 16 | P-13817 | M-3708 |
| 18 | M-3708 | M-3709 |

Três fatores se somam:

1. O salvamento em `Conferencia.tsx` faz `delete` + `insert` da tabela inteira de vértices,
   descartando os `id` a cada gravação — não existe identidade estável para ancorar.
2. Qualquer renumeração de `ordem` (reimportação, escrita direta) desloca todas as âncoras
   silenciosamente. Os dois `DSBN-V` nas ordens 3 e 4 estão com `inserido_manual = false`,
   valor que a inserção pela tela nunca produz.
3. Nada valida o resultado. `montarServico` só rejeita âncora para ordem **inexistente**
   (`servico.ts:101`); âncora que caiu num P passa batido até virar PDF.

Levantamento no banco em 28/07/2026: dos 195 trechos `geo`, 178 estavam corretos, 14
ancorados fora de M e 3 órfãos — todos os 17 defeituosos no FAZENDA MONOINO.

## A invariante

> **Um vértice M é o início de uma confrontação. O trecho vai daquele M até o próximo M.**

Isso já era a intenção do sistema: `parse-txt` importa com
`tipo: iniciosTrecho.has(i) ? "M" : "P"` e cria um trecho por M. O que faltava era
**garantir** em vez de apenas pretender.

Consequência de modelagem: o trecho deixa de ser uma entidade que *aponta* para um vértice
e passa a ser um atributo *do próprio vértice M*. Não há índice para errar, não há join
para desencontrar, e o número de confrontantes é sempre igual ao número de M.

## Modelo

### Fluxo `geo` — confrontação fundida no vértice

```sql
alter table vertices
  add column descritivo  text,
  add column tipo_limite text,
  add column eh_via      boolean not null default false,
  add column cns         text,
  add column matricula   text,
  add column apelido_txt text;
```

Preenchidas apenas quando `tipo = 'M'`. O trecho de um M vai até o próximo M no anel,
derivado em tempo de cálculo — nunca armazenado.

### Fluxo `pecas` — permanece como está

Os 6 trechos `pecas` do banco têm todos `codigo_inicio` preenchido e **nenhum** vínculo com
a tabela `vertices` (o perímetro vem do PDF do SIGEF em tempo de geração, não do banco).
Esse fluxo já ancora por código do SIGEF, que é estável por construção. `trechos_confrontantes`
continua existindo para ele, ganhando apenas a coluna `eh_via`.

Dois fluxos, duas fontes de verdade — mas cada uma correta no seu domínio. Tentar unificar
forçaria o `pecas` a materializar vértices que ele não tem.

## Fim das heurísticas de texto

`eh_via` explícito (checkbox "faixa de domínio pública") substitui as duas inferências
frágeis que marcavam estrada onde não havia:

- `gerar-planta/index.ts:76-77` — `!descritivo.includes("\\")`, que transformava em estrada
  todo confrontante digitado sem CPF (foi o que marcou MANOEL MOTA e ADELSON BONIFACIO).
- `PecasServico.tsx:107` — `/\\/.test(...) ? "LA1" : "LA3"`, que gravava LA3 no banco e
  congelava o erro mesmo depois de corrigir o descritivo.

`tipo_limite` continua existindo como campo de domínio SIGEF, mas deixa de decidir traçado.

## Validação antes de gerar

Com mensagem citando o **código** do vértice, nunca a `ordem`.

**Bloqueia** apenas corrupção estrutural: dado de confrontação preso a um vértice que não é
M. Pela tela isso é impossível; sobra como defesa contra dados legados e escrita direta no
banco.

**Avisa** (não bloqueia): M sem descritivo nem apelido; descritivo sem CPF quando `eh_via`
é falso — o caso que costuma ser estrada não marcada.

Descritivo vazio deliberadamente **não** é erro. O levantamento no banco em 28/07/2026
mostrou 90 vértices M usando só o apelido e 25 sem nenhum dos dois, em 4 serviços: o
memorial cai no apelido e, sem os dois, segue sem a cláusula de confrontação — comportamento
suportado desde sempre. Bloquear seria uma regressão disfarçada de rigor.

## Tela

Tabela única do perímetro em ordem de anel, identificada por código (`DSBN-M-3704`, não
`ordem 2`), com o confrontante em faixa colorida que se estende visualmente de M a M.
Botão "iniciar confrontação aqui" converte P→M; remover a confrontação reverte M→P.
Preview SVG do polígono com as faixas e a linha dupla das vias, para o erro aparecer na
tela e não no papel.

## Migração

`0002_confrontacao_no_vertice.sql`:

1. adiciona as colunas;
2. copia cada trecho `geo` para o vértice da sua âncora e força `tipo = 'M'` ali
   — preserva o comportamento atual, inclusive onde estava errado;
3. relatório dos vértices M sem descritivo e dos trechos órfãos, para conferência manual;
4. **não** apaga `trechos_confrontantes` — o fluxo `pecas` depende dela.

Correção pontual já aplicada em 28/07/2026 no serviço `74238a85` (LAGOA SECA):
`vertice_inicio_ordem + 2` nas seis âncoras, alinhando cada trecho ao seu M.
Os cinco serviços FAZENDA MONOINO seguem com âncoras inválidas e precisam de conferência
manual — o confrontante de cada trecho tem de ser reatribuído ao M correto, o que só quem
conhece o levantamento pode decidir.
