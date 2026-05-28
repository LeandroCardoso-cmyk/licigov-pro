# LiciGov Pro — Documentação Funcional

> Documentação funcional do sistema: user stories, fluxos de trabalho e regras de negócio.
> Atualizado em: 2026-05-27

---

## Papéis e Permissões

O LiciGov Pro usa RBAC hierárquico com 5 papéis por organização:

| Papel | Descrição | Pode aprovar documentos? | Pode gerenciar membros? |
|---|---|---|---|
| `viewer` | Leitura somente | Não | Não |
| `operator` | Criação e edição de rascunhos | Não | Não |
| `manager` | Submissão para revisão | Não | Não |
| `admin` | Aprovação e gestão de documentos | Sim | Parcial |
| `owner` | Controle total da organização | Sim | Sim |

---

## Fluxos Principais

### 1. Criação e Aprovação de Documento

```
Operador cria rascunho (draft)
  → Edita conteúdo (versões automáticas a cada save)
  → Submete para revisão (in_review)
    → Reviewer adiciona comentários
    → Reviewer aprova (approved) ou rejeita (rejected)
      → Se aprovado: disponível para export e publicação
      → Se rejeitado: retorna ao operador com comentários
  → Documento aprovado pode ser arquivado (archived)
```

### 2. Importação de Planilha de Pesquisa de Preços

```
Usuário faz upload de arquivo CSV/XLSX
  → Sistema detecta formato e inicia parsing
  → Dados são extraídos para staging (NÃO persistem no domínio ainda)
  → Sistema normaliza unidades (CanonicalUnits)
  → Sistema atribui scores de confiança a cada item
  → Usuário revisa itens na interface de staging
    → Itens high-confidence: aprovação em lote
    → Itens low/uncertain: revisão individual obrigatória
  → Usuário aprova staging completo
  → Sistema promove dados ao domínio (ItemsPesquisaPreco)
```

### 3. Gestão de Membros da Organização

```
Owner convida usuário por email
  → Usuário recebe convite com link temporário
  → Usuário aceita e seleciona organização
  → Owner (ou admin) atribui papel ao novo membro
  → Membro passa a ter acesso conforme papel
```

---

## Tipos de Documento

### Termo de Referência (TR)
- **Base legal**: Art. 6º, XXIII, Lei 14.133/2021
- **Quando usar**: Nas contratações de serviços e obras
- **Seções obrigatórias**: Objeto, justificativa, especificações técnicas, estimativa de preços, prazo de entrega/execução

### Estudo Técnico Preliminar (ETP)
- **Base legal**: Art. 18, Lei 14.133/2021
- **Quando usar**: Antes do TR, para estudos de viabilidade
- **Seções obrigatórias**: Necessidade da contratação, análise de riscos, estimativa de custo

### Edital
- **Base legal**: Art. 25, Lei 14.133/2021
- **Quando usar**: Instrumento convocatório para licitação
- **Seções obrigatórias**: Objeto, regras de habilitação, critérios de julgamento, minuta contratual

### Contrato
- **Base legal**: Art. 90, Lei 14.133/2021
- **Quando usar**: Formalização do vínculo contratual
- **Seções obrigatórias**: Partes, objeto, valor, vigência, obrigações, penalidades

---

## Regras de Negócio Críticas

### RN-001: Imutabilidade de Versões
- Versões aprovadas de documentos são imutáveis
- Qualquer edição pós-aprovação cria nova versão
- Hash SHA-256 garante integridade retroativa

### RN-002: Workflow Unidirecional
- `approved → archived` é o único caminho forward após aprovação
- Não é possível voltar de `approved` para `in_review`
- `rejected` permite retornar a `draft` para correção

### RN-003: Lock de Edição
- Apenas um usuário pode ter hard lock por vez
- Soft lock é aviso; não bloqueia outros usuários
- Lock expira automaticamente após 60 minutos de inatividade

### RN-004: Staging Obrigatório para Importações
- Dados importados NUNCA são persistidos diretamente no domínio
- Todo dado importado passa por: extração → staging → validação → aprovação
- Proveniência de cada item é registrada (linha, coluna, arquivo original)

### RN-005: Retenção Documental
- Contratos têm retenção mínima de 7 anos (prazo prescricional art. 205 CC)
- Rascunhos não promovidos expiram em 7 dias
- Purge só ocorre após aprovação do gestor de documentos

### RN-006: Multi-tenant Absoluto
- Nenhum dado é compartilhado entre organizações
- `organizationId` é validado em CADA operação, sem exceção
- Violação de tenant é tratada como erro de segurança (log + alerta)

---

## Casos de Uso por Papel

### Operator
- Criar rascunho de documento
- Editar documento em draft ou rejected
- Adicionar comentários
- Fazer upload para importação
- Revisar itens de staging

### Manager
- Tudo do Operator
- Submeter documento para revisão

### Admin
- Tudo do Manager
- Aprovar ou rejeitar documentos em revisão
- Arquivar documentos aprovados
- Gerenciar locks
- Exportar documentos
- Aprovar staging de importações

### Owner
- Tudo do Admin
- Gerenciar membros (convidar, remover, alterar papéis)
- Configurar a organização
- Purgar documentos expirados

---

*Para documentação técnica: [docs/technical/README.md](../technical/README.md)*
*Para domínio jurídico: [docs/domain/README.md](../domain/README.md)*
