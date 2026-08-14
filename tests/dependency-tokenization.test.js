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
]);

let registryPromise;

function loadRegistry() {
  if (registryPromise) return registryPromise;

  registryPromise = (async () => {
    const wasm = fs.readFileSync(
      require.resolve("vscode-oniguruma/release/onig.wasm")
    );
    await oniguruma.loadWASM(
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
    );

    const registry = new textmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (source) => new oniguruma.OnigString(source),
      }),
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

function findToken(tokens, line, text) {
  const token = tokens.find(
    ({ startIndex, endIndex }) =>
      line.slice(startIndex, endIndex).trim() === text
  );
  assert.ok(token, `expected token '${text}' in ${JSON.stringify(tokens.map((t) => line.slice(t.startIndex, t.endIndex)))}`);
  return token;
}

function hasScope(token, scope) {
  return token.scopes.includes(scope);
}

function anyTokenWithScope(tokens, scope) {
  return tokens.some((t) => t.scopes.includes(scope));
}

function noTokenWithScope(tokens, scope) {
  return tokens.every((t) => !t.scopes.includes(scope));
}

// ── DEPENDENCY CLAUSES ─────────────────────────────────────────────

test("bare namespace receives dependency clause scopes", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokens, line, "core/math"), "entity.name.namespace.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("namespace alias receives distinct namespace and alias scopes", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math as maths";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokens, line, "core/math"), "entity.name.namespace.moth"));
  assert.ok(hasScope(findToken(tokens, line, "as"), "keyword.other.alias.moth"));
  assert.ok(hasScope(findToken(tokens, line, "maths"), "entity.name.namespace.alias.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("same-line direct selections receive selection scopes", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math sin, cos";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokens, line, "cos"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokens, line, ","), "punctuation.separator.comma.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("selected aliases receive distinct selection and alias scopes", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math sin as sine, PI as pi";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokens, line, "sine"), "variable.other.dependency.alias.moth"));
  assert.ok(hasScope(findToken(tokens, line, "PI"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokens, line, "pi"), "variable.other.dependency.alias.moth"));
  const asTokens = tokens.filter((t) => line.slice(t.startIndex, t.endIndex).trim() === "as");
  assert.equal(asTokens.length, 2);
  for (const asToken of asTokens) {
    assert.ok(hasScope(asToken, "keyword.other.alias.moth"));
  }
});

test("provider direct selections with explicit extension", async () => {
  const grammar = await loadGrammar();
  const line = "@drawing.js draw, clear";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "drawing.js"), "entity.name.namespace.moth"));
  assert.ok(hasScope(findToken(tokens, line, "draw"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokens, line, "clear"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("provider namespace alias with explicit extension", async () => {
  const grammar = await loadGrammar();
  const line = "@drawing.js as drawing";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(hasScope(findToken(tokens, line, "drawing.js"), "entity.name.namespace.moth"));
  assert.ok(hasScope(findToken(tokens, line, "as"), "keyword.other.alias.moth"));
  assert.ok(hasScope(findToken(tokens, line, "drawing"), "entity.name.namespace.alias.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("dependency inside a multiline export block", async () => {
  const grammar = await loadGrammar();
  const lines = ["export:", "    @core/math sin, cos", ";"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "cos"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"));
  assert.ok(noTokenWithScope(tokenLines[2], "meta.dependency-clause.moth"));
});

test("dependency directly after export colon", async () => {
  const grammar = await loadGrammar();
  const lines = ["export: @core/math sin, cos", ";"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "export"), "keyword.other.moth"));
  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "cos"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokenLines[0], "meta.dependency-clause.moth"));
  assert.ok(noTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"));
});

test("comma-controlled multiline continuation", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data,", "    row,", "    heading"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "data"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[2], lines[2], "heading"), "variable.other.dependency.selection.moth"));
  for (let i = 0; i < 3; i++) {
    assert.ok(anyTokenWithScope(tokenLines[i], "meta.dependency-clause.moth"), `line ${i} should be in clause`);
  }
});

test("multiple blank lines after a comma", async () => {
  const grammar = await loadGrammar();
  const lines = ["@core/math sin,", "", "", "    cos"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[3], lines[3], "cos"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokenLines[3], "meta.dependency-clause.moth"));
});

test("comment after a continuation comma", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data, -- clause continues", "    row"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "data"), "variable.other.dependency.selection.moth"));
  const commentToken = tokenLines[0].find((t) =>
    lines[0].slice(t.startIndex, t.endIndex).startsWith("--")
  );
  assert.ok(commentToken, "expected comment token");
  assert.ok(hasScope(commentToken, "comment.line.double-dash.moth"));
  assert.ok(anyTokenWithScope(tokenLines[0], "meta.dependency-clause.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"));
});

