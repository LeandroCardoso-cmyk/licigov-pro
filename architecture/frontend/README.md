# Frontend Architecture

## Stack

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| React | 19 | UI framework |
| TypeScript | 5.x | Type safety |
| tRPC client | v11 | API calls type-safe |
| TanStack Query | 5.x | Server state management |
| Tailwind CSS | 3.x | Styling |
| Vite | 5.x | Build tool |

## Estrutura de Pastas

```
client/
├── components/       # Componentes reutilizáveis
│   ├── ui/           # Design system base
│   ├── documents/    # Componentes de documentos
│   └── imports/      # Componentes de importação
├── pages/            # Páginas da aplicação
├── hooks/            # React hooks customizados
├── lib/              # Utilitários e helpers
│   ├── trpc.ts       # tRPC client setup
│   └── utils.ts
└── types/            # Tipos específicos do cliente
```

## Padrão de Componente com tRPC

```typescript
// Query
const { data, isLoading } = trpc.documents.list.useQuery({
  organizationId,
  limit: 20,
});

// Mutation
const createDoc = trpc.documents.create.useMutation({
  onSuccess: () => utils.documents.list.invalidate(),
});
```

## Multi-tenant no Frontend

- `organizationId` presente em todos os contextos de rota
- Seleção de organização no header para usuários multi-org
- Nenhuma query de negócio sem contexto de organização ativo

## Sprint 3+: Telas Planejadas
- `/import` — Upload e monitoramento de importações
- `/import/:sessionId/review` — Revisão de staging items
- `/documents` — Listagem e gestão documental
- `/documents/:id` — Editor de documento com diff e versões
