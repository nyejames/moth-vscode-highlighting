const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const grammarPath = path.join(rootDir, "syntaxes", "moth.tmLanguage.json");
const packagePath = path.join(rootDir, "package.json");
const fixturePath = path.join(__dirname, "fixtures", "highlighting-samples.moth");
const invalidFixturePath = path.join(__dirname, "fixtures", "invalid-syntax.moth");

const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function walkObjects(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }

  for (const nested of Object.values(value)) walkObjects(nested, visit);
}

function includesUnder(value) {
  const includes = [];
  walkObjects(value, (node) => {
    if (typeof node.include === "string") includes.push(node.include);
  });
  return includes;
}

function repoIncludes(repositoryKey) {
  const repositoryEntry = grammar.repository[repositoryKey];
  assert.ok(repositoryEntry, `expected repository '${repositoryKey}'`);
  return includesUnder(repositoryEntry);
}

function repoExists(repositoryKey) {
  return Object.hasOwn(grammar.repository, repositoryKey);
}

function findPatterns(repositoryKey, predicate) {
  const repositoryEntry = grammar.repository[repositoryKey];
  assert.ok(repositoryEntry, `expected repository '${repositoryKey}'`);
  const matches = [];
  walkObjects(repositoryEntry, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function findPatternsByName(name) {
  const matches = [];
  walkObjects(grammar.repository, (node) => {
    if (typeof node.name === "string" && node.name.split(/\s+/).includes(name)) {
      matches.push(node);
    }
  });
  return matches;
}

function regexp(pattern) {
  return new RegExp(pattern, "u");
}

function rootIncludes() {
  return grammar.patterns.map((pattern) => pattern.include).filter(Boolean);
}

// ── GRAMMAR INTEGRITY ────────────────────────────────────────────────

test("main grammar uses the Moth source scope", () => {
  assert.equal(grammar.scopeName, "source.moth");
});

test("all internal repository includes resolve", () => {
  const missing = [];
  walkObjects(grammar, (node) => {
    if (typeof node.include !== "string" || !node.include.startsWith("#")) return;
    const key = node.include.slice(1);
    if (!Object.hasOwn(grammar.repository, key)) missing.push(node.include);
  });
  assert.deepEqual(missing, []);
});

test("root template patterns run before general source tokens", () => {
  const includes = rootIncludes();
  assert.ok(includes.includes("#template-nested"));
  const templateIndex = includes.indexOf("#template-nested");
  for (const sourceKey of ["#strings", "#numbers", "#keywords", "#identifiers"]) {
    assert.ok(
      templateIndex < includes.indexOf(sourceKey),
      `${sourceKey} must run after template recognition`
    );
  }
});

// ── KEYWORDS, TYPES, AND BUILTINS ───────────────────────────────────

test("assert is highlighted as a builtin intrinsic rather than keyword.other", () => {
  const builtinPattern = grammar.repository.constants.patterns.find(
    (pattern) => pattern.name === "support.function.builtin.moth"
  );
  assert.ok(builtinPattern, "expected support.function.builtin.moth");
  assert.match(builtinPattern.match, /\\bassert\\b/);

  const keywordOther = grammar.repository.keywords.patterns.find(
    (pattern) => pattern.name === "keyword.other.moth"
  );
  assert.ok(keywordOther, "expected keyword.other.moth");
  assert.doesNotMatch(keywordOther.match, /\bassert\b/);
});

test("current flow, logical, declaration, conversion, and range keywords are present", () => {
  const keywordText = grammar.repository.keywords.patterns
    .map((pattern) => pattern.match || "")
    .join(" ");
  for (const keyword of ["if", "else", "return", "loop", "break", "continue",
    "catch", "then", "is", "not", "and", "or", "as", "copy", "must",
    "cast", "into", "to", "by"]) {
    assert.ok(new RegExp("\\b" + keyword + "\\b").test(keywordText), `missing keyword '${keyword}'`);
  }
  for (const ordinary of ["export", "block", "import", "config", "group", "region"]) {
    assert.ok(!new RegExp("\\b" + ordinary + "\\b").test(keywordText),
      `ordinary identifier '${ordinary}' must not be reserved`);
  }
});

test("import is an ordinary identifier rather than a Moth keyword", () => {
  const keywordText = grammar.repository.keywords.patterns
    .map((pattern) => pattern.match || "")
    .join(" ");

  assert.doesNotMatch(keywordText, /\\bimport\\b/);
});

test("removed case and yield keywords are absent", () => {
  const flowPattern = grammar.repository.keywords.patterns.find(
    (pattern) => pattern.name === "keyword.control.flow.moth"
  );
  assert.ok(flowPattern);
  assert.doesNotMatch(flowPattern.match, /\bcase\b/);
  assert.doesNotMatch(flowPattern.match, /\byield\b/);
});

test("future-reserved async, checked, and yield use a distinct scope", () => {
  const reserved = grammar.repository.keywords.patterns.find(
    (pattern) => pattern.name === "keyword.other.future-reserved.moth"
  );
  assert.ok(reserved);
  for (const keyword of ["async", "checked", "yield"]) {
    assert.match(reserved.match, new RegExp("\\b" + keyword + "\\b"));
  }
  assert.doesNotMatch(reserved.match, /\\bblock\\b/);
});

test("this and This use their distinct language scopes", () => {
  const valueThis = grammar.repository.keywords.patterns.find(
    (pattern) => pattern.name === "variable.language.this.moth"
  );
  const traitThis = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "variable.language.trait-this.moth"
  );

  assert.ok(valueThis);
  assert.ok(traitThis);
  assert.ok(regexp(`^(?:${valueThis.match})$`).test("this"));
  assert.ok(!regexp(`^(?:${valueThis.match})$`).test("thistle"));
  assert.ok(regexp(`^(?:${traitThis.match})$`).test("This"));
});

test("exact-width types, decimals, option none, and lowercase booleans are present", () => {
  const primitive = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "support.type.primitive.moth"
  );
  const boolean = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "constant.language.boolean.moth"
  );
  const none = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "constant.language.none.moth"
  );
  const invalidDecimal = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "invalid.illegal.type.decimal.moth"
  );
  const isPrimitive = (name) => regexp(`^(?:${primitive.match})$`).test(name);
  for (const name of ["I8", "I16", "I32", "I64", "U8", "U16", "U32", "U64",
    "F16", "F32", "F64", "Bool", "String", "Char", "Byte",
    "None", "True", "False", "Dec", "Dec0", "Dec4", "Dec99", "Dec100", "Dec256"]) {
    assert.ok(isPrimitive(name), `missing primitive '${name}'`);
  }
  for (const old of ["Int", "Float", "Fn", "IO", "Dec01", "Dec257", "I128", "Dec256x"]) {
    assert.ok(!isPrimitive(old), `unexpected primitive '${old}'`);
  }
  assert.ok(invalidDecimal, "expected invalid.illegal.type.decimal.moth");
  for (const invalid of ["Dec01", "Dec257", "Dec999"]) {
    assert.ok(regexp(`^(?:${invalidDecimal.match})$`).test(invalid), `expected invalid decimal '${invalid}'`);
  }
  assert.match(boolean.match, /\btrue\b/);
  assert.match(boolean.match, /\bfalse\b/);
  assert.doesNotMatch(boolean.match, /\bTrue\b/);
  assert.match(none.match, /\\bnone\\b/);
});

