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

const mothFixturePath = path.join(__dirname, "fixtures", "highlighting-samples.moth");
const mtfFixturePath = path.join(__dirname, "fixtures", "highlighting-samples.mtf");
const invalidMothFixturePath = path.join(__dirname, "fixtures", "invalid-syntax.moth");
const invalidMtfFixturePath = path.join(__dirname, "fixtures", "invalid-syntax.mtf");

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

test("Moth file icon theme maps root roles and language fallbacks", () => {
  const packagedFiles = new Set(pkg.files.map(normalizeContributionPath));
  const contribution = pkg.contributes.fileIconThemes.find(
    (entry) => entry.id === "moth-file-icons"
  );
  assert.ok(contribution, "expected the Moth file icon theme contribution");
  assert.equal(contribution.label, "Moth File Icons");

  const themePath = normalizeContributionPath(contribution.path);
  const absoluteThemePath = path.join(rootDir, themePath);
  assert.ok(fs.existsSync(absoluteThemePath), `missing '${themePath}'`);
  assert.ok(packagedFiles.has(themePath), `'${themePath}' is missing from package.json files`);

  const theme = JSON.parse(fs.readFileSync(absoluteThemePath, "utf8"));
  const definitions = theme.iconDefinitions;
  const resolveIcon = (id, label) => {
    const definition = definitions[id];
    assert.ok(definition, `missing icon definition '${id}' for ${label}`);
    const iconPath = normalizeContributionPath(
      path.normalize(path.join(path.dirname(themePath), definition.iconPath))
    );
    assert.ok(fs.existsSync(path.join(rootDir, iconPath)), `missing icon '${iconPath}'`);
    assert.ok(packagedFiles.has(iconPath), `'${iconPath}' is missing from package.json files`);
    return iconPath;
  };

  assert.equal(resolveIcon(theme.fileNames["@entry.moth"], "@entry.moth"), "icons/moth-blue.png");
  assert.equal(resolveIcon(theme.fileNames["@package.moth"], "@package.moth"), "icons/moth-violet.png");
  assert.equal(resolveIcon(theme.fileNames["@mod.moth"], "@mod.moth"), "icons/moth-green.png");
  assert.equal(resolveIcon(theme.fileExtensions.moth, ".moth"), "icons/moth-logo.png");
  assert.equal(resolveIcon(theme.fileExtensions.mtf, ".mtf"), "icons/moth-template-logo.png");
  assert.equal(resolveIcon(theme.languageIds.moth, "moth language"), "icons/moth-logo.png");
  assert.equal(resolveIcon(theme.languageIds.mtf, "mtf language"), "icons/moth-template-logo.png");
  assert.equal(resolveIcon(theme.file, "default file"), "icons/moth-logo.png");
  assert.equal(resolveIcon(theme.folder, "default folder"), "icons/moth-logo.png");
  assert.equal(resolveIcon(theme.folderExpanded, "expanded folder"), "icons/moth-logo.png");
  assert.equal(normalizeContributionPath(pkg.icon), "icons/moth-logo.png");
});

test("Moth source and Moth Template files use different comment behaviour", () => {
  assert.equal(mothConfig.comments.lineComment, "--");
  assert.ok(!Object.hasOwn(mtfConfig, "comments"), ".mtf must not register -- as a line comment");

  assert.deepEqual(mtfConfig.brackets, mothConfig.brackets);
  assert.deepEqual(mtfConfig.autoClosingPairs, mothConfig.autoClosingPairs);
  assert.deepEqual(mtfConfig.surroundingPairs, mothConfig.surroundingPairs);
  for (const [label, config] of [
    ["moth", mothConfig],
    ["mtf", mtfConfig],
  ]) {
    assert.ok(
      !config.brackets.some(([open, close]) => open === ":" && close === ";"),
      `${label} must not pair : with ; outside bracket colourisation`
    );
  }
  assert.ok(
    mothConfig.autoClosingPairs.some((pair) => pair.open === "|" && pair.close === "|"),
    "pipe auto-closing must be preserved"
  );
});

