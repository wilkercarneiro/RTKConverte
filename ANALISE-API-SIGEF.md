# Análise: API SIGEF-Geo do INCRA para verificação automática de sobreposição

## 1. O que a API oferece (swagger.json)

- **Base:** `https://api.incra.gov.br/sigef-geo`
- **Auth:** OAuth2 *client_credentials*, token em
  `https://sso.incra.gov.br/auth/realms/APIS_INCRA/protocol/openid-connect/token`, scope `openid`.
- **Endpoints úteis (só 2, ambos GET):**
  | Endpoint | Retorno |
  |---|---|
  | `/v1/parcelas` | parcelas paginadas, campo `geometria` (texto/WKT) |
  | `/v1/parcelas/serpro` | idem, **geometria em GeoJSON** ← usar este |
- **Campos retornados por parcela:** `parcelaCodigo`, `nomeArea`, `areaHectares`, `geometria`,
  `detentorNome/Cpf/Cnpj`, `titularNome/Cpf/Cnpj`, `natureza`, `registroCns/Matricula`,
  `rt`, `art`, `status`, `municipio`, `uf`, `dataAprovacao`. → dá para responder
  **"quem está sobreposto"** com nome, CPF/CNPJ e matrícula.
- **Paginação:** `page`, `size`, `sort`.

## 2. Limitação central

**A API não tem consulta espacial.** Não existe `bbox`, `intersects` nem `within`.
O parâmetro `geometria` é filtro de igualdade sobre a string, não predicado espacial.

Consequência: **o cruzamento tem de ser feito do nosso lado** — buscamos as parcelas
candidatas por atributo (`uf` + `municipio`) e calculamos a interseção localmente.

## 3. Por que é viável no RTKConverte

Já temos o motor completo em [supabase/functions/_shared/sobreposicao.ts](supabase/functions/_shared/sobreposicao.ts):
`corrigirSobreposicao()` recebe `ParcelaSigef[] = { nome, ringUtm }` e devolve
`StatusParcela[]` com `areaSobrepostaM2` e status (`corrigida` / `mesma_gleba` / `interna` /
`sem_sobreposicao`), via clipper em inteiros.

Hoje esses anéis vêm de CSV baixado à mão do SIGEF (`parseCsvSigef`, chamado por
[corrigir-sobreposicao/index.ts](supabase/functions/corrigir-sobreposicao/index.ts) e disparado em
[Conferencia.tsx:278](src/components/Conferencia.tsx#L278)).

**A API substitui exatamente essa etapa manual.** Trocamos a origem dos anéis (CSV → API)
e todo o resto do algoritmo continua igual — inclusive a correção automática do anel.

## 4. Implementação proposta

1. **`_shared/sigef_api.ts`** (novo)
   - `getToken()` com cache em memória (respeitando `expires_in`);
   - `buscarParcelas({ uf, municipio })` paginando `/v1/parcelas/serpro` (`size=200`);
   - `geoJsonParaRingUtm(geom, zona, proj4)` → `[E,N][]` usando `utmDef()`/`proj4` de
     [_shared/geo.ts](supabase/functions/_shared/geo.ts); descartar geometrias inválidas;
   - pré-filtro por **bbox local** (retângulo do nosso serviço + folga de ~50 m) antes de
     mandar ao clipper — corta 99% das parcelas do município.

2. **Edge function `verificar-sobreposicao`** (nova)
   - entrada `{ servico_id }`; lê anel e `uf`/`municipio` do serviço;
   - chama `buscarParcelas`, monta `ParcelaSigef[]`, roda `corrigirSobreposicao` em
     modo consulta (`afastamento = 0`) só para obter `StatusParcela[]`;
   - devolve lista com `parcelaCodigo`, `detentorNome`, CPF/CNPJ, matrícula,
     `areaSobrepostaM2` e `%` da nossa área.

3. **Cache** — tabela `sigef_parcelas_cache(municipio, uf, parcela_codigo, geom, atualizado_em)`
   com TTL (ex.: 7 dias). Evita rebaixar um município inteiro a cada conferência.

4. **UI** — botão "Verificar sobreposição (SIGEF)" em `Conferencia.tsx`, antes do envio;
   se houver sobreposição, oferecer o fluxo já existente de correção.

5. **Segredos** — `SIGEF_CLIENT_ID` / `SIGEF_CLIENT_SECRET` nos secrets do projeto Supabase.

## 5. Riscos / pontos a validar

- **Credenciais:** **não é API aberta.** Teste feito em 29/07/2026:
  `GET /v1` → **200** (raiz sem `security` no swagger, só devolve `buildVersion`);
  `GET /v1/parcelas?size=1` → **401**; `GET /v1/parcelas/serpro?size=1` → **401**.
  Ou seja, os dados exigem token OAuth2 emitido pelo SSO do INCRA (realm `APIS_INCRA`).
  **Este é o bloqueio real** — sem client_id/secret nada roda. Pedir acesso é o passo 0.
- **Volume:** município grande pode ter milhares de parcelas → paginação + cache obrigatórios.
- **Cobertura:** a API expõe parcelas certificadas; **não cobre parcelas em análise**
  (que o SIGEF acusa no envio). Logo, a verificação é *pré-triagem*, não substitui o envio.
- **Datum/projeção:** geometria vem em lon/lat SIRGAS2000 → converter com a zona já
  detectada pelo serviço (`escolherZona`), senão a área de interseção sai errada.
- **Rate limit / SLA:** não documentado no swagger; tratar 429/5xx com retry e degradar
  para o fluxo manual por CSV.

## 6. Alternativa se as credenciais demorarem

O acervo fundiário do INCRA publica as parcelas certificadas via **WFS/GeoServer**
(`geoservicos.incra.gov.br`), que aceita filtro `BBOX` — resolveria a falta de consulta
espacial e dispensa OAuth. Vale testar em paralelo como plano B ou como pré-filtro.

## 7. Veredito

**Viável e de baixo esforço incremental** (~1 módulo + 1 edge function + botão), porque o
cálculo geométrico já existe e está validado. O único item fora do nosso controle é a
liberação das credenciais junto ao INCRA.
