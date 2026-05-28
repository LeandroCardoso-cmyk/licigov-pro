# LiciGov Pro — Política Documental

> Política oficial de gestão de documentos do LiciGov Pro, fundamentada na Lei 14.133/2021 e LGPD.
> Versão: 1.0 | Atualizado em: 2026-05-27

---

## Finalidade

Esta política define as regras para criação, versionamento, aprovação, retenção e purge de documentos licitatórios geridos pelo LiciGov Pro. Visa garantir conformidade legal, rastreabilidade e segurança da informação.

---

## Classificação de Documentos

### Por Tipo
| Tipo | Código | Base Legal | Descrição |
|---|---|---|---|
| Termo de Referência | `tr` | Art. 6º, XXIII, Lei 14.133/2021 | Define objeto da contratação |
| Estudo Técnico Preliminar | `etp` | Art. 18, Lei 14.133/2021 | Analisa viabilidade da contratação |
| Edital | `edital` | Art. 25, Lei 14.133/2021 | Instrumento convocatório |
| Contrato | `contrato` | Art. 90, Lei 14.133/2021 | Formaliza contratação |

### Por Retenção (RetentionClass)

| Classe | Prazo | Aplicação | Base Legal |
|---|---|---|---|
| `legal_permanent` | Permanente | Editais, atos normativos | Art. 169, Lei 14.133/2021 |
| `legal_7years` | 7 anos | Contratos, TRs, ETPs aprovados | Prazo prescricional (art. 205 CC) |
| `operational_3years` | 3 anos | Documentos operacionais | Recomendação CONARQ |
| `draft_7days` | 7 dias | Rascunhos não promovidos | Gestão interna |
| `log_2years` | 2 anos | Logs de auditoria | LGPD + recomendação CGU |
| `temp_30days` | 30 dias | Arquivos temporários de importação | Gestão interna |
| `attachment_follows_document` | Segue o documento pai | Anexos de documentos | — |

---

## Ciclo de Vida de um Documento

### Fase 1: Elaboração (DRAFT)
- Documento é criado por operador ou manager
- Múltiplas versões podem ser salvas livremente
- Cada save cria uma versão imutável numerada
- Documento pode ser excluído somente pelo criador ou admin
- Retenção aplicada: `draft_7days` (purge automático se não promovido)

### Fase 2: Revisão (IN_REVIEW)
- Iniciada por manager ou superior
- Documento fica em hard lock automático
- Revisores podem adicionar comentários
- Apenas admin+ pode aprovar ou rejeitar
- Rejeição obriga preenchimento de motivo

### Fase 3: Aprovação (APPROVED)
- Documento é imutável
- Hash SHA-256 da versão aprovada é calculado e armazenado
- `snapshotFingerprint` encadeia com versões anteriores
- Retenção muda para classe definitiva (ex: `legal_7years` para contratos)
- Disponível para exportação oficial

### Fase 4: Arquivamento (ARCHIVED)
- Documento movido para arquivo histórico
- Manutenção por período de retenção
- Acessível apenas para leitura e auditoria
- Purge automático ao fim do período de retenção (com aprovação do gestor)

---

## Regras de Imutabilidade

### O que é imutável
1. **Versões aprovadas**: Nenhuma edição após aprovação; qualquer mudança gera nova versão
2. **Hashes de integridade**: SHA-256 calculado na aprovação não pode ser alterado
3. **Timeline**: Eventos da timeline nunca são removidos
4. **ActivityLogs**: Registros de auditoria são append-only
5. **Fingerprints**: Cadeia de fingerprints validável retroativamente

### O que pode ser editado
1. **Documentos em DRAFT**: Conteúdo pode ser editado livremente
2. **Documentos em REJECTED**: Podem retornar a draft para correção
3. **Metadados não-substantivos**: Título pode ser editado em draft

---

## Política de Comentários

### Comentários de Revisão
- Podem ser adicionados por qualquer membro (operator+)
- Threading: respostas são agrupadas em threads
- Comentários de bloqueio (blocking): impedem aprovação enquanto não resolvidos
- Resolução de comentário: apenas admin+ ou autor do comentário

### Comentários de Rejeição
- Obrigatórios ao rejeitar documento
- Mínimo de 20 caracteres
- Não podem ser editados após criação
- Visíveis para o operador responsável

---

## Controle de Versões

### Numeração
- Versões são numeradas sequencialmente: v1, v2, v3...
- Número de versão é imutável após criação
- Não existe "deletar versão"

### Restauração de Versão
- Admin+ pode restaurar uma versão anterior
- Restauração cria NOVA versão (não desfaz versões existentes)
- Evento de restauração registrado na timeline com referência à versão origem

---

## Exportação de Documentos

### Formatos Suportados
| Formato | Uso | Quem pode exportar |
|---|---|---|
| HTML | Visualização online | operator+ (documentos em qualquer status exceto draft) |
| DOCX | Edição off-system | manager+ (documentos aprovados) |
| PDF | Publicação e arquivo | operator+ (documentos aprovados ou arquivados) |

### Restrições
- Documentos em DRAFT não são exportáveis
- Exportações são registradas na timeline
- PDF de documentos aprovados inclui carimbo digital de integridade

---

## Gestão de Anexos

### Tipos de Anexo Aceitos
- Planilhas: `.xlsx`, `.csv`
- Documentos: `.pdf`, `.docx`
- Imagens: `.jpg`, `.png` (projetos de engenharia)
- Tamanho máximo: 50MB por arquivo

### Retenção de Anexos
- Classe `attachment_follows_document`: anexo tem mesma retenção do documento pai
- Ao purgar documento, todos os anexos são purgados junto
- Sem retenção independente de anexo (exceto se desvinculado)

---

## Purge e Descarte

### Processo de Purge
1. Sistema identifica documentos com retenção expirada
2. Notificação enviada ao `owner` da organização
3. Owner tem 30 dias para contestar (legal hold)
4. Após 30 dias sem contestação: purge automático
5. Log de purge preservado por 5 anos (conformidade)

### Legal Hold
- Owner pode aplicar hold em qualquer documento
- Hold suspende purge indefinidamente
- Hold deve ter justificativa documentada
- Apenas owner pode remover hold

---

*Para segurança: [docs/security/README.md](../docs/security/README.md)*
*Para workflows: [docs/workflows/README.md](../docs/workflows/README.md)*