test("type and of use the generic-language scope", () => {
  const genericPattern = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "variable.language.generics.moth"
  );
  assert.ok(genericPattern);
  assert.match(genericPattern.match, /\btype\b/);
  assert.match(genericPattern.match, /\bof\b/);
});

test("Error remains a builtin type", () => {
  const builtinType = grammar.repository.constants.patterns.find(
    (pattern) => pattern.name === "support.type.builtin.moth"
  );
  assert.ok(builtinType);
  assert.match(builtinType.match, /\bError\b/);
  assert.match(builtinType.match, /\bWire\b/);
  assert.match(builtinType.match, /\bRoute\b/);
});

test("cast traits and ALL_CAPS traits use distinct scopes", () => {
  const castTrait = grammar.repository.types.patterns.find(
    (pattern) => pattern.name === "support.type.cast-trait.moth"
  );
  const caps = grammar.repository.constants.patterns.find(
    (pattern) => pattern.name === "constant.other.caps.moth"
  );
  assert.ok(castTrait);
  assert.ok(caps);
  for (const name of ["CASTABLE_TO_STRING", "TRY_CASTABLE_TO_I32", "CASTABLE_TO_BOOL"]) {
    assert.ok(regexp(`^(?:${castTrait.match})$`).test(name), `missing cast trait '${name}'`);
  }
  const capsRe = regexp(`^(?:${caps.match})$`);
  for (const name of ["DISPLAY_TEXT", "READABLE", "NAMED"]) {
    assert.ok(capsRe.test(name), `missing trait name '${name}'`);
  }
  assert.ok(!capsRe.test("A"), "single-letter generic parameters are not ALL_CAPS traits");
});

// ── OPERATORS, PUNCTUATION, AND NUMBERS ──────────────────────────────

