# Auditoria de Dashboard, Home, Navegação e UX Operacional
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

Classificação: **`DASHBOARD_HÍBRIDO`** — home canônica funcional com dados reais, mas rotas
legadas paralelas montadas, core do MVP no caminho legado e interações centrais mortas.

---

## 1. Rota pós-login e home efetiva

- **Após login:** `Login.tsx:20` navega para `/dashboard`.
- `/dashboard` **e** `/centro-operacoes` → **mesma implementação**: `CentroOperacoes` →
  `DepartmentOperationHome`, dentro do shell `DashboardLayout` (`App.tsx:143,156-157`).
- **Centro de Operações é a home canônica: confirmado.** Consome dados reais via
  `departmentOperation.*` (dashboard, indicators, recommendations, monitoringPanel, calendar,
  inbox, timeline).
- **Sem redirecionamento para dashboard legado.** `/modulos` (ModuleSelectionDashboard) existe
  apenas como rota passiva por URL direta, não é destino de nenhum redirect nem link ativo.

---

## 2. Matriz UI (home + sidebar + Business Domains)

| Elemento | Rota | Consumer tRPC | Canônico/Legado | Estado | Bloqueia piloto? |
|---|---|---|---|---|---|
| Home — Visão Geral (indicadores + eventos) | /dashboard | `departmentOperation.dashboard`/`.indicators` | Canônico | Funcional (dados reais); clique em evento sem ação | Não |
| Home — Recomendações | /dashboard | `departmentOperation.recommendations` | Canônico | Funcional | Não |
| Home — Painel de Monitoramento | /dashboard | `departmentOperation.monitoringPanel` | Canônico | Funcional | Não |
| Home — Calendário | /dashboard | `departmentOperation.calendar` | Canônico | Funcional; clique sem ação | Não |
| Home — Minha Caixa | /dashboard | `departmentOperation.inbox` | Canônico | Funcional; cliques sem ação | Não |
| Home — Timeline | /dashboard | `departmentOperation.timeline` | Canônico | Funcional | Não |
| Home — Registros (wizards) | /dashboard | `operationRecord.createRecord`/`.importLegacy` | Canônico | Funcional | Não |
| Home — botão "Relatório Operacional (DOCX/PDF)" | /dashboard | `departmentOperation.generateReport` | Canônico | **Quebrado** (retorno descartado) | Não (mina confiança) |
| Sidebar — Processo Licitatório | /processos | `processes.list` | **Legado ativo** | Funcional, dados reais | Não (mas IDOR no backend) |
| Sidebar — Contratação Direta | /contratacao-direta | `directProcurement.*` | Canônico | Funcional; sem tratamento de erro | Não |
| Sidebar — Parecer Jurídico | /parecer | `legalOpinionWorkspace.*` | Canônico | Funcional; sem tratamento de erro | Não |
| Sidebar — Contratos | /contratos | `contractWorkspace.*` | Canônico | Funcional | Não |
| Sidebar — Tirar Dúvidas | /tirar-duvidas | `institutionalConsultation.*` | Canônico | Funcional (com `isError` tratado) | Não |
| Sidebar — Templates | /templates | `templates.list` | Canônico | Funcional, **fora do shell** | Não |
| Sidebar — Configurações | /configuracoes | `documentSettings.*` | Canônico | Funcional, fora do shell | Não |
| /modulos (seletor legado) | /modulos | `contracts.analytics.getOverview`, `processes.list`, `directContracts.list`, `tasks.list` | Legado | Funcional; só por URL | Não |

---

## 3. Páginas órfãs (não referenciadas em App.tsx nem em outro arquivo)

1. `client/src/pages/Home.tsx` — scaffold de exemplo ("All content in this page are only for example"). **Órfã confirmada.**
2. `client/src/pages/Modules.tsx` — seletor de módulos antigo. **Órfã confirmada.**
3. `client/src/pages/ComponentShowcase.tsx` — vitrine shadcn com `console.log:197`. **Órfã confirmada.**
4. `client/src/pages/AdminPlatforms_ChecklistEditor.tsx` — **NÃO órfã** (importada por `AdminPlatforms.tsx:9` — falso positivo de nome).

As outras 45 páginas estão roteadas em `App.tsx`.

---

## 4. Módulos acessíveis vs inacessíveis pela navegação

**Acessíveis pela sidebar (sem URL manual):** Centro de Operações, Processos, Contratação
Direta, Parecer, Contratos, Tirar Dúvidas, Templates, Configurações, Plataformas (admin).
Importação de itens via aba "Registros" da home.

**Exigem URL manual (não linkados por nenhuma página ativa):** `/auditoria`, `/analytics`,
`/gestao-departamento`, `/personalizacao-documentos`, `/modulos`, `/gestao-comercial`, e todas
as rotas legadas (`/direct-contracts*`, `/contracts*`, `/parecer-juridico*`).

**Módulo canônico inacessível:** o módulo de Licitação canônico (procurementProcessRouter +
Workspaces DFD/ETP/TR/Edital em `components/procurement/*`) está **pronto no código mas sem
rota** — o menu "Processo Licitatório" usa o fluxo legado `Dashboard.tsx` (marcado
`@deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY`).

---

## 5. Dados reais vs mocks

**Confirmado reais** — todos os cards/contadores das homes ativas consomem tRPC contra tabelas
reais. Os únicos mocks hardcoded (`components/legal-ai/*`, `knowledge-graph/*`,
`semantic-retrieval/*`, `ai-context/*`) estão em bibliotecas de componentes **não roteadas** —
inalcançáveis pelo usuário (dead code, P3).

---

## 6. Achados de navegação e UX (resumo — detalhes em FINDINGS)

- **DASH-021 (P1):** botão de relatório da home descarta o retorno; cliques em eventos/inbox sem ação.
- **NAV-023 (P1, condicional):** sem seletor de organização; multi-org quebra. Single-org auto-resolve → não bloqueia piloto.
- **UI-054 (P2):** `/test`, `/test2`, `/test3` públicas em produção.
- **UI-055 (P2):** `NotFound` em inglês.
- **ERR-047 (P2):** componentes da home não tratam `isError` — falha de rede vira "departamento em dia".
- **NAV-081/082 (P3):** itens duplicados na sidebar; rotas fora do shell; rotas só por URL.
- **UX-079/080 (P3):** cores hardcoded quebram dark mode; `<h1>` duplicado nas telas de domínio.

---

## 7. Mudanças mínimas para permitir testes operacionais do piloto

1. **Blindar ou conectar o fluxo de Processos/DFD/ETP/TR** (decisão de arquitetura — ver Bloco B):
   corrigir o IDOR do legado (Bloco A) **ou** conectar o módulo canônico órfão. Sem isso, o core
   do MVP não é testável com segurança.
2. **Ocultar da navegação** as rotas legadas paralelas, `/modulos` e as `/test*` (remover ou
   proteger), para o servidor não cair em telas duplicadas/de debug.
3. **Corrigir DASH-021** (botão de relatório e cliques mortos) antes da demonstração institucional.
4. **Fazer a home enxergar os processos** que o usuário realmente cria (LEGACY-011), ou unificar
   a origem dos dados de licitação.
5. Traduzir `NotFound` e ativar tratamento de erro nos cards da home.

**Veredito:** nenhum P0 no frontend em si; os bloqueadores da home são de backend
(IDOR/desconexão canônico↔UI). Para um piloto single-org, a navegação é utilizável após as
mudanças mínimas acima.
