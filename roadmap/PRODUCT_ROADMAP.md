# Product Roadmap — LiciGov Pro

**Atualizado:** Maio 2026  
**Versão:** 1.0

---

## Visão do Produto

LiciGov Pro é o sistema de gestão de licitações públicas mais avançado do Brasil, projetado para conformidade total com a Lei 14.133/2021 e operação segura em ambiente multi-tenant enterprise.

---

## Progresso Atual

| Sprint | Título | Status | Testes |
|--------|--------|--------|--------|
| Sprint 1 | Multi-tenant Foundation | ✅ Concluída | ~56 |
| Sprint 1.5 | Hardening Multi-tenant | ✅ Concluída | 22 |
| Sprint 1.8 | Optimistic Locking | ✅ Concluída | — |
| Sprint 2 | Core Documental | ✅ Concluída | 55 |
| Sprint 2.5 | Hardening Documental | ✅ Concluída | 76 |
| Sprint 2.8 | Import Foundation Layer | ✅ Concluída | 99 |
| **Sprint 3** | **Import Avançado + CATMAT** | 📋 Planejada | — |
| Sprint 4 | IA Assistente | 📋 Planejada | — |
| Sprint 5 | Dashboard + Analytics | 📋 Planejada | — |
| Sprint 6 | Assinatura Digital | 📋 Planejada | — |

---

## Curto Prazo (Sprint 3)

### Import Avançado
- Extração real PDF com `pdf-parse`
- Extração real DOCX com `mammoth`
- Normalização semântica de itens
- Interface de revisão humana (aprovação/rejeição por item)

### CATMAT/CATSER
- Import completo do catálogo CATMAT
- Matching semântico item bruto → código CATMAT
- Score de matching com threshold configurável

### Queue Persistente
- Migração de fila em memória → BullMQ + Redis
- Jobs persistentes entre deploys
- Dashboard de filas

### ItemTR Integration
- Aprovação de staging → ItemTR no domínio
- Regras de negócio Lei 14.133/2021
- Proveniência preservada

---

## Médio Prazo (Sprint 4–5)

### Sprint 4 — IA Assistente
- Sugestão automática de descrição normalizada (LLM)
- Matching CATMAT assistido por IA
- Revisão automatizada de cláusulas contratuais
- Detecção de inconsistências entre TR e proposta

### Sprint 5 — Dashboard + Analytics
- Painel de controle por organização
- Indicadores de pesquisa de preço
- Histórico de importações com métricas
- Relatórios de conformidade Lei 14.133/2021
- Alertas de prazo e validade de documentos

---

## Longo Prazo (Sprint 6+)

### Sprint 6 — Assinatura Digital
- Assinatura eletrônica de documentos
- ICP-Brasil (certificados digitais)
- Protocolo de assinatura multi-parte
- QR Code de autenticidade

### Sprint 7 — Integrações Governamentais
- PNCP (Portal Nacional de Contratações Públicas)
- ComprasNet
- Diário Oficial Eletrônico
- SIAFI/SIAPE (federal)

### Sprint 8 — Mobile + Offline
- App mobile para revisão de documentos
- Modo offline com sincronização
- Notificações push de prazos

---

## Invariantes do Produto

1. **Multi-tenant**: `organizationId` obrigatório em toda operação
2. **Staging barrier**: raw extraction nunca persiste no domínio
3. **Auditoria imutável**: timeline e activity_logs são append-only
4. **Conformidade LGPD**: retenção por classe, purge com legalHold
5. **Integridade criptográfica**: SHA-256 em versões e snapshots
