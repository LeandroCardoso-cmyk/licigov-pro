---
name: brainstorming
description: Use esta skill antes de implementar qualquer feature nova ou fazer qualquer mudança significativa no LiciGov Pro. Garante que a direção de implementação está correta antes de codar.
---

# Skill: Brainstorming — Perguntar antes de codar no LiciGov Pro

## Perguntas obrigatórias para features novas

### 1. Qual módulo é afetado?
- [ ] Geração de documentos (DFD/ETP/TR/Edital) → verificar skill `doc-generation` + `lei-14133`
- [ ] Gestão do Departamento (tarefas/kanban) → módulo já implementado, verificar o que existe antes de refazer
- [ ] Autenticação → auth próprio com email/senha + JWT (bcrypt + jose) — já implementado
- [ ] Integração CATMAT/CATSER → API pública, sem autenticação, padrão já documentado
- [ ] Relatórios (PDF/Excel) → padrão já implementado na gestão do departamento

### 2. Depende de IA (Gemini)?
- Se SIM → usar `server/_core/llm.ts` (Gemini 2.5 Flash via `@google/generative-ai`, já implementado)
- Se NÃO → pode prosseguir normalmente

### 3. O que JÁ EXISTE que pode ser reaproveitado?
No módulo de Gestão do Departamento já estão implementados:
- Sistema de comentários (backend completo)
- Sistema de anexos (backend completo, limite 10MB)
- Exportação PDF/Markdown e Excel com formatação
- Dashboard analítico com 4 KPIs + 4 gráficos
- Numeração sequencial de atividades

Verificar antes de reimplementar.

### 4. Qual é o "pronto"?
- Definir critério claro de conclusão
- Para documentos: gerado + validado com Zod + salvo no banco + exibido no editor
- Para UI: responsivo em mobile + desktop

---

## Formato de saída do brainstorming

```
PROBLEMA: [1-2 linhas do que precisa ser resolvido]

MÓDULO AFETADO: [qual módulo do sistema]

SOLUÇÃO PROPOSTA: [abordagem técnica resumida]

ARQUIVOS A MODIFICAR:
- server/_core/...
- server/routers/...
- client/src/pages/...
- drizzle/schema.ts (se houver mudança de banco)

REUTILIZA O QUÊ: [o que do módulo de Gestão pode ser reaproveitado]

FORA DO ESCOPO: [o que explicitamente NÃO será feito]

PRONTO QUANDO: [critério de conclusão]
```

Só avançar para o código após confirmação.
