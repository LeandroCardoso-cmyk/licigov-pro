# Ontology Validation

## Objetivo

`ontologyValidationService.ts` garante a **integridade semântica** do grafo:
nenhuma aresta inválida é persistida. A validação acontece **antes** da escrita,
no service e reforçada no router, impedindo que relacionamentos sem sentido
jurídico entrem no banco.

## Cadeia ontológica válida

O domínio do Knowledge Graph modela a cadeia de fundamentação
técnico-jurídica da Lei 14.133/2021:

```
Lei → Artigo → Inciso → Acórdão → Parecer → Cláusula → TR → Processo → Contrato
```

Cada nível pode se relacionar apenas com níveis compatíveis. A matriz de
compatibilidade codifica quais transições são semanticamente válidas.

## Matriz de compatibilidade

A validação é definida como um conjunto de triplas permitidas
`(sourceNodeType, targetNodeType, relationshipType)`:

| sourceNodeType | relationshipType | targetNodeType |
|---|---|---|
| `legislation` | `regulates` | `article` |
| `article` | `contains` | `clause` |
| `article` | `contains` | `subsection` |
| `clause` | `applies_to` | `technical_requirement` |
| `jurisprudence` | `references` | `legislation` |
| `legal_opinion` | `supports` | `process` |
| `technical_reference` | `derives_from` | `clause` |
| `process` | `results_in` | `contract` |

Qualquer par que **não** esteja na matriz é rejeitado.

## Exemplos

### Válidos

```ts
validateEdge('legislation', 'article', 'regulates')
// → { valid: true, violations: [] }

validateEdge('article', 'clause', 'contains')
// → { valid: true, violations: [] }

validateEdge('clause', 'technical_requirement', 'applies_to')
// → { valid: true, violations: [] }

validateEdge('jurisprudence', 'legislation', 'references')
// → { valid: true, violations: [] }
```

### Inválidos

```ts
validateEdge('supplier', 'legislation', 'regulates')
// → {
//     valid: false,
//     violations: [
//       "Tipo de origem 'supplier' não pode 'regulates' 'legislation'",
//     ],
//   }
```

Um fornecedor não regula legislação — a relação é rejeitada antes de qualquer
INSERT.

## Assinatura

```ts
function validateEdge(
  sourceType: NodeType,
  targetType: NodeType,
  relationshipType: RelationshipType,
): { valid: boolean; violations: string[] }
```

- **`valid`** — `true` somente se a tripla existir na matriz.
- **`violations`** — lista legível de motivos da rejeição (vazia quando válida).

## Violation reporting

Quando `valid` é `false`, cada violação descreve exatamente o que foi rejeitado:
tipo de origem, relacionamento tentado e tipo de destino. O router propaga essas
mensagens ao cliente como erro de validação, e o service registra a tentativa em
observabilidade para auditoria.

## Fluxo de aplicação

```
Router (tenantProcedure)
   │  1. validateEdge(source, target, rel)
   │     └─ inválido → rejeita (violations)
   │  2. nodeBelongsToOrg(source) && nodeBelongsToOrg(target)
   │     └─ falso → rejeita (ownership)
   ▼
knowledgeGraphService.createEdge()
   └─ insertKnowledgeEdge()  (só chega aqui se válido)
```

## Princípio

A ontologia é a **primeira linha de defesa** contra corrupção semântica. Ela é
determinística e pura: mesma tripla, mesmo resultado — sem estado, sem banco,
sem I/O. Isso a torna trivialmente testável e segura para replay.
