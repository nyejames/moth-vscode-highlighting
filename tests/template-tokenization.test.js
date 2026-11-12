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
  if (scopeName === "source.mtf") {
    await registry.loadGrammar("source.moth");
  }
  return registry.loadGrammar(scopeName);
}

function tokenizeLines(grammar, lines) {
  let ruleStack = textmate.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    return {
      line,
      tokens: result.tokens.map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      })),
    };
  });
}

function tokensAt(entry, text) {
  return entry.tokens.filter((token) => token.text.trim() === text);
}

function hasScope(entry, text, scope) {
  return tokensAt(entry, text).some((token) => token.scopes.includes(scope));
}

function checkScope(entry, text, scope) {
  assert.ok(
    hasScope(entry, text, scope),
    `Expected ${JSON.stringify(text)} on line ${JSON.stringify(entry.line)} to have ${scope}; got ${JSON.stringify(entry.tokens)}`
  );
}

function checkNoScope(entry, text, scope) {
  const matches = tokensAt(entry, text);
  assert.ok(matches.length > 0, `Expected token ${JSON.stringify(text)} on ${JSON.stringify(entry.line)}`);
  for (const token of matches) {
    assert.ok(!token.scopes.includes(scope), `${JSON.stringify(text)} must not have ${scope}`);
  }
}

function checkClean(entry, text) {
  checkScope(entry, text, "variable.other.moth");
  assert.ok(
    !entry.tokens.some((token) => token.scopes.some((scope) =>
      scope === "meta.template.moth" || scope.startsWith("meta.embedded."))),
    `Expected no template or embedded scope after ${JSON.stringify(entry.line)}; got ${JSON.stringify(entry.tokens)}`
  );
}

// ── FIXTURE CORPUS ──────────────────────────────────────────────────

test("accepted Moth and MTF fixtures tokenize without invalid scopes", async () => {
  for (const [scopeName, fixture] of [
    ["source.moth", "highlighting-samples.moth"],
    ["source.mtf", "highlighting-samples.mtf"],
  ]) {
    const grammar = await loadGrammar(scopeName);
    const lines = fs.readFileSync(path.join(__dirname, "fixtures", fixture), "utf8").split(/\r?\n/);
    const entries = tokenizeLines(grammar, lines);
    const invalid = entries.flatMap((entry) =>
      entry.tokens
        .filter((token) => token.scopes.some((scope) => scope.startsWith("invalid.")))
        .map((token) => [entry.line, token.text, token.scopes.filter((scope) => scope.startsWith("invalid."))])
    );
    assert.deepEqual(invalid, [], `${fixture} should contain no invalid token scopes`);
  }
});

test("negative fixtures retain their labelled invalid token scopes", async () => {
  const mothGrammar = await loadGrammar();
  const mothLines = fs.readFileSync(
    path.join(__dirname, "fixtures", "invalid-syntax.moth"),
    "utf8"
  ).split(/\r?\n/);
  const mothEntries = tokenizeLines(mothGrammar, mothLines);
  const mothInvalid = mothEntries.flatMap((entry) =>
    entry.tokens.flatMap((token) => token.scopes.filter((scope) => scope.startsWith("invalid.")))
  );
  for (const scope of [
    "invalid.illegal.directive.call-syntax.moth",
    "invalid.illegal.directive.source-in-template.moth",
    "invalid.illegal.template.control.moth",
    "invalid.illegal.type.decimal.moth",
  ]) {
    assert.ok(mothInvalid.includes(scope), `expected ${scope} in the negative Moth fixture`);
  }

  const mtfGrammar = await loadGrammar("source.mtf");
  const mtfLines = fs.readFileSync(
    path.join(__dirname, "fixtures", "invalid-syntax.mtf"),
    "utf8"
  ).split(/\r?\n/);
  const mtfEntries = tokenizeLines(mtfGrammar, mtfLines);
  const mtfInvalid = mtfEntries.flatMap((entry) =>
    entry.tokens.flatMap((token) => token.scopes.filter((scope) => scope.startsWith("invalid.")))
  );
  for (const scope of [
    "invalid.illegal.directive.call-syntax.moth",
    "invalid.illegal.directive.source-in-template.moth",
    "invalid.illegal.template.control.moth",
  ]) {
    assert.ok(mtfInvalid.includes(scope), `expected ${scope} in the negative MTF fixture`);
  }
});

