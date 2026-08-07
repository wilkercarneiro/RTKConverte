# Auditoria da arquitetura atual — base para a repaginação

Data: 2026-08-07. Levantamento feito antes de qualquer alteração, para que a nova
estrutura não quebre o fluxo que hoje funciona ponta a ponta.

## 1. Navegação atual

`App.tsx` é uma máquina de estados de **6 telas**, sem rotas de URL:

```
dashboard ──┬─→ upload ──→ conferencia          (fluxo 'geo')
            ├─→ pecas                            (fluxo 'pecas')
            ├─→ cliente ──┬─→ upload
            │             └─→ pecas
            └─→ config
```

Consequências para a repaginação:

- **Não há roteador.** Voltar/atualizar o navegador perde a tela. Qualquer
  "botão no topo" (clientes, histórico, configurações) hoje é troca de `useState`,
  não link.
- `Conferencia` recebe o serviço inteiro por prop (`ResultadoParse`) e o
  `App.abrir()` remonta esse objeto ao reabrir do dashboard — inclusive um
  `preview` falso com zeros, recalculado dentro da tela.
- `ClientePage` duplica os dois pontos de entrada (`onNovoGeo`, `onNovoPecas`).
  Cada modalidade nova precisa ser plugada em **dois** lugares.

## 2. Os dois pipelines existentes

| | `tipo = 'geo'` (Serviço 1) | `tipo = 'pecas'` (Serviço 2) |
|---|---|---|
| Entrada | TXT do levantamento | PDF de prévia do SIGEF |
| Tela | `Upload` → `Conferencia` (1245 linhas) | `PecasServico` (518 linhas) |
| Confrontação | vive no vértice M (`vertices`) | tabela `trechos_confrontantes` |
| Gera | memorial DOCX, planilha ODS, planta do sistema, planta do SIGEF, 7 peças | 7 peças |

O `tipo` de hoje descreve **de onde vêm os dados**, não o que o cliente comprou.
As três modalidades pedidas são sobre **escopo de entrega** — eixo diferente.

## 3. O que `Conferencia` faz hoje (a tela que não pode quebrar)

Sete blocos, na ordem da tela:

1. `bloco-dados` — obrigatórios à vista (credenciado, detentor, denominação,
   município, UF) + 4 seções recolhíveis: RT/TRT, registro/cartório,
   **identificação da parcela** (`denominacao_parcela`, `parcela_numero`, `lado`),
   espólio.
2. `bloco-confrontantes` — trechos derivados dos M + `MapaSVG`.
3. `bloco-vertices` — edição + inserção de vértice V pré-existente.
4. `bloco-satelite` — obrigatória: entra no quadro PLANTA DE SITUAÇÃO.
5. `bloco-gerados` — memorial + planilha + planta do sistema.
6. `bloco-sigef` — upload do PDF + correção de sobreposição (CSVs).
7. `bloco-planta` / `bloco-pecas` — planta oficial e as 7 peças.

Serviços transversais: `useAutosave` (1,5 s, suspenso durante rotinas),
`Passos`, `ProximaAcao`, `Avisos`, `Secao`, `BotaoPerigo` — tudo já em `ui.tsx`
e reaproveitável pela nova casca.

## 4. Achados que condicionam a nova arquitetura

### 4.1 `servicos.tipo` tem CHECK constraint

```sql
CHECK (tipo = ANY (ARRAY['geo','pecas']))   -- default 'geo'
```

Inserir uma modalidade nova **falha no banco** enquanto essa constraint existir.
E `tipo` já significa outra coisa (fonte do dado). Sobrecarregá-lo obrigaria a
revisar todo `if (tipo === 'pecas')` do código — exatamente o tipo de mudança que
gera bug no que funciona.

→ Modalidade deve ser **coluna nova** (`modalidade`), com default cobrindo os 3
serviços existentes. `tipo` fica como está.

### 4.2 Gerar documentos QUEIMA códigos de vértice

`gerar-documentos` chama a RPC `alocar_contadores`, que incrementa
`contador_m/p/v` do credenciado de forma **permanente e irreversível**. Cada
geração de uma conferência de área consumiria numeração oficial do Anexo A que
nunca será usada.

