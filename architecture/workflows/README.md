# Workflows Architecture

## Document Workflow State Machine

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
draft ──────► in_review ──────► approved ──────► archived
  ▲               │                                  ▲
  │               └──────► rejected ─────────────────┘
  │                            │
  └────────────────────────────┘
           (pode reenviar)
```

### Transições Válidas

| De | Para | Quem pode |
|----|------|----------|
| draft | in_review | operator, manager, admin, owner |
| in_review | approved | manager, admin, owner |
| in_review | rejected | manager, admin, owner |
| rejected | draft | operator (próprio), manager+ |
| approved | archived | manager, admin, owner |
| qualquer | archived | manager, admin, owner |

## Import Session Workflow

```
uploaded → queued → parsing → extracted → normalized → awaiting_review
                                                              │
                                               ┌─────────────┼──────────────┐
                                               ▼             ▼              ▼
                                           approved       rejected       skipped
                                               │
                                         [Sprint 3]
                                               ▼
                                      ItemTR / Domínio
```

## Activity Log Flow

Toda ação de negócio dispara:
1. Operação de negócio (service layer)
2. `logActivity()` com snapshot de contexto
3. Registro imutável em `activity_logs`

Opcional: evento no `outbox_events` para processamento assíncrono.

## Lock Workflow

```
Usuário A solicita edição
       │
       ▼
ConcurrencyService.acquireLock(type="soft"|"hard")
       │
       ├── Sem lock ativo → lock adquirido, edição permitida
       │
       └── Lock de outro usuário
              ├── soft → aviso, mas permite edição
              └── hard → bloqueio, edição negada

Usuário A termina edição
       │
       ▼
ConcurrencyService.releaseLock()
       │
       ▼
Lock liberado para próximo usuário
```
