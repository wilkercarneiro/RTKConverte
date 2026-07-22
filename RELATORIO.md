# RELATÓRIO ESTRUTURADO — Sistema GEO: Memorial INCRA + Planilha SIGEF

Data: 22/07/2026 · Projeto Supabase: `rtkconverte-geo` (`utxqkbgfgpbczqjtieyu`, sa-east-1)

---

## 1. Resumo do implementado por fase

**Fase 1 — Fundação.** Projeto Vite + React + TS na raiz (`src/`), estrutura
`supabase/` (migrations + functions), fixtures em `reference/`. Projeto Supabase
novo criado via MCP (**custo: US$ 10/mês** — organização no plano Pro; ver §2.1).
Migrations aplicadas (5 tabelas + RLS + função RPC + `config_setup`), 3 buckets
privados criados (`uploads-txt`, `templates`, `gerados`), templates oficiais
enviados ao Storage (`planta-template.ods` = PLANTA.ODS oficial;
`memorial-template.docx` gerado por script).

**Fase 2 — Motor de cálculo.** `supabase/functions/_shared/geo.ts`: motor puro
(proj4 injetado) com o pipeline exato da seção 3.1 — detecção de fuso (com
candidatos + desempate por UF), UTM→geográficas (EPSG:319xx → 4674),
arredondamento canônico GMS (3 casas, half-up, com carry), re-projeção, azimutes
`atan2(ΔE,ΔN)`, distâncias, shoelace, perímetro. Edge Function `parse-txt`
implantada. **Testes de aceitação 3.2: 8/8 passando** (output real em §3).

**Fase 3 — UI de conferência.** Tela única com os 3 blocos: (1) dados do
serviço com selects dos domínios oficiais SIGEF e autocomplete de
detentor/RT/cartório de serviços anteriores; (2) confrontantes com trechos
sugeridos pelos rótulos, adicionar/remover transição em qualquer ponto, e
**mapa SVG** client-side com trechos coloridos e vértices numerados; (3) tabela
de vértices com troca de tipo, inserção de vértice V pré-existente e escolha do
vértice inicial. **Preview em rodapé fixo** (fuso, área, perímetro, M/P/V,
primeiro parágrafo) recalculado a cada edição reutilizando o mesmo motor puro
(exibição apenas — os valores oficiais são sempre server-side). Build de
produção OK (`tsc -b && vite build`).

**Fase 4 — Geradores.** Edge Function `gerar-documentos`: DOCX por templating
XML direto com jszip (template do Storage + `word/document.xml` injetado, com
códigos e coordenadas em **negrito**); ODS por patch cirúrgico do `content.xml`
do template oficial (apenas células de dados de `identificacao` e `perimetro_1`;
as 8 abas, estilos, validações, formulários, proteção de planilha e `mimetype`
sem compressão preservados). Alocação de códigos com incremento transacional dos
contadores via RPC `alocar_contadores` — **ao gerar, não ao sugerir**; regeração
reutiliza códigos sem re-incrementar. Validação por leitura real (unzip +
inspeção do XML) nos testes.

**Fase 5 — Fluxo completo.** `scripts/e2e.mjs` reproduz o serviço do Anexo A
inteiro via HTTP contra o backend implantado (login → parse-txt → cadastro →
trechos, incl. transição manual no pt 41 → inserção do V entre 68/69 → geração
→ download → inspeção → regeração). **28/28 verificações passaram** (§3).

## 2. Decisões em pontos ambíguos

1. **Custo Supabase**: a organização do usuário está no plano Pro; criar o
   projeto exigiu confirmar US$ 10/mês de compute. O prompt manda executar sem
   pedir confirmação — prossegui e registro aqui. O projeto pode ser deletado
   ou pausado para cessar a cobrança.
2. **Detecção de fuso é matematicamente ambígua** para E ≈ 500.000 (o LARISSA
   tem E ≈ 491.000): TODOS os fusos dão |lon−MC| ≤ 3°. Implementei retorno de
   candidatos + desempate por bbox da UF (aprox. por UF embutida) e, sem UF,
   prioridade heurística leste-primeiro [24,23,22,21,20,25,19,18]; UI exibe
   alerta de ambiguidade e override manual. Com UF=BA ou sem UF, LARISSA → 24S.
3. **Validação suave por município**: sem base de geocodificação embutida, a
   checagem usa bounding box da UF (alerta `foraDaUf` no preview). Checagem por
   município específico ficou como limitação (§6).
4. **DOCX por XML direto + jszip** (em vez de docxtemplater/pizzip): o corpo do
   memorial é uma sequência programática de runs com negrito intercalado —
   loops/formatação condicional em docxtemplater seriam mais frágeis que emitir
   os `<w:r>` diretamente; e elimina 2 dependências. O template do Storage
   fornece styles/fonte; a função injeta só o `document.xml`.
