# Publicar o frontend na Vercel

O repositório já está pronto: `vercel.json` (framework Vite, `npm run build`, saída `dist/`, rewrite para o `index.html`) e o build passa sem as chaves.

## Passo a passo (uma vez)

1. Em vercel.com → **Add New → Project**, importe `wilkercarneiro/RTKConverte` (branch `main`). A Vercel detecta Vite pelo `vercel.json`.
2. Em **Environment Variables** (Production e Preview):

   | Variável | Valor | Obrigatória |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://utxqkbgfgpbczqjtieyu.supabase.co` | sim |
   | `VITE_SUPABASE_ANON_KEY` | chave **anon/publishable** (Supabase → Project Settings → API). Nunca a service_role | sim |
   | `VITE_CADASTRO_ABERTO` | `false` até aplicar a migração de escritórios (docs/multiescritorio) | não |
   | `VITE_SUPORTE_EMAIL` / `VITE_SUPORTE_WHATSAPP` / `VITE_SUPORTE_PRAZO` | canal de suporte exibido em Ajuda | não |
   | `VITE_SENTRY_DSN` | DSN do Sentry (docs/operacao/backup-e-monitoramento.md) | não |

3. **Deploy**. A URL sai como `https://<projeto>.vercel.app`.
4. No Supabase → **Authentication → URL Configuration**:
   - **Site URL**: a URL da Vercel (depois, o domínio próprio).
   - **Redirect URLs**: a URL da Vercel e `http://localhost:5173` (desenvolvimento).
   Sem isso, os links de "Esqueci a senha" e de confirmação de cadastro voltam para o endereço errado.
5. Teste: entrar com o usuário do escritório, abrir um serviço, gerar documentos.

A partir daí, todo push na `main` publica sozinho (e cada pull request ganha uma prévia).

## Domínio próprio

Depois de registrar o domínio: Vercel → Project → Settings → **Domains** → adicione `app.<dominio>` e crie no DNS o CNAME que a Vercel indicar. O HTTPS é emitido automaticamente. Atualize o Site URL do Supabase (passo 4).

## Antes de abrir o cadastro para fora

Confira em Supabase → Authentication → Providers → Email:
- **Confirm email** ligado;
- **Allow new users to sign up**: só ligue depois da migração de escritórios. Enquanto as policies forem `using (true)`, qualquer conta nova enxerga os dados de todos — e a API do Supabase aceita cadastro direto, mesmo sem a tela.
- E-mail de envio: o SMTP padrão do Supabase tem limite baixo e cai em spam; configure um SMTP próprio (Resend, SES…) no domínio antes de abrir o cadastro.
