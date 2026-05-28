# LiciGov Pro — Governança Arquitetural e Estratégica

> Documento oficial de governança do projeto LiciGov Pro.
> Versão: 1.0 | Atualizado em: 2026-05-27

---

## Propósito

Este documento define os princípios, processos e responsabilidades que governam o desenvolvimento do LiciGov Pro. Serve como referência para decisões arquiteturais, técnicas e estratégicas.

---

## Princípios de Governança

### 1. Conformidade Legal Não é Negociável
- Toda funcionalidade deve estar em conformidade com a Lei 14.133/2021
- Qualquer exceção requer aprovação do responsável legal e documentação de risco
- Auditabilidade é requisito, não feature

### 2. Multi-tenant por Design
- `organizationId` é obrigatório em **toda** entidade de domínio
- Não existem dados "globais" acessíveis entre organizações
- Violações de tenant são erros críticos (log + alerta + bloqueio)

### 3. Imutabilidade de Registros de Auditoria
- ActivityLog é append-only; nenhuma linha é atualizada ou deletada
- Snapshots before/after preservam estado completo
- Fingerprints SHA-256 previnem adulteração retroativa

### 4. Staging antes de Domínio
- Dados externos NUNCA persistem diretamente no domínio
- Fluxo obrigatório: extração → staging → validação → revisão → aprovação
- Rastreabilidade de proveniência por célula/linha/página

### 5. Transparência de Decisões
- Toda decisão arquitetural relevante é documentada em ADRs
- ADRs têm contexto, alternativas consideradas e justificativa da decisão
- Decisões são revisitadas quando o contexto muda

---

## Processo de Decisão Arquitetural

### Quando Criar um ADR
- Mudança de stack tecnológica
- Novo padrão arquitetural
- Mudança em modelo de dados com impacto em múltiplos módulos
- Decisão de segurança ou conformidade legal

### Template de ADR
```markdown
# ADR-NNN: Título

## Status
[Proposta | Aceita | Depreciada | Supersedida por ADR-XXX]

## Contexto
[Por que esta decisão foi necessária]

## Decisão
[O que foi decidido]

## Alternativas Consideradas
[Outras opções avaliadas e por que foram descartadas]

## Consequências
[Impactos positivos e negativos da decisão]
```

ADRs ficam em: [governance/decisions/](./decisions/)

---

## Responsabilidades por Área

### Arquitetura
- Manter ADRs atualizados
- Revisar PRs com impacto arquitetural
- Definir padrões de código e estrutura de projeto

### Engenharia
- Seguir padrões estabelecidos nos ENGINEERING_STANDARDS
- Documentar código com JSDoc quando necessário
- Manter cobertura de testes ≥ 80%

### Produto
- Manter roadmap atualizado
- Definir priorização do backlog
- Validar conformidade funcional com Lei 14.133/2021

### Segurança
- Revisar qualquer mudança no modelo de autenticação/autorização
- Validar isolamento multi-tenant em novas features
- Aprovar mudanças na política de retenção

---

## Ciclo de Sprints

### Duração
- Sprints de 2 semanas (padrão)
- Micro-sprints de 1 semana para hardening (ex: 1.5, 1.8, 2.5, 2.8)

### Artefatos por Sprint
1. **README.md** da sprint — objetivos, entregas, decisões
2. **TECHNICAL_REPORT.md** — detalhes técnicos de implementação
3. **DECISIONS.md** — decisões tomadas durante a sprint
4. **TEST_RESULTS.md** — resultados de testes

### Critérios de Conclusão de Sprint
- Todos os testes passando
- Migrações aplicadas sem erros
- Documentação atualizada
- ADRs criados para novas decisões arquiteturais
- Code review aprovado

---

## Versionamento do Produto

### Esquema de Versões
```
[major].[minor].[patch]

- major: Mudança incompatível de API ou modelo de dados
- minor: Nova funcionalidade backward-compatible
- patch: Bug fix ou hardening
```

### Versões por Sprint
| Sprint | Versão | Tipo |
|---|---|---|
| Sprint 1 | 0.1.0 | Minor (foundation) |
| Sprint 1.5 | 0.1.5 | Patch (hardening) |
| Sprint 1.8 | 0.1.8 | Patch (prep) |
| Sprint 2 | 0.2.0 | Minor (core documental) |
| Sprint 2.5 | 0.2.5 | Patch (hardening) |
| Sprint 2.8 | 0.2.8 | Patch (import foundation) |
| Sprint 3 | 0.3.0 | Minor (CATMAT) |

---

## Gestão de Dívida Técnica

- Dívida técnica é registrada em [roadmap/TECHNICAL_DEBT.md](../roadmap/TECHNICAL_DEBT.md)
- Cada item tem: descrição, impacto estimado, prioridade, sprint-alvo
- Meta: não acumular mais de 20% de dívida técnica crítica sem endereçamento

---

*Para padrões de engenharia: [governance/ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md)*
*Para decisões arquiteturais: [governance/ARCHITECTURAL_DECISIONS.md](./ARCHITECTURAL_DECISIONS.md)*