test("active symbol operators retain current Moth spellings", () => {
  const symbolPatterns = grammar.repository.operators.patterns.filter(
    (pattern) => typeof pattern.name === "string"
      && pattern.name.split(/\s+/).includes("keyword.operator.symbol.moth")
  );
  assert.ok(symbolPatterns.length > 0);
  const matches = (operator) => symbolPatterns.some(
    (pattern) => regexp(`^(?:${pattern.match})$`).test(operator)
  );
  for (const operator of ["+", "-", "=>", "->", "::", "//", "<=", ">=", "$", "="]) {
    assert.ok(matches(operator), `expected operator '${operator}'`);
  }
  assert.ok(!matches(".."), "range syntax uses to/by, not '..'");
  assert.ok(!matches("|"), "pipe is parameter punctuation rather than a symbolic operator");
  const doubleColon = symbolPatterns.find(
    (pattern) => regexp(`^(?:${pattern.match})$`).test("::")
  );
  assert.ok(doubleColon.name.includes("punctuation.separator.double-colon.moth"));
  assert.ok(!doubleColon.name.includes("keyword.control.scope.delimiter.moth"));
});

test("future channel operators have their own scope", () => {
  const channel = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.channel.future.moth"
  );
  assert.ok(channel);
  for (const operator of ["<<", ">>"]) {
    assert.ok(regexp(`^(?:${channel.match})$`).test(operator));
  }
  assert.ok(!regexp(`^(?:${channel.match})$`).test("<="));
});

test("mutable and constant markers use distinct operator scopes", () => {
  const mutableAssign = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.assignment.mutable.moth"
  );
  const constantAssign = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.assignment.constant.moth"
  );
  const mutable = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.mutable.moth"
  );
  const constant = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.constant.moth"
  );
  assert.ok(mutableAssign && constantAssign && mutable && constant);
  assert.ok(regexp(`^(?:${mutableAssign.match})$`).test("~="));
  assert.ok(regexp(`^(?:${constantAssign.match})$`).test("#="));
  for (const source of ["~name", "~{I32}", "~Type"]) {
    assert.ok(regexp(mutable.match).test(source), `expected mutable marker in '${source}'`);
  }
  for (const source of ["#I32", "#|"]) {
    assert.ok(regexp(constant.match).test(source), `expected constant marker in '${source}'`);
  }
});

test("Never, error-return, and fallible cast tokens have distinct rules", () => {
  const keywords = grammar.repository.keywords.patterns;
  const errorReturn = keywords.find((p) => p.name === "keyword.control.flow.error-return.moth");
  const fallibleCast = keywords.find((p) => p.name === "keyword.control.conversion.fallible.moth");
  const never = keywords.find((p) => p.name === "meta.function.return.never.moth");
  assert.ok(errorReturn && fallibleCast && never);
  assert.ok(regexp(`^(?:${errorReturn.match})$`).test("return!"));
  assert.ok(regexp(`^(?:${fallibleCast.match})$`).test("cast!"));
  assert.ok(regexp(`^(?:${never.match})$`).test("-> !"));
  assert.equal(never.captures["3"].name, "storage.type.never.moth");
});

test("source directives separate active, accepted-future, and wrong-context names", () => {
  assert.ok(rootIncludes().includes("#source-directives"));
  assert.ok(repoIncludes("code-moth-fragment").includes("#source-directives"));

  const active = grammar.repository["source-directives"].patterns.find(
    (pattern) => pattern.name === "keyword.control.directive.source.moth"
  );
  const future = grammar.repository["source-directives"].patterns.find(
    (pattern) => pattern.name === "keyword.control.directive.source.future.moth"
  );
  const templateInSource = grammar.repository["source-directives"].patterns.find(
    (pattern) => pattern.name === "invalid.illegal.directive.template-in-source.moth"
  );
  assert.ok(active && future && templateInSource);

  const activeRe = regexp(`^(?:${active.match})$`);
  for (const directive of ["$export", "$config", "$doc", "$todo"]) {
    assert.ok(activeRe.test(directive), `missing active source directive ${directive}`);
  }
  const futureRe = regexp(`^(?:${future.match})$`);
  for (const directive of ["$fast_math", "$safe_math", "$infallible", "$test"]) {
    assert.ok(futureRe.test(directive), `missing future source directive ${directive}`);
  }
  const wrongRe = regexp(`^(?:${templateInSource.match})$`);
  for (const directive of ["$md", "$slot", "$note", "$code"]) {
    assert.ok(wrongRe.test(directive), `template directive ${directive} must be invalid in source`);
  }
  for (const stale of ["$page", "$project", "$builder", "$html_builder", "$entry"]) {
    const sourceText = grammar.repository["source-directives"].patterns
      .map((pattern) => pattern.match || "")
      .join(" ");
    assert.doesNotMatch(sourceText, new RegExp("\\" + stale + "\\b"), `stale directive ${stale}`);
  }
});