test("the MTF grammar is bound to the mtf language and source.mtf scope", () => {
  const contribution = pkg.contributes.grammars.find((entry) => entry.language === "mtf");
  assert.ok(contribution, "expected a grammar contribution for language ID 'mtf'");
  assert.equal(contribution.scopeName, "source.mtf");
  assert.equal(contribution.path, "./syntaxes/mtf.tmLanguage.json");
  assert.equal(contribution.embeddedLanguages["meta.embedded.block.markdown.moth"], "markdown");
  assert.equal(contribution.embeddedLanguages["meta.embedded.block.code.mothlang.moth"], "moth");
});

test("obsolete comment-directive injection grammar is removed", () => {
  const contribution = pkg.contributes.grammars.find(
    (entry) => entry.scopeName === "source.moth.comment-directives"
  );
  assert.ok(!contribution, "comment-directive injection grammar must not be contributed");
  assert.ok(
    !pkg.files.includes("syntaxes/moth-comment-directives.tmLanguage.json"),
    "comment-directive grammar must not be packaged"
  );
  assert.ok(
    !fs.existsSync(path.join(rootDir, "syntaxes/moth-comment-directives.tmLanguage.json")),
    "comment-directive grammar file must not exist"
  );
});

test("internal repository includes resolve in all shipped grammars", () => {
  for (const grammar of [mtfGrammar, mothGrammar]) {
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
    "entity.name.path.segment.moth",
    "entity.name.module.moth",
    "keyword.other.alias.moth",
    "variable.other.namespace.alias.moth",
    "variable.other.dependency.selection.moth",
    "variable.other.dependency.alias.moth",
    "punctuation.separator.comma.moth",
  ]) {
    assert.ok(scopes.has(required), `missing required scope '${required}'`);
  }
});

test("import is absent from keyword patterns", () => {
  const keywordText = mothGrammar.repository.keywords.patterns
    .map((p) => p.match || "")
    .join(" ");
  assert.doesNotMatch(keywordText, /\bimport\b/);
});

test("no old import or export-block syntax survives in any grammar", () => {
  for (const relPath of [
    "syntaxes/moth.tmLanguage.json",
    "syntaxes/mtf.tmLanguage.json",
  ]) {
    const text = fs.readFileSync(path.join(rootDir, relPath), "utf8");
    for (const forbidden of [
      "keyword.control.import.moth",
      "meta.path.import.moth",
      "entity.name.import.symbol.moth",
      "source.moth.import-groups",
      "export:",
    ]) {
      assert.ok(!text.includes(forbidden), `${relPath} still contains ${forbidden}`);
    }
  }
});

test("removed grammar files do not exist", () => {
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
  assert.deepEqual(mtfGrammar.patterns, [{ include: "#mtf-implicit-body" }]);

  const implicitIncludes = repoIncludes(mtfGrammar, "mtf-implicit-body");
  assert.ok(implicitIncludes.includes("#mtf-markdown-body"));
  assert.ok(!implicitIncludes.includes("source.moth#comments"), "-- is body text in .mtf files");
  assert.ok(!implicitIncludes.includes("source.moth#escapes"), "backslashes are body text in .mtf files");

  const bodyIncludes = repoIncludes(mtfGrammar, "mtf-markdown-body");
  assert.ok(bodyIncludes.includes("source.moth#markdown-fragment"));
  assert.ok(bodyIncludes.includes("#mtf-template-children"));
});

test("directive-free nested MTF templates default to Markdown", () => {
  const pattern = mtfGrammar.repository["mtf-template-default"].patterns[0];
  const beginRe = new RegExp(pattern.begin);

  for (const source of ["[p:", "[p,\n:", "[\n    section,\n    p:"]) {
    assert.ok(beginRe.test(source), `expected Markdown-default template: ${JSON.stringify(source)}`);
  }

  const children = repoIncludes(mtfGrammar, "mtf-template-children");
  const defaultIndex = children.indexOf("#mtf-template-default");
  for (const include of [
    "#mtf-template-markdown",
    "#mtf-template-raw",
    "#mtf-template-html",
    "#mtf-template-escape-html",
    "source.moth#template-note",
    "source.moth#template-slot",
    "source.moth#template-code-moth",
    "source.moth#template-css",
  ]) {
    assert.ok(children.indexOf(include) < defaultIndex, `${include} must precede the MTF default`);
  }
});