5. **Perímetro = soma das distâncias publicadas** (2 casas) e não da soma bruta
   arredondada — auto-consistência: os segmentos do memorial somam exatamente o
   perímetro impresso. Resultado bate com o histórico (4.075,94 m).
6. **Padding do sequencial dos códigos**: mínimo 4 dígitos (histórico:
   `DSBN-V-0758`, `DSBN-M-3605`, `DSBN-P-13130`).
7. **Numeração M na ordem do memorial**: o histórico tem 3606/3607 trocados
   entre os pts 41/36 (acidente do legado). Aloco sequencialmente na ordem do
   perímetro; os demais códigos (P-13130.., V-0758) coincidem com o histórico.
8. **Hemisfério na planilha**: o arquivo histórico traz "Norte" (default do
   template, campo inerte para coordenada Geográfica). Gravo o valor
   semanticamente correto pela latitude ("Sul").
9. **Altitude no memorial com 2 casas** (`300,05 m`) — seguindo o documento
   legado extraído, não as 3 casas do TXT.
10. **Fraseado**: uniformizei `com azimute de` (o legado alterna com/sem "de")
    e ponto final único (legado: `m..`). Campos "Código Credenciamento" e
    "Comarca" ficam em branco no DOCX (não existem no modelo de dados da spec —
    o legado também os deixava vazios).
11. **Upload de templates**: MCP não expõe service key p/ Storage; criei a
    Edge Function `admin-setup` (segredo em `config_setup`, RLS sem política =
    somente service role) + script `upload-templates.mjs`. Só aceita os 2 nomes
    fixos de template.
12. **Trechos sem rótulo/edição**: adicionar transição marca o vértice como M;
    remover trecho devolve a P. O vértice inicial do memorial deve iniciar um
    trecho (validação do motor).
13. **Regeração com vértices novos**: se qualquer vértice não-manual estiver sem
    código, TODOS os não-manuais são realocados a partir dos contadores atuais
    (números anteriores são "queimados" — comportamento simples e seguro).

## 3. Output real dos testes de aceitação

### 3.1 Motor (`node --test tests/engine.test.mjs`)

```
    área calculada: 83,9908 ha | perímetro: 4.075,94 m
✔ parse do TXT: 69 pontos, rótulos detectados (1.4413ms)
✔ detecção de fuso: 24S / EPSG:31984 (1.2346ms)
✔ conversão canônica do ponto 30 (lat exata; lon ±0,001") (0.2289ms)
✔ segmentos de aceitação: azimutes e distâncias exatos (0.161ms)
✔ área e perímetro do polígono do TXT puro (0.5778ms)
✔ formatação pt-BR (0.1474ms)
✔ códigos de vértice (0.1491ms)
✔ GMS: round-trip e carry no arredondamento (0.2415ms)
ℹ tests 8  ℹ pass 8  ℹ fail 0
```

