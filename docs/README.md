# LiciGov Pro — Documentação

> Este diretório centraliza toda a documentação técnica e funcional do projeto LiciGov Pro.

> **📜 Constituição do Produto:** [architecture/PRODUCT_NORTH_STAR.md](./architecture/PRODUCT_NORTH_STAR.md)
> é a **fonte oficial da verdade** sobre a filosofia permanente do LiciGov Pro e tem
> **precedência** sobre qualquer documento de visão anterior. Toda implementação e
> documentação deve respeitá-la. Em caso de conflito, o PRODUCT_NORTH_STAR prevalece.

---

## Padrão Documental

### Princípios
1. **Documentação como código** — Todos os arquivos `.md` são versionados junto ao código
2. **Atualização obrigatória** — Cada sprint deve atualizar documentação relevante
3. **Específico ao domínio** — Nenhum texto genérico; sempre referenciando contexto do LiciGov Pro
4. **Linkagem interna** — Arquivos devem referenciar outros documentos relacionados

### Convenções de Nomenclatura
- Arquivos: `SCREAMING_SNAKE_CASE.md` para documentos principais
- Diretórios: `kebab-case` para subdiretórios temáticos
- READMEs: todo diretório com conteúdo substantivo tem um `README.md`

### Estrutura Padrão de Documento
```markdown
# Título — Subtítulo

> Metadados: versão, data, autor, status

## Visão Geral
[Contexto e propósito]

## Conteúdo Principal
[Seções específicas]

## Referências
[Links para documentos relacionados]
```

---

## Subdiretórios

| Diretório | Conteúdo |
|---|---|
| [architecture/PRODUCT_NORTH_STAR.md](./architecture/PRODUCT_NORTH_STAR.md) | **📜 Constituição do Produto — filosofia permanente (fonte oficial da verdade)** |
| [technical/](./technical/README.md) | Documentação técnica do sistema (APIs, schemas, serviços) |
| [functional/](./functional/README.md) | Documentação funcional (user stories, fluxos, regras de negócio) |
| [domain/](./domain/README.md) | Domínio jurídico-operacional (Lei 14.133/2021, tipos de documento) |
| [imports/](./imports/README.md) | Motor de importação (parsers, staging, canonicalização) |
| [security/](./security/README.md) | Segurança, multi-tenant, RBAC, criptografia |
| [workflows/](./workflows/README.md) | Workflows documentais e state machine |
| [integrations/](./integrations/) | Integrações externas (PNCP, CATMAT, CATSER) |
| [infrastructure/](./infrastructure/) | Infraestrutura (Railway, MySQL, deploy) |
| [observability/](./observability/) | Observabilidade (logs, métricas, alertas) |
| [ai/](./ai/) | Camada de IA (matching, sugestões, scoring) |
| [catmat/](./catmat/) | Integração CATMAT/CATSER |
| [legal/](./legal/) | Referências legais e conformidade |

---

## Responsabilidades

- **Tech Lead**: revisão e aprovação de documentação arquitetural
- **Engenheiros**: manutenção de docs técnicos ao longo das sprints
- **Product Owner**: validação de docs funcionais e de domínio

---

*Índice geral: [MASTER_INDEX.md](../MASTER_INDEX.md)*
