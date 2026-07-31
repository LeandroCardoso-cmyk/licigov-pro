# SEC-036 — Homologação da CSP em staging (landing + login)

> Correção das violações reais de Content-Security-Policy encontradas na homologação da PR #191
> em staging, **sem enfraquecer** a política. CSP mantida secure-by-default.

## Violações encontradas (console, staging)

A landing e a tela de login compartilham o **mesmo shell** (`client/index.html`). As 3 violações
vinham dos 3 `<script>` embutidos no shell, bloqueados pela CSP `script-src 'self'` (padrão do Helmet):

| # | Origem no shell | Violação |
|---|---|---|
| 1 | `<script>` inline de tema/FOUC | `script-src 'self'` bloqueia inline |
| 2 | `<script src="https://www.googletagmanager.com/gtag/js?id=G-N0PT3PG3R1">` | domínio externo não liberado |
| 3 | `<script>` inline de bootstrap do `gtag()` | `script-src 'self'` bloqueia inline |

## Decisões

Seguindo a diretriz "remover inline desnecessário / externalizar / nonce-hash; não adicionar
`unsafe-inline` global; se a analítica não for necessária no contexto, impedir o carregamento em
vez de enfraquecer a CSP":

1. **Script de tema (violação 1) → externalizado.** Movido para `client/public/theme-init.js`,
   servido a partir da própria origem (`'self'`) e referenciado com `<script src="/theme-init.js">`.
   Continua bloqueante no `<head>` (roda antes do primeiro paint → sem flash de tema). Sem inline,
   sem `unsafe-inline`.

2. **Google Analytics GA4 (violações 2 e 3) → runtime, condicional e desligado por padrão.**
   Removido do shell (carregava em **toda rota** — inclusive login e app autenticado — e em **todo
   ambiente**, inclusive staging). Agora é carregado por `client/src/lib/analytics.ts` **apenas
   quando `VITE_GA_MEASUREMENT_ID` está definido no build**. O id nunca é hardcodado.
   - **Staging/dev:** variável ausente → GA **não** carrega → nenhuma requisição ao googletagmanager
     → landing e login **sem violação**, CSP **restritiva**.
   - **Produção (opcional):** define-se `VITE_GA_MEASUREMENT_ID` **e** `CSP_ALLOW_ANALYTICS=true`.

3. **CSP explícita e centralizada** em `server/config/csp.ts` (substitui o *default* implícito do
   Helmet), tornando o header determinístico e testável. Restritiva por padrão; libera os domínios
   **exatos** do Google **somente** quando `CSP_ALLOW_ANALYTICS=true` — sem wildcard amplo.

## Política resultante (`server/config/csp.ts`)

| Diretiva | Valor (analítica OFF — padrão) | Acréscimo quando `CSP_ALLOW_ANALYTICS=true` |
|---|---|---|
| `default-src` | `'self'` | — |
| `script-src` | `'self'` | `https://www.googletagmanager.com` |
| `script-src-attr` | `'none'` | — |
| `style-src` | `'self' https: 'unsafe-inline'` | — |
| `connect-src` | `'self'` | `…google-analytics.com`, `region1.google-analytics.com`, `…googletagmanager.com` |
| `img-src` | `'self' data: blob:` | `…googletagmanager.com`, `…google-analytics.com` |
| `font-src` | `'self' https: data:` | — |
| `object-src` | `'none'` | — |
| `base-uri` / `form-action` / `frame-ancestors` | `'self'` | — |
| `upgrade-insecure-requests` | ativo | — |

Notas:
- **`'unsafe-inline'` existe SOMENTE em `style-src`** (Recharts injeta `<style>`; TipTap usa estilo
  inline). **Nunca** em `script-src` — essa é a garantia central do SEC-036.
- **Sem host S3 na CSP:** downloads/anexos passam pela API tRPC (same-origin) e viram `blob:`; o
  browser não busca `amazonaws.com` diretamente. Por isso `img-src`/`connect-src` ficam enxutos.

## Gates de ambiente

| Variável | Efeito | Padrão |
|---|---|---|
| `HELMET_CSP_ENABLED` | `=false` desliga a CSP (escape hatch). Em prod/staging fica ligada por padrão | ligada em prod/staging; desligada em dev |
| `CSP_ALLOW_ANALYTICS` | `=true` libera os domínios do Google na CSP | `false` |
| `VITE_GA_MEASUREMENT_ID` | id do GA4 no build do cliente; ausente → GA não carrega | ausente |

Em **produção**, para ligar a analítica, defina **as duas** (`CSP_ALLOW_ANALYTICS=true` +
`VITE_GA_MEASUREMENT_ID=G-…`). Em **staging**, **não** defina nenhuma.

## Cobertura de testes

`server/__tests__/integration/csp-headers.test.ts`:
- header CSP tem `script-src 'self'` e **não** tem `'unsafe-inline'` nem `*` em `script-src`;
- diretivas restritivas presentes (`object-src 'none'`, `frame-ancestors/base-uri/default-src 'self'`);
- domínios do Google **ausentes** por padrão e **presentes só** com analítica habilitada, nas
  diretivas corretas (script/connect/img), sem wildcard;
- `'unsafe-inline'` só em `style-src`;
- gates de ambiente (`isCspEnabled`, `isAnalyticsAllowed`);
- **shell da landing/login** (`client/index.html`): sem script inline executável, sem
  `googletagmanager`/`gtag`, com `/theme-init.js` presente e servido de `'self'`.

## Condição de parada — status

- [x] landing e login sem violações CSP (só scripts `'self'` no shell buildado)
- [x] CSP mantida restritiva (sem `unsafe-inline`/wildcard em scripts)
- [x] aplicação interna sem regressão (suíte completa verde)
- [x] CI verde localmente (typecheck, lint, build, testes)
- [x] Graphify atualizado
- [ ] PR #191 aguardando **nova homologação** em staging — **sem merge**