// ── NESTING AND SCOPE RESTORATION ────────────────────────────────────

test("nested templates retain each depth and restore source scope after every close", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[a:",
    "  [b:",
    "    [c:",
    "      [d:",
    "        [e: five]",
    "      ]",
    "    ]",
    "  ]",
    "]",
    "after = 1",
  ]);

  const expectedDepths = [1, 2, 3, 4, 5];
  for (let index = 0; index < expectedDepths.length; index += 1) {
    const begin = lines[index].tokens.find((token) => token.text === "[");
    assert.ok(begin, `expected template begin on line ${index}`);
    assert.equal(
      begin.scopes.filter((scope) => scope === "meta.template.moth").length,
      expectedDepths[index],
      `line ${index} should open depth ${expectedDepths[index]}`
    );
  }

  for (let index = 5; index < 9; index += 1) {
    assert.ok(
      lines[index].tokens.some((token) => token.scopes.includes("punctuation.section.template.end.moth")),
      `line ${index} should close a template`
    );
  }

  checkClean(lines[9], "after");
});

test("runtime and const fragment roots keep their own markers", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "~[: Runtime fragment.]",
    "value = [: Const fragment.]",
  ]);
  checkScope(lines[0], "~", "keyword.operator.runtime-fragment.moth");
  checkScope(lines[0], "[", "punctuation.section.template.begin.moth");
  checkScope(lines[1], "[", "punctuation.section.template.begin.moth");
});

// ── SLOTS, INSERTS, AND WRAPPERS ─────────────────────────────────────

test("slot declarations cover default, named, positional, and defaulted forms", async () => {
  const grammar = await loadGrammar();
  for (const source of [
    "[$slot]",
    "[$slot title]",
    "[$slot title = \"Untitled\"]",
    "[$slot = \"Fallback\"]",
    "[$slot 1]",
    "[$slot 1 = \"Fallback\"]",
  ]) {
    const [entry] = tokenizeLines(grammar, [source]);
    checkScope(entry, "$slot", "keyword.control.directive.template.moth");
    const end = entry.tokens.find(
      (token) => token.text === "]" && token.scopes.includes("punctuation.section.template.end.moth")
    );
    assert.ok(end, `${source} should close as a slot declaration`);
  }

  const [named] = tokenizeLines(grammar, ["[$slot title]"]);
  checkScope(named, "title", "variable.parameter.template.slot.moth");
  const slotBegin = named.tokens.find((token) => token.text === "[");
  assert.ok(slotBegin.scopes.includes("punctuation.definition.slot.begin.moth"));
  const slotEnd = named.tokens.find((token) => token.text === "]");
  assert.ok(slotEnd.scopes.includes("punctuation.definition.slot.end.moth"));

  const [positional] = tokenizeLines(grammar, ["[$slot 1]"]);
  checkScope(positional, "1", "constant.numeric.positional-slot.moth");

  const [defaultSlot] = tokenizeLines(grammar, ['[$slot = "Fallback"]']);
  checkScope(defaultSlot, "=", "keyword.operator.symbol.moth");
  checkScope(defaultSlot, "Fallback", "string.quoted.double.moth");
});

test("invalid slot targets and slot bodies are marked", async () => {
  const grammar = await loadGrammar();

  const [quoted] = tokenizeLines(grammar, ['[$slot "title"]']);
  checkScope(quoted, '"title"', "invalid.illegal.template.slot.target.moth");

  const [zero] = tokenizeLines(grammar, ["[$slot 0]"]);
  checkScope(zero, "0", "invalid.illegal.template.slot.position.moth");

  const [call] = tokenizeLines(grammar, ["[$slot(title)]"]);
  checkScope(call, "$slot(", "invalid.illegal.directive.call-syntax.moth");

  const [body] = tokenizeLines(grammar, ["[$slot: body]"]);
  checkScope(body, ":", "invalid.illegal.template.slot.body.moth");
});