test("assignment/declaration operator forms remain highlighted", () => {
  const compoundPattern = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.assignment.compound.moth"
  );
  assert.ok(compoundPattern);

  const re = regexp(`^(?:${compoundPattern.match})$`);
  for (const operator of ["+=", "-=", "*=", "//=", "/=", "%=", "^="]) {
    assert.ok(re.test(operator), `expected operator form '${operator}'`);
  }
  assert.ok(!re.test("#="), "#= has its own constant-assignment scope");
  assert.ok(!re.test("~="), "~= has its own mutable-assignment scope");
});

test("punctuation covers pipe brackets and dot access", () => {
  const pipe = grammar.repository.punctuation.patterns.find(
    (pattern) => pattern.name.includes("punctuation.brackets.pipe.moth")
  );
  const dot = grammar.repository.punctuation.patterns.find(
    (pattern) => pattern.name === "punctuation.accessor.dot.moth"
  );

  assert.ok(pipe);
  assert.equal(pipe.name, "punctuation.brackets.pipe.moth");
  assert.ok(dot);
  assert.ok(regexp(`^(?:${pipe.match})$`).test("|"));
  assert.ok(regexp(`^(?:${dot.match})$`).test("."));
});

test("numeric literals cover signed values, decimals, and lowercase exponents", () => {
  const numeric = grammar.repository.numbers.patterns.find(
    (pattern) => pattern.name === "constant.numeric.moth"
  );
  assert.ok(numeric);

  const re = regexp(`^(?:${numeric.match})$`);
  for (const value of ["1", "1.5", "1e6", "1.0e-6", "-2147483648", "4_294_967_296"]) {
    assert.ok(re.test(value), `expected numeric literal '${value}'`);
  }
  for (const invalid of ["1E6", "0x10", "1u", ".5", "1__2"]) {
    assert.ok(!re.test(invalid), `unexpected numeric syntax '${invalid}'`);
  }
});

test("Unicode identifiers are matched and keyword prefixes stay identifiers", () => {
  const identifier = grammar.repository.identifiers.patterns[0];
  const typeIdentifier = grammar.repository["type-identifiers"].patterns[0];
  assert.ok(identifier);
  assert.ok(typeIdentifier);
  const idRe = regexp(`^(?:${identifier.match})$`);
  const typeRe = regexp(`^(?:${typeIdentifier.match})$`);
  for (const name of ["café", "π", "naïve_value", "_private"]) {
    assert.ok(idRe.test(name), `expected identifier '${name}'`);
  }
  for (const name of ["Person", "Éclair", "A"]) {
    assert.ok(typeRe.test(name), `expected type identifier '${name}'`);
  }
  assert.ok(idRe.test("iffy"), "keyword prefixes remain ordinary identifiers");
});

// ── TEMPLATE DIRECTIVES AND EMBEDDED LANGUAGES ──────────────────────

test("template directives cover the accepted formatter, slot, and wrapper names", () => {
  const patternText = grammar.repository["template-directive"].patterns
    .map((pattern) => pattern.match || "")
    .join(" ");

  for (const directive of [
    "before",
    "after",
    "fresh",
    "slot",
    "in",
    "note",
    "raw",
    "md",
    "html",
    "css",
    "escape_html",
    "code",
  ]) {
    assert.ok(patternText.includes(directive), `missing $${directive}`);
  }
  assert.doesNotMatch(patternText, /\binsert\b/, "$insert is not a current directive");
  assert.doesNotMatch(patternText, /\bchildren\b/, "$children is not a current directive");
});

test("source directives are invalid in template heads", () => {
  const invalid = grammar.repository["template-directive"].patterns.find(
    (pattern) => pattern.name === "invalid.illegal.directive.source-in-template.moth"
  );
  assert.ok(invalid);
  const re = regexp(`^(?:${invalid.match})$`);
  for (const directive of ["$export", "$config", "$doc", "$todo", "$test"]) {
    assert.ok(re.test(directive), `expected invalid template-head directive ${directive}`);
  }
  assert.ok(!re.test("$md"));
});

