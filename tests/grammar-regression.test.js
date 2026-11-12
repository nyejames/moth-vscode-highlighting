const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const grammarPath = path.join(rootDir, "syntaxes", "moth.tmLanguage.json");
const packagePath = path.join(rootDir, "package.json");
const fixturePath = path.join(__dirname, "fixtures", "highlighting-samples.moth");

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

function findPatternsByName(name) {
  const results = [];
  walkObjects(grammar, (node) => {
    if (typeof node.name !== "string") return;
    if (node.name === name || node.name.split(/\s+/).includes(name)) results.push(node);
  });
  return results;
}

function findPatterns(repositoryKey, predicate) {
  const entry = grammar.repository[repositoryKey];
  assert.ok(entry, `expected repository '${repositoryKey}'`);

  const results = [];
  walkObjects(entry, (node) => {
    if (predicate(node)) results.push(node);
  });
  return results;
}

function includesUnder(value) {
  const includes = [];
  walkObjects(value, (node) => {
    if (typeof node.include === "string") includes.push(node.include);
  });
  return includes;
}

function repoIncludes(repositoryKey) {
  const entry = grammar.repository[repositoryKey];
  assert.ok(entry, `expected repository '${repositoryKey}'`);
  return includesUnder(entry);
}

function repoExists(repositoryKey) {
  return Object.hasOwn(grammar.repository, repositoryKey);
}

function regexp(pattern) {
  return new RegExp(pattern);
}

function rootIncludes() {
  return grammar.patterns.map((pattern) => pattern.include).filter(Boolean);
}

// ── GRAMMAR INTEGRITY ────────────────────────────────────────────────

test("main grammar uses the Moth source scope", () => {
  assert.equal(grammar.name, "Moth");
  assert.equal(grammar.scopeName, "source.moth");
});

test("all internal repository includes resolve", () => {
  const missing = [];

  walkObjects(grammar, (node) => {
    if (typeof node.include !== "string" || !node.include.startsWith("#")) return;
    const repositoryKey = node.include.slice(1);
    if (!repoExists(repositoryKey)) missing.push(node.include);
  });

  assert.deepEqual(missing, []);
});