test("insert contributions use a bare named target", async () => {
  const grammar = await loadGrammar();
  const [valid] = tokenizeLines(grammar, ["[layout:[$in title:Welcome]]"]);
  checkScope(valid, "$in", "keyword.other.template.slot.fill.moth");
  checkScope(valid, "title", "variable.parameter.template.slot.target.moth");
  checkScope(valid, "Welcome", "string.unquoted.template.body.moth");

  const [quoted] = tokenizeLines(grammar, ['[$in "title":Welcome]']);
  checkScope(quoted, '"title"', "invalid.illegal.template.slot.target.moth");

  const [numeric] = tokenizeLines(grammar, ["[$in 1:Welcome]"]);
  checkScope(numeric, "1", "invalid.illegal.template.slot.target.moth");
});

test("before, after, and fresh wrappers stay in the template head", async () => {
  const grammar = await loadGrammar();
  const [entry] = tokenizeLines(grammar, [
    "[list, $before [:<li>], $after [:</li>], $fresh: <ul>[$slot]</ul>]",
  ]);
  checkScope(entry, "$before", "keyword.control.directive.template.moth");
  checkScope(entry, "$after", "keyword.control.directive.template.moth");
  checkScope(entry, "$fresh", "keyword.control.directive.template.moth");
  checkScope(entry, "$slot", "keyword.control.directive.template.moth");

  const [invalid] = tokenizeLines(grammar, ["[$before = x: y]"]);
  checkScope(invalid, "=", "invalid.illegal.directive.operand.moth");
});

test("note discards a balanced body and rejects source directives in template heads", async () => {
  const grammar = await loadGrammar();
  const [note] = tokenizeLines(grammar, ["[$note: discarded [nested] content]"]);
  checkScope(note, "[", "punctuation.section.template.begin.moth");
  checkScope(note, "nested", "comment.block.template.comment.moth");
  assert.ok(
    note.tokens.some((token) => token.scopes.includes("meta.template.comment.note.moth")),
    "expected the note template scope"
  );

  const [doc] = tokenizeLines(grammar, ["[$doc: nope]"]);
  checkScope(doc, "$doc", "invalid.illegal.directive.source-in-template.moth");

  const [unknown] = tokenizeLines(grammar, ["[$unknown: nope]"]);
  checkScope(unknown, "$unknown", "invalid.illegal.directive.unknown.moth");
});

test("template if and loop suffixes use template control scopes and reject else controls", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[if show: Visible]",
    "[card, if show: Visible]",
    "[loop items by 2 |item, index|: [item]]",
    "[loop 10 to 0 by -2 |value|: [value]]",
    "[if show: yes else: no]",
    "[break]",
    "[continue]",
  ]);

  for (const index of [0, 1, 4]) {
    checkScope(lines[index], "if", "keyword.control.flow.template.moth");
  }
  for (const index of [2, 3]) {
    checkScope(lines[index], "loop", "keyword.control.flow.template.moth");
  }

  checkScope(lines[4], "else", "invalid.illegal.template.control.moth");
  checkScope(lines[5], "break", "invalid.illegal.template.control.moth");
  checkScope(lines[6], "continue", "invalid.illegal.template.control.moth");
});

test("directive string operands use ordinary string scopes consistently", async () => {
  const grammar = await loadGrammar();
  for (const line of [
    '$doc "Documentation text"',
    '$todo "Todo text"',
    '[$code "moth":]',
    '[$slot = "Fallback"]',
    '[$before "wrapper": body]',
  ]) {
    const [entry] = tokenizeLines(grammar, [line]);
    assert.ok(
      entry.tokens.some((token) => token.scopes.includes("string.quoted.double.moth")),
      `${line} must use the ordinary string scope`
    );
    assert.ok(
      !entry.tokens.some((token) => token.scopes.includes("variable.parameter.code-language.moth")),
      `${line} must not use a context-specific directive operand scope`
    );
  }
});

test("formatter heads support comma-separated and multiline items", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[",
    "    codeblock,",
    "    $code \"moth\":",
    "    sample = 1",
    "]",
  ]);
  checkScope(lines[1], "codeblock", "variable.other.moth");
  checkScope(lines[2], "$code", "keyword.other.template.code.directive.moth");
  checkScope(lines[2], '"moth"', "string.quoted.double.moth");
  checkScope(lines[4], "]", "punctuation.section.template.end.moth");
});

// ── EMBEDDED LANGUAGES ──────────────────────────────────────────────