test("no-comma newline termination", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data", "row = build_row()"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "data"), "variable.other.dependency.selection.moth"));
  assert.ok(anyTokenWithScope(tokenLines[0], "meta.dependency-clause.moth"));
  assert.ok(noTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"), "next line must not be in clause");
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.moth"));
});

test("selected alias on a continuation line", async () => {
  const grammar = await loadGrammar();
  const lines = ["@docs/pages/home render as render_home,", "    content as about_content"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "render"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "render_home"), "variable.other.dependency.alias.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "content"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "about_content"), "variable.other.dependency.alias.moth"));
  for (let i = 0; i < 2; i++) {
    assert.ok(anyTokenWithScope(tokenLines[i], "meta.dependency-clause.moth"));
  }
});

test("no dependency-scope leakage after clause termination", async () => {
  const grammar = await loadGrammar();
  const lines = ["@core/math sin, cos", "value = 1"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(noTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"));
  assert.ok(noTokenWithScope(tokenLines[1], "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "value"), "variable.other.moth"));
});

// ── MALFORMED BOUNDARIES ───────────────────────────────────────────

test("trailing comma at end of file", async () => {
  const grammar = await loadGrammar();
  const lines = ["@core/math sin,"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[0], lines[0], "sin"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[0], lines[0], ","), "punctuation.separator.comma.moth"));
});

test("trailing comma followed by row = ...", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data,", "row = build_row()"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.dependency.selection.moth"));
  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "meta.dependency-clause.moth"));
  const eqToken = tokenLines[1].find((t) => lines[1].slice(t.startIndex, t.endIndex) === "=");
  assert.ok(eqToken, "expected = token");
  assert.ok(!hasScope(eqToken, "meta.dependency-clause.moth"), "= must not be in dependency clause");
  assert.ok(!hasScope(eqToken, "variable.other.dependency.selection.moth"));
});

test("trailing comma followed by row #= ...", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data,", "row #= build_row()"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.dependency.selection.moth"));
  const assignToken = tokenLines[1].find((t) => lines[1].slice(t.startIndex, t.endIndex) === "#=");
  assert.ok(assignToken, "expected #= token");
  assert.ok(!hasScope(assignToken, "meta.dependency-clause.moth"));
});

test("trailing comma followed by row |value Int|:", async () => {
  const grammar = await loadGrammar();
  const lines = ["@html/tables data,", "row |value Int|:"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(hasScope(findToken(tokenLines[1], lines[1], "row"), "variable.other.dependency.selection.moth"));
  const pipeToken = tokenLines[1].find((t) => lines[1].slice(t.startIndex, t.endIndex) === "|");
  assert.ok(pipeToken, "expected | token");
  assert.ok(!hasScope(pipeToken, "meta.dependency-clause.moth"));
});

test("brace-delimited selections are not treated as current selections", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math {sin, cos}";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "variable.other.dependency.selection.moth"), "braces must not produce selection scopes");
  const braceToken = tokens.find((t) => lines_to_text(t, line) === "{");
  if (braceToken) assert.ok(!hasScope(braceToken, "meta.dependency-clause.moth"));
});

function lines_to_text(token, line) {
  return line.slice(token.startIndex, token.endIndex);
}

test("parentheses are not treated as selections", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math (sin, cos)";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "variable.other.dependency.selection.moth"));
});

test("pipes are not treated as selections", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math |sin, cos|";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "variable.other.dependency.selection.moth"));
});

test("colon blocks are not treated as selections", async () => {
  const grammar = await loadGrammar();
  const line = "@core/math: sin, cos";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "variable.other.dependency.selection.moth"));
});

test("old import @... does not give import a keyword scope", async () => {
  const grammar = await loadGrammar();
  const line = "import @core/math {sin, cos}";
  const [tokens] = tokenizeLines(grammar, [line]);

  const importToken = findToken(tokens, line, "import");
  assert.ok(hasScope(importToken, "variable.other.moth"));
  assert.ok(!hasScope(importToken, "keyword.control.import.moth"));
  assert.ok(!hasScope(importToken, "keyword.other.moth"));
});

test("import = 1 receives ordinary identifier scope", async () => {
  const grammar = await loadGrammar();
  const line = "import = 1";
  const [tokens] = tokenizeLines(grammar, [line]);

  const importToken = findToken(tokens, line, "import");
  assert.ok(hasScope(importToken, "variable.other.moth"));
  assert.ok(!hasScope(importToken, "keyword.control.import.moth"));
});

// ── GENERAL PATHS ──────────────────────────────────────────────────

