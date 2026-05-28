# Security Architecture

## Camadas de Segurança

### Autenticação
- JWT com expiração máxima 24h
- bcrypt com salt factor 12 para senhas
- Senha de assinatura separada da senha de login (`signaturePassword`)

### Autorização (RBAC)
```
viewer   (1) → leitura apenas
operator (2) → criar/editar próprios documentos
manager  (3) → aprovar/rejeitar documentos
admin    (4) → gerenciar organização
owner    (5) → todas as operações incluindo purge
```

### Isolamento Multi-tenant
- Todo SELECT inclui `WHERE organizationId = ?`
- Middleware verifica `orgMembership` antes de qualquer operação
- Cross-tenant: impossível por design de API

### Upload de Arquivos
- Validação de MIME type antes de processar
- Limite de 50MB por arquivo
- `scanStatus` preparado para antivírus (pending → clean/infected/error)
- Arquivos nunca executados no servidor

### Integridade de Documentos
- `contentHash` SHA-256 por documento
- `snapshotFingerprint` por versão
- `validateIntegrity()` detecta adulteração

### Proteção contra Injeção
- Drizzle ORM usa prepared statements (sem SQL injection)
- tRPC usa Zod para validação de input (sem prototype pollution)
- Nenhuma query raw SQL sem sanitização explícita

## Security Checklist por Sprint

- [ ] Toda nova entidade tem `organizationId` obrigatório
- [ ] Todo upload passa por `validateFile()` antes de processar
- [ ] Toda procedure tRPC tem validação de input Zod
- [ ] Nenhuma rota pública acessa dados de tenant sem auth
- [ ] Logs não expõem dados sensíveis (PII, senhas, tokens)
