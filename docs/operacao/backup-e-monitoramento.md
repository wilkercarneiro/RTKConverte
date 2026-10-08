# Backup e monitoramento

## Backup do banco

| O quê | Onde | Quem restaura |
|---|---|---|
| Backup diário automático | Supabase (plano Pro: 7 dias; Free: nenhum) — Database → Backups | painel, restaura o projeto inteiro |
| Cópia própria (`pg_dump`) | máquina/drive do dono | `scripts/restaurar-teste.sh` (teste) ou `pg_restore` |

### Fazer a cópia

```sh
SUPABASE_DB_URL='postgresql://postgres.utxqkbgfgpbczqjtieyu:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' \
  bash scripts/backup-banco.sh backups
```

A URL vem de Supabase → Project Settings → Database → Connection string (Session pooler). Guarde o `.dump` fora do computador (drive da empresa). Frequência sugerida: semanal e antes de toda migração.

### Provar que a cópia abre (definição de pronto)

```sh
bash scripts/restaurar-teste.sh backups/vertice-AAAAMMDD-HHMMSS.dump
```

Sobe um Postgres descartável, restaura e conta as linhas de `auth.users`, `servicos`, `vertices`, `clientes`, `documentos_gerados`… Rode o mesmo SELECT no SQL Editor de produção e compare. Anote data e números no Marco — essa é a evidência de "restauração feita".

O par backup → restauração foi testado localmente em 2026-10-08 contra um banco com o mesmo esquema; falta rodar contra a produção (precisa da senha do banco).

### Arquivos do Storage

O dump guarda só os metadados dos arquivos. Os DOCX/PDF gerados podem ser regerados a partir do banco (o banco é a fonte da verdade), mas os **modelos** (`templates/`) e a **logo** não: mantenha uma cópia local deles (os originais estão em `reference/` e `DocPosse/`) e, para um espelho completo, use `npx supabase storage cp -r ss:///templates ./backup-templates --experimental`.

## Monitoramento de erros

### Navegador (frontend)

`src/lib/monitoramento.ts` envia erros não tratados ao **Sentry** quando a variável `VITE_SENTRY_DSN` existe (sem ela, não faz nada). Não envia e-mail, nome, CPF nem conteúdo de formulário — só a mensagem, a pilha e a rota.

1. Crie a conta e um projeto "Browser JavaScript" em sentry.io (o plano gratuito basta para começar).
2. Copie o DSN (Settings → Client Keys) para `VITE_SENTRY_DSN` na Vercel e publique de novo.
3. Em Alerts, crie "Issues → a new issue is created → e-mail para <responsável>".
4. Teste: no console do navegador do sistema publicado, rode `setTimeout(() => { throw new Error("teste de alerta") })` e confira o e-mail.

### Servidor (edge functions)

As funções devolvem `{ erro }` para a tela e registram no log do Supabase (Edge Functions → Logs). Para alerta: Supabase → Project Settings → Log Drains (planos pagos) para o Sentry/Datadog, ou revisão semanal dos logs filtrando `status >= 500`.

## Quem recebe o alerta

**[DEFINIR: nome e e-mail do responsável]** — sem isso o monitoramento não está pronto.
