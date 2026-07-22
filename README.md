# RTKConverte — Gerador de Memorial INCRA + Planilha SIGEF

Sistema para empresa de topografia/georreferenciamento: recebe o TXT da máquina
de topografia, apresenta formulário de conferência (dados do serviço,
confrontantes, vértices) e gera o **Memorial Descritivo GEO (DOCX)** e a
**Planilha Eletrônica de Dados Georreferenciados (ODS oficial SIGEF)**.

## Arquitetura

- **Frontend**: React + Vite + TypeScript (deploy Vercel). Não contém segredos;
  o preview do rodapé reutiliza o mesmo motor puro apenas para exibição.
- **Backend**: Supabase — Postgres + RLS, Storage (`uploads-txt`, `templates`,
  `gerados`, todos privados) e Edge Functions (Deno):
  - `parse-txt` — valida o TXT, detecta fuso, converte coordenadas (proj4),
    sugere trechos/tipos e cria o serviço em rascunho.
  - `gerar-documentos` — monta o serviço a partir do banco (fonte da verdade),
    aloca códigos de vértice (contadores transacionais via RPC
    `alocar_contadores`), gera DOCX + ODS e grava no bucket `gerados`
    (regeração ilimitada, arquivos sobrescritos).
  - `admin-setup` — ferramenta de deploy p/ subir os templates oficiais ao
    bucket `templates` (protegida por segredo na tabela `config_setup`).
- **Motor geodésico** (`supabase/functions/_shared/geo.ts`): pipeline
  auto-consistente — UTM → geográficas (SIRGAS2000), arredondamento canônico
  dos segundos a 3 casas (half-up), re-projeção e TODOS os cálculos (azimutes,
  distâncias, área shoelace, perímetro) no plano re-projetado.

## Comandos

```sh
npm install
npm run test:engine        # testes de aceitação do motor (LARISSA.txt)
node --test tests/gerador.test.mjs   # testes dos geradores DOCX/ODS
npm run dev                # frontend local (precisa de .env)
npm run build              # build de produção
npm run make:docx-template # regenera reference/memorial-template.docx
npm run upload:templates   # envia templates ao Storage (env: SETUP_SECRET)
npm run e2e                # teste end-to-end contra o backend implantado
```

## Variáveis de ambiente

Ver `.env.example`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Scripts: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SETUP_SECRET`, `E2E_EMAIL`,
`E2E_PASSWORD`.

## Deploy

1. **Banco**: aplicar `supabase/migrations/*.sql` (via MCP/CLI/painel).
2. **Segredo de setup**: `insert into config_setup values ('setup_secret', '<aleatório>')`.
3. **Edge Functions**: implantar `parse-txt` e `gerar-documentos` com
   `verify_jwt` ligado e `admin-setup` com `verify_jwt` desligado.
   Nota: no deploy, os arquivos de `supabase/functions/_shared/` são enviados
   como `_shared/…` dentro de cada função e os imports `../_shared/` do
   `index.ts` viram `./_shared/` (layout do bundle da Edge Function).
4. **Templates**: `npm run make:docx-template && npm run upload:templates`.
5. **Usuários**: criar operadores via painel do Supabase (Auth → e-mail/senha).
6. **Frontend (Vercel)**: importar o repositório, framework Vite, configurar
   `VITE_SUPabase_URL`/`VITE_SUPABASE_ANON_KEY` — `vercel.json` já incluso.

## Fixtures de referência (`reference/`)

- `LARISSA.txt` — TXT real usado nos testes de aceitação (fuso 24S).
- `PLANTA.ODS` — planilha oficial SIGEF usada como template-base.
- `5MEMORIAL-INCRA.DOC` — memorial legado de referência do fraseado.
