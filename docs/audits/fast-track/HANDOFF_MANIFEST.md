# Fast-Track — Handoff Manifest

Registro de integridade dos artefatos de handoff entre ambientes. Branch exclusiva de auditoria
(`audit/fast-track-template-handoff`): **não** é PR, **não** entra na main.

| Campo | Valor |
|---|---|
| MAIN_SHA | `ee70c81eeeba6f54413b625e64ee8c03ae108e55` |
| WAVE_A_SHA (`integration/semantic-fast-wave-a`) | `dda9fea71915a9bfdfbf47c2ac8448c9eef08776` |
| WAVE_B_SHA (`integration/semantic-fast-wave-b`) | `5827b7f4fa6b351d3232eae485a4e190cef5f62c` |
| G0_SHADOW_BASE | `5827b7f4fa6b351d3232eae485a4e190cef5f62c` (árvore sintética main + Wave A + Wave B; não mergeada) |
| Commits críticos de template | 49 (ver `CRITICAL_COMMITS_49.md`) |
| Commits post-G0 | 9 (ver `POST_G0_COMMITS_9.md`) |
| Cadeia de migrations | 0310 → 0311 → 0312 → 0313 → 0314 (Wave A) → 0315 (Wave B) |
| Gerado em (UTC) | 2026-10-06T01:11:27Z |

## SHA-256 dos arquivos de handoff

| Arquivo | SHA-256 |
|---|---|
| `CRITICAL_COMMITS_49.md` | `4304530a7bea97c2270527d8b4d9933adb163333903a5d25de0f59bacf5ce39f` |
| `FAST_WAVES_REPORT.md` | `2175ceb0a16e7c3d6460b0a1b211412d2072aa45de5f0d76348e25679b2dc5e1` |
| `G0_SHADOW_REPORT.md` | `59be4dffba535df783d5b77ccf6e00a43fc8fc4d03ce0f9fff8bbb572e8fd2e4` |
| `POST_G0_COMMITS_9.md` | `700e9abd8b3b7b535ea275e9f41d50a68e85a656ae8de96cb1c5d86790b60ced` |
| `T0_DRAFT_ADR_CANDIDATE.md` | `9d7c85d83c81541fa5319908c9c009770f3cfa5df8bb3fd6b634f4a24c6ef969` |
| `T1_DESIGN_PACKAGE.md` | `ecdedd296f8ef2c82e4130c796fe3fa885c12a8e149f45e79d711b330f563a8a` |

## Notas

- Os seis arquivos foram copiados byte a byte do material produzido na execução do fast-track; nenhum conteúdo técnico foi alterado.
- Os documentos T0 e T1 são **rascunhos** (sem migration, router, frontend ou integração).
- O G0 oficial permanece não executado.
