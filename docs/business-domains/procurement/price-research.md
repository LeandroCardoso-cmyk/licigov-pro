# Pesquisa de Preços — Workspace Vivo (PriceResearchWorkspace)

> A Pesquisa de Preços **não é um anexo**. É um **workspace próprio** — uma
> **entidade viva** (`PriceResearchWorkspace`) que persiste cada item de preço
> individualmente e alimenta o Item Intelligence Workspace.

## 1. Entidade viva, não documento

Sistemas comuns tratam a pesquisa de preços como um PDF anexado ao processo.
Aqui, a pesquisa é uma **entidade estruturada e navegável**:

- cada preço coletado vira um **registro individual** no banco;
- os registros alimentam diretamente os `IntelligentProcurementItem`;
- o workspace mantém proveniência, fonte e histórico de cada valor.

## 2. Formas de importação

O `PriceResearchWorkspace` aceita entrada por múltiplos meios:

| Origem | Comportamento |
|---|---|
| **PDF** | Extração e estruturação automática dos itens |
| **DOCX** | Extração e estruturação automática dos itens |
| **XLSX** | Mapeamento de colunas → campos do item |
| **CSV** | Mapeamento de colunas → campos do item |
| **Colar (paste)** | Interpretação de texto colado |
| **Manual** | Inserção campo a campo pelo servidor |

Toda importação é registrada na **Timeline append-only**.

## 3. Campos extraídos de cada item

Para cada linha/item de preço, o sistema extrai e persiste:

- `description` — descrição do item;
- `quantity` — quantidade;
- `unit` — unidade de medida;
- `supplier` — fornecedor;
- `brand` — marca;
- `model` — modelo;
- `value` — valor;
- `observations` — observações;
- `source` — fonte (documento, portal, painel de preços, etc.).

A extração assistida por IA ocorre **via `kernelAccessService`** (pipeline
oficial `server/_core/llm.ts`), nunca chamando o provedor diretamente.

## 4. Persistência item a item

```
arquivo/colagem/manual
        │
        ▼
 kernelAccessService  ──▶  extração estruturada dos campos
        │
        ▼
 para cada item detectado:
   ┌────────────────────────────────┐
   │ persiste registro individual   │  (SHA-256 determinístico, organizationId)
   └────────────────────────────────┘
        │
        ▼
alimenta IntelligentProcurementItem (preço médio, fornecedores)
```

> Nunca se persiste a pesquisa como um blob único. **Cada item é uma linha
> viva** no banco, editável e rastreável.

## 5. Do workspace ao Item Intelligence

Os registros do `PriceResearchWorkspace` são a base para:

- o **preço médio** (`averagePrice`) de cada item inteligente;
- a lista de **fornecedores** (`suppliers`);
- os **alertas** de preço fora da curva;
- a análise de **competitividade** feita pelos copilotos.

O painel lateral do item exibe, no bloco **"pesquisa usada"**, exatamente quais
registros do workspace fundamentaram o preço.

## 6. Qualidade e alertas

Os copilotos (em especial o **Copiloto de Pesquisa de Preços**) analisam os
registros e podem sinalizar:

- preço fora da curva;
- baixa quantidade de fontes;
- inconsistências entre unidade, quantidade e valor;
- fornecedores repetidos ou suspeitos de baixa competitividade.

Esses alertas **explicam** o motivo e **nunca bloqueiam** o servidor.

## 7. Rastreabilidade e multi-tenant

- Cada registro carrega `organizationId` (multi-tenant).
- IDs são **SHA-256 determinísticos**, garantindo replay safety.
- O acesso ao banco usa `getDb()` com degradação graciosa.
- Importações, edições e exclusões ficam na **Timeline append-only**, com
  provenance da fonte de cada valor.
