# Toolchain reproduzível do Graphify — LiciGov Pro

Este diretório fixa, de forma **versionada e determinística**, a ferramenta que mantém o
grafo de conhecimento do repositório em [`graphify-out/`](../../graphify-out).

> **Regra Graphify-first:** consultar sempre `graphify-out/` antes de navegar o código;
> confirmar cada descoberta no código (o código é a verdade operacional); atualizar o grafo
> **somente após** as mudanças implementadas e validadas.

## Versão fixada

| Item | Valor |
|---|---|
| Pacote | `graphifyy` (PyPI) |
| Versão exata | **`0.9.32`** |
| Origem | PyPI — https://pypi.org/project/graphifyy/ — release estável mais recente (canal público, sem pré-release) em 2026-08-04 |
| CLI | `graphify` |
| Namespace/projeto | **raiz do repositório** (`graphify-out/.graphify_root = .`, projeto `licigov-pro`) — namespace único, não criar concorrente |

O pin está em [`requirements.txt`](./requirements.txt). **Nunca** instalar `graphifyy`
globalmente — sempre em ambiente Python isolado.

## Wrapper reproduzível (forma canônica)

Use SEMPRE o wrapper [`run.sh`](./run.sh): ele garante a versão exata fixada num venv isolado
(`.venv-graphify/`, gitignored) e executa a CLI. **Nunca** depende de instalação global.

```bash
# a partir da raiz do repositório — cria/atualiza o venv sob demanda e roda o comando
tools/graphify/run.sh update .          # atualiza o grafo (100% local, sem LLM)
tools/graphify/run.sh --version         # → graphify 0.9.32
```

Variável opcional `GRAPHIFY_VENV` aponta o venv para outro caminho (ex.: fora da árvore).

### Instalação manual equivalente (se preferir sem o wrapper)

```bash
python3 -m venv .venv-graphify
./.venv-graphify/bin/python -m pip install --upgrade pip
./.venv-graphify/bin/python -m pip install -r tools/graphify/requirements.txt
```

## Integração com o git hook

O `.githooks/pre-commit` chama **`tools/graphify/run.sh update .`** quando o commit toca
`server/` ou `client/`, re-incluindo os 4 artefatos versionados. Diferente da versão antiga,
**não há skip silencioso**: se a toolchain não puder rodar (sem `python3`/rede na 1ª instalação),
o hook **falha** com mensagem acionável em vez de deixar o grafo desatualizado.

- Extrai a AST de `server/`, `client/`, `shared/`, `docs/` etc. e reescreve
  `graphify-out/{graph.json,GRAPH_REPORT.md,manifest.json,.graphify_labels.json}`.
- A nomeação de comunidades por LLM (`graphify label`) é **opcional** e **não** é usada no fluxo
  determinístico: sem chave de API, o `update` nomeia comunidades pelo hub.

## Freshness, determinismo e tamanho do diff (rebaseline de 2026-10-01)

Comportamentos verificados com experimentos em worktrees descartáveis:

- **`built_at_commit` registra o commit PAI.** O hook roda *antes* de o commit existir, então o grafo
  incluído no commit `X` reflete o código de `X` (staged), mas grava `built_at_commit = X^`. Por isso
  "`built_at_commit` ≠ `HEAD`" **não** significa grafo desatualizado. Critério correto de freshness:
  nenhum arquivo de código mudou depois do último commit que tocou `graphify-out/graph.json`
  (`git log -1 --format=%H -- graphify-out/graph.json` e então `git diff --name-only <esse>..HEAD`).
- **Determinismo.** O wrapper fixa `PYTHONHASHSEED=0`. Sem isso, a extração (nós/arestas) já era
  determinística, mas o agrupamento em comunidades variava entre execuções sobre o mesmo código.
  Com a semente fixa, duas gerações do zero em diretórios independentes produzem `graph.json`,
  `GRAPH_REPORT.md` e `.graphify_labels.json` idênticos byte a byte. Um `update` sem mudança de
  topologia não reescreve nada.
- **O que ainda varia por máquina/checkout:**
  - `manifest.json` guarda o `mtime` de cada arquivo. Num checkout novo, todas as entradas mudam na
    próxima regeneração; num checkout já usado, só as dos arquivos alterados.
  - O título do `GRAPH_REPORT.md` usa o **nome da pasta** do repositório. Gere o grafo num diretório
    chamado `licigov-pro`.
- **Tamanho do diff.** Toda mudança de topologia (mesmo +1 nó) reexecuta o clustering global e
  reatribui milhares de nós a comunidades. O diff de `graph.json` costuma ficar na casa de dezenas de
  milhares de linhas mesmo para mudanças pequenas. Não é sinal de drift; é o comportamento da ferramenta.

## Notas de compatibilidade (validação 0.9.32 × grafo canônico)

Validação executada em **cópia isolada** do repositório (o `graphify-out/` canônico **não** foi
sobrescrito), comparando a build 0.9.32 no HEAD contra o grafo canônico:

| Dimensão | Canônico (`0fd50990`) | Build 0.9.32 (HEAD) | Veredito |
|---|---|---|---|
| Schema top-level | `built_at_commit, directed, graph, hyperedges, links, multigraph, nodes` | idêntico¹ | ✅ compatível |
| Schema de nó | 10 chaves (`id,label,source_file,…`) | **idêntico** | ✅ |
| Schema de aresta | 9 chaves (`source,target,relation,…`) | **idêntico** | ✅ |
| `directed` / `multigraph` | `false` / `false` | `false` / `false` | ✅ |
| Cobertura `server/` | 809 arquivos | 809 (0 a mais/menos) | ✅ |
| Cobertura `client/` | 572 arquivos | 572 (0 a mais/menos) | ✅ |
| Cobertura `shared/`,`drizzle/`,`docs/` | 4 / 2 / 200 | 4 / 2 / 200 | ✅ |
| Arquivos `.sql` no grafo | 0 | 0 | ✅ consistente² |
| Nós | 14 509 | 14 580 (**+71**) | ✅ explicado³ |
| Arestas | 29 040 | 29 347 (**+307**) | ✅ explicado³ |

¹ Na cópia de validação (sem `.git`) o campo `built_at_commit` fica ausente; no repositório real
  (com `.git`) o `graphify update .` o preenche com o `HEAD` no momento da execução — no pre-commit,
  é o commit pai (ver "Freshness, determinismo e tamanho do diff").

² `tree_sitter_sql` **não** é instalado (nem era no canônico): os 288 arquivos `.sql` de
  `drizzle/` nunca contribuíram nós. **Não** adicionar o extra `graphifyy[sql]` — introduziria
  divergência estrutural frente ao grafo canônico.

³ Divergência **aditiva e benigna**: a 0.9.32 captura símbolos mais granulares em arquivos de
  código **inalterados** (nenhum arquivo de código mudou entre `0fd50990` e o HEAD). Ex.:
  `server/domain/authErrors.ts` passou de 3 → 21 nós (cada código de erro — `INVITATION_EXPIRED`,
  `RATE_LIMITED`, `TENANT_ACCESS_FORBIDDEN`… — agora é um nó); `shared/const.ts` 1 → 6
  (`COOKIE_NAME`, `ONE_YEAR_MS`…). **Zero nós perdidos**, schema estável, cobertura estável.
  O re-baseline de +71/+307 é assumido na primeira atualização canônica do grafo.
