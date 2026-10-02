# Bloqueios do lote autônomo — registro classificado

> Branch `work/autonomous-semantic-remediation-r3-r11` · 2026-10-02. Protocolo: cada bloqueio isola só os nós
> dependentes; o restante do trabalho técnico seguiu. Nenhuma parada global ocorreu (nenhum REPO_INTEGRITY_FAILURE,
> SECRET_EXPOSURE, MIGRATION_CHAIN_CORRUPTION, UNRESOLVABLE_SCHEMA_COLLISION, TEST_ENVIRONMENT_CORRUPTION,
> UNEXPECTED_PRODUCTION_MUTATION nem BASELINE_FILE_CHANGED_UNINTENTIONALLY).

| ID | Classe | Bloqueia | Pergunta / condição de desbloqueio | Pacote |
|---|---|---|---|---|
| B-01 | BLOCKED_PR_REQUIRED | todas as PRs (R2.5, R2.6, R3.4, R4.4, R4.5, R5.2–R5.5, R6.3, R6.5, R7.1, R7.3, R7.4, R8.1, R11.8) | abrir as PRs conforme o fatiamento (não autorizado neste lote) | HD-12 |
| B-02 | BLOCKED_MERGE_REQUIRED | checkpoints "… merged" | merge após revisão humana, na ordem das migrations | HD-12 |
| B-03 | BLOCKED_PRODUCTION_VALIDATION | R1.10, R2.7, R3.6, R4.7, R5.7, R6.6, R7.6, R8.6 | deploy autorizado + verificação read-only de comportamento | — |
| B-04 | BLOCKED_PRODUCTION_ACCESS | R2.2 (estado da flag), R2.3 (uso legado), R6.1 (inventário) | mecanismo read-only legítimo e autorização | HD-02, HD-04, HD-05 |
| B-05 | BLOCKED_HUMAN_DECISION | R6.2 / merge da PR-13 | tratamento dos processos legados sem Itens | HD-01 |
| B-06 | BLOCKED_HUMAN_DECISION | R7.2 | backfill de snapshot das versões já emitidas | HD-03 |
| B-07 | BLOCKED_LEGAL_REVIEW | R4.2 (competência da ratificação) | parecer J-1 | LEGAL J-1 |
| B-08 | BLOCKED_LEGAL_REVIEW | R8.2, R8.4 (PR-19) | parecer J-2 (catálogo arts. 74/75) | LEGAL J-2 |
| B-09 | BLOCKED_LEGAL_REVIEW | R8.3, R8.5 (PR-20), SEM-084 | pareceres J-3/J-4 (art. 125) | LEGAL J-3, J-4 |
| B-10 | BLOCKED_HUMAN_DECISION | R9.1 → R9.2–R9.10 | aprovação do plano dos 54 P1 | HD-10 |
| B-11 | BLOCKED_HUMAN_DECISION | R10.2, R10.4 | aprovação do plano dos 12 P2 / LEG-007 | HD-11 |
| B-12 | BLOCKED_HUMAN_DECISION | Pilot Reset real (2026/253) | merge+deploy da 0313, preview read-only, decisão da ação | HD-06 |
| B-13 | BLOCKED_HUMAN_DECISION | regularização de ratificações legadas e checklists `s3://anexo` | HD-07, HD-08 | HD-07, HD-08 |
| B-14 | BLOCKED_HUMAN_DECISION | NEW-028 (status após "não ratificado") | HD-09 | HD-09 |

## EXPECTED_SKIP × UNEXECUTED_REQUIRED_TEST

- **EXPECTED_SKIP**: a suíte sem DB pula os arquivos `*-mysql-smoke` (`describe.skipIf(!DATABASE_URL)`); eles rodam no
  gate MySQL. Os testes "degrada sem DB" de `sprint5w/5y/5z` só são válidos sem `DATABASE_URL` (rodam na suíte sem DB).
- **UNEXECUTED_REQUIRED_TEST**: verificação comportamental em **produção** de cada fase (B-03) — não executável por
  autorização. Nenhum teste local obrigatório ficou sem executar (ver números no relatório de execução).
