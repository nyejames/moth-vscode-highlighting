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
    const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await oniguruma.loadWASM(
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
    );

    return new textmate.Registry({
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
    return { line, tokens: result.tokens, ruleStack };
  });
}

function lineTokens(entry) {
  return entry.tokens.map((token) => ({
    text: entry.line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
}

function allTokens(grammar, source) {
  const result = grammar.tokenizeLine(source, textmate.INITIAL);
  return result.tokens.map((token) => ({
    text: source.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
}

function hasScope(token, scope) {
  return token.scopes.includes(scope);
}

function checkScope(tokens, text, scope) {
  assert.ok(
    tokens.some((token) => token.text.trim() === text && token.scopes.includes(scope)),
    `Expected ${JSON.stringify(text)} to have ${scope}; got ${JSON.stringify(
      tokens.map((token) => [token.text, token.scopes])
    )}`
  );
}

function checkNoScope(tokens, text, scope) {
  const matches = tokens.filter((token) => token.text.trim() === text);
  assert.ok(matches.length > 0, `Expected token ${JSON.stringify(text)}`);
  for (const token of matches) {
    assert.ok(!hasScope(token, scope), `${JSON.stringify(text)} must not have ${scope}`);
  }
}

// ── SOURCE DIRECTIVES ────────────────────────────────────────────────

test("active source directives use the source directive scope", async () => {
  const grammar = await loadGrammar();
  for (const directive of ["$export", "$config", "$doc", "$todo"]) {
    const tokens = allTokens(grammar, directive);
    checkScope(tokens, directive, "keyword.control.directive.source.moth");
  }
});

test("accepted-future source directives use a distinct future scope", async () => {
  const grammar = await loadGrammar();
  for (const directive of ["$fast_math", "$safe_math", "$infallible", "$test"]) {
    const tokens = allTokens(grammar, directive);
    checkScope(tokens, directive, "keyword.control.directive.source.future.moth");
  }
});

test("template directives in source position are invalid and unknown directives are invalid", async () => {
  const grammar = await loadGrammar();
  for (const directive of ["$md", "$slot", "$note", "$code"]) {
    const tokens = allTokens(grammar, directive);
    checkScope(tokens, directive, "invalid.illegal.directive.template-in-source.moth");
  }
  checkScope(
    allTokens(grammar, "$not_a_directive"),
    "$not_a_directive",
    "invalid.illegal.directive.unknown.moth"
  );
});

test("source directives vanish inside strings but survive in comments as comment text", async () => {
  const grammar = await loadGrammar();
  const tokens = allTokens(grammar, 'text = "$export"');
  checkScope(tokens, "$export", "string.quoted.double.moth");
  checkNoScope(tokens, "$export", "keyword.control.directive.source.moth");

  const commentTokens = allTokens(grammar, "-- $export");
  assert.ok(commentTokens.every((token) => token.scopes.includes("comment.line.double-dash.moth")));
});

// ── TYPES AND NOMINAL NAMES ──────────────────────────────────────────

test("exact numeric, builtin, and contract types tokenize as primitives", async () => {
  const grammar = await loadGrammar();
  for (const type of [
    "I8", "I16", "I32", "I64",
    "U8", "U16", "U32", "U64",
    "F16", "F32", "F64",
    "Dec", "Dec0", "Dec4", "Dec99", "Dec256",
    "Bool", "String", "Char", "Byte", "None", "True", "False",
  ]) {
    checkScope(allTokens(grammar, `value ${type} = x`), type, "support.type.primitive.moth");
  }
  for (const builtin of ["Error", "Wire", "Route"]) {
    checkScope(allTokens(grammar, `value ${builtin}`), builtin, "support.type.builtin.moth");
  }
});

test("invalid decimal widths and retired primitive names are not primitive types", async () => {
  const grammar = await loadGrammar();
  for (const invalid of ["Dec01", "Dec257", "Dec999"]) {
    checkScope(allTokens(grammar, `value ${invalid} = x`), invalid, "invalid.illegal.type.decimal.moth");
  }
  for (const retired of ["Int", "Float", "Fn", "IO"]) {
    checkNoScope(allTokens(grammar, `value ${retired} = x`), retired, "support.type.primitive.moth");
  }
});

test("user types, generic parameters, traits, and cast traits use distinct scopes", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "Box type A = | value A |"), "A", "entity.name.type.moth");
  checkScope(allTokens(grammar, "identity type Item |value Item| -> Item:"), "Item", "entity.name.type.moth");
  checkScope(allTokens(grammar, "DISPLAY_TEXT must:"), "DISPLAY_TEXT", "constant.other.caps.moth");
  checkScope(
    allTokens(grammar, "Label must CASTABLE_TO_STRING"),
    "CASTABLE_TO_STRING",
    "support.type.cast-trait.moth"
  );
  checkScope(
    allTokens(grammar, "Label must TRY_CASTABLE_TO_I32"),
    "TRY_CASTABLE_TO_I32",
    "support.type.cast-trait.moth"
  );
});

test("this and This use distinct language scopes", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "return this.name"), "this", "variable.language.this.moth");
  checkScope(allTokens(grammar, "display |This| -> String"), "This", "variable.language.trait-this.moth");
});

