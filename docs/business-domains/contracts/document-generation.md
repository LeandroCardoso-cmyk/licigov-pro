# Geração Inteligente de Minutas

A **geração inteligente de documentos contratuais** é o **principal diferencial** do
Business Domain Contratos. A partir da legislação, jurisprudência, templates institucionais,
cláusulas obrigatórias/facultativas e boas práticas, o sistema produz minutas de alta
qualidade jurídica — **sempre revisáveis, nunca automáticas em caráter definitivo**.

Router: `generateDocuments` · Tabela: `contract_ws_documents`

> "O diferencial do sistema NÃO é apenas gerar texto com IA. O diferencial é **estruturar
> tecnicamente** a contratação pública com inteligência operacional, padronização e
> segurança jurídica."

## Documentos gerados

| Minuta | Contexto |
|---|---|
| **Contrato** | Instrumento principal, nascido de processo, contratação direta ou externo. |
| **Termo Aditivo** | Alteração de prazo/valor/quantitativo/qualitativo. |
| **Apostilamento** | Reajuste, alteração de gestor/fiscal, alterações legais. |
| **Rescisão** | Encerramento antecipado do contrato. |

## Como funciona

```
Contexto do Workspace + tipo de documento
      │
      ▼
Seleção de template institucional (contract_templates)
      │
      ▼
Composição de cláusulas obrigatórias + facultativas
      │  (apoiada por legislação, jurisprudência e boas práticas)
      ▼
Minuta com reasoning / explainability / provenance / confidence
      │  → REVISÃO HUMANA (aceitar, editar ou rejeitar cada sugestão)
      ▼
Document Engine → DOCX / PDF (por referência, sem duplicação)
```

### Cláusulas obrigatórias e facultativas
- **Obrigatórias:** exigidas pela Lei 14.133/2021 e pela natureza do instrumento; sempre
  presentes na minuta.
- **Facultativas:** sugeridas conforme o contexto (objeto, valor, tipo de alteração), com
  justificativa e nível de *confidence*. O usuário decide incluí-las ou não.

### Explainability e provenance
Cada cláusula sugerida traz:
- **Reasoning** — por que foi proposta.
- **Explainability** — a fundamentação (artigo de lei, jurisprudência, template).
- **Provenance** — a origem da sugestão.
- **Confidence** — o grau de confiança.
- **Rejeição** — o usuário pode **rejeitar** qualquer sugestão.

## Document Engine (DOCX/PDF)

A materialização em **DOCX e PDF** é responsabilidade do **Document Engine**, acessado via
**Kernel Access Service**. O domínio Contratos **não reimplementa** geração de arquivos: ele
compõe o conteúdo estruturado e delega a renderização. Os artefatos são referenciados em
`contract_ws_documents` — **nunca duplicados** entre domínios.

## Copilotos supervisionados

A composição das minutas é apoiada pelo **Multi-Copilot Orchestrator** (copilotos Jurídico,
Contratos e Agente de Contratação). Os copilotos **sugerem e explicam**, mas são
**supervisionados** e **nunca decidem** — a validação é sempre humana.

## Determinismo e rastreabilidade

- **Replay-safe:** a mesma entrada gera a mesma minuta; IDs derivam de `sha256`, sem
  `Date.now()`/`Math.random()`.
- **Multi-tenant:** todo documento pertence ao `organizationId` do Workspace.
- **Timeline:** cada geração é registrada pelo Timeline Engine para auditoria.

## Princípio inegociável

> Toda saída de IA é **editável, revisável e validada por humano**. Nenhuma minuta é
> aplicada como definitiva sem revisão.
