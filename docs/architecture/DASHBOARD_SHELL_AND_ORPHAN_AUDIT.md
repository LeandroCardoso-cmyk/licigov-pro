# Shell único + Home canônica (Centro de Operações) — RC-6

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
>
> Consolida a navegação autenticada do LiciGov Pro em torno de **um shell único**
> (`DashboardLayout`) e define o **Centro de Operações** como a **home canônica** pós-login.
> Mudança **mínima, aditiva e retrocompatível** — nenhuma página legada foi apagada.

## Decisão arquitetural

```
Login → /dashboard → AuthenticatedRoute (guarda) → DashboardLayout (shell) → Centro de Operações
```

- **Home canônica:** `pages/CentroOperacoes.tsx` → `components/department-operation/DepartmentOperationHome.tsx`.
- **`/dashboard` e `/centro-operacoes` renderizam a MESMA implementação** — sem duas versões, sem
  duplicar lógica/estado. Ambas as rotas usam o mesmo componente shelled (`OperationsHomeShellRoute`).
- **Shell único:** `components/DashboardLayout.tsx` (menu lateral consolidado já existente). O login
  **continua** redirecionando para `/dashboard`; apenas o componente associado à rota mudou.

### Rotas (estado final)

| Rota | Renderiza | Shell? |
|---|---|---|
| `/dashboard` | Centro de Operações (canônico) | ✅ |
| `/centro-operacoes` | Centro de Operações (mesma implementação) | ✅ |
| `/modulos` | `ModuleSelectionDashboard` (legado preservado) | ❌ (header próprio de seletor) |
| `/tirar-duvidas` | Tirar Dúvidas | ✅ |
| `/processos` | Processos Licitatórios | ✅ |
| `/contratacao-direta` | Contratação Direta | ✅ |
| `/parecer` | Parecer Jurídico | ✅ |
| `/contratos` | Contratos | ✅ |

### Como a duplicação de shell é evitada

O shell é aplicado **somente na composição de rota** (`withAuthenticatedShell` em `App.tsx`).
**Regra:** nenhuma página wrapped importa `DashboardLayout` diretamente. `pages/PublicationLogs.tsx`
(que já usa `DashboardLayout` internamente) **não** está entre as rotas wrapped — logo, não há
aninhamento. Os wrappers têm identidade estável (const de módulo) para não remontar a árvore.

### Headers próprios ajustados

- **`Dashboard.tsx` (/processos):** tinha header de aplicação completo (logo + usuário + logout +
  tema) que **duplicaria** o shell. Substituído pela faixa de título leve (Breadcrumbs + h1), padrão
  dos demais Business Domains. Funcionalidade preservada (métricas, lista, "Novo Processo").
- **Demais domínios** (Centro de Operações, Tirar Dúvidas, Contratação Direta, Parecer, Contratos):
  já usavam faixa leve — convivem com o shell sem conflito.

### Dívidas menores registradas (pós-homologação, não bloqueiam)

- O botão `BackToDashboard` na home (`CentroOperacoes`) fica redundante quando ela é a própria home;
  como `/dashboard` e `/centro-operacoes` compartilham o mesmo componente canônico, **não** foi
  forkado. Ajuste cosmético futuro.
- O `DashboardLayout` ainda não possui um **toggle de tema** no desktop nem o atalho admin de custos
  de IA que existiam no header antigo de `/processos`. O tema continua disponível em `/modulos`; a
  rota `/admin/ai-costs` segue acessível por URL/menu. Candidatos a um header institucional do shell.

---

## Auditoria de sobreposição — dashboards órfãos (decisão RC-6 nº 7)

Dois conjuntos de dashboards foram desenvolvidos em sprints anteriores e **nunca conectados** à
navegação. **Não** foram incorporados agora (nenhum é obrigatório para a home atual funcionar). Este
inventário orienta uma futura incorporação **seletiva** ao Centro de Operações.

### 1. `components/operational-dashboard/` — Analytics de Itens & Review (Sprint 3.1, #94)

| Componente | Papel | Dependências |
|---|---|---|
| `OperationalDashboardPage` | KPIs de análise de itens + resumo de review | tRPC `itemAnalytics.getDashboard`, `reviewWorkspace.getSummary`; **prop `organizationId` obrigatória** |
| `KPIWidget` | Cartão de KPI genérico (valor + tendência) | Nenhuma (apresentacional) |
| `ConfidenceDriftChart` | Gráfico de drift de confiança ao longo do tempo | Recebe séries por prop |
| `ReviewProductivityWidget` | Produtividade da revisão humana | Recebe dados por prop |

- **Capacidades úteis:** taxa de aceitação de candidatos, override rate, acurácia de catálogo,
  latência de revisão, uso de cláusulas, drift de confiança. **Domínio:** pipeline de importação /
  matching semântico (CATMAT), **não** operação geral do departamento.
- **Sobreposição com o Centro de Operações:** parcial com a aba **"Painel"**
  (`OperationalMonitoringPanel`), mas com foco distinto (qualidade de itens/review vs. acompanhamento
  operacional). `KPIWidget` e `ConfidenceDriftChart` são **reutilizáveis** e genéricos.
- **Permissões:** já é multi-tenant via `organizationId`; incorporar exige manter isolamento por
  tenant. Provável escopo de perfis técnicos/administrativos.

### 2. `components/executive-operations/` — Operação Executiva & SLA (Sprint 3.6, #104)

| Componente | Papel | Dependências |
|---|---|---|
| `ExecutiveOperationsDashboard` | KPIs executivos: estabilidade, throughput, adoção, backlog, incidentes | **Dados via props** (sem tRPC próprio — precisa de loader/fonte) |
| `SlaMonitorDashboard` | Monitor de SLA | Props |
| `DeploymentHealthCard` | Saúde de deployments por município | Props |

- **Capacidades úteis:** estabilidade institucional, throughput de workflow, taxa de adoção, backlog
  de suporte, incidentes críticos/altos, SLA, saúde de deployment. **Domínio:** observabilidade de
  produção / visão executiva multi-município.
- **Sobreposição com o Centro de Operações:** conceitual com a aba **"Painel"**, mas em nível
  **executivo/plataforma** (vários municípios) e não operacional-diário de um departamento.
- **Permissões:** sem escopo de tenant embutido (recebe tudo por props) — uma incorporação exigiria
  **loader com isolamento multi-tenant** e, muito provavelmente, **restrição admin/executivo**.

### Recomendação (futuro, não agora)

1. **Reutilizar já** (baixo risco) — `KPIWidget`, `ConfidenceDriftChart` como blocos genéricos em
   novas telas/abas, sem acoplar aos dashboards órfãos inteiros.
2. **Aba futura "Qualidade & Review"** no Centro de Operações — a partir de `OperationalDashboardPage`
   (já multi-tenant), quando o módulo de importação/itens entrar em homologação.
3. **Visão executiva separada** (admin) — `ExecutiveOperationsDashboard`/`SlaMonitorDashboard`/
   `DeploymentHealthCard` sob uma rota admin dedicada, **após** criar loaders com isolamento por
   tenant. **Não** deve ser a home do usuário operacional.
4. Enquanto não incorporados, permanecem como código não-referenciado (candidatos a limpeza se a
   incorporação for descartada).
