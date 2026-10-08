# Vértice — Gerador de Memorial INCRA + Planilha SIGEF

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
    sugere trechos/tipos e cria o serviço em rascunho. Quando o serviço
    confronta com área certificada, recebe também os CSVs de exportação do
    SIGEF dos vizinhos com os vértices escolhidos e os une ao levantamento
    (`_shared/certificados.ts`: igualar a ≤ tolerância, inserir no lado mais
    próximo; o vértice sai com código/GMS/método/σ/Z do vizinho).
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
npm test                   # todos os testes do motor e dos geradores (node --test)
npm run test:engine        # só os testes de aceitação do motor (LARISSA.txt)
npm run test:rls           # isolamento entre escritórios num Postgres descartável
npm run dev                # frontend local (precisa de .env)
npm run build              # build de produção
npm run make:docx-template # regenera reference/memorial-template.docx
npm run upload:templates   # envia templates ao Storage (env: SETUP_SECRET)
npm run deploy:functions   # publica as 9 edge functions a partir do repositório
npm run e2e                # teste end-to-end contra o backend implantado
```

O GitHub Actions roda testes, RLS e build em todo push (`.github/workflows/ci.yml`)
e publica as edge functions quando `supabase/functions/` muda na `main`
(precisa do secret `SUPABASE_ACCESS_TOKEN`).

## Variáveis de ambiente

Ver `.env.example`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
e as opcionais `VITE_CADASTRO_ABERTO`, `VITE_SUPORTE_*`, `VITE_SENTRY_DSN`.
Scripts: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SETUP_SECRET`, `E2E_EMAIL`,
`E2E_PASSWORD`, `SUPABASE_DB_URL` (backup).

## Deploy

1. **Banco**: aplicar `supabase/migrations/*.sql` (via MCP/CLI/painel).
2. **Segredo de setup**: `insert into config_setup values ('setup_secret', '<aleatório>')`.
3. **Edge Functions**: `npm run deploy:functions` (todas; `verify_jwt` vem de
   `supabase/config.toml` — só a `admin-setup` fica sem JWT). Segredo extra:
   `MAPBOX_TOKEN`.
4. **Templates**: `npm run make:docx-template && npm run upload:templates`.
5. **Usuários**: criar operadores via painel do Supabase (Auth → e-mail/senha).
   Com a migração de escritórios aplicada, o cadastro é pela tela
   ("Criar conta") e a equipe em Configurações → Equipe.
6. **Frontend (Vercel)**: passo a passo em `docs/operacao/publicar-na-vercel.md`.

Documentação de operação e produto:

- `docs/multiescritorio/` — migração de vários escritórios (proposta, com teste) e ordem de aplicação
- `docs/operacao/` — Vercel, backup/restauração e monitoramento de erros
- `docs/legal/` — minutas de termos de uso e política de privacidade (revisão jurídica pendente)
- `docs/guia-primeiros-passos.md` — onboarding do cliente (também na tela Ajuda)
- `docs/comercial/` — cliente ideal, roteiro de abordagem/demo, proposta e conteúdo

## Fixtures de referência (`reference/`)

- `LARISSA.txt` — TXT real usado nos testes de aceitação (fuso 24S).
- `PLANTA.ODS` — planilha oficial SIGEF usada como template-base.
- `5MEMORIAL-INCRA.DOC` — memorial legado de referência do fraseado.
