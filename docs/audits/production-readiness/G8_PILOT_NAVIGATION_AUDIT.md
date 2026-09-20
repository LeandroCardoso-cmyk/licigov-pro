# G8 — Auditoria de Navegação do Piloto (2026-09-20)

### LiciGov Pro · Gate de Produção Interna · item G8 ("Fluxo principal navegável e sem telas de debug/duplicadas")

> Auditoria do estado **real** do roteamento/navegação do cliente (`client/src/App.tsx`,
> `client/src/config/businessDomains.ts`, camadas de layout). Sem alteração de negócio; sem features novas.

## O que já está correto

- **Navegação principal canônica e limpa.** `businessDomains.ts` é a fonte única da navegação (Home /
  Sidebar): expõe os 5 domínios canônicos (`/processos`, `/contratacao-direta`, `/parecer`,
  `/contratos`, `/centro-operacoes`) + ferramentas (`/templates`, `/configuracoes`). Os caminhos
  **legados** constam apenas como `legacyPath` e são explicitamente listados em `LEGACY_PATHS` como
  **"NÃO devem aparecer na navegação principal"**. ⇒ requisito "legados fora da navegação" **atendido**.
- **Rotas de teste/debug fora do roteamento.** `/test`..`/test4` foram removidas do `App.tsx` (PR B) e
  há teste de fiação (`pr-b-canonical-wiring.test.ts`) garantindo que `App.tsx` não importa `TestPage`.
- **Redirects canônicos já ativos:** `/modulos` → `/dashboard`; `/novo-processo` → `/processos`;
  `/processo/:id` → `/processos`.
- **Sem bypass de auth:** todas as rotas de negócio (inclusive as legadas) passam por
  `AuthenticatedRoute` (auth + tenant). Rota direta não escapa de autenticação.

## Correção aplicada nesta rodada (segura)

- **Removidos os 4 arquivos órfãos de página de teste** (`client/src/pages/TestPage.tsx`,
  `TestPage2.tsx`, `TestPage3.tsx`, `TestPage4.tsx`). Já estavam **fora do roteamento** (não
  importados em lugar algum — confirmado; o único match é a asserção do teste de fiação). A remoção
  satisfaz o item "Páginas de teste (`/test*`) — REMOVER" também no nível de arquivo, sem risco.

## Bloqueio residual (por que G8 permanece PARTIAL)

As **rotas legadas** dos três domínios permanecem **montadas e acessíveis por URL direta**, servindo
UIs de CRUD legadas paralelas às canônicas:

| Legada (montada) | Canônica (nav) | Classificação |
|---|---|---|
| `/direct-contracts` (+ `/analytics`, `/new`, `/:id`) | `/contratacao-direta` (`DirectProcurementHome`) | Duplicada **e** internamente necessária |
| `/parecer-juridico` (+ `/analytics`, `/novo`, `/:id`) | `/parecer` (`LegalOpinionHome`) | Duplicada **e** internamente necessária |
| `/contracts` (+ `/new`, `/alerts`, `/:id`) | `/contratos` (`ContractsHome`) | Duplicada **e** internamente necessária |

**Por que não foram redirecionadas/removidas nesta rodada (decisão de segurança):** as páginas
legadas estão **ativamente cross-wired** por fluxos vivos, inclusive do **núcleo**:
- `client/src/pages/ProcessDetails.tsx` navega para `/parecer-juridico/novo?processId=…` e
  `/contracts/new?…` (criar parecer/contrato **a partir de um processo** — fluxo crítico do piloto).
- `client/src/pages/DirectContractDetails.tsx` navega para `/parecer-juridico/novo` e `/contracts/new`.
- As próprias listas legadas cross-navegam entre si (`/…/new`, `/…/:id`, `/…/analytics`).

