const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

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

function repoIncludes(grammar, repositoryKey) {
  const repositoryEntry = grammar.repository[repositoryKey];
  assert.ok(repositoryEntry, `expected repository '${repositoryKey}'`);
  return includesUnder(repositoryEntry);
}

function normalizeContributionPath(contributionPath) {
  return contributionPath.replace(/^\.\//, "");
}

const pkg = readJson("package.json");
const mothConfig = readJson("language-configuration.json");
const mtfConfig = readJson("mtf-language-configuration.json");
const mothGrammar = readJson("syntaxes/moth.tmLanguage.json");
const mtfGrammar = readJson("syntaxes/mtf.tmLanguage.json");
const commentGrammar = readJson("syntaxes/moth-comment-directives.tmLanguage.json");

const mothFixturePath = path.join(__dirname, "fixtures", "highlighting-samples.moth");
const mtfFixturePath = path.join(__dirname, "fixtures", "highlighting-samples.mtf");

// ── MANIFEST INTEGRITY ───────────────────────────────────────────────

test("package registers distinct Moth and Moth Template language IDs", () => {
  const languages = new Map(pkg.contributes.languages.map((entry) => [entry.id, entry]));

  const moth = languages.get("moth");
  assert.ok(moth, "expected a moth language contribution");
  assert.deepEqual(moth.extensions, [".moth"]);
  assert.equal(moth.configuration, "./language-configuration.json");

  const mtf = languages.get("mtf");
  assert.ok(mtf, "expected an mtf language contribution");
  assert.deepEqual(mtf.extensions, [".mtf"]);
  assert.equal(mtf.configuration, "./mtf-language-configuration.json");
});

test("every language-bound grammar refers to a declared language ID", () => {
  const languageIds = new Set(pkg.contributes.languages.map((entry) => entry.id));

  for (const grammar of pkg.contributes.grammars) {
    if (!grammar.language) continue;
    assert.ok(
      languageIds.has(grammar.language),
      `grammar '${grammar.scopeName}' refers to undeclared language ID '${grammar.language}'`
    );
  }
});

test("contributed grammar files exist, declare the registered scope, and are packaged", () => {
  const packagedFiles = new Set(pkg.files.map(normalizeContributionPath));

  for (const contribution of pkg.contributes.grammars) {
    const relativePath = normalizeContributionPath(contribution.path);
    const absolutePath = path.join(rootDir, relativePath);

    assert.ok(fs.existsSync(absolutePath), `missing contributed grammar '${relativePath}'`);
    assert.ok(packagedFiles.has(relativePath), `'${relativePath}' is missing from package.json files`);

    const grammar = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    assert.equal(
      grammar.scopeName,
      contribution.scopeName,
      `scope mismatch for '${relativePath}'`
    );
  }
});

test("language configuration files exist and are included in the VSIX", () => {
  const packagedFiles = new Set(pkg.files.map(normalizeContributionPath));

  for (const language of pkg.contributes.languages) {
    const relativePath = normalizeContributionPath(language.configuration);
    assert.ok(fs.existsSync(path.join(rootDir, relativePath)), `missing '${relativePath}'`);
    assert.ok(packagedFiles.has(relativePath), `'${relativePath}' is missing from package.json files`);
  }
});

test("Moth source and Moth Template files use different comment behaviour", () => {
  assert.equal(mothConfig.comments.lineComment, "--");
  assert.ok(!Object.hasOwn(mtfConfig, "comments"), ".mtf must not register -- as a line comment");

  assert.deepEqual(mtfConfig.brackets, mothConfig.brackets);
  assert.deepEqual(mtfConfig.autoClosingPairs, mothConfig.autoClosingPairs);
  assert.deepEqual(mtfConfig.surroundingPairs, mothConfig.surroundingPairs);
});

test("the MTF grammar is bound to the mtf language and source.mtf scope", () => {
  const contribution = pkg.contributes.grammars.find((entry) => entry.language === "mtf");
  assert.ok(contribution, "expected a grammar contribution for language ID 'mtf'");
  assert.equal(contribution.scopeName, "source.mtf");
  assert.equal(contribution.path, "./syntaxes/mtf.tmLanguage.json");
  assert.equal(contribution.embeddedLanguages["meta.embedded.block.markdown.moth"], "markdown");
  assert.equal(contribution.embeddedLanguages["meta.embedded.block.code.mothlang.moth"], "moth");
});

test("internal repository includes resolve in all migration support grammars", () => {
  for (const grammar of [mtfGrammar, mothGrammar, commentGrammar]) {
    const missing = [];
    walkObjects(grammar, (node) => {
      if (typeof node.include !== "string" || !node.include.startsWith("#")) return;
      const key = node.include.slice(1);
      if (!Object.hasOwn(grammar.repository, key)) missing.push(node.include);
    });

    assert.deepEqual(missing, [], `${grammar.scopeName} contains unresolved internal includes`);
  }
});

// ── DEPENDENCY CLAUSES ───────────────────────────────────────────────

test("dependency clauses are integrated into the main Moth grammar", () => {
  const mothGrammar = readJson("syntaxes/moth.tmLanguage.json");
  assert.ok(
    Object.hasOwn(mothGrammar.repository, "dependency-clauses"),
    "expected dependency-clauses repository entry in main grammar"
  );
  const rootIncludes = mothGrammar.patterns.map((p) => p.include).filter(Boolean);
  const depIdx = rootIncludes.indexOf("#dependency-clauses");
  const pathIdx = rootIncludes.indexOf("#path-literals");
  assert.ok(depIdx >= 0, "expected #dependency-clauses in root patterns");
  assert.ok(pathIdx >= 0, "expected #path-literals in root patterns");
  assert.ok(depIdx < pathIdx, "dependency-clauses must precede path-literals in root");

  const codeMothIncludes = mothGrammar.repository["code-moth-fragment"].patterns
    .map((p) => p.include)
    .filter(Boolean);
  const depIdx2 = codeMothIncludes.indexOf("#dependency-clauses");
  const pathIdx2 = codeMothIncludes.indexOf("#path-literals");
  assert.ok(depIdx2 >= 0, "expected #dependency-clauses in code-moth-fragment");
  assert.ok(pathIdx2 >= 0, "expected #path-literals in code-moth-fragment");
  assert.ok(depIdx2 < pathIdx2, "dependency-clauses must precede path-literals in embedded Moth");
});

test("no separate dependency injection grammar is packaged", () => {
  const contribution = pkg.contributes.grammars.find(
    (entry) => entry.scopeName === "source.moth.dependency-clauses"
  );
  assert.ok(!contribution, "no separate dependency injection grammar should exist");
  assert.ok(
    !pkg.files.includes("syntaxes/moth-dependency-clauses.tmLanguage.json"),
    "dependency injection grammar file must not be in files list"
  );
});

test("dependency clause scope contract uses required scope families", () => {
  const mothGrammar = readJson("syntaxes/moth.tmLanguage.json");
  const scopes = new Set();
  function walk(v) {
    if (!v || typeof v !== "object") return;
    if (typeof v.name === "string") for (const s of v.name.split(" ")) scopes.add(s);
    if (typeof v.contentName === "string") for (const s of v.contentName.split(" ")) scopes.add(s);
    if (v.beginCaptures) for (const c of Object.values(v.beginCaptures)) {
      if (c && typeof c.name === "string") for (const s of c.name.split(" ")) scopes.add(s);
    }
    if (v.endCaptures) for (const c of Object.values(v.endCaptures)) {
      if (c && typeof c.name === "string") for (const s of c.name.split(" ")) scopes.add(s);
    }
    if (v.captures) for (const c of Object.values(v.captures)) {
      if (c && typeof c.name === "string") for (const s of c.name.split(" ")) scopes.add(s);
    }
    for (const val of Object.values(v)) walk(val);
  }
  walk(mothGrammar.repository["dependency-clauses"]);
  walk(mothGrammar.repository["dependency-continuation"]);
  walk(mothGrammar.repository["dependency-selection-alias"]);
  walk(mothGrammar.repository["dependency-selection"]);

  for (const required of [
    "meta.dependency-clause.moth",
    "punctuation.definition.path.begin.moth",
    "entity.name.namespace.moth",
    "keyword.other.alias.moth",
    "entity.name.namespace.alias.moth",
    "variable.other.dependency.selection.moth",
    "variable.other.dependency.alias.moth",
    "punctuation.separator.comma.moth",
  ]) {
    assert.ok(scopes.has(required), `missing required scope '${required}'`);
  }
});

test("import is absent from keyword patterns", () => {
  const mothGrammar = readJson("syntaxes/moth.tmLanguage.json");
  const keywordText = mothGrammar.repository.keywords.patterns
    .map((p) => p.match || "")
    .join(" ");
  assert.doesNotMatch(keywordText, /\bimport\b/);
});

test("no old import scope survives in any grammar", () => {
  for (const relPath of [
    "syntaxes/moth.tmLanguage.json",
    "syntaxes/mtf.tmLanguage.json",
    "syntaxes/moth-comment-directives.tmLanguage.json",
  ]) {
    const text = fs.readFileSync(path.join(rootDir, relPath), "utf8");
    assert.ok(
      !text.includes("keyword.control.import.moth"),
      `${relPath} still contains keyword.control.import.moth`
    );
    assert.ok(
      !text.includes("meta.path.import.moth"),
      `${relPath} still contains meta.path.import.moth`
    );
    assert.ok(
      !text.includes("entity.name.import.symbol.moth"),
      `${relPath} still contains entity.name.import.symbol.moth`
    );
    assert.ok(
      !text.includes("source.moth.import-groups"),
      `${relPath} still contains source.moth.import-groups`
    );
  }
});

test("removed import-group grammar file does not exist", () => {
  assert.ok(
    !fs.existsSync(path.join(rootDir, "syntaxes/moth-import-groups.tmLanguage.json")),
    "old import-group grammar file must not exist"
  );
  assert.ok(
    !fs.existsSync(path.join(rootDir, "syntaxes/moth-dependency-clauses.tmLanguage.json")),
    "separate dependency injection grammar file must not exist"
  );
});

// ── MOTH TEMPLATE FILES ──────────────────────────────────────────────

test("Moth Template files start directly in the implicit Markdown body", () => {
  assert.equal(mtfGrammar.scopeName, "source.mtf");
  assert.deepEqual(mtfGrammar.patterns, [{ include: "#mtf-markdown-body" }]);

  const includes = repoIncludes(mtfGrammar, "mtf-markdown-body");
  for (const required of [
    "#mtf-template-markdown",
    "#mtf-template-explicit-generic",
    "source.moth#template-code-moth",
    "source.moth#template-css",
    "source.moth#template-html",
    "source.moth#template-markdown",
    "source.moth#template-generic",
    "source.moth#embedded-markdown",
  ]) {
    assert.ok(includes.includes(required), `expected '${required}' in the .mtf body stack`);
  }

  assert.ok(!includes.includes("source.moth#template-body-markdown"), ".mtf has no ':' opener");
  assert.ok(!includes.includes("source.moth#comments"), "-- is body text in .mtf files");
  assert.ok(!includes.includes("source.moth#escapes"), "backslashes are body text in .mtf files");
});

test("directive-free nested MTF templates default to Markdown", () => {
  const pattern = mtfGrammar.repository["mtf-template-markdown"].patterns[0];
  const beginRe = new RegExp(pattern.begin);

  for (const source of ["[p:", "[p,\n:", "[$md:", "[p,\n$md:"]) {
    assert.ok(beginRe.test(source), `expected Markdown-default template: ${JSON.stringify(source)}`);
  }

  for (const directive of [
    "$raw",
    "$fresh",
    "$html",
    '$code("moth")',
    "$css",
    "$escape_html",
    "$children",
    "$doc",
    "$note",
    "$todo",
  ]) {
    assert.ok(
      !beginRe.test(`[p, ${directive}:`),
      `${directive} must not be classified as the implicit Markdown default`
    );
  }
});

test("explicit non-Markdown formatter heads use the generic MTF body stack", () => {
  const pattern = mtfGrammar.repository["mtf-template-explicit-generic"].patterns[0];
  const beginRe = new RegExp(pattern.begin);

  for (const source of [
    "[p, $raw:",
    "[p,\n$raw:",
    "[p, $fresh:",
    "[p, $escape_html:",
    "[p, $children:",
  ]) {
    assert.ok(beginRe.test(source), `expected explicit generic MTF body: ${JSON.stringify(source)}`);
  }

  for (const source of [
    "[p, $md:",
    '[p, $code("moth"):',
    "[p, $css:",
    "[p, $html:",
    "[p, $doc:",
    "[p, $note:",
    "[p, $todo:",
  ]) {
    assert.ok(!beginRe.test(source), `special directive must keep its own grammar: ${source}`);
  }
});

test("nested MTF Markdown bodies recurse without restoring Moth comments or escapes", () => {
  const includes = repoIncludes(mtfGrammar, "mtf-template-body-markdown");
  assert.ok(includes.includes("#mtf-template-markdown"));
  assert.ok(includes.includes("#mtf-template-explicit-generic"));
  assert.ok(includes.includes("source.moth#embedded-markdown"));
  assert.ok(!includes.includes("source.moth#comments"));
  assert.ok(!includes.includes("source.moth#escapes"));

  const genericIncludes = repoIncludes(mtfGrammar, "mtf-template-body-generic");
  assert.ok(genericIncludes.includes("#mtf-template-markdown"));
  assert.ok(genericIncludes.includes("#mtf-template-explicit-generic"));
  assert.ok(!genericIncludes.includes("source.moth#embedded-markdown"));
});

// ── COMMENT DIRECTIVES ───────────────────────────────────────────────

test("package injects comment directives into source.moth and source.mtf", () => {
  const contribution = pkg.contributes.grammars.find(
    (entry) => entry.scopeName === "source.moth.comment-directives"
  );

  assert.ok(contribution, "expected the comment-directive injection grammar");
  assert.deepEqual(new Set(contribution.injectTo), new Set(["source.moth", "source.mtf"]));
  assert.equal(contribution.path, "./syntaxes/moth-comment-directives.tmLanguage.json");
  assert.match(commentGrammar.injectionSelector, /source\.moth/);
  assert.match(commentGrammar.injectionSelector, /source\.mtf/);
});

test("todo, note, and doc directives accept single-line and multiline heads", () => {
  for (const [repositoryKey, directive] of [
    ["template-todo-comment", "todo"],
    ["template-note-comment", "note"],
    ["template-doc-comment", "doc"],
  ]) {
    const pattern = commentGrammar.repository[repositoryKey].patterns[0];
    const beginRe = new RegExp(pattern.begin);

    assert.ok(beginRe.test(`[$${directive}:`));
    assert.ok(beginRe.test(`[\n    section,\n    $${directive}:`));
    assert.ok(!beginRe.test(`[p, $${directive}_later:`));
  }
});

test("todo and note keep distinct template scopes with comment-like bodies", () => {
  const todoPattern = commentGrammar.repository["template-todo-comment"].patterns[0];
  const notePattern = commentGrammar.repository["template-note-comment"].patterns[0];
  const bodyPattern = commentGrammar.repository["template-comment-body"].patterns[0];

  assert.match(todoPattern.name, /meta\.template\.comment\.todo\.moth/);
  assert.match(notePattern.name, /meta\.template\.comment\.note\.moth/);
  assert.notEqual(todoPattern.name, notePattern.name);
  assert.match(bodyPattern.contentName, /comment\.line\.double-dash\.moth/);
  assert.match(bodyPattern.contentName, /comment\.block\.template\.comment\.moth/);
});

test("doc uses the Markdown-template body stack", () => {
  const docPattern = commentGrammar.repository["template-doc-comment"].patterns[0];
  assert.match(docPattern.name, /meta\.template\.markdown\.moth/);

  const includes = repoIncludes(commentGrammar, "template-doc-body");
  for (const required of [
    "source.moth#embedded-markdown",
    "source.moth#template-generic",
    "source.moth#template-code-moth",
  ]) {
    assert.ok(includes.includes(required), `expected '${required}' in $doc body`);
  }
  assert.ok(!includes.includes("source.moth#escapes"));
});

// ── FIXTURES AND MIGRATION HYGIENE ──────────────────────────────────

test("fixtures contain the cases needed for manual token inspection", () => {
  assert.ok(fs.existsSync(mothFixturePath), "expected the .moth fixture");
  assert.ok(fs.existsSync(mtfFixturePath), "expected the .mtf fixture");

  const mothFixture = fs.readFileSync(mothFixturePath, "utf8");
  const mtfFixture = fs.readFileSync(mtfFixturePath, "utf8");

  for (const snippet of [
    '@styles/docs navbar, title, section',
    '@core/math as math',
    '@drawing.js draw,',
    '@drawing.js as drawing',
    'import = 1',
    '@html/tables data, -- clause continues',
    'row = build_row()',
    '@core/math {sin, cos}',
    'logo #= @assets/logo.svg',
    'font #= @fonts/"Computer Modern.woff2"',
    'page = [@pages/home.mtf]',
    'root = @/',
    '$code("moth")',
    "items.length()",
    "io.line(\"then\")",
    "clip-path: circle(55%);",
    "Write markdown and nested Moth templates directly in the `.mtf` file",
  ]) {
    assert.ok(mothFixture.includes(snippet), `expected .moth fixture to include '${snippet}'`);
  }

  for (const snippet of [
    "# Moth Template title",
    "-- this is Markdown body text, not a Moth comment.",
    "[p:",
    "$raw:",
    "$escape_html:",
    "$doc:",
    "$todo:",
    "$note:",
    '$code("moth")',
    '["[literal]"]',
    "@docs/pages/home render as render_home",
    "@docs/pages/about content as about_content",
  ]) {
    assert.ok(mtfFixture.includes(snippet), `expected .mtf fixture to include '${snippet}'`);
  }
});

test("migration support files contain no Beanstalk, BST, BD, or source.bd identifiers", () => {
  const paths = [
    "package.json",
    "syntaxes/moth.tmLanguage.json",
    "syntaxes/mtf.tmLanguage.json",
    "syntaxes/moth-comment-directives.tmLanguage.json",
    "tests/fixtures/highlighting-samples.moth",
    "tests/fixtures/highlighting-samples.mtf",
  ];

  const forbidden = [
    /Beanstalk/i,
    /Beandown/i,
    /source\.bst\b/,
    /source\.bd\b/,
    /\.bst\b/,
    /\.bd\b/,
    /\$code\(["']bst["']\)/,
  ];

  for (const relativePath of paths) {
    const text = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${relativePath} still contains legacy text matching ${pattern}`);
    }
  }
});

test("main and MTF grammar scopes remain distinct", () => {
  assert.equal(mothGrammar.scopeName, "source.moth");
  assert.equal(mtfGrammar.scopeName, "source.mtf");
  assert.notEqual(mothGrammar.scopeName, mtfGrammar.scopeName);
});
