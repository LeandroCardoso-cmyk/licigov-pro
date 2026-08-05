import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // NB: `drizzle/**` NÃO fica em `ignores` global. Sob o gate de não-regressão
      // (`eslint $CHANGED --max-warnings 0`), um arquivo globalmente ignorado mas passado
      // explicitamente (ex.: drizzle/schema.ts alterado numa migration) emite o warning
      // "File ignored…", que derruba o gate. Em vez disso, drizzle/** é lintado por uma
      // config dedicada com regras desligadas (abaixo) — 0 problemas, sem warning.
      "*.config.{js,mjs,cjs}",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Proibir uso de `any` explícito
      "@typescript-eslint/no-explicit-any": "warn",

      // Proibir variáveis não utilizadas (exceto prefixadas com _)
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],

      // Proibir console.log em produção (warn para não quebrar dev)
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],

      // Evitar == em favor de ===
      "eqeqeq": ["error", "always", { null: "ignore" }],

      // Sem return implícito de undefined em funções async
      "@typescript-eslint/no-floating-promises": "off",

      // Proibir throw de não-Error
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    // Schema/relations do Drizzle são fonte de tipos (grande, parcialmente gerada). Não
    // aplicamos as regras de estilo aqui; a config existe só para o arquivo NÃO ser tratado
    // como "globalmente ignorado" quando passado explicitamente ao eslint (gate de não-regressão).
    files: ["drizzle/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      "eqeqeq": "off",
    },
  },
];