Segmentos 3.2 verificados exatos: 32→33 `129°46'54"`/33,01 m; 33→34
`130°03'37"`/43,37 m; 34→35 `130°14'30"`/24,62 m. Ponto 30: lat
`11 23 44,344 S` (exata), lon `39 5 04,736 W` (dentro do ±0,001").

### 3.2 Geradores (`node --test tests/gerador.test.mjs`)

```
    área: 83.9886 ha | perímetro: 4075.94 m
✔ montagem: 70 vértices, códigos e contadores (1.1969ms)
✔ montagem: área/perímetro compatíveis com o arquivo histórico (0.5053ms)
✔ memorial: abertura, MC real e segmentos históricos (0.739ms)
✔ DOCX: pacote gerado, XML bem formado, negritos presentes (25.9283ms)
✔ ODS: abas preservadas, 70 linhas de vértices, valores conferem (79.1616ms)
ℹ tests 5  ℹ pass 5  ℹ fail 0
```

Com o V inserido, a área reproduz o histórico **exatamente**: 83,9886 ha.

### 3.3 End-to-end contra o backend implantado (`node scripts/e2e.mjs`)

```
login ok: e2e@rtkconverte.local
servico: 5ff8beed-24c8-432a-99d6-0f3f9718fd40
✔ fuso detectado = 24 (obtido 24)
✔ 69 vértices importados (69)
✔ 5 trechos sugeridos pelos rótulos (5)
✔ área preview ≈ 83,99 ha (83.9908)
✔ perímetro preview ≈ 4.075,9 m (4075.94)
✔ lat canônica do ponto 30 (11 23 44,344 S)
✔ lon canônica do ponto 30 (39 5 04,736 W)
✔ ponto 30 sugerido como M
resumo da geração: {"areaHa":83.98864282226563,"perimetroM":4075.94,"qtdM":6,
  "qtdP":63,"qtdV":1,"contadoresFinais":{"M":3611,"P":13193,"V":758},
  "verticeInicial":"DSBN-M-3605"}
✔ geração retornou ok
✔ vértice inicial DSBN-M-3605
✔ contagem M/P/V = 6/63/1 (6/63/1)
✔ área final ≈ 83,9886 ha (83.9886)
✔ perímetro final ≈ 4.075,94 m (4075.94)
✔ contadores após geração M=3611 P=13193 V=758 (3611/13193/758)
arquivos baixados: memorial.docx (5662 b), planilha.ods (88380 b)
✔ DOCX: título
✔ DOCX: MC-39 (bug de 45° do legado corrigido)
✔ DOCX: sem longitudes 45°
✔ DOCX: segmento 32→33 (129°46'54" / 33,01 m)
✔ DOCX: segmento 33→34 (130°03'37" / 43,37 m)
✔ DOCX: segmento 34→35 (130°14'30" / 24,62 m)
✔ DOCX: vértice V inserido presente
✔ DOCX: 6 linhas de assinatura de confrontantes
✔ ODS: mimetype preservado
✔ ODS: todas as 8 abas do template preservadas
✔ ODS: 70 linhas de vértices (70)
✔ ODS: DSBN-M-3605
✔ ODS: long do ponto 30
✔ ODS: lat do ponto 30
✔ ODS: vértice V com método PA1
✔ ODS: identificação preenchida
✔ ODS: trecho LA3/CORREDOR
✔ regeração não re-incrementa contadores (3611/13193)
✔ status do serviço = gerado (gerado)

E2E: TODOS OS TESTES PASSARAM
```

Arquivos gerados baixados em `tests/out/e2e/` (memorial.docx, planilha.ods).

## 4. Estrutura final de arquivos

```
d:\RTKConverte
├── index.html · vite.config.ts · tsconfig.json · vercel.json
├── package.json · .env.example · .gitignore · README.md · RELATORIO.md
├── src/
│   ├── main.tsx · App.tsx · styles.css · vite-env.d.ts
│   ├── lib/  supabase.ts · types.ts · domains.ts · preview.ts
│   └── components/  Login.tsx · Upload.tsx · Conferencia.tsx · MapaSVG.tsx
├── supabase/
│   ├── migrations/  0001_init.sql · 0002_alocar_contadores.sql · 0003_config_setup.sql
│   └── functions/
│       ├── _shared/  geo.ts · servico.ts · memorial.ts · docx.ts · ods.ts
│       ├── parse-txt/  index.ts · deno.json
│       ├── gerar-documentos/  index.ts · deno.json
│       └── admin-setup/  index.ts · deno.json
├── scripts/  make-docx-template.mjs · upload-templates.mjs · e2e.mjs
├── tests/  engine.test.mjs · gerador.test.mjs  (out/ = artefatos gerados)
└── reference/  LARISSA.txt · PLANTA.ODS · 5MEMORIAL-INCRA.DOC · memorial-template.docx · LARISSA.dxf
```

## 5. Instruções de deploy

**Já provisionado nesta execução**: projeto `utxqkbgfgpbczqjtieyu`
(https://utxqkbgfgpbczqjtieyu.supabase.co, sa-east-1), migrations aplicadas,
buckets criados, templates no Storage, 3 Edge Functions ativas
(`parse-txt` e `gerar-documentos` com verify_jwt; `admin-setup` sem —
protegida por segredo), usuário de teste `e2e@rtkconverte.local`.

Para reprovisionar do zero: ver README.md (§Deploy). Resumo:
1. `supabase/migrations/*.sql` no banco.
2. `insert into config_setup values ('setup_secret','<aleatório>')`.
3. Implantar as 3 functions (os `_shared/*.ts` entram no bundle como
   `_shared/…`, imports do index.ts como `./_shared/…`).
4. `npm run make:docx-template && npm run upload:templates`
   (env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SETUP_SECRET`).
5. Criar operadores no Auth (e-mail/senha).
6. Vercel: importar repo (framework Vite) + `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY`. O `vercel.json` já configura build e rewrites.

Segredo de setup desta instalação: gravado em
`%USERPROFILE%\.rtkconverte-setup-secret` (fora do repositório).

## 6. Pendências e limitações conhecidas

- **Deploy Vercel não executado** (requer login/conta Vercel) — projeto pronto
  com `vercel.json`; build de produção validado localmente.
- **UI não testada em navegador de ponta a ponta** — o fluxo completo foi
  validado via E2E HTTP contra as Edge Functions reais; a UI compila (tsc +
  vite) e usa exatamente as mesmas chamadas, mas não houve teste manual de
  cliques.
- Validação suave de fuso usa **bbox da UF**, não a coordenada do município
  específico (sem base de municípios embutida).
- Arquivos DOCX/ODS validados por inspeção estrutural do XML (critério da
  spec); não foram abertos em LibreOffice/Word nesta máquina.
- Rótulos do TXT em pontos coincidentes com transições manuais: o apelido
  detectado é só sugestão; o operador confirma o descritivo formal.
- `verify_jwt` das functions exige usuário autenticado; criação de usuários é
  manual (painel Supabase) — não há tela de cadastro (por escopo).
- Custo recorrente do projeto Supabase: US$ 10/mês (plano Pro da organização).
