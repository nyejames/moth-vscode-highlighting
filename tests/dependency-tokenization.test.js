const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const oniguruma = require("vscode-oniguruma");
const textmate = require("vscode-textmate");

const rootDir = path.resolve(__dirname, "..");
const grammarPaths = new Map([
  ["source.moth", path.join(rootDir, "syntaxes", "moth.tmLanguage.json")],
  ["source.mtf", path.join(rootDir, "syntaxes", "mtf.tmLanguage.json")],
  [
    "source.moth.dependency-clauses",
    path.join(rootDir, "syntaxes", "moth-dependency-clauses.tmLanguage.json"),
  ],
]);

let registryPromise;

function loadRegistry() {
  if (registryPromise) return registryPromise;

  registryPromise = (async () => {
    const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (source) => new oniguruma.OnigString(source),
      }),
      getInjections: (scopeName) =>
        ["source.moth", "source.mtf"].includes(scopeName)
          ? ["source.moth.dependency-clauses"]
          : undefined,
      loadGrammar: async (scopeName) => {
        const grammarPath = grammarPaths.get(scopeName);
        if (!grammarPath) return null;
        return JSON.parse(fs.readFileSync(grammarPath, "utf8"));
      },
    });

    return registry;
  })();

  return registryPromise;
}

async function loadGrammar(scopeName = "source.moth") {
  const registry = await loadRegistry();
  return registry.loadGrammar(scopeName);
}

function tokenizeLines(grammar, lines) {
  let ruleStack = textmate.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    return result.tokens;
  });
}

function tokenScopes(tokens, line, text) {
  const token = tokens.find(({ startIndex, endIndex }) => line.slice(startIndex, endIndex).trim() === text);
  assert.ok(token, `expected token '${text}' in ${JSON.stringify(tokens)}`);
  return token.scopes;
}

test("top-level dependency clauses distinguish namespace and selected aliases", async () => {
  const grammar = await loadGrammar();
  const namespaceLine = "@core/math as maths";
  const [tokens] = tokenizeLines(grammar, [namespaceLine]);

  assert.ok(tokenScopes(tokens, namespaceLine, "as").includes("keyword.other.alias.namespace.moth"));
  assert.ok(tokenScopes(tokens, namespaceLine, "maths").includes("entity.name.namespace.alias.moth"));

  const selectionLine = "@core/math sin as sine, PI as pi";
  const [selectionTokens] = tokenizeLines(grammar, [selectionLine]);
  assert.ok(tokenScopes(selectionTokens, selectionLine, "sin").includes("entity.name.dependency.selection.moth"));
  assert.ok(
    tokenScopes(selectionTokens, selectionLine, "sine").includes("entity.name.dependency.selection.alias.moth")
  );
});

test("comma continuation ends before blank and ordinary lines", async () => {
  const grammar = await loadGrammar();
  const lines = ["@core/math sin,", "    cos as cosine"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(tokenLines[0].some((token) => token.scopes.includes("meta.dependency.clause.moth")));
  assert.ok(
    tokenScopes(tokenLines[1], lines[1], "cos").includes("entity.name.dependency.selection.moth")
  );
  assert.ok(
    tokenScopes(tokenLines[1], lines[1], "cosine").includes(
      "entity.name.dependency.selection.alias.moth"
    )
  );

  const terminatedLines = ["@core/math sin,", "", "value = 1"];
  const terminatedTokenLines = tokenizeLines(grammar, terminatedLines);
  assert.ok(
    terminatedTokenLines[2].every((token) => !token.scopes.includes("meta.dependency.clause.moth")),
    "ordinary code after a blank line must not remain inside the dependency clause"
  );
});

test("removed delimiters do not assign dependency selection scopes", async () => {
  const grammar = await loadGrammar();

  for (const line of [
    "@core/math {sin, cos}",
    "@core/math (sin, cos)",
    "@core/math |sin, cos|",
    "@core/math: sin, cos",
  ]) {
    const [tokens] = tokenizeLines(grammar, [line]);
    assert.ok(
      tokens.every((token) => !token.scopes.includes("entity.name.dependency.selection.moth")),
      `${JSON.stringify(line)} must not highlight valid selections`
    );
  }
});

test("embedded Moth code receives dependency clause scopes", async () => {
  const grammar = await loadGrammar();
  const lines = ["[$code(\"moth\"):", "    @core/math sin,", "        cos as cosine", "]"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(
    tokenScopes(tokenLines[2], lines[2], "cosine").includes(
      "entity.name.dependency.selection.alias.moth"
    )
  );
});

test("MTF injects dependency scopes only inside embedded Moth code", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = [
    "@core/math sin,",
    "",
    "[codeblock, $code(\"moth\"):",
    "    @core/math sin,",
    "        cos as cosine",
    "]",
  ];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(
    tokenLines[0].every((token) => !token.scopes.includes("meta.dependency.clause.moth")),
    "top-level MTF Markdown must not receive dependency scopes"
  );
  assert.ok(
    tokenScopes(tokenLines[4], lines[4], "cosine").includes(
      "entity.name.dependency.selection.alias.moth"
    )
  );
});