test("slot and insert targets are bare tokens, with invalid quoted and call forms", () => {
  const targets = grammar.repository["template-head-directive-targets"].patterns;
  const serialized = JSON.stringify(targets);
  for (const scope of [
    "variable.parameter.template.slot.moth",
    "constant.numeric.positional-slot.moth",
    "variable.parameter.template.slot.target.moth",
    "invalid.illegal.template.slot.target.moth",
    "invalid.illegal.template.slot.position.moth",
    "invalid.illegal.directive.call-syntax.moth",
  ]) {
    assert.ok(serialized.includes(scope), `missing ${scope}`);
  }
  assert.ok(
    JSON.stringify(grammar.repository["template-directive"]).includes("invalid.illegal.directive.operand.moth")
  );
});

test("Rust formatter recognises rs and rust", () => {
  const pattern = grammar.repository["template-code-rs"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.rs\.moth/);
  assert.ok(beginRe.test('[$code "rs":'));
  assert.ok(beginRe.test('[$code "rust":'));
  assert.ok(beginRe.test('[codeblock, $code "rust":'));
  assert.ok(!beginRe.test('[$code "py":'));
});

test("shell formatter recognises sh, shell, and bash", () => {
  const pattern = grammar.repository["template-code-shell"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.shell\.moth/);
  for (const name of ["sh", "shell", "bash"]) {
    assert.ok(beginRe.test(`[$code "${name}":`));
  }
  assert.ok(!beginRe.test('[$code "py":'));
});

test("Moth formatter recognises moth and mtf without call syntax", () => {
  const pattern = grammar.repository["template-code-moth"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.mothlang\.moth/);
  assert.ok(beginRe.test('[$code "moth":'));
  assert.ok(beginRe.test('[$code "mtf":'));
  assert.ok(!beginRe.test('[$code("moth"):'));
  assert.doesNotMatch(pattern.begin, /bst/, "legacy bst code labels must be gone");
});

test("formatter begin patterns accept multiline heads and comma-separated items", () => {
  const cases = [
    ["template-markdown", "$md"],
    ["template-raw", "$raw"],
    ["template-escape-html", "$escape_html"],
    ["template-html", "$html"],
    ["template-css", "$css"],
  ];
  for (const [key, directive] of cases) {
    const beginRe = regexp(grammar.repository[key].patterns[0].begin);
    assert.ok(beginRe.test(`[${directive}:`), `${key} single-line`);
    assert.ok(beginRe.test(`[\n    section,\n    ${directive}:`), `${key} multiline`);
    assert.ok(beginRe.test(`[card, ${directive}:`), `${key} comma item`);
  }
});

test("Rust, shell, JS, TS, and Python bodies delegate to their source grammars", () => {
  for (const [repositoryKey, expectedScope] of [
    ["embedded-code-rs", "source.rust"],
    ["embedded-code-shell", "source.shell"],
    ["embedded-code-js", "source.js"],
    ["embedded-code-ts", "source.ts"],
    ["embedded-code-py", "source.python"],
  ]) {
    const includes = repoIncludes(repositoryKey);
    assert.ok(includes.includes(expectedScope), `${repositoryKey} should include ${expectedScope}`);
  }
});

test("embedded Moth code preserves path and invalid-at fallback highlighting", () => {
  const includes = repoIncludes("code-moth-fragment");
  assert.ok(includes.includes("#path-literals"));
  assert.ok(includes.includes("#invalid-at-sign"));

  const recursiveBlocks = findPatterns(
    "embedded-code-moth",
    (node) => typeof node.begin === "string" && includesUnder(node).includes("#embedded-code-moth")
  );
  assert.ok(recursiveBlocks.length > 0, "expected recursive bracket handling in embedded Moth code");
  assert.ok(recursiveBlocks.some((pattern) => includesUnder(pattern).includes("#code-moth-fragment")));
  assert.ok(
    !repoIncludes("embedded-code-moth").includes("#template-nested"),
    "code bodies must not interpret nested Moth templates"
  );
});

// ── BOUNDED CSS REGRESSIONS ─────────────────────────────────────────

test("CSS formatter bodies use the bounded embedded CSS fragment", () => {
  const bodyIncludes = repoIncludes("template-body-css");
  assert.ok(bodyIncludes.includes("#embedded-css"));

  const embedded = grammar.repository["embedded-css"].patterns;
  assert.ok(embedded.some((pattern) => pattern.name === "meta.embedded.block.css.moth"));
  assert.ok(repoIncludes("embedded-css").includes("#css-fragment"));
});

