const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const oniguruma = require("vscode-oniguruma");
const textmate = require("vscode-textmate");

let grammarPromise;
function loadGrammar() {
  if (!grammarPromise) grammarPromise = (async () => {
    const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (source) => new oniguruma.OnigString(source),
      }),
      loadGrammar: async (name) => name === "source.moth"
        ? JSON.parse(fs.readFileSync(path.join(__dirname, "../syntaxes/moth.tmLanguage.json"), "utf8"))
        : null,
    });
    return registry.loadGrammar("source.moth");
  })();
  return grammarPromise;
}
function tokensFor(grammar, source) {
  return grammar.tokenizeLine(source, textmate.INITIAL).tokens.map((token) => ({
    text: source.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
}
function checkScope(tokens, text, scope) {
  assert.ok(tokens.some((token) => token.text === text && token.scopes.includes(scope)),
    `Expected ${JSON.stringify(text)} to have ${scope}; got ${JSON.stringify(tokens)}`);
}
test("source directive and exact-width type tokenize with modern scopes", async () => {
  const grammar = await loadGrammar();
  checkScope(tokensFor(grammar, "$export"), "$export", "keyword.control.directive.source.moth");
  checkScope(tokensFor(grammar, "value I32 = 1"), "I32", "support.type.primitive.moth");
  checkScope(tokensFor(grammar, "value Dec256 = 1"), "Dec256", "support.type.primitive.moth");
  checkScope(tokensFor(grammar, "value Wire of String"), "Wire", "support.type.builtin.moth");
});
test("future channels and Never/error-return spellings tokenize distinctly", async () => {
  const grammar = await loadGrammar();
  checkScope(tokensFor(grammar, "source << sink"), "<<", "keyword.operator.channel.future.moth");
  checkScope(tokensFor(grammar, "source >> sink"), ">>", "keyword.operator.channel.future.moth");
  checkScope(tokensFor(grammar, "fatal || -> !:"), "!", "storage.type.never.moth");
  checkScope(tokensFor(grammar, "return! Error"), "return!", "keyword.control.flow.error-return.moth");
  checkScope(tokensFor(grammar, "value = cast! other"), "cast!", "keyword.control.conversion.fallible.moth");
});
test("removed keywords remain ordinary identifiers", async () => {
  const grammar = await loadGrammar();
  checkScope(tokensFor(grammar, "export = 1"), "export", "variable.other.moth");
  checkScope(tokensFor(grammar, "block = 1"), "block", "variable.other.moth");
});
