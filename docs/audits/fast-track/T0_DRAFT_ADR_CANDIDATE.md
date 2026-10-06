# T0 DRAFT — ADR candidata: Modelos Documentais Institucionais (DRAFT, não aprovado)

Status: **DRAFT para decisão humana**. Nada aqui é migration, router, frontend ou integração. Base: G0 SHADOW (`5827b7f`).

## Decisão proposta
1. **AST estruturado canônico** (`STRUCTURED_AST`); Markdown/DOCX são formatos de import/export/revisão.
2. **Organização-only (V1)**: `organization_id` obrigatório; sem `PLATFORM_GLOBAL`.
3. **Ciclo**: DRAFT → APPROVED → PUBLISHED; `APPROVED ≠ PUBLISHED`; revisão publicada imutável; revisão usada nunca é apagada. Aprovação/publicação registradas em `institutional_decisions`.
4. **Binding determinístico** (sem seleção por IA, sem avaliação condicional por IA); IA somente em slots narrativos explícitos.
5. **Composição na geração** (composer puro, sem I/O); export nunca recompõe; conteúdo persistido + manifest = autoridade de replay.
6. **Manifest** imutável (insert-only): revisão/hash exatos, referências de fonte exatas (`srcd:`), referências de narrativa IA, referências de anexos, referências a documentos oficiais pinadas.
7. **Edição humana governada** (marcador SEM-044) sobre o conteúdo composto; **revalidação canônica antes da emissão**; `SOURCE_CHANGED` nunca auto-muta; documento emitido imutável.
8. **Flag OFF/NOT_BOUND** ⇒ caminho legado governado; **flag ON + resolvido + erro de composição ⇒ FAIL CLOSED**; sem rollout percentual.
9. **Segurança do AST**: whitelist de nós; proibido eval/JS/SQL/fetch/fs/código custom. Import → AST candidato → validação → DRAFT (nunca direto a PUBLISHED).
10. **Catálogo de variáveis versionado**; variável desconhecida bloqueia o submit.
11. **HD-26**: relacionamentos cross-tenant impossíveis — FK composta nas tabelas novas + validação de fallback para tabelas existentes (ver G0 §6).
12. **Fora de escopo**: orquestração/publicação (LICIGOV, PNCP, BLL, Diário, Portal) — sem PublicationProfile/PNCPPublication/status/retry; cláusulas de publicidade do Edital são conteúdo.

## Consequências / deltas
`replay_hash` v2; primeira FK composta; `subject_type` de decisão; naming `institutional_template_*`; contenção do `/templates` legado; sem segundo Document Engine.

## Decisões humanas pendentes
HD-26 (estrutural vs fallback; `UNIQUE(tenant_id,id)` em `official_documents`), política de autoridade de aprovação, destino do legado, revisão jurídica do Modelo-Mestre.
