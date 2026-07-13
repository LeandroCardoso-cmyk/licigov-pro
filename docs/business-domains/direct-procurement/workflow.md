# Fluxo de Trabalho — 15 etapas e o Adaptive Process Engine

## Máquina de estados

O `DirectProcurementWorkspace` é conduzido por uma máquina de **15 etapas**.
A ordem lógica é fixa, mas etapas condicionais são **puladas automaticamente**
pelo Adaptive Process Engine — nunca existe um fluxo rígido único.

| # | Etapa | Descrição | Condicional? |
|---|---|---|---|
| 1 | `NEW` | Criação do workspace, definição de modalidade | Não |
| 2 | `DFD` | Documento de Formalização da Demanda | **Opcional** |
| 3 | `LEGAL_BASIS` | Seleção do fundamento legal (Art. 74/75) | Não |
| 4 | `NEED_CHARACTERIZATION` | Caracterização da necessidade | Não |
| 5 | `PRICE_RESEARCH` | Pesquisa de preços (import do Price Research) | Condicional |
| 6 | `PROCEDURE` | Configuração eletrônico/presencial | Não |
| 7 | `PROPOSAL_COLLECTION` | Recebimento de propostas | Condicional |
| 8 | `CONTRACT_JUSTIFICATION` | Justificativa da contratação | Não |
| 9 | `PRICE_JUSTIFICATION` | Justificativa do preço | Não |
| 10 | `REQUIRED_DOCUMENTS` | Checklist dinâmico de documentação | Não |
| 11 | `LEGAL_OPINION` | Parecer jurídico (via Institutional Request) | **Configurável** |
| 12 | `RATIFICATION` | Ratificação pela autoridade competente | Não |
| 13 | `PUBLICATION` | Geração da publicação | Não |
| 14 | `CONTRACT` | Formalização contratual | Não |
| 15 | `ARCHIVED` | Encerramento e arquivamento | Não |

## Adaptive Process Engine

O motor decide, a partir da **modalidade** e das **flags** do workspace, quais
etapas condicionais são obrigatórias, opcionais ou puladas.

### Regras por modalidade

| Etapa | Dispensa (Art. 75) | Inexigibilidade (Art. 74) |
|---|---|---|
| `PRICE_RESEARCH` | **Obrigatória** | Opcional |
| `PROPOSAL_COLLECTION` | **Obrigatória** | Opcional |
| `DFD` | Opcional | Opcional |
| `LEGAL_OPINION` | Configurável | Configurável |

A lógica: na **dispensa**, há disputa/comparação de preços, então pesquisa de
preços e recebimento de propostas são obrigatórios. Na **inexigibilidade**, a
contratação decorre de inviabilidade de competição (fornecedor exclusivo, notória
especialização etc.), tornando essas etapas opcionais.

### Flags configuráveis

Via `configureFlags` (router) o operador ajusta:

- `dfdEnabled` — inclui/exclui a etapa `DFD`;
- `priceResearchRequired` — força ou libera `PRICE_RESEARCH`;
- `proposalCollectionRequired` — força ou libera `PROPOSAL_COLLECTION`;
- `legalOpinionRequired` — inclui/exclui `LEGAL_OPINION`.

## Como uma etapa é pulada

Quando o motor determina que uma etapa condicional não se aplica:

1. a etapa é marcada como `SKIPPED` (não como concluída);
2. o Timeline Engine registra o salto com a **razão** (`reasoning`);
3. a transição avança direto para a próxima etapa aplicável.

O salto é sempre **explicável e reversível**: reativar a flag reintroduz a etapa.

## Exemplos de fluxo

**Dispensa completa (com DFD):**
```
NEW → DFD → LEGAL_BASIS → NEED_CHARACTERIZATION → PRICE_RESEARCH →
PROCEDURE → PROPOSAL_COLLECTION → CONTRACT_JUSTIFICATION →
PRICE_JUSTIFICATION → REQUIRED_DOCUMENTS → LEGAL_OPINION →
RATIFICATION → PUBLICATION → CONTRACT → ARCHIVED
```

**Inexigibilidade enxuta (sem DFD, sem propostas, sem pesquisa):**
```
NEW → LEGAL_BASIS → NEED_CHARACTERIZATION → PROCEDURE →
CONTRACT_JUSTIFICATION → PRICE_JUSTIFICATION → REQUIRED_DOCUMENTS →
RATIFICATION → PUBLICATION → CONTRACT → ARCHIVED
```
(as etapas `DFD`, `PRICE_RESEARCH`, `PROPOSAL_COLLECTION` e `LEGAL_OPINION`
foram puladas por configuração.)

## Transições

Cada transição (`updateStage` e as operações específicas como `selectLegalBasis`,
`ratify`, `publish`) valida as pré-condições da etapa atual, aplica a regra e
persiste o novo estado de forma determinística. Nenhuma transição usa relógio ou
aleatoriedade — o replay reproduz exatamente o mesmo caminho.