test("formatter selection survives multiline and nested template heads", async () => {
  const mothGrammar = await loadGrammar();
  const multiline = tokenizeLines(mothGrammar, [
    "[",
    "    section,",
    "    $md:",
    "    # Heading",
    "    [name]",
    "]",
    "after_multiline = 1",
  ]);
  checkScope(multiline[3], "#", "markup.heading.markdown");
  checkScope(multiline[4], "name", "variable.other.moth");
  const heading = multiline[3].tokens.find((token) => token.text === "#");
  assert.ok(!heading.scopes.includes("meta.template.head.moth"), "formatter bodies are not head text");
  checkClean(multiline[6], "after_multiline");

  const nested = tokenizeLines(mothGrammar, [
    "[$before [:prefix], $md:",
    "# Nested heading",
    "body [name]",
    "]",
    "after_nested = 2",
  ]);
  checkScope(nested[1], "#", "markup.heading.markdown");
  checkScope(nested[2], "name", "variable.other.moth");
  checkClean(nested[4], "after_nested");

  const mtfGrammar = await loadGrammar("source.mtf");
  const raw = tokenizeLines(mtfGrammar, [
    "[",
    "    $raw:",
    "    - plain",
    "    [name]",
    "]",
    "after raw text",
  ]);
  checkScope(raw[2], "- plain", "string.unquoted.template.body.moth");
  assert.ok(
    !raw[2].tokens.some((token) => token.scopes.includes("punctuation.definition.list.begin.markdown")),
    "the multiline $raw body must not use Markdown"
  );
  checkScope(raw[3], "name", "variable.other.moth");

  const mtfMarkdown = tokenizeLines(mtfGrammar, [
    "[",
    "    $md:",
    "    # MTF heading",
    "]",
  ]);
  checkScope(mtfMarkdown[2], "#", "markup.heading.markdown");
});

test("plain-text code formatter adds no syntax classes", async () => {
  const grammar = await loadGrammar();
  for (const source of [
    ['[codeblock, $code "text":', "plain if 123 -- text", "]"],
    ["[", '    $code "text":', "    plain if 123 -- text", "]"],
  ]) {
    const lines = tokenizeLines(grammar, source);
    const body = lines.find((entry) => entry.line.includes("plain"));
    assert.ok(body, "expected a plain text body line");
    const token = body.tokens.find((candidate) => candidate.text.includes("plain"));
    assert.ok(token, "expected a plain text token");
    assert.ok(token.scopes.includes("meta.embedded.block.code.generic.moth"));
    assert.ok(token.scopes.includes("source.code.generic.moth"));
    for (const forbidden of [
      "keyword.control.code.generic.moth",
      "constant.numeric.moth",
      "comment.line.double-dash.moth",
      "support.type.code.generic.moth",
    ]) {
      assert.ok(!token.scopes.includes(forbidden), `text mode must not add ${forbidden}`);
    }
  }
});

test("Moth code bodies balance brackets, keep strings, and stay opaque to interpolation", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[codeblock, $code \"moth\":",
    "    sample = \"[child]\"",
    "    nested = [not_a_template]",
    "    brackets = \"[]\"",
    "    after = 1",
    "]",
    "after_code = 2",
  ]);

  checkScope(lines[1], "[child]", "string.quoted.double.moth");

  const nestedBegin = lines[2].tokens.find((token) => token.text === "[");
  assert.ok(nestedBegin, "expected a balanced bracket region in the code body");
  assert.ok(
    nestedBegin.scopes.includes("meta.embedded.block.code.mothlang.moth"),
    "code bracket regions stay inside the embedded code scope"
  );
  checkScope(lines[2], "not_a_template", "variable.other.moth");
  assert.equal(
    tokensAt(lines[2], "not_a_template")[0].scopes.filter((scope) => scope === "meta.template.moth").length,
    1,
    "only the outer code template contributes meta.template.moth"
  );
  assert.ok(
    !nestedBegin.scopes.includes("punctuation.section.template.begin.moth"),
    "a balanced code sample must not open an inner template"
  );

  checkScope(lines[3], "[]", "string.quoted.double.moth");
  checkScope(lines[4], "after", "variable.other.moth");
  checkScope(lines[1], "sample", "variable.other.moth");
  assert.ok(lines[1].tokens.some((token) => token.scopes.includes("meta.embedded.block.code.mothlang.moth")));
  assert.ok(
    lines[4].tokens.every((token) => !token.scopes.includes("punctuation.section.template.begin.moth")),
    "nested-looking samples must not open templates"
  );

  checkScope(lines[5], "]", "punctuation.section.template.end.moth");
  checkClean(lines[6], "after_code");
});

