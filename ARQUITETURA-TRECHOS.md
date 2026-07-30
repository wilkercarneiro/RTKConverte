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

## A planta gerada com o PDF do SIGEF

O `gerar-planta` tem dois caminhos, e o segundo custou três rodadas de defeito porque
ninguém tinha reparado que ele **não passa pelos vértices**:

- sem PDF (fluxo `geo` puro): monta o serviço pelo `montarServico`, que deriva os trechos
  dos vértices M. Sempre esteve certo.
- com PDF (`servico.tipo === 'pecas'` **ou** qualquer serviço em que se envia o PDF):
  reconcilia os vértices com a prévia do SIGEF e montava os trechos lendo
  `trechos_confrontantes` — tabela que ficou vazia para serviços `geo` quando a
  confrontação passou para o vértice. Sem linhas ali, caía no texto do PDF, que não
  distingue faixa de domínio, e nada saía marcado como estrada.

Sintoma característico: **a tela mostra a estrada e o PDF não.** São fontes diferentes.

Dois agravantes no mesmo caminho, ambos corrigidos:

1. `reconciliarVerticesBancoComSigef` devolvia linhas sem as colunas de confrontação, e o
   `gerar-planta` apaga e reinsere a tabela de vértices com esse resultado — ou seja, gerar
   a planta **apagava a marcação** antes de desenhar.
2. O `tipo` era reescrito a partir da letra do código do SIGEF. Um vértice com confrontação
   cujo código dissesse `-P-` virava P e o trecho sumia do desenho — não só a cor.

A escolha da origem dos trechos virou `montarTrechosDoSigef`, com precedência explícita
(trechos por `codigo_inicio` → confrontação nos vértices M → texto do SIGEF) e testes em
`tests/reconciliacao_confrontacao.test.mjs`. Estava solta dentro da edge function, onde
nenhum teste alcançava.

**Regra que fica:** ao mudar onde a confrontação mora, varra TODOS os caminhos que a leem.
Foram três: o desenho, a reconciliação e a montagem dos trechos a partir do PDF.

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

Cada confrontação é editada no seu vértice M, identificado por código (`DSBN-M-3704`, não
`ordem 2`), com checkbox "faixa de domínio pública". Adicionar uma transição converte P→M;
remover reverte M→P e limpa os dados — marcar o M e criar o trecho são o mesmo ato, então
os dois nunca divergem.

O campo "Inicia no ponto" **move** a confrontação: escolher outro vértice leva descritivo,
apelido, tipo de limite, faixa de domínio, CNS e matrícula junto, converte o destino em M e
devolve a origem ao tipo que ela tinha antes — V se foi inserida à mão, P caso contrário.
Existe porque o M vem do rótulo do TXT e erra com frequência; sem mover, corrigir o ponto
significava remover o trecho e redigitar tudo. A regra é `moverConfrontacao` em
`src/lib/trechos.ts`, testada em `tests/trechos.test.mjs`; destino que já é M é recusado na
tela, para não sobrescrever a confrontação do vizinho.

O preview SVG desenha a **linha dupla vermelha por fora do polígono** exatamente onde a
planta desenharia, com a mesma construção de `planta.ts` (normal apontando para o lado
oposto ao centroide). Se a linha vermelha aparecer onde não há estrada, o erro está na tela
antes de virar PDF — que é o ponto.

A regra "a que trecho pertence cada segmento" vive em `src/lib/trechos.ts`, isolada e
testada em `tests/trechos.test.mjs` contra o anel real da LAGOA SECA: a estrada tem de
começar no M-3704 e terminar no M-3705, e os segmentos P-13806→P-13807→M-3704 têm de ficar
de fora. São os dois defeitos relatados, agora travados por teste.

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
