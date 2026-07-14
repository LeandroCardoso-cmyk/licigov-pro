# Arquitetura — Business Domain Contratos e Instrumentos Contratuais

## Visão geral

O Business Domain **Contratos** é a camada inteligente de **engenharia documental
contratual** do LiciGov Pro. Seu foco é **exclusivamente a geração inteligente de
documentos contratuais** — contratos, termos aditivos, apostilamentos e rescisões — a
partir da legislação (Lei 14.133/2021), jurisprudência, templates institucionais e boas
práticas.

> **Importante:** este domínio **NÃO é um ERP contratual**. Ele não controla pagamentos,
> empenhos, orçamento, patrimônio, almoxarifado, nem executa fiscalização financeira
> avançada. Seu diferencial é **estruturar tecnicamente** a instrumentalização do contrato
> com padronização e segurança jurídica.

## Arquitetura workspace-cêntrica

A unidade central do domínio é o **`ContractWorkspace`** (`server/domain/contractWorkspace.ts`),
um agregado que concentra todo o ciclo de vida documental de um contrato.

### Campos do Workspace
| Campo | Descrição |
|---|---|
| `id` | Identificador determinístico (sha256) |
| `organizationId` | Tenant (multi-tenant) |
| `originType` | `processo_licitatorio` \| `contratacao_direta` \| `externo` (via Reconstrução Assistida) |
| `originProcess` | Referência ao processo de origem (quando houver) |
| `contractNumber` | Número do contrato |
| `contractor` | Contratada |
| `object` | Objeto do contrato |
| `value` | Valor |
| `term` | Vigência / prazo |
| `status` | Estado atual (ver abaixo) |
| `manager` | Gestor (opcional) |
| `inspector` | Fiscal (opcional) |
| `createdAt` / `updatedAt` | Timestamps determinísticos |

### Estados (`status`)
`minuta` → `vigente` → `aditado` / `apostilado` → `encerrado` / `rescindido` → `arquivado`

Os estados **não seguem um fluxo fixo**: o **Adaptive Process Engine** decide as transições
conforme o contexto de cada contrato.

## Camadas

```
┌────────────────────────────────────────────────────────┐
│ Router tRPC  (contractWorkspaceRouter.ts)              │  ← superfície de API
├────────────────────────────────────────────────────────┤
│ Serviços     (contractService.ts)                      │  ← orquestração de fluxos
├────────────────────────────────────────────────────────┤
│ Domínio      (contractWorkspace.ts / contractInstruments.ts) │  ← regras e agregados
├────────────────────────────────────────────────────────┤
│ Kernel Access Service                                  │  ← única porta ao Kernel
├────────────────────────────────────────────────────────┤
│ Persistência (7 tabelas Drizzle / MySQL)               │
└────────────────────────────────────────────────────────┘
```

### Tabelas
- `contract_workspaces`
- `contract_ws_documents`
- `contract_addenda`
- `contract_ws_apostilles`
- `contract_occurrences`
- `imported_contracts`
- `contract_templates`

## Reuso do Kernel (nunca reimplementar)

O domínio **não reinventa** engines já existentes. Todo acesso passa pelo
**Kernel Access Service**, única porta de entrada ao Kernel:

- **Institutional Document Engine** (nome institucional de display do Document Engine) — gera
  DOCX/PDF das minutas.
- **Institutional Request Engine** — solicita Parecer Jurídico ao Business Domain Parecer
  Jurídico (`LEGAL_OPINION_INITIAL` / `LEGAL_OPINION_FINAL`). Nunca integra diretamente.
- **Timeline Engine** — registra o histórico e a rastreabilidade do contrato.
- **Adaptive Process Engine** — decide automaticamente a necessidade de parecer, aditivo,
  apostilamento ou geração documental (nunca fluxo fixo).
- **Multi-Copilot Orchestrator** — copilotos Jurídico, Contratos e Agente de Contratação
  (sempre supervisionados; nunca decidem sozinhos).

## Documentos por referência

Documentos **nunca são duplicados**. O Workspace referencia os artefatos gerados pelo
Document Engine e os pareceres produzidos pelo domínio Parecer Jurídico. Não há
upload/download manual entre domínios: os resultados são **disponibilizados automaticamente**.

## Minutas inteligentes e metadados auditáveis

Toda minuta gerada pelo domínio registra **metadados institucionais auditáveis**, garantindo
rastreabilidade completa da sua origem:

- **origem da cláusula**, **template** e **versão do template**
- **base legal** aplicada
- **copilotos participantes** e **recomendações aplicadas**
- **confidence**, **reasoning**, **explainability** e **provenance**

Esses metadados permitem auditar exatamente como cada trecho da minuta foi construído. Note-se
que contratos externos entram por **Reconstrução Assistida** (nunca extração perfeita) e nascem
como **minuta**, dependendo da validação do servidor. Ver
[`imported-contracts.md`](./imported-contracts.md).

## Multi-tenant e replay-safety

- **Multi-tenant:** toda entidade carrega `organizationId`; nenhuma query cruza tenants.
- **Determinístico / replay-safe:** todos os IDs derivam de `sha256` de entradas estáveis.
  **Nunca** se usa `Date.now()` nem `Math.random()`. O mesmo input sempre produz o mesmo
  resultado, permitindo replays seguros e auditoria confiável.

## Princípio central

> Toda sugestão da IA é **revisável**, com *reasoning*, *explainability*, *provenance* e
> *confidence*, e pode ser **rejeitada** pelo usuário. Nada é aplicado automaticamente sem
> validação humana.