test("root template patterns run before general source tokens", () => {
  const includes = rootIncludes();
  const templateKeys = [
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
    "#template-generic",
  ];

  for (const key of templateKeys) assert.ok(includes.includes(key), `expected root include '${key}'`);

  const genericTemplateIndex = includes.indexOf("#template-generic");
  for (const sourceKey of ["#strings", "#numbers", "#keywords", "#identifiers"]) {
    assert.ok(
      genericTemplateIndex < includes.indexOf(sourceKey),
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
  assert.match(builtinPattern.match, /\bassert\b/);

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
  for (const ordinary of ["export", "block", "import"]) {
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
  const isPrimitive = (name) => regexp(`^(?:${primitive.match})$`).test(name);
  for (const name of ["I8", "I16", "I32", "I64", "U8", "U16", "U32", "U64",
    "F16", "F32", "F64", "Bool", "String", "Char", "Byte",
    "None", "True", "False", "Dec", "Dec0", "Dec4", "Dec99", "Dec100", "Dec256"]) {
    assert.ok(isPrimitive(name), `missing primitive '${name}'`);
  }
  for (const old of ["Int", "Float", "Fn", "IO", "Dec01", "Dec257", "I128"]) {
    assert.ok(!isPrimitive(old), `unexpected primitive '${old}'`);
  }
  assert.match(boolean.match, /\\btrue\\b/);
  assert.match(boolean.match, /\\bfalse\\b/);
  assert.doesNotMatch(boolean.match, /\\bTrue\\b/);
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
});

// ── OPERATORS, PUNCTUATION, AND NUMBERS ──────────────────────────────

test("active symbol operators retain current Moth spellings", () => {
  const symbolPattern = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.symbol.moth"
  );
  assert.ok(symbolPattern);
  const re = regexp(`^(?:${symbolPattern.match})$`);
  for (const operator of ["+", "-", "=>", "->", "::", "//", "<=", ">=", "$"]) {
    assert.ok(re.test(operator), `expected operator '${operator}'`);
  }
  assert.ok(!re.test(".."), "range syntax uses to/by, not '..'");
  assert.ok(!re.test("|"), "pipe is parameter punctuation rather than a symbolic operator");
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

test("implemented source directives use a dedicated scope", () => {
  assert.ok(rootIncludes().includes("#source-directives"));
  assert.ok(repoIncludes("code-moth-fragment").includes("#source-directives"));
  const rule = grammar.repository["source-directives"].patterns[0];
  assert.equal(rule.name, "keyword.control.directive.source.moth");
  const re = regexp(`^(?:${rule.match})$`);
  for (const directive of ["$export", "$config", "$doc", "$todo"]) {
    assert.ok(re.test(directive), `missing source directive ${directive}`);
  }
  for (const directive of ["$note", "$slot", "$children", "$exported"]) {
    assert.ok(!re.test(directive), `unexpected source directive ${directive}`);
  }
});

test("assignment/declaration operator forms remain highlighted", () => {
  const assignmentPattern = grammar.repository.operators.patterns.find(
    (pattern) => pattern.name === "keyword.operator.assignment.compound.moth"
  );
  assert.ok(assignmentPattern);

  const re = regexp(`^(?:${assignmentPattern.match})$`);
  for (const operator of ["+=", "-=", "*=", "//=", "/=", "%=", "^=", "#=", "~="]) {
    assert.ok(re.test(operator), `expected operator form '${operator}'`);
  }
});

test("punctuation covers pipe brackets and dot access", () => {
  const pipe = grammar.repository.punctuation.patterns.find(
    (pattern) => pattern.name === "punctuation.brackets.pipe.moth"
  );
  const dot = grammar.repository.punctuation.patterns.find(
    (pattern) => pattern.name === "punctuation.accessor.dot.moth"
  );

  assert.ok(pipe);
  assert.ok(dot);
  assert.ok(regexp(`^(?:${pipe.match})$`).test("|"));
  assert.ok(regexp(`^(?:${dot.match})$`).test("."));
});

test("numeric literals cover signed values, decimals, and lowercase exponents", () => {
  const numeric = grammar.repository.numbers.patterns.find(
    (pattern) => pattern.name === "constant.numeric.moth"
  );
  assert.ok(numeric);

  const re = regexp(numeric.match);
  for (const value of ["1", "1.5", "1e6", "1.0e-6", "-2147483648"]) {
    assert.ok(re.test(value), `expected numeric literal '${value}'`);
  }
  assert.ok(!re.test("1E6"), "uppercase exponent syntax is not Moth numeric syntax");
});

// ── TEMPLATE DIRECTIVES AND EMBEDDED LANGUAGES ──────────────────────

test("template-head directives include the current formatter and slot names", () => {
  const patterns = findPatterns(
    "template-head-directives",
    (node) => typeof node.match === "string"
  );
  const matchText = patterns.map((pattern) => pattern.match).join(" ");

  for (const directive of [
    "slot",
    "insert",
    "children",
    "fresh",
    "md",
    "raw",
    "note",
    "todo",
    "doc",
    "html",
    "css",
    "escape_html",
    "code",
  ]) {
    assert.match(matchText, new RegExp(`\\b${directive}\\b`), `missing $${directive}`);
  }
  assert.doesNotMatch(matchText, /\bmarkdown\b/, "$markdown has been replaced by $md");
});

test("Rust formatter recognises rs and rust", () => {
  const pattern = grammar.repository["template-code-rs"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.rs\.moth/);
  assert.ok(beginRe.test('[$code("rs"):'));
  assert.ok(beginRe.test('[$code("rust"):'));
  assert.ok(!beginRe.test('[$code("py"):'));
});

test("shell formatter recognises sh, shell, and bash", () => {
  const pattern = grammar.repository["template-code-shell"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.shell\.moth/);
  for (const name of ["sh", "shell", "bash"]) {
    assert.ok(beginRe.test(`[$code("${name}"):`));
  }
  assert.ok(!beginRe.test('[$code("py"):'));
});

test("Moth formatter recognises the moth code-language label", () => {
  const pattern = grammar.repository["template-code-moth"].patterns[0];
  const beginRe = regexp(pattern.begin);

  assert.match(pattern.name, /meta\.template\.code\.mothlang\.moth/);
  assert.ok(beginRe.test('[$code("moth"):'));
  assert.doesNotMatch(pattern.begin, /bst/, "legacy bst code labels must be gone");
});

test("Rust and shell embedded bodies delegate to their source grammars", () => {
  for (const [repositoryKey, expectedScope] of [
    ["embedded-code-rs", "source.rust"],
    ["embedded-code-shell", "source.shell"],
  ]) {
    const contentPatterns = findPatterns(
      repositoryKey,
      (node) => typeof node.contentName === "string" && node.contentName.includes(expectedScope)
    );
    assert.ok(contentPatterns.length > 0, `${repositoryKey} should expose ${expectedScope}`);
    assert.ok(
      contentPatterns.some((pattern) => includesUnder(pattern).includes(expectedScope)),
      `${repositoryKey} should include ${expectedScope}`
    );
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
});

// ── BOUNDED CSS REGRESSIONS ─────────────────────────────────────────

test("CSS formatter bodies use the bounded embedded CSS fragment", () => {
  const bodyIncludes = repoIncludes("template-body-css");
  assert.ok(bodyIncludes.includes("#embedded-css"));

  const contentPatterns = findPatterns(
    "embedded-css",
    (node) => typeof node.contentName === "string" && node.contentName.includes("source.css")
  );
  assert.ok(contentPatterns.length > 0);

  for (const pattern of contentPatterns) {
    const includes = includesUnder(pattern);
    assert.ok(includes.includes("#css-fragment"));
    assert.ok(!includes.includes("source.css"), "external CSS state can leak past the template close");
  }
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

test("new code-language patterns remain wired into every shared template body", () => {
  for (const repositoryKey of [
    "template-body-code-js",
    "template-body-code-ts",
    "template-body-code-py",
    "template-body-code-moth",
    "template-body-code-generic",
    "template-body-generic",
    "template-body-html",
    "template-body-markdown",
  ]) {
    const includes = repoIncludes(repositoryKey);
    assert.ok(includes.includes("#template-code-rs"), `${repositoryKey} is missing Rust`);
    assert.ok(includes.includes("#template-code-shell"), `${repositoryKey} is missing shell`);
  }
});

test("root code formatter order keeps specific languages before generic code", () => {
  const includes = rootIncludes();
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
    "path-literals",
    "invalid-at-sign",
    "template-code-js",
    "template-code-ts",
    "template-code-py",
    "template-code-rs",
    "template-code-shell",
    "template-code-moth",
    "template-code-generic",
    "template-css",
    "template-html",
    "template-markdown",
    "template-generic",
    "template-head",
    "template-head-directives",
    "template-body-code-js",
    "template-body-code-ts",
    "template-body-code-py",
    "template-body-code-rs",
    "template-body-code-shell",
    "template-body-code-moth",
    "template-body-code-generic",
    "template-body-css",
    "template-body-html",
    "template-body-markdown",
    "template-body-generic",
    "embedded-code-js",
    "embedded-code-ts",
    "embedded-code-py",
    "embedded-code-rs",
    "embedded-code-shell",
    "embedded-code-moth",
    "embedded-code-generic",
    "embedded-markdown",
    "embedded-css",
    "css-fragment",
    "embedded-html",
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
    "template-slot-marker",
    "template-slot-directive",
    "template-children-directive",
    "template-doc-directive",
    "template-note-todo-directive",
    "template-doc-nested-brackets",
    "template-note-todo-nested-brackets",
    "markdown-fragment",
    "code-moth-fragment",
    "code-generic-fragment",
    "embedded-html-fragment",
    "embedded-html-string-double",
    "embedded-html-string-single",
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
    "variable.language.this.moth",
    "support.type.primitive.moth",
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

test("Markdown list markers have dedicated punctuation captures", () => {
  const bullet = grammar.repository["markdown-fragment"].patterns.find(
    (pattern) => pattern.name === "markup.list.unnumbered.markdown"
  );
  assert.ok(bullet);

  const re = regexp(bullet.match);
  for (const source of ["- item", "  * item", "+ item"]) {
    assert.ok(re.test(source), `expected Markdown bullet '${source}'`);
  }
  assert.ok(!re.test("-item"));
  assert.equal(bullet.captures["1"].name, "punctuation.definition.list.begin.markdown");
});

test("Moth Markdown links accept supported path forms and reject bare domains", () => {
  const link = grammar.repository["markdown-fragment"].patterns.find(
    (pattern) => pattern.name === "meta.link.inline.markdown.moth"
  );
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
  ]) {
    assert.ok(re.test(source), `expected supported link '${source}'`);
  }

  for (const source of [
    "@example.com (Example)",
    "@https://example.com(Example)",
    "@https://example.com\n(Example)",
  ]) {
    assert.ok(!re.test(source), `expected unsupported link '${source}'`);
  }
});

// ── FIXTURE ─────────────────────────────────────────────────────────

test("Moth fixture contains current syntax and migration regression cases", () => {
  assert.ok(fs.existsSync(fixturePath));
  const fixture = fs.readFileSync(fixturePath, "utf8");

  for (const snippet of [
    "-- Single-line comment",
    "@styles/docs navbar, title, section",
    "@html center",
    "@core/math as math",
    "@docs/pages/home render as render_home",
    "@docs/pages/about content as about_content",
    "@drawing.js draw,",
    "@drawing.js as drawing",
    "import = 1",
    'page_title #= "Templates"',
    'page_description #String = "Template syntax in Moth."',
    "logo #= @assets/logo.svg",
    'font #= @fonts/"Computer Modern.woff2"',
    "page = [@pages/home.mtf]",
    "root = @/",
    "@html/tables data, -- clause continues",
    "@html/tables data,",
    "row = build_row()",
    "@core/math {sin, cos}",
    "count ~= 0",
    "ratio Float = 1.5",
    'text_slice = "text"',
    "letter = 'A'",
    "values ~{Int} = {}",
    'names {String} = {"Priya", "Gollum"}',
    "Person = |",
    "Status ::",
    "increment |value Int| -> Int:",
    "return value + 1",
    "name, count = pair()",
    "display |this Person| -> String:",
    "return this.name",
    "if value is true:",
    'io.line("then")',
    "if value is:",
    "loop items |item, index|:",
    "loop 0 to 10 by 2 |i|:",
    "loop 0 to & 10 |i|:",
    "assert(index < items.length())",
    'assert(index < items.length(), "out of bounds")',
    "maybe_name String? = none",
    "if maybe_name is |name| then name else",
    "parse_number(text)!",
    "parse_number(text) catch:",
    "then 0",
    "count_text String = cast count",
    "value = identity(42)",
    "[$md:",
    "- This is a Markdown bullet.",
    "[$slot]",
    '[$slot("style")]',
    '[$insert("style"): color: blue;]',
    "[$children([: Prefix]):",
    "[if show:",
    "[list, if show:",
    '$code("moth")',
    '$code("js")',
    '$code("ts")',
    '$code("py")',
    '$code("rs")',
    '$code("rust")',
    '$code("sh")',
    '$code("shell")',
    '$code("bash")',
    "[$css:",
    "[$html:",
    "clip-path: circle(55%);",
    "after_css_marker = \"not css\"",
    "`.mtf` file",
  ]) {
    assert.ok(fixture.includes(snippet), `fixture is missing '${snippet}'`);
  }

  for (const legacy of ["Beanstalk", ".bst", ".bd", '$code("bst")']) {
    assert.ok(!fixture.includes(legacy), `fixture still contains legacy text '${legacy}'`);
  }
});