test("explicit or structural MTF templates keep their own grammar", () => {
  const classes = [
    ["mtf-template-markdown", "$md"],
    ["mtf-template-raw", "$raw"],
    ["mtf-template-html", "$html"],
    ["mtf-template-escape-html", "$escape_html"],
  ];
  for (const [key, directive] of classes) {
    const beginRe = new RegExp(mtfGrammar.repository[key].patterns[0].begin);
    assert.ok(beginRe.test(`[p, ${directive}:`), `${key} should own ${directive}`);
  }

  const children = repoIncludes(mtfGrammar, "mtf-template-children");
  for (const include of [
    "source.moth#template-note",
    "source.moth#template-slot",
    "source.moth#template-code-moth",
    "source.moth#template-css",
    "#mtf-template-default",
  ]) {
    assert.ok(children.includes(include), `expected '${include}' in the .mtf child stack`);
  }
});

test("nested MTF Markdown bodies recurse without restoring Moth comments or escapes", () => {
  const includes = repoIncludes(mtfGrammar, "mtf-template-body-markdown");
  assert.ok(includes.includes("#mtf-markdown-body"));
  assert.ok(!includes.includes("source.moth#comments"));
  assert.ok(!includes.includes("source.moth#escapes"));

  const rawIncludes = repoIncludes(mtfGrammar, "mtf-template-body-raw");
  assert.ok(rawIncludes.includes("#mtf-template-children"));
  assert.ok(!rawIncludes.includes("source.moth#markdown-fragment"));
});

// ── FIXTURES AND MIGRATION HYGIENE ──────────────────────────────────

test("fixtures contain the cases needed for manual token inspection", () => {
  assert.ok(fs.existsSync(mothFixturePath), "expected the .moth fixture");
  assert.ok(fs.existsSync(mtfFixturePath), "expected the .mtf fixture");
  assert.ok(fs.existsSync(invalidMothFixturePath), "expected the negative .moth fixture");
  assert.ok(fs.existsSync(invalidMtfFixturePath), "expected the negative .mtf fixture");

  const mothFixture = fs.readFileSync(mothFixturePath, "utf8");
  const mtfFixture = fs.readFileSync(mtfFixturePath, "utf8");

  for (const snippet of [
    '@styles/docs navbar, title, section',
    '@core/math as math',
    '@drawing.js draw,',
    '$export',
    'import = 1',
    'logo #= @assets/logo.svg',
    'font #= @fonts/"Computer Modern.woff2"',
    'page = [@pages/home.mtf]',
    'root = @/',
    '[codeblock, $code "moth":',
    "clip-path: circle(55%);",
  ]) {
    assert.ok(mothFixture.includes(snippet), `expected .moth fixture to include '${snippet}'`);
  }

  for (const snippet of [
    "# Moth Template title",
    "-- this is Markdown body text, not a Moth comment.",
    "[p:",
    "$raw:",
    "$escape_html:",
    "[$note:",
    '[codeblock, $code "moth":',
    '["[literal]"]',
    "@https://example.com (link)",
  ]) {
    assert.ok(mtfFixture.includes(snippet), `expected .mtf fixture to include '${snippet}'`);
  }
});

test("negative fixtures clearly label deprecated forms", () => {
  const moth = fs.readFileSync(invalidMothFixturePath, "utf8");
  const mtf = fs.readFileSync(invalidMtfFixturePath, "utf8");
  assert.match(moth, /Deprecated and invalid forms/);
  for (const snippet of ["export:", '$code("moth")', "[$doc:", "[$todo:", "count Int", "#[p:"]) {
    assert.ok(moth.includes(snippet), `negative .moth fixture is missing '${snippet}'`);
  }
  for (const snippet of ["[$doc:", "[$todo:", '$code("moth")', "[break]"]) {
    assert.ok(mtf.includes(snippet), `negative .mtf fixture is missing '${snippet}'`);
  }
});

test("migration support files contain no Beanstalk, BST, BD, or source.bd identifiers", () => {
  const paths = [
    "package.json",
    "syntaxes/moth.tmLanguage.json",
    "syntaxes/mtf.tmLanguage.json",
    "tests/fixtures/highlighting-samples.moth",
    "tests/fixtures/highlighting-samples.mtf",
    "tests/fixtures/invalid-syntax.moth",
    "tests/fixtures/invalid-syntax.mtf",
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