test("embedded language scopes identify each code body", async () => {
  const grammar = await loadGrammar();
  const cases = [
    ["js", "meta.embedded.block.code.js.moth", "source.js"],
    ["ts", "meta.embedded.block.code.ts.moth", "source.ts"],
    ["py", "meta.embedded.block.code.py.moth", "source.python"],
    ["rust", "meta.embedded.block.code.rs.moth", "source.rust"],
    ["bash", "meta.embedded.block.code.shell.moth", "source.shell"],
    ["moth", "meta.embedded.block.code.mothlang.moth", "source.moth.embedded"],
    ["text", "meta.embedded.block.code.generic.moth", "source.code.generic.moth"],
  ];

  for (const [language, embedScope, sourceScope] of cases) {
    const lines = tokenizeLines(grammar, [
      `[codeblock, $code "${language}":`,
      "    body",
      "]",
    ]);
    const body = lines[1].tokens.find((token) => token.text.includes("body"));
    assert.ok(body, `expected a body token for ${language}`);
    assert.ok(body.scopes.includes(embedScope), `${language} must have ${embedScope}`);
    assert.ok(body.scopes.includes(sourceScope), `${language} must have ${sourceScope}`);
  }
});

test("CSS bodies keep balanced selectors and bracket characters inside strings", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$css \"inline\":",
    "    .card[data-kind=\"x\"] {",
    "        background: url(\"shape]one.svg\");",
    "        clip-path: circle(55%);",
    "        color: #ddd;",
    "    }",
    "]",
    "after_css = 1",
  ]);

  checkScope(lines[1], "[", "meta.embedded.block.css.moth");
  checkScope(lines[2], "background", "support.type.property-name.css");
  const string = lines[2].tokens.find((token) => token.text.includes("shape]one.svg"));
  assert.ok(string, "expected a CSS string token");
  assert.ok(string.scopes.includes("string.quoted.double.css"), "the bracket stays inside the CSS string");
  checkScope(lines[3], "circle", "support.function.css");
  checkScope(lines[3], "55", "constant.numeric.css");
  checkScope(lines[4], "#ddd", "constant.other.color.rgb-value.hex.css");

  checkScope(lines[6], "]", "punctuation.section.template.end.moth");
  checkClean(lines[7], "after_css");
});

test("HTML bodies highlight tags, nested templates, and restore scope at the close", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$html:",
    "    <h1 title=\"Moth\">Title [$slot]</h1>",
    "    <p>Text [name]</p>",
    "]",
    "after_html = 1",
  ]);

  checkScope(lines[1], "h1", "entity.name.tag.html");
  checkScope(lines[1], "title", "entity.other.attribute-name.html");
  checkScope(lines[1], "$slot", "keyword.control.directive.template.moth");
  checkScope(lines[2], "name", "variable.other.moth");
  checkScope(lines[3], "]", "punctuation.section.template.end.moth");
  checkClean(lines[4], "after_html");
});

// ── MOTH MARKDOWN ───────────────────────────────────────────────────

test("Markdown headings, lists, emphasis, links, and section IDs tokenize", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$md:",
    "    # Title @#title",
    "    - item @#one",
    "    1. ordered",
    "    **bold [name]** and *italic* and `code [child] text`",
    "    See @./path (label) and @#id and @#section (Section).",
    "]",
    "after_md = 1",
  ]);

  checkScope(lines[1], "#", "punctuation.definition.heading.markdown");
  checkScope(lines[1], "title", "entity.other.attribute-name.id.moth");

  checkScope(lines[2], "-", "punctuation.definition.list.begin.markdown");
  checkScope(lines[2], "one", "entity.other.attribute-name.id.moth");

  checkScope(lines[3], "1.", "punctuation.definition.list.begin.markdown");

  checkScope(lines[4], "**", "punctuation.definition.bold.markdown");
  checkScope(lines[4], "name", "variable.other.moth");
  checkScope(lines[4], "*", "punctuation.definition.italic.markdown");
  checkScope(lines[4], "child", "variable.other.moth");

  checkScope(lines[5], "./path", "markup.underline.link.markdown");
  checkScope(lines[5], "label", "string.other.link.description.title.markdown");
  checkScope(lines[5], "id", "entity.other.attribute-name.id.moth");
  checkScope(lines[5], "#section", "markup.underline.link.markdown");
  checkNoScope(lines[5], "#section", "entity.other.attribute-name.id.moth");

  checkScope(lines[6], "]", "punctuation.section.template.end.moth");
  checkClean(lines[7], "after_md");
});