As rotas canônicas são **Home único** (`/parecer`, `/contratos`, `/contratacao-direta`) e **não
possuem** hoje a entrada de criação-com-contexto (`/novo?processId=…`). Portanto:
- **Redirecionar** as legadas para as canônicas **quebraria** a criação com contexto (perda de
  `processId`/`contractId`) — fluxo útil e crítico. Proibido pelo mandato ("não mascarar fluxo
  quebrado", "não deletar funcionalidade útil só para passar o gate").
- **Migrar** os cross-links para as canônicas exigiria **construir** as entradas de criação-com-contexto
  nas Homes canônicas — **feature nova**, fora do escopo desta rodada.

⇒ A reconciliação da duplicação é uma **decisão de produto humana** + trabalho de fluxo canônico, não
uma limpeza segura autônoma. **G8 permanece `PARTIAL`** (não forçado a PASS).

## Condição objetiva de PASS (trabalho canônico, fora desta rodada)

1. Adicionar às Homes canônicas (`ParecerJuridico`, `Contratos`, `DirectProcurement`) as entradas de
   **criação/detalhe com contexto** hoje servidas pelas rotas legadas (`?processId=`, `?contractId=`, `:id`).
2. Migrar os cross-links do núcleo (`ProcessDetails`, `DirectContractDetails`) e das Homes canônicas
   para os caminhos canônicos.
3. Só então **redirecionar** as rotas legadas (`/direct-contracts`, `/parecer-juridico`, `/contracts`
   e sub-rotas) para as canônicas e remover os componentes legados com segurança.
4. Teste de fiação: nenhuma navegação para `LEGACY_PATHS`; rotas legadas redirecionam; smoke de
   navegação do fluxo principal (login → domínio → criar → detalhe → voltar).

Enquanto (1)–(3) não ocorrerem, as legadas seguem **fora da navegação** e **auth-protegidas**
(tratamento de "legado necessário internamente"), mas a **duplicação não está reconciliada** —
condição que mantém G8 em `PARTIAL`.

---

## Adendo — Fechamento canônico do G8 (2026-09-20)

Decisão de produto do owner: **os workspaces canônicos absorvem a criação/detalhe contextual**;
rotas legadas viram redirects de compatibilidade (transição governada, sem remoção abrupta). Executado
o **mínimo necessário reusando componentes/routers existentes** (sem service/router/CRUD paralelo):

1. **Equivalência canônica (reuso):** novas rotas `/parecer/novo`, `/parecer/analytics`, `/parecer/:id`;
   `/contratos/novo`, `/contratos/alertas`, `/contratos/:id`; `/contratacao-direta/novo`,
   `/contratacao-direta/analytics`, `/contratacao-direta/:id` — renderizando os **mesmos** componentes
   já testados (`NewLegalOpinion`/`LegalOpinionDetails`/`NewContract`/`ContractDetails`/
   `NewDirectContract`/`DirectContractDetails`/analytics), sob `AuthenticatedRoute` (auth+tenant).
   Detalhes passaram a ler `:id` via `useParams` (agnóstico à rota).
2. **Migração dos cross-links do núcleo:** `ProcessDetails` cria parecer/contrato via
   `/parecer/novo?processId=` e `/contratos/novo?...`; `DirectContractDetails` via `/parecer/novo?contractId=`
   e `/contratos/novo?...`. Nenhum componente migrado referencia mais paths legados.
3. **Legado → redirect de compatibilidade:** `/parecer-juridico*`, `/contracts*`, `/direct-contracts*`
   redirecionam ao canônico **preservando `:id` e query** (`LegacyRedirect` + render-prop). Sempre
   legado → canônico (sem loop). Deep links/bookmarks continuam válidos.
4. **Criação standalone sem dead-end:** os Homes canônicos já possuem criação própria
   (`DirectProcurementHome`/`ContractsHome` view "Novo"); parecer é orientado a caixa/solicitação
   (modelo institucional). Contextual via `/X/novo?params`.
5. **Guarda de regressão:** `client/src/g8-canonical-navigation.test.ts` (11 asserts) — rotas canônicas,
   ordenação estática-antes-de-`:id`, redirects preservando query/`:id`, núcleo sem legado, `useParams`,
   nav sem legados, sem `/test*`. Suíte completa verde; typecheck 0; build ok.

**Follow-ups não bloqueantes (transição, pós-RC-5):** remover componentes de lista legados órfãos
(`Contracts`/`DirectContracts`/`LegalOpinions`, já fora do roteamento); unificar as duas superfícies de
criação (view "Novo" do Home × formulário legado reusado) numa só; smoke visual dos fluxos em produção.

**Classificação: G8 = PASS** (critérios de navegação/duplicação/redirect/bypass atendidos e cobertos por
teste). Validação pela barra do repositório (source-scan + CI); sem ambiente de browser/staging nesta
execução — recomenda-se smoke visual operacional pós-deploy (não bloqueante).
