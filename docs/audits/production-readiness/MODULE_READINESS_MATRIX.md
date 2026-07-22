# Matriz de Prontidão por Módulo
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

Estados: **pronto** · **pronto com ressalvas** · **parcial** · **legado** · **inacessível** ·
**quebrado** · **mock** · **não auditado** · **fora do piloto**.

| Módulo | UI | Backend | Persist. | Tenant | RBAC | Auditoria | IA | Testes | Estado | Achados-chave |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|---|
| **Centro de Operações** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | n/a | ⚠️ | **pronto com ressalvas** | DASH-021, LEGACY-011 |
| **Contratação Direta** (canônico `/contratacao-direta`) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | **pronto com ressalvas** | AI-015, DOC-2 (sem download UI) |
| **Parecer Jurídico** (canônico `/parecer`) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | **pronto com ressalvas** | DOC-2, DOC-084 |
| **Contratos e Aditivos** (canônico `/contratos`) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | **pronto com ressalvas** | DATA-039 |
| **Tirar Dúvidas** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | **pronto com ressalvas** | AI-015 (mock silencioso) |
| **Documentos / Export** (Document Engine) | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ | n/a | ✅ | **pronto com ressalvas** | Download só em Contratos |
| **Processos Licitatórios** (legado `/processos`) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ⚠️ | ⚠️ | **parcial (IDOR)** | **TENANT-001**, DATA-013 |
| **DFD/ETP/TR/Edital** (legado no processo) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | **parcial** | ARCH-025, LEGACY-010 |
| **Módulo Licitação canônico** (Workspaces) | ❌ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | **inacessível** | **LEGACY-010** (órfão do frontend) |
| **Importação de itens** | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ | n/a | ⚠️ | **parcial** | só Excel; LEGACY-074 (pipeline órfão) |
| **CATMAT/CATSER** | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | **pronto com ressalvas** | TENANT-038, DOC-016 |
| **Gestão / Tarefas** | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | n/a | ❌ | **parcial (IDOR)** | **TENANT-002**, SEC-037, TEST-053 |
| **Colaboração / Comentários** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | n/a | ⚠️ | **parcial** | parte de TENANT-002 |
| **Aprovação / Workflow** | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | n/a | ⚠️ | **parcial (memória)** | AUDIT-020 |
| **Contratação Direta legada** (`/direct-contracts`) | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | n/a | ✅ | **legado** | TENANT-006 (analytics global) |
| **Parecer legado** (`/parecer-juridico`) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | **legado (corrigido)** | PR #183 |
| **Contratos legado** (`/contracts`) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | n/a | ✅ | **legado (corrigido)** | PR #182 |
| **Admin / Plataformas** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | n/a | ⚠️ | **pronto com ressalvas** | RBAC binário admin/user |
| **Deploy / Estabilidade** | ❌ | ✅ | ✅ | ❌ | ❌ | ⚠️ | n/a | ✅ | **quebrado (público)** | **AUTH-003** |
| **RAG institucional / Governança IA** | ❌ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | **inacessível/órfão** | TENANT-032, LEGACY-071 |
| **Importação semântica / Copilots / Agentes** | ❌ | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ | **fora do piloto** | camada de sprints 4x-5x sem UI |
| **Billing / Comercial** | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | n/a | ❌ | **fora do piloto** | TEST-053; não é escopo do piloto |

---

## Síntese por grupo

- **Prontos com ressalvas (utilizáveis no piloto):** Centro de Operações, Contratação Direta,
  Parecer, Contratos/Aditivos, Tirar Dúvidas, Document Engine, CATMAT (com revisão humana),
  Admin. As ressalvas são P1/P2 corrigíveis, não bloqueiam uso supervisionado.

- **Parciais com bloqueador P0 (exigem Bloco A):** Processos, Gestão/Tarefas, Colaboração —
  IDOR real. **Devem ser corrigidos ou ocultados antes do piloto.**

- **Inacessíveis / órfãos:** módulo Licitação canônico (pronto mas sem rota — LEGACY-010),
  RAG institucional, pipeline de importação semântica. Decisão de fluxo no Bloco B.

- **Quebrado por exposição:** Deploy/Estabilidade (públicos — AUTH-003). Corrigir no Bloco A.

- **Fora do piloto (ocultar):** Copilots, Agentes, Governança IA, Billing/Comercial — não
  fazem parte do escopo do piloto do Departamento de Licitações.

**Módulos que podem ser ocultados/desabilitados no piloto sem prejuízo:** RAG institucional,
Copilots, Agentes, Governança IA, Billing/Comercial, Deploy/Estabilidade (ou proteger),
Importação semântica avançada, rotas legadas duplicadas.