test("Markdown link targets cover routes, relative, fragment, query, absolute, and protocol-relative forms", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$md:",
    "    @/docs/packages (Packages)",
    "    @./guide#frag (Guide)",
    "    @../up (Up)",
    "    @#fragment (Fragment)",
    "    @?query=1 (Query)",
    "    @//example.com/x (Protocol)",
    "    @https://example.com/path (Absolute)",
    "]",
  ]);

  const targets = [
    ["/docs/packages", "Packages"],
    ["./guide#frag", "Guide"],
    ["../up", "Up"],
    ["#fragment", "Fragment"],
    ["?query=1", "Query"],
    ["//example.com/x", "Protocol"],
    ["https://example.com/path", "Absolute"],
  ];
  for (let index = 0; index < targets.length; index += 1) {
    const [target, label] = targets[index];
    checkScope(lines[index + 1], target, "markup.underline.link.markdown");
    checkScope(lines[index + 1], label, "string.other.link.description.title.markdown");
  }
  checkNoScope(lines[4], "#fragment", "entity.other.attribute-name.id.moth");
});

test("Markdown links accept one line break and reject a second blank line", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$md:",
    "    See @/guide",
    "    (Guide)",
    "    plain",
    "]",
  ]);
  checkScope(lines[1], "/guide", "markup.underline.link.markdown");
  checkScope(lines[2], "Guide", "string.other.link.description.title.markdown");

  const blank = tokenizeLines(grammar, [
    "[$md:",
    "    See @/guide",
    "",
    "    (Guide)",
    "]",
  ]);
  assert.ok(
    !blank[3].tokens.some((token) => token.scopes.includes("string.other.link.description.title.markdown")),
    "a second line break must not create a link label"
  );
});

test("CRLF link labels keep their scopes", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$md:\r",
    "    See @/guide\r",
    "    (Guide)\r",
    "]\r",
  ]);
  checkScope(lines[1], "/guide", "markup.underline.link.markdown");
  checkScope(lines[2], "Guide", "string.other.link.description.title.markdown");
});

test("Markdown markers and links stay literal inside inline code", async () => {
  const grammar = await loadGrammar();
  const [entry] = tokenizeLines(grammar, ["[$md: `@#not-an-id @./not-a-link` text]"]);
  const literal = entry.tokens.find((token) => token.text.includes("@#not-an-id"));
  assert.ok(literal, "expected inline-code text");
  assert.ok(literal.scopes.includes("markup.inline.raw.string.markdown"));
  assert.ok(!literal.scopes.includes("entity.other.attribute-name.id.moth"));
  assert.ok(!literal.scopes.includes("markup.underline.link.markdown"));
});

test("heading levels, paragraph IDs, and link-label markers stay distinct", async () => {
  const grammar = await loadGrammar();
  const lines = tokenizeLines(grammar, [
    "[$md:",
    "    ###### Six",
    "    @#paragraph-id A paragraph with an ID.",
    "    See @./guide (@#literal label).",
    "]",
  ]);

  checkScope(lines[1], "######", "punctuation.definition.heading.markdown");
  checkScope(lines[2], "paragraph-id", "entity.other.attribute-name.id.moth");

  const label = lines[3].tokens.find((token) => token.text.includes("@#literal"));
  assert.ok(label, "expected the link label token");
  assert.ok(label.scopes.includes("string.other.link.description.title.markdown"));
  assert.ok(!label.scopes.includes("entity.other.attribute-name.id.moth"));
});