test("bounded CSS fragments recognise property names, functions, colours, and percentages", () => {
  const patterns = grammar.repository["css-fragment"].patterns;
  const property = patterns.find((pattern) => pattern.name === "support.type.property-name.css");
  const fn = patterns.find((pattern) => pattern.name === "support.function.css");
  const colour = patterns.find(
    (pattern) => pattern.name === "constant.other.color.rgb-value.hex.css"
  );
  const number = patterns.find((pattern) => pattern.name === "constant.numeric.css");

  assert.ok(property);
  assert.ok(fn);
  assert.ok(colour);
  assert.ok(number);
  assert.ok(regexp(property.match).test("clip-path: circle(55%);"));
  assert.ok(regexp(fn.match).test("circle(55%);"));
  assert.ok(regexp(number.match).test("55%"));
});

test("shared template nesting includes every formatter and code language", () => {
  const includes = repoIncludes("template-nested");
  for (const key of [
    "#template-note",
    "#template-slot",
    "#template-code-js",
    "#template-code-ts",
    "#template-code-py",
    "#template-code-rs",
    "#template-code-shell",
    "#template-code-moth",
    "#template-code-generic",
    "#template-css",
    "#template-html",
    "#template-markdown",
    "#template-raw",
    "#template-escape-html",
    "#template-generic",
  ]) {
    assert.ok(includes.includes(key), `missing ${key}`);
  }

  const genericIndex = includes.indexOf("#template-generic");
  for (const key of includes.filter((entry) => entry !== "#template-generic")) {
    assert.ok(includes.indexOf(key) < genericIndex, `${key} must precede generic templates`);
  }
});

test("root code formatter order keeps specific languages before generic code", () => {
  const includes = repoIncludes("template-nested");
  const genericIndex = includes.indexOf("#template-code-generic");

  for (const key of [
    "#template-code-js",
    "#template-code-ts",
    "#template-code-py",
    "#template-code-rs",
    "#template-code-shell",
    "#template-code-moth",
  ]) {
    assert.ok(includes.indexOf(key) < genericIndex, `${key} must precede generic $code`);
  }
});

// ── PACKAGE EMBEDDED-LANGUAGE MAPPINGS ──────────────────────────────

test("package maps embedded Moth grammar scopes to VS Code language IDs", () => {
  const contribution = pkg.contributes.grammars.find((entry) => entry.language === "moth");
  assert.ok(contribution, "expected the source.moth grammar contribution");

  const embedded = contribution.embeddedLanguages || {};
  assert.equal(embedded["meta.embedded.block.markdown.moth"], "markdown");
  assert.equal(embedded["meta.embedded.block.css.moth"], "css");
  assert.equal(embedded["meta.embedded.block.html.moth"], "html");
  assert.equal(embedded["meta.embedded.block.code.js.moth"], "javascript");
  assert.equal(embedded["meta.embedded.block.code.ts.moth"], "typescript");
  assert.equal(embedded["meta.embedded.block.code.py.moth"], "python");
  assert.equal(embedded["meta.embedded.block.code.mothlang.moth"], "moth");
  assert.equal(embedded["meta.embedded.block.code.generic.moth"], "plaintext");
  assert.equal(embedded["meta.embedded.block.code.rs.moth"], "rust");
  assert.equal(embedded["meta.embedded.block.code.shell.moth"], "shellscript");
});

// ── REPOSITORY AND SCOPE COVERAGE ───────────────────────────────────

test("all expected repository families are present", () => {
  const expected = [
    "comments",
    "source-directives",
    "dependency-clauses",
    "dependency-continuation",
    "dependency-selection-alias",
    "dependency-selection",
    "path-literals",
    "path-components",
    "invalid-at-sign",
    "template-nested",
    "template-head",
    "template-head-directive-targets",
    "template-directive",
    "template-default-expression",
    "template-slot",
    "template-note",
    "note-body",
    "template-markdown",
    "template-raw",
    "template-escape-html",
    "template-html",
    "template-css",
    "template-code-js",
    "template-code-ts",
    "template-code-py",
    "template-code-rs",
    "template-code-shell",
    "template-code-moth",
    "template-code-generic",
    "template-generic",
    "template-body-markdown",
    "template-body-generic",
    "template-body-raw",
    "template-body-escape-html",
    "template-body-html",
    "template-body-css",
    "template-body-code-js",
    "template-body-code-ts",
    "template-body-code-py",
    "template-body-code-rs",
    "template-body-code-shell",
    "template-body-code-moth",
    "template-body-code-generic",
    "markdown-fragment",
    "markdown-heading",
    "markdown-list-unnumbered",
    "markdown-list-numbered",
    "markdown-inline",
    "markdown-link",
    "markdown-link-multiline",
    "markdown-section-id",
    "markdown-inline-code",
    "markdown-bold",
    "markdown-italic",
    "embedded-html",
    "embedded-html-fragment",
    "embedded-html-string-double",
    "embedded-html-string-single",
    "embedded-css",
    "css-fragment",
    "embedded-code-js",
    "embedded-code-ts",
    "embedded-code-py",
    "embedded-code-rs",
    "embedded-code-shell",
    "embedded-code-moth",
    "embedded-code-generic",
    "code-moth-fragment",
    "code-generic-fragment",
    "raw-strings",
    "strings",
    "chars",
    "numbers",
    "keywords",
    "types",
    "operators",
    "punctuation",
    "constants",
    "type-identifiers",
    "identifiers",
  ];

  for (const repositoryKey of expected) {
    assert.ok(repoExists(repositoryKey), `missing repository '${repositoryKey}'`);
  }
});

