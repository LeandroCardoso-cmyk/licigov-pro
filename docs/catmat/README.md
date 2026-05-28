# CATMAT/CATSER — Documentação

## O que é CATMAT?

O **Catálogo de Materiais (CATMAT)** e **Catálogo de Serviços (CATSER)** são sistemas do Governo Federal que padronizam a identificação de materiais e serviços adquiridos pela Administração Pública.

## Relevância no LiciGov Pro

O CATMAT é fundamental para:
- Pesquisa de preços (Lei 14.133/2021, Art. 23)
- Padronização de descrições de itens em TR
- Comparação de preços entre diferentes processos
- Integração com PNCP e ComprasNet

## Status de Implementação

| Componente | Status |
|-----------|--------|
| CanonicalUnits registry (25 unidades) | ✅ Sprint 2.8 |
| Staging pipeline para itens brutos | ✅ Sprint 2.8 |
| Motor de importação CSV/XLSX | ✅ Sprint 2.8 |
| Matching semântico item → CATMAT | 📋 Sprint 3 |
| Interface de vinculação CATMAT | 📋 Sprint 3 |
| Import completo do catálogo CATMAT | 📋 Sprint 3 |

## Formato de Código CATMAT

```
XXXXX-X
│     └── Dígito verificador
└── 5 dígitos: código do item
```

## Integração Planejada (Sprint 3)

### CatmatMatchingService
```typescript
interface CatmatMatchResult {
  catmatCode:   string;
  description:  string;
  score:        number;      // 0–1
  level:        ConfidenceLevel;
  unit:         string;      // unidade canônica CATMAT
}

async function matchToCatmat(
  rawDescription: string,
  canonicalUnit?: string,
): Promise<CatmatMatchResult[]>
```

### Tabela catmat_items (Sprint 3)
- Import completo do catálogo (~500k itens)
- Índice full-text para busca semântica
- Normalização de unidades via CanonicalUnits registry
