"""Decide se um conjunto de caminhos staged exige regenerar o Graphify — LiciGov Pro.

Usado pelo `.githooks/pre-commit` via `tools/graphify/run.sh --python`, ou seja, no venv com a
versão fixada do graphify. Lê caminhos (um por linha) da entrada padrão.

Reaproveita a classificação da PRÓPRIA ferramenta (`graphify.detect`), em vez de manter uma lista
paralela de extensões:

- insumo do gerador: `tools/graphify/**` e `.githooks/pre-commit` (mudam como o grafo é gerado);
- insumo do corpus: arquivo que o scanner do graphify extrai em modo determinístico (sem LLM):
  código e documentos. Ficam de fora:
    * `graphify-out/` e diretórios/arquivos que o próprio graphify ignora (ex.: `pnpm-lock.yaml`);
    * imagem, PDF e vídeo (só têm extração semântica por LLM, que este fluxo não usa);
    * `.sql`, enquanto `tree_sitter_sql` não estiver instalado (sem parser, não gera nós).

Saída: códigos de retorno 0 = regenerar (imprime o motivo), 1 = nada relevante. Qualquer erro
inesperado sai com código 2, e o hook trata isso como "regenerar" (fail-closed).
"""

import importlib.util
import json
import sys
from pathlib import Path

from graphify.detect import _SKIP_FILES, FileType, _is_noise_dir, classify_file

GENERATOR_PREFIXES = ("tools/graphify/",)
GENERATOR_FILES = {".githooks/pre-commit"}
AST_TYPES = {FileType.CODE, FileType.DOCUMENT}
SQL_PARSER_AVAILABLE = importlib.util.find_spec("tree_sitter_sql") is not None


def reason_for(path: str) -> str | None:
    if path.startswith("graphify-out/"):
        return None
    if path in GENERATOR_FILES or path.startswith(GENERATOR_PREFIXES):
        return "tooling do Graphify alterado"
    p = Path(path)
    if p.name in _SKIP_FILES or any(_is_noise_dir(part) for part in p.parts[:-1]):
        return None
    if p.suffix.lower() == ".sql" and not SQL_PARSER_AVAILABLE:
        return None
    if classify_file(p) in AST_TYPES:
        return "input do corpus alterado"
    # Sem extensão (ex.: script com shebang) e já removido: o graphify não consegue mais ler o
    # arquivo para classificá-lo; vale o que o manifest gerado registra.
    if not p.suffix and not p.exists() and path in manifest_paths():
        return "input do corpus alterado"
    return None


def manifest_paths() -> set[str]:
    try:
        return set(json.loads(Path("graphify-out/manifest.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()


def main() -> int:
    hits = [(path, reason_for(path)) for path in (line.strip() for line in sys.stdin) if path]
    hits = [(path, why) for path, why in hits if why]
    for path, why in hits[:5]:
        print(f"{why}: {path}")
    if len(hits) > 5:
        print(f"(+{len(hits) - 5} arquivo(s))")
    return 0 if hits else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # fail-closed: na dúvida, regenerar
        print(f"classificação do corpus falhou ({exc}); regenerando por segurança")
        sys.exit(2)
