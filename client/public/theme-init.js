/*
 * LiciGov Pro — inicialização de tema (claro/escuro) ANTES do React montar (sem flash / FOUC).
 *
 * SEC-036 — Este script foi EXTERNALIZADO do index.html para não depender de `script-src
 * 'unsafe-inline'`. Servido a partir da própria origem (`'self'`), continua sendo um script
 * bloqueante no <head>, então executa antes do primeiro paint e evita o flash de tema.
 *
 * Deve espelhar a lógica de client/src/contexts/ThemeContext.tsx (chave "theme").
 */
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var pref = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
    var root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  } catch (e) {
    /* localStorage indisponível — usa o tema padrão do CSS */
  }
})();
