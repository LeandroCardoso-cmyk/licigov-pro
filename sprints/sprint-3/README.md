# Sprint 3 — Import Avançado + CATMAT + Interface de Revisão

**Status:** Planejada  
**Dependências:** Sprint 2.8 (Import Foundation Layer)

---

## Objetivo

Completar o motor de importação com extração real de PDF/DOCX, integração com CATMAT/CATSER, normalização semântica de itens e interface de revisão humana.

## Escopo Planejado

### Extração Real PDF/DOCX
- Integrar `pdf-parse` no `PdfParser` (extração de texto por página, tabelas por heurística)
- Integrar `mammoth` no `DocxParser` (parágrafos e tabelas)
- Substituir stubs por implementações completas

### Motor CATMAT/CATSER
- Importação e indexação do catálogo CATMAT completo
- Matching semântico: item bruto → código CATMAT
- Score de matching com threshold configurável por tenant

### Normalização Semântica
- `NormalizationService`: rawDescription → descrição normalizada
- Normalização de quantidades (parsing de "10 un", "5,5 kg")
- Normalização de preços (moeda, localidade PT-BR)
- Integração com `CanonicalUnits` registry

### Interface de Revisão Humana
- Tela de revisão: listagem de staging items com filtros
- Ações: aprovar / rejeitar / editar / pular
- Revisão em lote
- Indicadores visuais de confiança (high/medium/low/uncertain)
- Diff entre valor extraído e valor normalizado

### Queue Persistente
- Migrar `ImportQueueService` de memória para BullMQ + Redis
- Jobs persistentes entre deploys
- Dashboard de monitoramento de filas

### ItemTR Integration
- Aprovação de item de staging → inserção no `item_tr` (domínio)
- Validação de regras de negócio (Lei 14.133/2021)
- Histórico de proveniência preservado

## Critérios de Aceite
- [ ] Upload de PDF de edital → itens extraídos em staging
- [ ] Upload de DOCX de TR → itens extraídos em staging
- [ ] Matching CATMAT com score ≥ 0.7 para ≥ 80% dos itens de teste
- [ ] Interface de revisão funcional com filtros e ações
- [ ] Jobs persistentes sobrevivem a restart do servidor
- [ ] 100% dos testes existentes continuam passando

## Notas Arquiteturais

- Manter o princípio: **staging nunca persiste diretamente em domínio**
- A interface de revisão humana é o portão de qualidade obrigatório
- IA pode sugerir, mas humano aprova
