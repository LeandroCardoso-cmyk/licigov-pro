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

**Deep link `/processo/:id` — documentado expressamente:** o `:id` é o ID **numérico**
da tabela legada `processes`. O fluxo canônico usa IDs **string** de
`procurementProcessesTable` e navega por **estado interno** no shell (não expõe URL
por processo). Como (a) não há dados legados e (b) os espaços de ID são distintos,
**não existe deep link válido a preservar** — o ID legado não tem alvo canônico.
A rota, portanto, não tem mais uso e redireciona à listagem canônica (comentário
correspondente em `App.tsx`).

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
- Renderização real de **DOCX/PDF** do Relatório Operacional. Hoje o Document
  Engine produz o relatório em **Markdown**; o botão ("Baixar relatório
  operacional") e o arquivo (`.md`) refletem o formato real — não prometem
  DOCX/PDF. A renderização binária permanece follow-up.
- `generateDFD` **por IA** no canônico (hoje o DFD é **importado** — atende o
  piloto; a geração do zero por IA é evolução).
- Migração de dark-mode dos workspaces `components/procurement/*` (mantidos com
  estilo próprio; fora do redesign).

## 9.1. Correção de homologação — criação canônica de processo (DATETIME)

Na 1ª homologação em staging, "Novo Processo → Criar processo" falhava com "Erro
ao criar o processo". **Causa-raiz:** o fluxo canônico gravava timestamps ISO
(`new Date().toISOString()` → `"…T…Z"`) em colunas MySQL `DATETIME(3)`, que o
MySQL em modo estrito rejeita. O pipeline legado nunca inseria datetime explícito
(usava o default do banco), por isso o bug só apareceu no canônico recém-conectado;
a suíte in-memory/mockada não o capturava (mesmo padrão já documentado no smoke de
consultas institucionais).

**Correção:** `db/procurement.ts` passou a usar os helpers oficiais
`toDbDatetime`/`fromDbDatetime` na fronteira do banco (escrita normaliza, leitura
volta a ISO). `createProcess` agora loga o erro técnico com `correlationId` (sem
mascarar) e retorna mensagem amigável pt-BR; a criação é idempotente (id
determinístico + `onDuplicateKeyUpdate`). Contraste dark mode das telas expostas
(listagem + wizard) corrigido com tokens semânticos. Guardado por um smoke MySQL
real ligado ao job "Smoke MySQL" do CI.

## 9.2. Lacuna reportada — "Criar DFD do zero" (geração por IA)

A opção **"Criar DFD do zero"** do wizard é aceita na CRIAÇÃO do processo (o
`startOption` é válido e persistido; o processo é criado corretamente). Porém a
capacidade de **gerar o DFD do zero por IA** NÃO existe no fluxo canônico: o
`DFDWorkspace` só oferece **importação** (`importDFD`) e não há procedure
`generateDFD` no `procurementProcessRouter` (achado da Fase 0). Ou seja, a etapa
DFD é alcançável e funcional por importação, mas a promessa "do zero por IA" não é
atendida na etapa seguinte.

Conforme instrução de homologação, **a opção NÃO foi removida nem desabilitada** —
a lacuna é registrada aqui para decisão do responsável (implementar `generateDFD`
por IA, rerotular a opção para refletir a importação assistida, ou desabilitá-la).
Fora do escopo desta correção pontual.

## 9.3. "Criar DFD do zero" agora funciona (homologação DFD)

**Consulta Graphify (antes de implementar):** apontou `dfdState.ts` (domínio de
estado do DFD), `DFDWorkspace.tsx`, o princípio "DFD é um estado, não um documento",
o serviço `generateDocument` (usado por ETP/TR) e a tabela `generated_documents`.

**Divergências confirmadas no código:**
- `importDFD` **não persistia** nada — criava um `createDFDState` em memória e só
  registrava um evento de timeline; o estado do DFD no workspace era client-side
  (por isso ficava sempre "Inexistente").
- `generateDocument` exige **itens aprovados** (que vêm depois do DFD) e tem conteúdo
  ETP/TR-específico → não serve para o DFD.
- `gemini.generateDFD` (legado) exige campos do processo legado (estimatedValue,
  category) inexistentes no canônico → não reutilizável de forma limpa.
- `DocumentKind` não incluía "dfd".

**Implementação (mínima, production-ready, reutilizando estrutura existente):**
- DFD passa a ser um **documento canônico** `generated_documents` de `kind "dfd"`,
  status "rascunho" — reutiliza `createGeneratedDocument`/`insertGeneratedDocument`/
  `listGeneratedDocuments` (aparece na Visão Geral). Sem tabela nova, sem migration
  (coluna `kind` é VARCHAR).
- `buildDFDDraft(object)` (domínio): rascunho **estruturado e editável** com as
  seções do art. 12 §1º. Determinístico, sem Kernel/IA.
- Serviço `generateDFDDraft`/`saveDFDDraft`; router `generateDFD`/`saveDFD`/`loadDFD`
  (tenantProcedure + requireProcess; idempotente por id determinístico `gdoc:{org}:{proc}:dfd`).
- `DFDWorkspace`: "Criar DFD do zero" → rascunho editável → "Salvar rascunho";
  estado passa de **Inexistente → Rascunho**; mantém "Importar DFD"; reflete na
  Visão Geral; continuidade para ETP/TR preservada (mesmo `processId`).
- **Formas de início**: a aba inicial agora segue o modo — `iniciar_etp` abre no
  ETP; `criar_dfd`/`importar_*` abrem no DFD (mesmo `processId`, sem URL manual).

**Supervisão humana preservada:** sempre rascunho, nunca aprovação automática.
**Capacidade de IA deferida:** a geração do DFD **assistida por IA plena**
(enriquecimento pela porta de IA) fica como evolução — a capacidade atual é a
elaboração estruturada editável (o DFDWorkspace informa isso ao usuário). A opção
"Criar DFD do zero" **não** foi removida nem renomeada.

**Dark mode:** os 7 workspaces canônicos (Visão Geral, DFD, Pesquisa de Preços,
Itens Inteligentes, ETP, TR, Edital) migrados para tokens semânticos e guardados
por `darkmode-tokens`.

**Graphify:** regenerado no commit (reflete `generated_documents kind "dfd"`, o
fluxo DFD canônico, routers/services novos e os workspaces ajustados).

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

## 11. Pipeline comum de exportação (DOCX/PDF)

Infraestrutura transversal reutilizável (ver `docs/architecture/DOCUMENT_EXPORT_PIPELINE.md`),
integrada **apenas** ao Processo Licitário (DFD/ETP/TR/Edital) nesta PR:

- `documentExportService` (módulo-agnóstico): conteúdo → DOCX/PDF → S3 → URL assinada.
- Fronteira RC-3.5.2 preservada: renderização via `documentEngineService.renderContent`
  (Engine é o único a acionar o DocumentConverter); storage isolado por tenant.
- Adapter do Processo: `procurementProcess.exportDocument` (mapeia processId+kind →
  conteúdo); botões DOCX/PDF por documento na Visão Geral.
- Adapters de Contratos/Aditivos/Contratação Direta/Parecer documentados (não
  implementados — aguardam autorização). Parecer já tem exportação parcial
  (`legalOpinionExportService`) a consolidar sobre o núcleo comum.

## 12. Acabamento institucional das exportações (PR #188)

Consulta Graphify + confirmação no código: o núcleo comum (`documentExportService`)
e o Document Engine já existiam; o `documentConverter` usa `marked` (v17, já no
projeto). Divergência confirmada: o **DOCX** fazia parsing ingênuo (`split("\n")`)
→ `_itálico_`/`>` vazavam como texto; o **PDF** usava `marked` mas `stripInline`
removia a ênfase. Ajustes (apenas apresentação — conteúdo persistido intocado):

- **Modelo intermediário comum** (`buildInstitutionalModel`) via tokens inline do
  `marked` — consumido pelos dois renderers (`renderInstitutionalDOCX/PDF`): mesmos
  metadados, seções, status; negrito/itálico reais; blockquote → **bloco de aviso**
  (sem `>`); nenhum marcador Markdown literal.
- **Cabeçalho institucional**: organização (via `getOrganizationById`), título do
  documento, processo, objeto (fiel, sem correção), **status**, versão, data de
  exportação. **RASCUNHO** destacado com aviso de revisão obrigatória.
- **DOCX e PDF** partilham o mesmo modelo lógico (diferem só no formato).
- **Nome de download determinístico** (`DFD_100-2026_rascunho_v1.docx`) separado da
  **chave interna** do storage (com timestamp) via `Content-Disposition` na URL
  assinada (`storageSignedUrl(..., downloadFileName)`).
- **Data pt-BR** (`formatBrazilianDateTime`, America/Sao_Paulo) só na apresentação;
  armazenamento interno permanece UTC.
- **Fronteira RC-3.5.2** preservada: os renderers vivem no `documentConverter`
  (renderer interno) e são acionados via `documentEngineService.renderInstitutionalContent`.
- Sem migration; `generated_documents` é rascunho único (versão 1). Segurança/tenant/
  auditoria inalterados; conteúdo buscado no backend, não confiado ao frontend.

Reutilizável pelos adapters futuros (Contratos/Aditivos/Contratação Direta/Parecer):
cada um fornece `{content, baseName, meta}` ao mesmo núcleo.
