import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "drizzle/**",
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
];
