# Staging Releases

Registro de releases em ambiente de staging (testes pelo usuário).

## Processo

1. Claude Code implementa na branch de desenvolvimento
2. PR criada contra `main`
3. Railway gera preview deploy automaticamente (se configurado)
4. Usuário testa funcionalidades no ambiente de staging
5. Aprovação: "aprovado" → merge para main

## Branch de Staging

Branch utilizada para testes: `fix/staging-documents-schema`

## Checklist de Teste em Staging

- [ ] Login e seleção de organização funcionando
- [ ] Criação e edição de documento funciona
- [ ] Workflow de documento (draft → revisão → aprovação)
- [ ] Upload de arquivo (quando disponível na Sprint 3)
- [ ] Activity logs registrando corretamente
- [ ] Performance aceitável (< 2s para operações básicas)