// ── OPERATORS AND DECLARATIONS ───────────────────────────────────────

test("mutable and constant declarations use distinct marker and assignment scopes", async () => {
  const grammar = await loadGrammar();
  const mutable = allTokens(grammar, "count ~= 0");
  checkScope(mutable, "~=", "keyword.operator.assignment.mutable.moth");

  const constant = allTokens(grammar, "count #= 0");
  checkScope(constant, "#=", "keyword.operator.assignment.constant.moth");

  const write = allTokens(grammar, "~count += 1");
  checkScope(write, "~", "keyword.operator.mutable.moth");
  checkScope(write, "+=", "keyword.operator.assignment.compound.moth");

  for (const source of ["~name.method()", "value ~{I32} = {}", "take |value ~I32|"]) {
    checkScope(allTokens(grammar, source), "~", "keyword.operator.mutable.moth");
  }

  checkScope(allTokens(grammar, "value #I32 = 1"), "#", "keyword.operator.constant.moth");
  checkScope(allTokens(grammar, "square #|value I32| -> I32:"), "#", "keyword.operator.constant.moth");
});

test("fallible calls, never contracts, and channel operators keep distinct scopes", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "return! Error(\"x\")"), "return!", "keyword.control.flow.error-return.moth");
  checkScope(allTokens(grammar, "value = cast! other"), "cast!", "keyword.control.conversion.fallible.moth");
  checkScope(allTokens(grammar, "fatal || -> !:"), "!", "storage.type.never.moth");
  checkScope(allTokens(grammar, "source << sink"), "<<", "keyword.operator.channel.future.moth");
  checkScope(allTokens(grammar, "source >> sink"), ">>", "keyword.operator.channel.future.moth");
});

test("type suffixes and postfix propagation use visible theme scopes", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "name String? = none"), "?", "support.type.option.moth");
  checkScope(allTokens(grammar, "value {String}? = none"), "?", "support.type.option.moth");
  checkScope(allTokens(grammar, "value Item? = none"), "?", "support.type.option.moth");
  checkScope(allTokens(grammar, "value I32? = none"), "?", "support.type.option.moth");
  checkScope(allTokens(grammar, "value ÄType? = none"), "?", "support.type.option.moth");
  checkScope(allTokens(grammar, "pair || -> String, Error!:"), "!", "support.type.error.moth");
  checkScope(allTokens(grammar, "fail || -> MyError!:"), "!", "support.type.error.moth");
  checkScope(allTokens(grammar, "fail || -> HTTPError!:"), "!", "support.type.error.moth");

  const propagationError = allTokens(grammar, "value = parse(text)!");
  checkScope(propagationError, "!", "storage.type.never.moth");
  checkNoScope(propagationError, "!", "punctuation.operator.propagation.error.moth");
  checkNoScope(propagationError, "!", "keyword.operator.symbol.moth");

  const propagationOption = allTokens(grammar, "value = maybe?");
  checkScope(propagationOption, "?", "support.type.option.moth");
  checkNoScope(propagationOption, "?", "punctuation.operator.propagation.option.moth");
  checkNoScope(propagationOption, "?", "keyword.operator.symbol.moth");

  const constantOption = allTokens(grammar, "value = CONSTANT?");
  checkScope(constantOption, "?", "support.type.option.moth");
  const constantError = allTokens(grammar, "value = CONSTANT!");
  checkScope(constantError, "!", "storage.type.never.moth");
});

