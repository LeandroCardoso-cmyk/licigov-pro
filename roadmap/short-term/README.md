# Roadmap de Curto Prazo

**Horizonte:** Próximas 2 sprints (Sprint 3–4)

## Sprint 3 — Import Avançado + CATMAT (Próxima)

### Entregas Críticas
- [ ] Extração real PDF com `pdf-parse`
- [ ] Extração real DOCX com `mammoth`
- [ ] Import completo do catálogo CATMAT
- [ ] Matching semântico item → CATMAT
- [ ] Interface de revisão humana (aprovação/rejeição por item)
- [ ] Fila persistente com BullMQ + Redis
- [ ] ItemTR: aprovação de staging → domínio

### Critérios de Aceite
- Upload PDF/DOCX extrai itens reais (não stub)
- Score CATMAT ≥ 0.7 para ≥ 80% dos itens de teste
- Interface de revisão funcional com filtros
- Fila persistente sobrevive a restart
- 100% dos testes existentes continuam passando

## Sprint 4 — IA Assistente

### Entregas Previstas
- Normalização de descrição de item com LLM
- Matching CATMAT assistido por IA
- Revisão de cláusulas contratuais
- Dashboard básico de KPIs
