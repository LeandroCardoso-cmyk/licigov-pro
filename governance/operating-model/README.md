# Operating Model

## Modelo de Desenvolvimento

### Ciclo de Sprint

```
Prompt Estratégico
       │
       ▼
Claude Code implementa na branch de desenvolvimento
       │
       ▼
Testes automatizados (100% obrigatório)
       │
       ▼
Resolução de conflitos com main
       │
       ▼
PR criada (sem conflitos)
       │
       ▼
Usuário revisa no Railway (staging)
       │
       ▼
"aprovado" → merge para main → deploy automático
```

### Responsabilidades

| Papel | Responsabilidade |
|-------|-----------------|
| Claude Code | Implementação, testes, resolução de conflitos, PR |
| Usuário/Owner | Revisão funcional, aprovação, feedback |
| Railway | Deploy automático, infraestrutura, backups |

### Critérios de "Pronto"
- [ ] Todos os testes passando
- [ ] Sem conflitos com main
- [ ] Migrações aplicáveis sem downtime
- [ ] PR com descrição completa
- [ ] Bootstrap safety nets atualizadas
- [ ] Documentação de sprint atualizada

## Modelo de Comunicação

### Problemas Técnicos
Abrir issue no GitHub com:
- Sprint afetada
- Comportamento esperado vs. atual
- Logs relevantes

### Decisões Arquiteturais
Registrar em `governance/decisions/` como ADR antes de implementar.

### Dívida Técnica
Registrar em `roadmap/TECHNICAL_DEBT.md` com severidade e plano.
