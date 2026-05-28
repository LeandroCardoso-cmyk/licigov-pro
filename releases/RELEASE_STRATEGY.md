# Release Strategy — LiciGov Pro

## Modelo de Branches

```
main                    → Produção (Railway auto-deploy em push)
  ◄── PR aprovada
development branch      → Feature em desenvolvimento
  ◄── cherry-pick / merge
staging branch          → Teste pelo usuário
```

## Pipeline de Release

1. **Desenvolvimento**: feature branch `claude/rebuild-licigov-pro-*`
2. **Integração**: `git fetch origin main && git merge origin/main` (resolver conflitos)
3. **Testes**: `pnpm vitest run` (100% obrigatório)
4. **PR**: contra `main`, com descrição completa de entregas
5. **Revisão**: usuário valida no Railway (staging)
6. **Aprovação**: merge para main → deploy automático

## Critérios de Release

### Obrigatórios
- [ ] 100% dos testes passando
- [ ] Sem conflitos com main
- [ ] Migrações aplicáveis sem downtime (CREATE IF NOT EXISTS, ADD COLUMN)
- [ ] Bootstrap safety nets atualizadas
- [ ] PR com descrição completa

### Desejáveis
- [ ] Sem regressão de performance
- [ ] CHANGELOG.md atualizado
- [ ] Sprint history documentada

## Hotfix Policy

Em caso de bug crítico em produção:
1. Branch `hotfix/descricao-breve` de main
2. Fix mínimo necessário
3. Testes passando
4. PR → main (merge imediato após review)
5. Cherry-pick para branch de desenvolvimento