test("key source scopes remain available to themes", () => {
  for (const scope of [
    "comment.line.double-dash.moth",
    "keyword.control.flow.moth",
    "keyword.control.loop.range.moth",
    "keyword.other.moth",
    "keyword.control.logical.moth",
    "keyword.operator.assignment.compound.moth",
    "keyword.operator.assignment.mutable.moth",
    "keyword.operator.assignment.constant.moth",
    "keyword.operator.mutable.moth",
    "keyword.operator.constant.moth",
    "keyword.operator.runtime-fragment.moth",
    "keyword.operator.channel.future.moth",
    "variable.language.this.moth",
    "support.type.primitive.moth",
    "support.type.cast-trait.moth",
    "invalid.illegal.type.decimal.moth",
    "constant.language.boolean.moth",
    "constant.language.none.moth",
    "variable.language.trait-this.moth",
    "variable.language.generics.moth",
    "support.function.builtin.moth",
    "support.type.builtin.moth",
    "string.quoted.double.moth",
    "string.quoted.single.char.moth",
    "constant.numeric.moth",
    "entity.name.type.moth",
    "variable.other.moth",
  ]) {
    assert.ok(findPatternsByName(scope).length > 0, `missing scope '${scope}'`);
  }
});

test("template meta scopes remain available for embedded language mapping", () => {
  for (const scope of [
    "meta.template.moth",
    "meta.template.markdown.moth",
    "meta.template.css.moth",
    "meta.template.html.moth",
    "meta.template.raw.moth",
    "meta.template.escape-html.moth",
    "meta.template.code.js.moth",
    "meta.template.code.ts.moth",
    "meta.template.code.py.moth",
    "meta.template.code.rs.moth",
    "meta.template.code.shell.moth",
    "meta.template.code.mothlang.moth",
    "meta.template.code.generic.moth",
  ]) {
    assert.ok(findPatternsByName(scope).length > 0, `missing template scope '${scope}'`);
  }
});

// ── MARKDOWN REGRESSIONS ────────────────────────────────────────────

test("Markdown unordered and ordered list markers have dedicated punctuation captures", () => {
  const bullet = grammar.repository["markdown-list-unnumbered"].patterns[0];
  const ordered = grammar.repository["markdown-list-numbered"].patterns[0];
  assert.ok(bullet);
  assert.ok(ordered);

  const bulletRe = regexp(bullet.match);
  for (const source of ["- item", "  - item"]) {
    assert.ok(bulletRe.test(source), `expected Markdown bullet '${source}'`);
  }
  assert.ok(!bulletRe.test("-item"));
  assert.equal(bullet.captures["1"].name, "punctuation.definition.list.begin.markdown");

  const orderedRe = regexp(ordered.match);
  for (const source of ["1. item", "  12. item"]) {
    assert.ok(orderedRe.test(source), `expected Markdown ordered item '${source}'`);
  }
  assert.ok(!orderedRe.test("1.item"));
});

test("Moth Markdown links accept supported single-line forms and reject bare domains", () => {
  const link = grammar.repository["markdown-link"].patterns[0];
  assert.ok(link);

  const re = regexp(link.match);
  for (const source of [
    "@https://example.com (Example)",
    "@//cdn.example.com/lib.js (CDN)",
    "@/docs/getting-started (Docs)",
    "@./local/path (Local)",
    "@../parent/path (Parent)",
    "@#overview (Overview)",
    "@?q=moth (Search)",
    "@./guide#getting-started (Guide)",
  ]) {
    assert.ok(re.test(source), `expected supported link '${source}'`);
  }

  for (const source of [
    "@example.com (Example)",
    "@https://example.com(Example)",
    "@https://example.com\n(Example)",
  ]) {
    assert.ok(!re.test(source), `expected unsupported single-line link '${source}'`);
  }
});

