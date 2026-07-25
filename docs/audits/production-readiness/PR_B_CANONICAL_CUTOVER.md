# PR B — Fluxo Canônico e Interface · Corte controlado do pipeline legado

> Bloco B do `PRODUCTION_REMEDIATION_PLAN.md`. Entregue para homologação (sem merge).
> Base: branch `claude/rebuild-licigov-pro-bFyTO` sobre `main` = `e50aa87` (PR #187).

## 1. Decisão adotada

Adoção **definitiva do pipeline canônico** para o piloto (Opção 2 do plano de
remediação), autorizada pelo responsável do projeto, que confirmou **não haver
dados legados a preservar ou migrar**. O pipeline legado foi **desativado e
mantido inerte** — sem exclusão física nesta PR (a remoção do código é faxina
pós-piloto).

Jornada única, sem URL manual:

```
Processo Licitatório → listagem → criar/abrir → DFD → ETP → TR → Edital
```

**DFD, ETP, TR e Edital NÃO são módulos** — são etapas internas do mesmo
`processId`, expostas como abas de um único shell (`ProcessoLicitatorio.tsx`).

## 2. Mapa dos pipelines (antes da alteração)

| | Legado (ativo em produção antes da PR) | Canônico (North Star) |
|---|---|---|
| Menu "Processo Licitatório" | `/processos` → `Dashboard.tsx` | — (órfão) |
| Backend | `processesRouter` + `documentsRouter` | `procurementProcessRouter` (completo, tenant-scoped) |
| Frontend | `Dashboard`/`NewProcess`/`ProcessDetails` | `components/procurement/*` (9 workspaces, órfãos) |
| Central de Operações | nunca lia a tabela `processes` | já lia `procurementProcessesTable` |

Lacuna impeditiva encontrada: os 9 workspaces canônicos existiam, tipados e
ligados ao tRPC, mas **100% órfãos** — nenhuma rota os montava e **não havia
shell de navegação** entre etapas. Correção mínima = criar o shell + roteamento
(integração, não reconstrução). Nenhuma condição de PARADA foi acionada.

## 3. Correções mínimas realizadas (paridade de piloto)

- **Shell canônico** (`client/src/pages/ProcessoLicitatorio.tsx`): listagem →
  wizard → abas (Visão Geral, DFD, Pesquisa de Preços, Itens Inteligentes, ETP,
  TR, Edital). `processId` preservado entre etapas; breadcrumbs; painel lateral
  de inteligência do item; estados de loading/vazio; erros pt-BR. Toda regra de
  domínio permanece no backend (`procurementProcess.*`).
- **Roteamento** (`App.tsx`): `/processos` passa a servir o shell canônico.

## 4. Rotas legadas retiradas da navegação / redirects preservados

| Rota antiga | Ação | Destino |
|---|---|---|
| `/processos` | repontada | shell canônico |
| `/novo-processo` | redirect | `/processos` |
| `/processo/:id` | redirect | `/processos` |
| `/modulos` | redirect | `/dashboard` |
| `/test`, `/test2`, `/test3`, `/test4` | **removidas** | NotFound |

A home legada (`Dashboard.tsx`) e as telas `NewProcess`/`ProcessDetails` deixaram
de ser importadas por qualquer rota — ficam **órfãs/inertes** (sem acesso pela
interface, sem acesso por URL direta).

## 5. Impedir novas gravações no pipeline legado

- `processesRouter.create` (única entrada que duplicava o canônico) agora **recusa
  gravações** com erro estável `FORBIDDEN` + token `LEGACY_PROCESS_PIPELINE_DISABLED`
  (`server/domain/legacyPipeline.ts`). A tela que a consumia (`/novo-processo`) já
  redireciona.
- Como **não há dados legados**, nenhum processo legado pode existir; por
  consequência, as demais gravações legadas (itens, documentos, CATMAT) ficam
  **naturalmente inertes** — não há processo legado-alvo para escrever. Os routers
  legados permanecem **registrados apenas por inércia** (têm consumidores de
  LEITURA ainda alcançáveis — Admin, ActivityReport, criação de parecer — logo não
  foram desregistrados; ver §8).

## 6. Central de Operações — fonte canônica

- Confirmado: a Central já consome **exclusivamente** a fonte canônica
  (`procurementProcessesTable`) — sem leitura dupla, sem dual-write, sem dedup.
- **Causa de "não aparecer/não atualizar"** e correção:
  1. Ausência de invalidação → o shell agora invalida
     `departmentOperation.dashboard/indicators/monitoringPanel` ao criar/atualizar
     processo (aparece no Painel e nos indicadores sem refresh manual).
  2. `modality: ""` hardcoded → `db.listProcesses` passa a projetar a **modalidade
     real** e o Painel a exibe; ordenação determinística (updatedAt desc + id asc).
- Observação honesta: a aba "Visão Geral" é **orientada a eventos**
  (`operationalEventsTable`); processos aparecem no **Painel** e nos indicadores
  (`activeProcesses`), por design. Indicadores `pendingTasks`/`addendaCount`
  permanecem placeholders preexistentes (não são a fonte-processo; fora do escopo).

## 7. SEC-037 — upload seguro de anexo de tarefa

Reabilitado `departmentTasks.addAttachment` (antes desabilitado; aceitava
`fileUrl` arbitrário / risco SSRF). Pipeline seguro:

- autenticação + **autorização sobre a tarefa** (tenant + posse) antes de tudo;
- **allowlist** de MIME + validação de **conteúdo real por magic-bytes** + limite
  de 10 MB (`server/domain/taskAttachmentPolicy.ts`);
- **nome interno seguro** com prevenção de **path traversal**;
- gravação via **Storage Service (S3)** com chave `tasks/<taskId>/<ts>_<nome>`;
- persistência **tenant-scoped** (`createTaskAttachmentForOrganization`);
- **compensação** (remove o objeto do S3) se a persistência falhar — sem órfão;
- **auditoria** (`logActivity`); mensagens pt-BR;
- cliente envia **conteúdo em base64** (nunca URL). Reutiliza o padrão de
  `documentsRouter.uploadDocument` + `fileIngestionService` — sem storage paralelo.

Não há migration nesta PR: `task_attachments` usa isolamento por join com `tasks`
(padrão vigente); nenhuma coluna nova foi necessária.

## 8. Código legado mantido temporariamente (e por quê)

| Item | Motivo de manter inerte |
|---|---|
| `Dashboard.tsx`, `NewProcess.tsx`, `ProcessDetails.tsx` | Órfãos (sem rota); remoção física é faxina P3, fora do escopo. |
| `processesRouter`, `documentsRouter` | Ainda têm consumidores de **leitura** alcançáveis (Admin, ActivityReport, criação de parecer). Desregistrar provocaria regressão. |
| Rotas RC-2 (`/direct-contracts/*`, `/contracts/*`, `/parecer-juridico/*`) | Já fora da navegação; não fazem parte do pipeline DFD→Edital. |

## 9. Deixado para pós-piloto (P3)

- Remoção física do código legado (páginas, routers órfãos) — `LEGACY-070..074`.
- Renderização real de **DOCX/PDF** do Relatório Operacional (hoje entrega o
  conteúdo consolidado em Markdown; o botão passou a **entregar** o arquivo).
- `generateDFD` **por IA** no canônico (hoje o DFD é **importado** — atende o
  piloto; a geração do zero por IA é evolução).
- Migração de dark-mode dos workspaces `components/procurement/*` (mantidos com
  estilo próprio; fora do redesign).

## 10. Validação

- **Suíte completa:** 4268 passed / 102 skipped · **0 falhas** (baseline 4247 →
  +21: −8 testes do caminho de criação legada substituídos + 29 novos).
- **Typecheck:** `tsc --noEmit` limpo.
- **Build:** `pnpm build` ok (avisos de tamanho de chunk preexistentes).
- **Lint:** `pnpm lint` já era vermelho por 358 erros **preexistentes** não
  relacionados; os arquivos desta PR têm **0 erros** (apenas warnings
  `no-explicit-any` idiomáticos aos mocks de teste).
- Testes novos: política de anexo (13), router SEC-037 (8), wiring canônico (8),
  bloqueio de criação legada (4).
