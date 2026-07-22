# Mapa da Jornada Institucional
### LiciGov Pro · Servidor da Prefeitura de Moreira Sales · 2026-07-22

Fluxo ponta a ponta de um servidor do Departamento de Licitações. Cada etapa registra: UI
acessível, backend funcional, persistência real, tenant-safe, auditável, testável hoje.

Legenda: ✅ sim · ⚠️ parcial/com ressalva · ❌ não · n/a não aplicável.

| # | Etapa | UI acessível | Backend funcional | Persistência real | Tenant-safe | Auditável | Testável hoje | Observação |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Login | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | JWT cookie httpOnly; sessão de 1 ano (SEC-022); registro público aberto (SEC-017) |
| 2 | Resolução da organização | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | Single-org auto-resolve; sem seletor (NAV-023); fallback org 1 é porta de entrada indevida |
| 3 | Centro de Operações | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Home canônica, dados reais; não vê processos legados (LEGACY-011) |
| 4 | Criar processo/demanda | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | `/novo-processo`; **IDOR** no `processesRouter` (TENANT-001); sem número automático (DATA-013) |
| 5 | Elaborar DFD | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | Gerado por IA na criação + aba DFD; via legado `documentsRouter` + Gemini direto (ARCH-025) |
| 6 | Elaborar ETP | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | Aba ETP; `documents.generateDocument` com RAG Lei 14.133 |
| 7 | Elaborar TR | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | Aba TR; mesma via; Edital idem |
| 8 | Importar itens | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ⚠️ | **Só Excel** via TRItemsModal; Word/PDF e pipeline semântico órfãos (LEGACY-074) |
| 9 | CATMAT/CATSER | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | Busca na API real; `catmatRouter` público (TENANT-038); sugestão IA pode alucinar código (DOC-016) |
| 10 | Revisão / colaboração | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | Comentários existem; `comments.list`/activities por id global (parte de TENANT-002) |
| 11 | Versionamento | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | Histórico + restore; incremento `version+1` sem transação (DATA-039) |
| 12 | Aprovação | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ | `approvalWorkflow` existe; `humanApprovalService` em memória, aprovador forjável (AUDIT-020) |
| 13 | Exportação (DOCX/PDF) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Real (pdfkit+docx) no processo e em Contratos; UIs de Parecer/Contratação Direta sem botão download (DOC-016/DOC-2) |
| 14 | Parecer jurídico | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Fluxo canônico completo em `/parecer` (receber→minutar→assinar→devolver); legado corrigido (PR #183) |
| 15 | Contratação direta | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Wizard completo `/contratacao-direta`, tenant-safe; IA pode cair em mock silencioso (AI-015) |
| 16 | Contrato | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `/contratos`: criação a partir de licitação/direta/manual; download via OfficialDocumentPanel |
| 17 | Aditivo / apostilamento | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `createAddendum`/`createApostille` (tenant); sequence `count+1` sem lock (DATA-039) |
| 18 | Central de controle | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | Funciona com dados canônicos; **não enxerga processos do fluxo legado** (LEGACY-011) |
| 19 | Acompanhamento / auditoria | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | `activity_logs` com ator+org+entidade+IP; sem before/after; `/auditoria` só por URL (NAV-081) |
| 20 | Tirar Dúvidas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Corpus real (Lei 14.133 + 8.666 + Lei Municipal 769), citações, replay; degrada p/ mock sem API key (AI-015) |

---

## Leitura da jornada

- **Cauda forte (etapas 14-17, 20):** contratação direta, parecer, contratos/aditivos e tirar
  dúvidas estão **canônicos, tenant-safe e prontos**. Um servidor consegue usar esses módulos hoje.
- **Núcleo frágil (etapas 4-12):** o coração do MVP — criar processo, DFD/ETP/TR, importar,
  revisar, aprovar — funciona pela UI mas roda no **caminho legado user-scoped com IDOR**
  (TENANT-001/002) e com o módulo canônico equivalente **pronto porém desconectado** (LEGACY-010).
- **Desconexão de dados (etapas 3, 18):** a Central de Operações lê tabelas canônicas; os
  processos que o usuário cria pela única UI disponível (legada) **não aparecem** nos indicadores.

**Conclusão da jornada:** o piloto é viável **se** o Bloco A (segurança do núcleo) e a decisão
de fluxo do Bloco B (unificar Processos/DFD/ETP/TR) forem resolvidos antes do go-live. A cauda
de módulos de Fase 5 já sustenta demonstração e uso real.