→ A modalidade "Conferência de área" precisa decidir isto explicitamente. É a
questão de maior impacto do redesenho.

### 4.3 A planta já sabe mudar de formato — A4 é barato

`planta.ts` desenha **sempre** nas medidas A1 (841×594 mm) e, para posse, aplica
`scaleContent + setSize` no fim, virando A3 exato (420×297). O comentário da
linha 1137 deixa a regra explícita: a A3 é uma *redução*, não outra folha.

→ A4 (297×210) é mais um fator de escala (~0,3532), não um segundo desenho.
Baixo risco. O que muda junto é o rodapé (`"01 001 A1"` / `"01 001 A3"`) e a
decisão hoje amarrada a `tipoImovel === "posse"`.

### 4.4 A planta NÃO suporta polígono interno

`DadosPlanta` tem **um** anel (`vertices: VerticePlanta[]`) e `trechos` que
apontam para índices desse anel. Não existe estrutura para sub-polígonos.
`geometriaDoCalculo` e `montarTrechosDoSigef` produzem um anel só; o desenho, a
malha UTM, o enquadramento e o quadro analítico assumem isso.

→ Desenhar glebas dentro do perímetro é **trabalho de motor**, não de tela: novo
campo em `DadosPlanta`, nova passada de desenho, e decisão sobre o quadro
analítico. É o item mais caro dos três.

### 4.5 "Gleba" hoje significa outra coisa no código

Dois usos, nenhum deles o pedido:

- `sobreposicao.ts` / `Conferencia.tsx:52` — `mesma_gleba` é um **status de
  sobreposição** (parcela que cobre >50% da área ⇒ é a própria gleba já
  certificada).
- `denominacao_parcela` / `parcela_numero` / `lado` — identificam **uma** parcela
  ("Parte 1", "001", "Externo") e vão para a planilha ODS
  (`gerar-documentos:184-186`). Descrevem a parte, não desenham as irmãs.

→ Nomenclatura precisa ser fixada antes de codar, senão `gleba` vira três coisas.

### 4.6 Não há tabela para sub-áreas

Tabelas existentes: `clientes`, `config_empresa`, `config_setup`, `credenciados`,
`documentos_gerados`, `responsaveis_tecnicos`, `servicos`,
`trechos_confrontantes`, `vertices`. Nenhuma comporta N glebas de um serviço.

## 5. Recomendação: gleba é MODO, não caminho novo

**Não criar um pipeline separado.** Motivos, na ordem do risco:

1. O fluxo completo é o ativo que não pode quebrar. Um segundo caminho que
   também faz TXT→memorial→SIGEF→peças duplica a superfície de manutenção — e a
   história recente do repositório (`ARQUITETURA-TRECHOS.md`) mostra que a
   confrontação já se perdeu uma vez por ter dois caminhos que divergiram.
2. Da entrada até a planta, gleba e completo são **idênticos**: mesmo TXT, mesmo
   anel, mesmo memorial, mesma planilha, mesmas peças. A diferença é uma camada
   de desenho a mais e uma etapa de edição antes de gerar a planta.
3. O que o usuário vê pode continuar sendo três cartões: o cartão de gleba só
   liga a flag. UX de três caminhos, código de um.

O que a gleba adiciona, isolado do resto:

- tabela nova (ex.: `glebas`: `servico_id`, `nome`, `area_ha`, geometria);
- editor de glebas em `Conferencia`, entre confrontantes e a geração da planta;
- campo opcional em `DadosPlanta` + uma passada de desenho em `planta.ts`;
- nada disso é executado quando a flag está desligada — o caminho atual não muda.

## 6. Pontos que precisam de decisão do usuário

Levantados na auditoria, respondidos na conversa antes da implementação:

1. O que acontece com o **"Serviço 2 — Peças técnicas"** (entrada só pelo PDF do
   SIGEF, sem TXT). Não está entre as três modalidades pedidas, mas é código
   vivo (`PecasServico`, 518 linhas) e tem serviços no banco.
2. **Conferência de área consome numeração oficial de vértice?**  (ver 4.2)
3. **O que é uma "gleba"** neste serviço: sub-polígonos desenhados dentro do
   perímetro, ou divisão em serviços-parte irmãos? (ver 4.5)
