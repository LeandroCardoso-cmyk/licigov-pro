# Triagem de Auditoria de Dependências (PR D)

> Recorte de PRODUÇÃO (`pnpm audit --prod`). 3 críticas + 45 altas (advisories) PRÉ-EXISTENTES em dependências transitivas. Correção = upgrades controlados (OPERATOR_ACTION_REQUIRED, fora do escopo do PR D). Baseline em [`security/audit-baseline.json`](../../security/audit-baseline.json); o gate bloqueia NOVAS.

| Módulo | Severidade | Advisories | GHSA | Recomendação |
|---|---|---:|---|---|
| `jspdf` | CRITICAL | 8 | GHSA-f8cm-6447-x5h2, GHSA-pqxr-3g65-p328, GHSA-95fx-jjr5-f39c … | Upgrade to version 4.0.0 or later |
| `fast-xml-parser` | CRITICAL | 4 | GHSA-37qj-frw5-hhjh, GHSA-m7jm-9gc2-mpf2, GHSA-jmr7-xgp7-cmfj … | Upgrade to version 5.3.4 or later |
| `axios` | HIGH | 11 | GHSA-pmwg-cvhr-8vh7, GHSA-pf86-5x62-jrwf, GHSA-6chq-wfr3-2hj9 … | Upgrade to version 1.15.1 or later |
| `minimatch` | HIGH | 9 | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 | Upgrade to version 3.1.3 or later |
| `brace-expansion` | HIGH | 3 | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg | Upgrade to version 2.1.2 or later |
| `xlsx` | HIGH | 2 | GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9 | None |
| `linkify-it` | HIGH | 2 | GHSA-22p9-wv53-3rq4, GHSA-v245-v573-v5vm | Upgrade to version 5.0.1 or later |
| `glob` | HIGH | 1 | GHSA-5j98-mcp5-4vw2 | Upgrade to version 10.5.0 or later |
| `@trpc/server` | HIGH | 1 | GHSA-43p4-m455-4f4j | Upgrade to version 11.8.0 or later |
| `path-to-regexp` | HIGH | 1 | GHSA-37ch-88jc-xwx2 | Upgrade to version 0.1.13 or later |
| `lodash-es` | HIGH | 1 | GHSA-r5fr-rjxr-66jc | Upgrade to version 4.18.0 or later |
| `lodash` | HIGH | 1 | GHSA-r5fr-rjxr-66jc | Upgrade to version 4.18.0 or later |
| `drizzle-orm` | HIGH | 1 | GHSA-gpj5-g38j-94v9 | Upgrade to version 0.45.2 or later |
| `tmp` | HIGH | 1 | GHSA-ph9p-34f9-6g65 | Upgrade to version 0.2.6 or later |
| `form-data` | HIGH | 1 | GHSA-hmw2-7cc7-3qxx | Upgrade to version 4.0.6 or later |
| `ws` | HIGH | 1 | GHSA-96hv-2xvq-fx4p | Upgrade to version 8.21.0 or later |