test("RHS asset path receives path scopes not dependency scopes", async () => {
  const grammar = await loadGrammar();
  const line = "logo #= @assets/logo.svg";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "meta.dependency-clause.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.path.moth"));
  assert.ok(hasScope(findToken(tokens, line, "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokens, line, "assets"), "entity.name.namespace.moth"));
});

test("template-head path receives path scopes", async () => {
  const grammar = await loadGrammar();
  const line = "page = [@pages/home.mtf]";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "meta.dependency-clause.moth"));
  assert.ok(anyTokenWithScope(tokens, "meta.path.moth"));
});

test("quoted component with spaces", async () => {
  const grammar = await loadGrammar();
  const line = 'font #= @fonts/"Computer Modern.woff2"';
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(anyTokenWithScope(tokens, "meta.path.moth"));
  assert.ok(noTokenWithScope(tokens, "meta.dependency-clause.moth"));
  const quotedToken = tokens.find((t) =>
    line.slice(t.startIndex, t.endIndex).includes("Computer Modern")
  );
  assert.ok(quotedToken, "expected quoted path component");
  assert.ok(hasScope(quotedToken, "entity.name.namespace.moth"));
});

test("escaped quote and backslash in a quoted component", async () => {
  const grammar = await loadGrammar();
  const line = 'path #= @data/"test\\"file.txt"';
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(anyTokenWithScope(tokens, "meta.path.moth"));
  assert.ok(noTokenWithScope(tokens, "meta.dependency-clause.moth"));
});

test("exact @/ root path", async () => {
  const grammar = await loadGrammar();
  const line = "root = @/";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "meta.dependency-clause.moth"));
  assert.ok(hasScope(findToken(tokens, line, "@"), "punctuation.definition.path.begin.moth"));
  assert.ok(hasScope(findToken(tokens, line, "/"), "punctuation.separator.path.moth"));
});

test("explicit-extension path receives path scopes", async () => {
  const grammar = await loadGrammar();
  const line = "logo #= @assets/logo.svg";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(anyTokenWithScope(tokens, "meta.path.moth"));
  assert.ok(hasScope(findToken(tokens, line, "logo.svg"), "entity.name.namespace.moth"));
});

test("general paths do not receive dependency-selection scopes", async () => {
  const grammar = await loadGrammar();
  const line = "logo #= @assets/logo.svg";
  const [tokens] = tokenizeLines(grammar, [line]);

  assert.ok(noTokenWithScope(tokens, "variable.other.dependency.selection.moth"));
});

// ── MTF AND EMBEDDED MOTH ──────────────────────────────────────────

test("top-level MTF Markdown receives no dependency scopes", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = ["@https://example.com (link)", "", "Some text"];
  const tokenLines = tokenizeLines(grammar, lines);

  for (let i = 0; i < lines.length; i++) {
    assert.ok(
      noTokenWithScope(tokenLines[i], "meta.dependency-clause.moth"),
      `line ${i} must not have dependency scopes`
    );
    assert.ok(
      noTokenWithScope(tokenLines[i], "variable.other.dependency.selection.moth"),
      `line ${i} must not have selection scopes`
    );
  }
});

test("nested Moth templates remain correctly scoped", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = ["[p:", "    Some text", "]"];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(anyTokenWithScope(tokenLines[0], "meta.template.moth"));
});

test("embedded $code('moth') recognises dependency clauses", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = [
    '[codeblock, $code("moth"):',
    "    @core/math sin,",
    "        cos as cosine",
    "]",
  ];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(
    hasScope(findToken(tokenLines[1], lines[1], "sin"), "variable.other.dependency.selection.moth"),
    "embedded sin should have selection scope"
  );
  assert.ok(
    hasScope(findToken(tokenLines[2], lines[2], "cos"), "variable.other.dependency.selection.moth"),
    "embedded cos should have selection scope"
  );
  assert.ok(
    hasScope(findToken(tokenLines[2], lines[2], "cosine"), "variable.other.dependency.alias.moth"),
    "embedded cosine should have alias scope"
  );
  assert.ok(anyTokenWithScope(tokenLines[1], "meta.dependency-clause.moth"));
  assert.ok(anyTokenWithScope(tokenLines[2], "meta.dependency-clause.moth"));
});

test("embedded dependency state ends at the code-template boundary", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = [
    '[codeblock, $code("moth"):',
    "    @core/math sin,",
    "        cos as cosine",
    "]",
    "Some text after",
  ];
  const tokenLines = tokenizeLines(grammar, lines);

  assert.ok(
    noTokenWithScope(tokenLines[4], "meta.dependency-clause.moth"),
    "text after code block must not have dependency scopes"
  );
});
