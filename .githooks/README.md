# Git hooks — LiciGov Pro

Hooks versionados, ativados via `core.hooksPath = .githooks` (configurado
automaticamente pelo script `prepare` do `package.json`, ao rodar `pnpm install`).

## pre-commit

Mantém o **grafo de conhecimento Graphify** sincronizado com o código:

- Dispara apenas quando o commit toca `server/` ou `client/`.
- Roda `graphify update .` (100% local, sem LLM, custo de tokens zero).
- Re-inclui no commit os artefatos versionados do grafo
  (`graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`).
- **Não bloqueia** o commit se o Graphify não estiver instalado — apenas avisa.
- Ignorado durante merge/rebase/cherry-pick.

### Instalar o Graphify (opcional, recomendado)

```bash
pip install graphifyy --break-system-packages
```

### Ativar manualmente (se necessário)

```bash
git config core.hooksPath .githooks
```
