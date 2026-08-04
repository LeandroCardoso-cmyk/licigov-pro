# Git hooks — LiciGov Pro

Hooks versionados, ativados via `core.hooksPath = .githooks` (configurado
automaticamente pelo script `prepare` do `package.json`, ao rodar `pnpm install`).

## pre-commit

Mantém o **grafo de conhecimento Graphify** sincronizado com o código:

- Dispara apenas quando o commit toca `server/` ou `client/`.
- Roda `tools/graphify/run.sh update .` — o **wrapper reproduzível** que fixa a versão exata
  do `graphifyy` num venv isolado (100% local, sem LLM, sem instalação global).
- Re-inclui no commit os artefatos versionados do grafo
  (`graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`).
- **NÃO faz skip silencioso**: se a toolchain não puder rodar quando `server/`/`client/` mudam,
  o hook **falha** com mensagem acionável (a 1ª execução requer `python3` + rede).
- Ignorado durante merge/rebase/cherry-pick.

### Toolchain do Graphify

Versão fixada e wrapper em [`tools/graphify/`](../tools/graphify/) (ver `README.md` de lá).
O venv isolado (`.venv-graphify/`) é criado sob demanda pelo wrapper e é gitignored.

### Ativar manualmente (se necessário)

```bash
git config core.hooksPath .githooks
```
