# Domain Architecture

## Bounded Contexts

O LiciGov Pro é organizado em contextos delimitados seguindo princípios de DDD:

### Contexto: Organização e Acesso
- `organizations` — tenants da plataforma
- `organization_members` — papéis e permissões
- `users` — identidade dos usuários

### Contexto: Processo Licitatório
- `processes` — processos licitatórios com optimistic locking
- `documents` — documentos com lifecycle completo
- `document_versions` — histórico imutável de versões
- `document_drafts` — rascunhos de edição
- `document_timeline` — auditoria imutável
- `document_attachments` — anexos tenant-safe

### Contexto: Importação
- `import_sessions` — sessões de importação de arquivos
- `import_staging_items` — itens brutos aguardando revisão humana

### Contexto: Auditoria e Observabilidade
- `activity_logs` — log imutável de ações de negócio
- `outbox_events` — eventos de domínio para processamento assíncrono

## Invariantes de Domínio

1. **organizationId obrigatório**: nenhuma entidade de negócio existe sem tenant
2. **Timeline imutável**: eventos de auditoria são append-only, nunca modificados
3. **Staging barrier**: dados importados nunca persistem diretamente no domínio
4. **Versões imutáveis**: versões de documento são append-only após criação
5. **Confidence explícita**: toda extração carrega metadados de confiança

## Tipos de Documento (Lei 14.133/2021)

```
edital       → legal_permanent
contrato     → legal_permanent
aditivo      → legal_permanent
ata          → legal_7years
parecer      → legal_7years
tr           → operational_3years
etp          → operational_3years
dfd          → operational_3years
nota_tecnica → operational_3years
relatorio    → operational_3years
outros       → operational_3years
```
