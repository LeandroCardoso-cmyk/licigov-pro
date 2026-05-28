# Sprint 2.8 — Decisões Arquiteturais

## ADR-010: Staging como barreira obrigatória entre extração e domínio

**Contexto:** Dados de importação são inerentemente incertos (qualidade variável, erros de OCR, headers ambíguos).

**Decisão:** `import_staging_items` é o único destino de dados extraídos. Domínio (ItemTR, CATMAT) só recebe dados após aprovação humana.

**Consequências:**
- Qualidade de dados garantida por revisão humana
- Dados ruins nunca contaminam o domínio
- IA pode sugerir, humano aprova
- Auditoria completa de quem aprovou o quê

---

## ADR-011: Confidence como metadado explícito, não filtro silencioso

**Contexto:** Parsers extraem dados com graus variados de certeza.

**Decisão:** Toda extração carrega `ConfidenceMetadata` explícita. O sistema nunca filtra silenciosamente itens de baixa confiança — eles aparecem na revisão com indicador de incerteza.

**Consequências:**
- Usuário vê TODOS os itens extraídos, inclusive os incertos
- Incerteza não é escondida, é sinalizada visualmente
- Revisor humano toma decisão informada

---

## ADR-012: Fila em memória com API compatível com BullMQ

**Contexto:** Sprint 2.8 precisa de fila mas infraestrutura Redis não está disponível.

**Decisão:** Implementar fila em memória com mesma API pública que BullMQ usaria. Sprint 3 substitui internals sem mudar chamadores.

**Consequências:**
- Jobs perdidos em restart (aceitável em desenvolvimento)
- Migração para Redis não requer mudança de API
- Retry e DLQ já funcionais desde o início

---

## ADR-013: ParseOptions com sourceChecksum obrigatório

**Contexto:** Proveniência requer identificação unívoca do arquivo fonte.

**Decisão:** `ParseOptions` exige `sourceChecksum` (SHA-256 do buffer). Calculado em `validateFile()` antes de qualquer operação.

**Consequências:**
- Rastreabilidade: item → linha → arquivo → checksum
- Deduplicação possível: mesmo checksum = mesmo arquivo
- Replay: arquivo + posição permitem re-extração
