# IA — Documentação

## Uso de IA no LiciGov Pro

### Princípio Fundamental
> **IA assiste, humano decide.**  
> Toda sugestão de IA é apresentada como recomendação, nunca aplicada automaticamente em dados de negócio.

## Status de Implementação

| Componente | Status | Sprint |
|-----------|--------|--------|
| Configuração AI_CONFIG | ✅ Ativo | 1.x |
| IA na geração de texto de documentos | 🔧 Básico | 1.x |
| Normalização de descrições com IA | 📋 Planejado | 4 |
| Matching CATMAT assistido por IA | 📋 Planejado | 3-4 |
| Revisão de cláusulas contratuais | 📋 Planejado | 4 |
| Detecção de inconsistências TR/proposta | 📋 Planejado | 4 |

## Configuração

```typescript
// server/config/ai.ts
export const AI_CONFIG = {
  provider: process.env.AI_PROVIDER ?? "anthropic",
  model:    process.env.AI_MODEL    ?? "claude-sonnet-4-6",
  apiKey:   process.env.AI_API_KEY  ?? "",
};
```

## Casos de Uso Planejados (Sprint 4)

### 1. Normalização de Descrição de Item
Input: `"Caneta esferográfica azul, ponta média"`  
Output: `"Caneta esferográfica, corpo plástico, tinta azul, ponta média 0,7mm, traço 0,5mm"`

### 2. Matching CATMAT com LLM
Input: raw description + top-5 candidatos CATMAT  
Output: código CATMAT recomendado + justificativa

### 3. Revisão de Cláusula Contratual
Input: texto da cláusula  
Output: alertas de não-conformidade com Lei 14.133/2021

## Guardrails

- Nenhuma ação de IA modifica dados de negócio sem confirmação humana
- Sugestões de IA têm `confidence` explícita
- Log de todas as interações com IA para auditoria
- Custo de API monitorado por organização
