# Prompt Guidelines — LiciGov Pro

## Objetivo

Este guia define como estruturar prompts eficazes para desenvolvimento do LiciGov Pro com Claude Code.

## Anatomia de um Prompt Eficaz

### 1. Contexto do Projeto
Sempre incluir:
- Nome do projeto: LiciGov Pro
- Stack: tRPC v11 + Drizzle ORM + MySQL + React 19 + Express + Railway
- Package manager: pnpm
- Branch de trabalho: `claude/rebuild-licigov-pro-bFyTO`

### 2. Sprints Anteriores Relevantes
Mencionar qual sprint fornece a base para a implementação solicitada. Exemplo:
> "Com base na Sprint 2.8 (Import Foundation Layer), implemente agora..."

### 3. Princípios Inegociáveis
Sempre incluir:
- Multi-tenant: `organizationId` obrigatório em toda operação
- Staging barrier: raw extraction nunca persiste no domínio
- Auditoria imutável: timeline e activity_logs são append-only

### 4. O Que NÃO Implementar
Delimitar explicitamente o que está fora do escopo. Exemplo:
> "NÃO implementar ItemTR, CATMAT, IA, matching semântico nesta sprint."

### 5. Entregáveis Esperados
Listar explicitamente:
- Arquivos de domínio
- Serviços
- Migrações
- Atualizações de schema
- Testes (quantidade mínima)

### 6. Regra de Conflitos (CRÍTICA)
Sempre incluir:
> "Antes de criar o PR: git fetch origin main + merge local + resolver conflitos + rodar testes. NUNCA entregar PR com conflitos."

## Template de Prompt

```
Com base em toda a arquitetura e implementação já concluídas do LiciGov Pro:
[listar sprints relevantes]

Realize agora uma: SPRINT X.Y — [NOME DA SPRINT]

### Contexto
[descrição do problema a resolver]

### Componentes a implementar
1. [Componente 1] — [descrição]
2. [Componente 2] — [descrição]

### Princípios obrigatórios
- [princípio 1]
- [princípio 2]

### NÃO implementar
- [item fora do escopo]

### Branch
Desenvolver em: claude/rebuild-licigov-pro-bFyTO

### Entregáveis
- [ ] server/domain/[arquivo].ts
- [ ] server/services/[serviço].ts
- [ ] drizzle/[migration].sql
- [ ] Testes: mínimo X testes
- [ ] PR sem conflitos com main
```