test("colon and semicolon use structural punctuation scopes, not keyword scopes", async () => {
  const grammar = await loadGrammar();
  const colon = allTokens(grammar, "if ready:");
  checkScope(colon, ":", "punctuation.separator.colon.moth");
  checkScope(colon, ":", "punctuation.section.scope.begin.moth");
  checkNoScope(colon, ":", "keyword.control.scope.delimiter.moth");

  const semicolon = allTokens(grammar, ";");
  checkScope(semicolon, ";", "punctuation.terminator.statement.moth");
  checkScope(semicolon, ";", "punctuation.section.scope.end.moth");
  checkNoScope(semicolon, ";", "keyword.control.scope.delimiter.moth");

  const templateColon = allTokens(grammar, "[p: body]");
  checkScope(templateColon, ":", "punctuation.separator.template.head-body.moth");
  checkNoScope(templateColon, ":", "keyword.control.scope.delimiter.moth");

  const pathSeparator = allTokens(grammar, "status = Status::Ready");
  const doubleColon = pathSeparator.find((token) => token.text === "::");
  assert.ok(doubleColon.scopes.includes("punctuation.separator.double-colon.moth"));
  assert.ok(!doubleColon.scopes.includes("keyword.control.scope.delimiter.moth"));
});

test("range, map, choice, and match punctuation remain visible", async () => {
  const grammar = await loadGrammar();
  const range = allTokens(grammar, "loop 0 to & 10 by 2 |value|:");
  checkScope(range, "to", "keyword.control.loop.range.moth");
  checkScope(range, "&", "keyword.control.loop.range.moth");
  checkScope(range, "by", "keyword.control.loop.range.moth");

  checkScope(allTokens(grammar, "map ~{String = I32} = {=}"), "=", "keyword.operator.symbol.moth");
  checkScope(allTokens(grammar, "status = Status::Ready"), "::", "keyword.operator.symbol.moth");
  checkScope(allTokens(grammar, "0 => then \"zero\""), "=>", "keyword.operator.symbol.moth");
  checkScope(allTokens(grammar, "quotient = a // b"), "//", "keyword.operator.symbol.moth");
  checkScope(allTokens(grammar, "~count //= 2"), "//=", "keyword.operator.assignment.compound.moth");
});

test("runtime fragments mark the tilde before a template", async () => {
  const grammar = await loadGrammar();
  const tokens = allTokens(grammar, "~[: Runtime fragment.]");
  checkScope(tokens, "~", "keyword.operator.runtime-fragment.moth");
});

// ── LEXICAL BOUNDARIES ───────────────────────────────────────────────

test("retired reserved words remain ordinary identifiers", async () => {
  const grammar = await loadGrammar();
  for (const name of ["import", "export", "block", "config", "group", "region"]) {
    const tokens = allTokens(grammar, `${name} = 1`);
    checkScope(tokens, name, "variable.other.moth");
    checkNoScope(tokens, name, "keyword.other.moth");
    checkNoScope(tokens, name, "keyword.control.flow.moth");
  }
});

test("ordinary identifiers keep keyword prefixes and do not receive keyword scopes", async () => {
  const grammar = await loadGrammar();
  for (const identifier of ["iffy", "exporter", "configuration", "blocked", "regionally", "grouped", "imported"]) {
    const tokens = allTokens(grammar, identifier);
    checkScope(tokens, identifier, "variable.other.moth");
    for (const scope of [
      "keyword.control.flow.moth",
      "keyword.other.moth",
      "keyword.control.logical.moth",
      "keyword.control.loop.range.moth",
    ]) {
      checkNoScope(tokens, identifier, scope);
    }
  }
});

test("Unicode identifiers tokenize in type and value positions", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "café = 1"), "café", "variable.other.moth");
  checkScope(allTokens(grammar, "naïve_value = 1"), "naïve_value", "variable.other.moth");
  checkScope(allTokens(grammar, "Éclair = | flavour String |"), "Éclair", "entity.name.type.moth");
});

test("signed numeric literals stay distinct from spaced minus", async () => {
  const grammar = await loadGrammar();
  checkScope(allTokens(grammar, "value = -2147483648"), "-2147483648", "constant.numeric.moth");
  checkScope(allTokens(grammar, "value = 4_294_967_296"), "4_294_967_296", "constant.numeric.moth");
  checkScope(allTokens(grammar, "value = 1.0e-6"), "1.0e-6", "constant.numeric.moth");

  const spaced = allTokens(grammar, "value = - 5");
  checkScope(spaced, "-", "keyword.operator.symbol.moth");
  checkScope(spaced, "5", "constant.numeric.moth");
});