test("Unicode section IDs and literal template syntax in inline code stay distinct", async () => {
  const grammar = await loadGrammar();
  const [heading] = tokenizeLines(grammar, ["[$md: # Café @#café-π_1]"]);
  checkScope(heading, "café-π_1", "entity.other.attribute-name.id.moth");

  const [literal] = tokenizeLines(grammar, ['[$md: Static `["[...]"]` text]']);
  const content = literal.tokens.find((token) => token.text.includes("[...]"));
  assert.ok(content, "expected the quoted literal inside inline code");
  assert.ok(content.scopes.includes("string.quoted.double.moth"), "the literal keeps its string scope");
  assert.ok(
    !content.scopes.includes("punctuation.section.template.begin.moth"),
    "the literal bracket run is not a nested template"
  );
});

test("triple backticks remain literal Markdown text", async () => {
  const grammar = await loadGrammar();
  const [entry] = tokenizeLines(grammar, ["[$md: ``` not code]"]);
  assert.ok(
    !entry.tokens.some((token) => token.scopes.includes("markup.inline.raw.string.markdown")),
    "fenced code is not part of Moth Markdown"
  );
});

// ── MTF IMPLICIT MARKDOWN ────────────────────────────────────────────

test("MTF files start in Markdown and default directive-free children to Markdown", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = tokenizeLines(grammar, [
    "# Moth Template title",
    "- implicit list item",
    "[p:",
    "    [child:",
    "        - nested list item",
    "    ]",
    "]",
  ]);

  checkScope(lines[0], "#", "punctuation.definition.heading.markdown");
  checkScope(lines[1], "-", "punctuation.definition.list.begin.markdown");
  checkScope(lines[4], "-", "punctuation.definition.list.begin.markdown");
  assert.ok(
    lines[0].tokens.some((token) => token.scopes.includes("meta.embedded.block.markdown.moth")),
    "the implicit body carries the Markdown embedded scope"
  );
});

test("MTF explicit formatters override the Markdown default", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = tokenizeLines(grammar, [
    "[raw_content, $raw:",
    "    - not a list",
    "]",
    "[escaped_content, $escape_html:",
    "    <strong>escaped</strong>",
    "]",
    "[$note: discarded [balanced]]",
  ]);

  const rawLine = lines[1];
  assert.ok(
    !rawLine.tokens.some((token) => token.scopes.includes("punctuation.definition.list.begin.markdown")),
    "raw bodies must not use Markdown"
  );
  assert.ok(
    lines[4].tokens.some((token) => token.scopes.includes("string.unquoted.template.body.moth")),
    "escape_html bodies are plain template text"
  );
  assert.ok(
    !lines[4].tokens.some((token) => token.scopes.includes("meta.embedded.block.html.moth")),
    "escape_html does not switch to HTML embedding"
  );
  checkScope(lines[6], "balanced", "comment.block.template.comment.moth");
});

test("MTF comments and backslashes remain body text", async () => {
  const grammar = await loadGrammar("source.mtf");
  const [entry] = tokenizeLines(grammar, ["-- not a comment \\ text"]);
  assert.ok(
    !entry.tokens.some((token) => token.scopes.includes("comment.line.double-dash.moth")),
    "-- is body text in .mtf files"
  );
  assert.ok(
    !entry.tokens.some((token) => token.scopes.includes("constant.character.escape.moth")),
    "backslashes are body text in .mtf files"
  );
});

test("MTF code blocks keep balanced Moth samples out of template interpolation", async () => {
  const grammar = await loadGrammar("source.mtf");
  const lines = tokenizeLines(grammar, [
    '[codeblock, $code "moth":',
    "    @core/math sin, cos",
    "    sample = \"[literal]\"",
    "    nested = [not_a_template]",
    "]",
    "after text",
  ]);

  checkScope(lines[1], "sin", "variable.other.dependency.selection.moth");
  checkScope(lines[2], "[literal]", "string.quoted.double.moth");
  assert.equal(
    tokensAt(lines[3], "not_a_template")[0].scopes.filter((scope) => scope === "meta.template.moth").length,
    1,
    "only the outer code template contributes meta.template.moth"
  );
  assert.ok(
    !lines[4].tokens.some((token) => token.scopes.includes("meta.embedded.block.code.mothlang.moth")),
    "the code body must close before the following Markdown text"
  );
});
