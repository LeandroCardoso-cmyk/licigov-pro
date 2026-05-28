# Release History — LiciGov Pro

## Releases em Produção (Railway)

| Versão | Sprint | Data | PR | Status |
|--------|--------|------|----|--------|
| v0.8.0 | Sprint 2.8 | Maio 2026 | #75 | Aguardando aprovação |
| v0.5.0 | Sprint 2.5 | Maio 2026 | #74 | Merged |
| v0.2.0 | Sprint 2 | Maio 2026 | #72/#73 | Merged |
| v0.1.8 | Sprint 1.8 | Maio 2026 | #70 | Merged |
| v0.1.5 | Sprint 1.5 | Maio 2026 | — | Merged |
| v0.1.0 | Sprint 1 | Maio 2026 | — | Merged |

## Estratégia de Versionamento

Veja [releases/VERSIONING_POLICY.md](../releases/VERSIONING_POLICY.md).

## Branch Model

```
main ◄────────── Produção (Railway auto-deploy)
  ▲
  │  merge via PR após aprovação
  │
claude/rebuild-licigov-pro-bFyTO ◄── Desenvolvimento atual
  ▲
  │
fix/staging-documents-schema ◄── Branch de teste (usuário valida aqui)
```

## Processo de Release

1. Desenvolvedor implementa na branch de desenvolvimento
2. Testes passam (100%)
3. Conflitos com main resolvidos localmente
4. PR criada contra main
5. Usuário revisa no Railway (staging)
6. Aprovação: "aprovado"
7. Merge para main → deploy automático Railway