test("multiline links begin only on an end-of-line target", () => {
  const multiline = grammar.repository["markdown-link-multiline"].patterns[0];
  assert.ok(multiline);
  const beginRe = regexp(multiline.begin);
  assert.ok(beginRe.test("@/guide"));
  assert.ok(beginRe.test("@https://example.com"));
  assert.ok(!beginRe.test("@/guide (Guide)"));
  assert.ok(!beginRe.test("@#section-id"), "a bare section marker is not a multiline link");
});

test("Markdown section IDs use Unicode letters and reject labels", () => {
  const sectionId = grammar.repository["markdown-section-id"].patterns[0];
  assert.ok(sectionId);
  const re = regexp(sectionId.match);
  for (const source of ["@#welcome", "@#café", "@#概要", "@#release-notes_2"]) {
    assert.ok(re.test(source), `expected section ID '${source}'`);
  }
  for (const source of ["@#welcome (Welcome)", "prefix@#id", "@#1bad"]) {
    assert.ok(!re.test(source), `unexpected section ID '${source}'`);
  }
});

test("Markdown inline code requires one same-line backtick pair", () => {
  const inline = grammar.repository["markdown-inline-code"].patterns[0];
  assert.ok(inline);
  const beginRe = regexp(inline.begin);
  assert.ok(beginRe.test("`code [child]`"));
  assert.ok(!beginRe.test("``code``"), "repeated backtick runs are not inline code");
  assert.ok(!beginRe.test("`unmatched"));
  assert.ok(!beginRe.test("`multi\nline`"), "inline code cannot span lines");
  assert.ok(inline.patterns.some((pattern) => pattern.include === "#template-nested"));
});

// ── FIXTURE ─────────────────────────────────────────────────────────

test("Moth fixture contains accepted syntax and regression cases", () => {
  assert.ok(fs.existsSync(fixturePath));
  const fixture = fs.readFileSync(fixturePath, "utf8");

  for (const snippet of [
    "-- Source comments",
    "@styles/docs navbar, title, section",
    "@drawing.js draw,",
    "$export",
    "@core/math sin, cos",
    "import = 1",
    "export = 2",
    "config = 4",
    "page_title #= \"Templates\"",
    "logo #= @assets/logo.svg",
    'font #= @fonts/"Computer Modern.woff2"',
    "root = @/",
    "count ~= 0",
    "~person.age += 1",
    "decimal Dec4 = 12.3456",
    "values ~{I32} = {}",
    "Person = |",
    "Status ::",
    "identity type Item |value Item| -> Item:",
    "DISPLAY_TEXT must:",
    "Label must DISPLAY_TEXT",
    "~count, status = next()",
    "loop 0 to & 10 by 2 |number, ordinal|:",
    "loop ~scanner.next_token() is |token|:",
    "fatal |message String| -> !:",
    "assert(false, message)",
    "catch:",
    "[$md:",
    "# Welcome @#welcome",
    "- This is a Markdown bullet. @#install",
    "1. This is an ordered item.",
    "**Bold [name]** and *italic* text.",
    "See @#welcome (Welcome) and @./guide (Guide).",
    "`code [name] text`",
    "[$note:",
    "[$slot title = \"Untitled\"]",
    "[$slot]",
    "[$in title:Welcome]",
    "$after [:</li>]:",
    "[$fresh: [: Rob]]",
    "[$slot 1]",
    '$code "moth"',
    '$code "js"',
    '$code "ts"',
    '$code "py"',
    '$code "rust"',
    '$code "bash"',
    '$code "text"',
    "[$html:",
    "[$css:",
    "clip-path: circle(55%);",
    "background: url(\"shape]one.svg\");",
    "$todo [$md: Review this later.]",
    "~[: Runtime fragment.]",
  ]) {
    assert.ok(fixture.includes(snippet), `fixture is missing '${snippet}'`);
  }

  for (const legacy of ["Beanstalk", ".bst", ".bd", '$code("', "$children", "$insert(", "Int ", "Float "]) {
    assert.ok(!fixture.includes(legacy), `fixture still contains obsolete syntax '${legacy}'`);
  }
});

test("negative fixture records deprecated forms separately", () => {
  assert.ok(fs.existsSync(invalidFixturePath));
  const fixture = fs.readFileSync(invalidFixturePath, "utf8");
  for (const snippet of [
    "export:",
    '$slot("title")',
    '$insert("title")',
    "[$children(",
    '$code("moth")',
    "[$doc:",
    "[$todo:",
    "loop item in items",
    "[break]",
    "count Int = 1",
    "ratio Float = 1.5",
    "Dec01",
    "Dec257",
    "@core/math {sin, cos}",
    "#[p:",
  ]) {
    assert.ok(fixture.includes(snippet), `negative fixture is missing '${snippet}'`);
  }
});