test("invalid numeric spellings are not numeric literals", async () => {
  const grammar = await loadGrammar();
  for (const source of ["value = 1E6", "value = 0x10", "value = 1u", "value = .5"]) {
    const tokens = allTokens(grammar, source);
    assert.ok(!tokens.some((token) => token.scopes.includes("constant.numeric.moth")),
      `${source} must not contain a numeric literal`);
  }
});

test("supported string escapes are escaped and unsupported escapes are invalid", async () => {
  const grammar = await loadGrammar();
  const tokens = allTokens(grammar, 'text = "a\\nb\\t\\"c\\\\"');
  for (const escape of ['\\n', '\\t', '\\"', '\\\\']) {
    checkScope(tokens, escape, "constant.character.escape.moth");
  }
  checkScope(allTokens(grammar, 'bad = "\\q"'), "\\q", "invalid.illegal.string.escape.moth");
  checkScope(allTokens(grammar, "letter = '\\n'"), "\\n", "constant.character.escape.moth");
});

test("unterminated strings recover at the physical line end", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, ['value = "unterminated', "after = 1"]);
  const second = lines[1].tokens.map((token) => ({
    text: lines[1].line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
  checkScope(second, "after", "variable.other.moth");
  assert.ok(!second.some((token) => token.scopes.includes("string.quoted.double.moth")));
});

// ── DEPENDENCY CLAUSES ───────────────────────────────────────────────

test("source directives annotate the following dependency clause without leaking state", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "$export",
    "@core/math sin, cos",
    "value = 1",
  ]);
  const clause = lines[1].tokens.map((token) => ({
    text: lines[1].line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
  checkScope(clause, "sin", "variable.other.dependency.selection.moth");
  checkScope(clause, "cos", "variable.other.dependency.selection.moth");

  const following = lines[2].tokens.map((token) => ({
    text: lines[2].line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
  checkScope(following, "value", "variable.other.moth");
  assert.ok(!following.some((token) => token.scopes.includes("meta.dependency-clause.moth")));
});

test("source directive runs stack and nested operands stay in template context", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "$export $config",
    "$doc [$md: Public function.]",
    "$todo [: Review this later.]",
    "",
    "@core/math sin",
  ]);

  checkScope(lineTokens(lines[0]), "$export", "keyword.control.directive.source.moth");
  checkScope(lineTokens(lines[0]), "$config", "keyword.control.directive.source.moth");

  checkScope(lineTokens(lines[1]), "$doc", "keyword.control.directive.source.moth");
  checkScope(lineTokens(lines[1]), "$md", "keyword.control.directive.template.moth");
  checkNoScope(lineTokens(lines[1]), "$md", "invalid.illegal.directive.source-in-template.moth");
  checkScope(lineTokens(lines[1]), "Public function.", "meta.embedded.block.markdown.moth");

  checkScope(lineTokens(lines[2]), "$todo", "keyword.control.directive.source.moth");
  checkScope(lineTokens(lines[2]), "Review this later.", "string.unquoted.template.body.moth");

  checkScope(lineTokens(lines[4]), "@", "punctuation.definition.path.begin.moth");
  checkScope(lineTokens(lines[4]), "sin", "variable.other.dependency.selection.moth");
});

test("source -- comments and template body -- text stay distinct", async () => {
  const grammar = await loadGrammar();
  const [comment] = tokenizeLines(grammar, ["-- source comment"]);
  checkScope(lineTokens(comment), "-- source comment", "comment.line.double-dash.moth");

  const [body] = tokenizeLines(grammar, ["[p: -- authored body text]"]);
  checkScope(lineTokens(body), "-- authored body text", "string.unquoted.template.body.moth");
  checkNoScope(lineTokens(body), "-- authored body text", "comment.line.double-dash.moth");
});

test("export colon no longer creates a dependency block keyword", async () => {
  const grammar = await loadGrammar();
  const tokens = allTokens(grammar, "export: @core/math sin, cos");
  checkScope(tokens, "export", "variable.other.moth");
  checkNoScope(tokens, "export", "keyword.other.moth");
  assert.ok(!tokens.some((token) => token.scopes.includes("meta.dependency-clause.moth")));
});

test("multiline dependency selections accept CRLF line endings", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "@html/tables data,\r",
    "    row,\r",
    "    heading\r",
  ]);
  for (const [index, expected] of [[0, "data"], [1, "row"], [2, "heading"]]) {
    const tokens = lines[index].tokens.map((token) => ({
      text: lines[index].line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    }));
    checkScope(tokens, expected, "variable.other.dependency.selection.moth");
  }
});
