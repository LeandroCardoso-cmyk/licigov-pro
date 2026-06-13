---
name: brainstorming
description: Use esta skill antes de implementar qualquer feature nova ou fazer qualquer mudança significativa no LiciGov Pro. Com 3 problemas críticos de migração do Manus ativos, codar na direção errada tem custo alto.
---

# Skill: Brainstorming — Perguntar antes de codar no LiciGov Pro

## Verificação obrigatória antes de qualquer tarefa

### Passo 0 — Estado da migração Manus
Antes de QUALQUER coisa, verificar:

```
1. Plugin Manus removido do vite.config.ts?     → SIM / NÃO
2. Auth próprio implementado (sdk.ts limpo)?     → SIM / NÃO  
3. LLM migrando para Gemini direto?             → SIM / NÃO
```

Se qualquer resposta for NÃO e a tarefa depende dessas bases → aplicar a skill `manus-migration` primeiro.

---

## Perguntas obrigatórias para features novas

### 1. Qual módulo é afetado?
- [ ] Geração de documentos (DFD/ETP/TR/Edital) → verificar skill `doc-generation` + `lei-14133`
- [ ] Gestão do Departamento (tarefas/kanban) → módulo já implementado, verificar o que existe antes de refazer
- [ ] Autenticação → verificar migração Manus primeiro
- [ ] Integração CATMAT/CATSER → API pública, sem autenticação, padrão já documentado
- [ ] Relatórios (PDF/Excel) → padrão já implementado na gestão do departamento

### 2. Depende de IA (Gemini)?
- Se SIM → verificar se `server/_core/llm.ts` já foi migrado para Gemini
- Se NÃO → pode prosseguir independentemente da migração

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
ESTADO DA MIGRAÇÃO: [quais dos 3 críticos estão pendentes]

PROBLEMA: [1-2 linhas do que precisa ser resolvido]

MÓDULO AFETADO: [qual módulo do sistema]

DEPENDE DE MANUS? [SIM/NÃO — auth ou LLM]

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
