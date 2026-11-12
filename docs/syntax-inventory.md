# Moth VS Code syntax inventory

This is a maintenance map for the TextMate grammars in this repository, not a
language authority. Accepted syntax is owned by the Moth repository. When this
document and the Moth documentation disagree, the Moth documentation wins and
this file should be corrected.

Status labels:

- **active** — accepted and highlighted as current Moth syntax.
- **accepted-future** — accepted language design that the grammar may colour, but
  the extension makes no claim that the current compiler executes it.
- **deprecated** — removed or replaced syntax. It may receive an invalid scope
  only when the distinction is lexical; it never receives a current-syntax scope.
- **unsettled** — design not final enough for an active grammar rule.

## Sources of truth

- [Moth language cheatsheet](https://github.com/nyejames/moth/blob/main/docs/docs/cheatsheet/moth-language-cheatsheet.mtf)
- [Reserved names](https://github.com/nyejames/moth/blob/main/docs/docs/cheatsheet/reserved-names-list.mtf)
- [Source directives](https://github.com/nyejames/moth/blob/main/docs/docs/directives/directives.mtf)
- [Template directives](https://github.com/nyejames/moth/blob/main/docs/docs/templates/template-directives.mtf)
- [Template slots](https://github.com/nyejames/moth/blob/main/docs/docs/templates/template-slots.mtf)
- [Template control flow](https://github.com/nyejames/moth/blob/main/docs/docs/templates/template-control-flow.mtf)
- [Moth Markdown](https://github.com/nyejames/moth/blob/main/docs/docs/templates/markdown-formatting.mtf)
- [Dependency clauses](https://github.com/nyejames/moth/blob/main/docs/docs/packages/dependency-clauses.mtf)
- [Module roots and file roles](https://github.com/nyejames/moth/blob/main/docs/docs/project-structure/module-roots.mtf)
- [Progress matrix](https://github.com/nyejames/moth/blob/main/docs/docs/progress/@entry.moth)
- [Directive specifications](https://github.com/nyejames/moth/blob/main/src/compiler_frontend/style_directives/specs.rs)
- [Directive attachment](https://github.com/nyejames/moth/blob/main/src/compiler_frontend/headers/file_parser.rs)

## Grammar architecture

- `syntaxes/moth.tmLanguage.json` owns source lexing, source directives,
  dependency clauses, paths, reusable template rules, Markdown fragments,
  embedded language bodies, and their nested-template entry points.
- `syntaxes/mtf.tmLanguage.json` owns the `.mtf` implicit Markdown body,
  MTF-specific formatter fallback bodies, and default nested-template handling.
  It delegates common head, slot, note, and lexical rules to `source.moth`
  through repository includes.
- Reusable regions are repository includes. There is no generated grammar and no
  injection grammar for directives or dependencies; the checked-in JSON is
  directly consumed by VS Code.
- Root order deliberately puts comments, source directives, dependency clauses,
  paths, and templates before general lexical rules. This keeps line-start
  constructs and nested formatter bodies from being consumed as ordinary text.

## Feature inventory

| Area | Status | Grammar behaviour | Owner |
| --- | --- | --- | --- |
| `--` source comments | active | `comment.line.double-dash.moth`; body `--` remains authored text | Cheatsheet, directives |
| Lexical names | active | Unicode identifiers, keyword-prefix boundaries, `snake_case` values, `PascalCase` types, `ALL_CAPS` traits | Cheatsheet |
| Primitive and contract types | active | Exact `I/U/F` widths, `Dec`/`Dec0`–`Dec256`, `Bool`, `String`, `Char`, `Byte`, `None`, `True`, `False`, `Error`, `Wire`, `Route` | Cheatsheet, numbers, progress |
| Invalid numeric type names | deprecated | `Dec01`, `Dec257`, `Dec999` use `invalid.illegal.type.decimal.moth`; retired `Int`, `Float`, `Fn`, `IO` receive no primitive scope | Cheatsheet, numbers |
| User types, generics, traits | active | User nominal types, generic parameters, `type`/`of`, trait names, `This`/`this`, cast-trait families | Cheatsheet, traits |
| Mutable and constant syntax | active | `~=`, `~name`, `~{T}`, `#=`, `#Type`; `#|...|` const-function markers stay distinct | Cheatsheet, constants |
| Never and fallible calls | active | `-> !` stays `storage.type.never.moth`; type suffixes use `support.type.option.moth` / `support.type.error.moth`; call propagation reuses `storage.type.never.moth` for `!` and `support.type.option.moth` for `?`; `return!` and `cast!` stay distinct | Errors, functions |
| Operators and punctuation | active | `::`, `=>`, `->`, `//`, `//=`, `to &`, comparisons, arithmetic, compound assignments, `{=}` maps; `:` / `;` use structural punctuation plus `punctuation.section.scope.begin` / `.end`, not keyword scopes | Cheatsheet, wiring |
| Future channel operators | accepted-future | `<<` and `>>` use `keyword.operator.channel.future.moth`; no execution semantics implied | Channel design |
| Declarations and heads | active | Functions, named/default parameters, multi-result slots, generics, structs, choices, aliases, traits, conformance, `Wire`/`Route` parameters | Functions, types, wiring |
| Control flow | active | `if`/`then`/`else`, guarded matches, option captures, `catch`, conditional/collection/range loops, signed `by`, loop pipes | Loops, matching |
| Repeated option-capture and collection-producing loops | accepted-future | Same loop lexical forms; no claim of current compiler support | Loops, const functions |
| `#|...|` const functions | accepted-future | Constant marker `#` plus function pipes; no separate runtime claim | Const functions plan |
| Source directives | active | `$export`, `$config`, `$doc`, `$todo` use `keyword.control.directive.source.moth`; operands use ordinary compile-time expression/template scopes | Directives |
| Future source modifiers | accepted-future | `$fast_math`, `$safe_math`, `$infallible`, `$test` use `keyword.control.directive.source.future.moth` | Directive specs, roadmap |
| Unsettled directives | unsettled | `$layout`, `$feature`, `$mon`, `$pure`, `$no_io`, `$no_wrap` are not active rules; they fall through to unknown-directive highlighting | Roadmap |
| Dependency clauses | active | Direct selections, namespace clauses, namespace aliases, selection aliases, comma-driven multiline continuation, bounded termination | Dependency clauses |
| `$export` dependency annotation | active | `$export` is a separate source directive; the following line-start clause is highlighted as a dependency | Public API, dependency clauses |
| File values and paths | active | Path components use `entity.name.path.segment.moth` plus `entity.name.module.moth`; path literals never receive dependency-selection scopes | Resources |
| Templates and roots | active | `[: body]`, `[expr]`, helper/directive templates, `#=` const templates, `~[` runtime fragments; closing `]` restores outer state | Templates |
| Template heads | active | Comma-separated items, nested head expressions/templates, multiline heads, final `if`/`loop` suffix | Template directives, control flow |
| Template control flow | active | `if`/`loop` suffixes use `keyword.control.flow.template.moth`; `else:` in a generic body and `else`/`break`/`continue` heads use `invalid.illegal.template.control.moth` | Template control flow |
| Slots and inserts | active | `[$slot]`, `[$slot name]`, positional slots, `= value` defaults, `[$in name:body]`; quoted targets, slot `0`, call spelling and slot bodies are invalid | Template slots |
| Wrappers and notes | active | `$before`, `$after`, `$fresh`, `$note`; note bodies are discarded and balanced | Template directives |
| Formatters | active | `$md`, `$raw`, `$html`, `$css`, `$escape_html`, `$code "language"`; no call spelling | Template directives |
| CSS formatter direction | unsettled | Current compiler accepts `$css` and `$css "inline"`; grammar keeps both until the compiler settles the external-stylesheet design | Compiler docs |
| Moth Markdown | active | Headings 1–6, unordered/ordered lists, bold/italic, links, `@#id` section IDs, paired single-backtick inline code | Moth Markdown |
| Markdown exclusions | deprecated | Fenced code, tables and CommonMark extensions are intentionally unsupported | Moth Markdown |
| `.mtf` implicit body | active | Implicit `$md` body; nested directive-free templates default to `$md`; explicit formatters override | Moth templates |
| Embedded Moth code | active | `$code "moth"` is opaque to template interpolation while retaining balanced Moth highlighting | Template directives |
| Embedded JS/TS/Python/Rust/Shell/generic | active | `meta.embedded.block.code.<id>.moth` plus the delegated source grammar scope and `embeddedLanguages` mapping | Template directives |
| Embedded CSS/HTML | active | Bounded fragments prevent `]`, quotes, `url(...)`, nested tags and attribute values from leaking into Moth | Template directives |
| Root file roles | active | Only `@entry.moth`, `@mod.moth`, `@package.moth` are special authored roots; arbitrary `@*.moth` files are not roots | Module roots |
| Root-role icons | active | Opt-in `Moth File Icons` theme maps `@entry.moth` to blue, `@mod.moth` to green, and `@package.moth` to violet; regular `.moth` / `.mtf` files keep their language icons | Module roots, VS Code file-icon themes |

## Retired forms

These forms must not receive current Moth scopes. Lexically detectable cases use
`invalid.illegal.*` where noted.

| Retired form | Replacement |
| --- | --- |
| `export:` block, `export` keyword | `$export` source directive on a declaration or direct-selection dependency |
| `import` keyword | dependency clauses; `import` is an ordinary identifier |
| `$insert(...)`, `$children(...)` | `[$in name: body]` |
| `[$slot("title")]` | `[$slot title]` or `[$slot title = value]` |
| `$code("moth")` | `$code "moth"` |
| `[$doc: ...]`, `[$todo: ...]` | source `$doc`/`$todo`; `$note` is the only template comment |
| `#[...]` root templates | `[: ...]` or `[expr]` |
| Template `else`, `break`, `continue` | no equivalent; template `if` selects one body and template loops have no loop controls |
| `loop item in items` | `loop items \|item\|:` |
| `Int`, `Float` | exact-width integer/float types, `Dec`, `Byte` |
| `..` range operator | `to` / `to &` |
| `$page`, `$project`, `$builder`, `$html_builder`, `$entry` | ordinary records/configuration and file roles |
| `source.moth.comment-directives` injection grammar | directives are part of the main grammars |

## Scope conventions

- Roots stay `source.moth` and `source.mtf`; language IDs stay `moth` and `mtf`.
- `meta.template.moth`, `meta.template.head.moth`, `meta.template.body.moth`,
  `meta.template.markdown.moth`, and `meta.template.slot.marker.moth` separate
  template structure.
- `meta.embedded.block.markdown.moth`, `.css.moth`, `.html.moth`, and
  `.code.<language>.moth` are the package's `embeddedLanguages` contract.
- Source directives use `keyword.control.directive.source.moth`; future source
  directives use `.future.moth`; template directives use
  `keyword.control.directive.template.moth`.
- Primitive types use `support.type.primitive.moth`; builtin contracts use
  `support.type.builtin.moth`; user nominal types use `entity.name.type.moth`.
- Option and error type suffixes use `support.type.option.moth` and
  `support.type.error.moth`, so they inherit type colouring. Postfix call
  propagation uses `storage.type.never.moth` for `!` and
  `support.type.option.moth` for `?`, giving both the same visible theme
  treatment as their type counterparts.
- Pipe parameter delimiters use their own `punctuation.brackets.pipe.moth`
  scope. Bracket-pair decoration is controlled by the language configuration.
- Directive string operands use ordinary `string.quoted.double.moth` scopes,
  including `$code "language"`; directives do not introduce a separate operand
  colour.
- Dependency path components use `entity.name.path.segment.moth` with
  `entity.name.module.moth` as a theme-compatible alias. They intentionally do
  not use `entity.name.namespace`, which themes commonly map to type colour.
  The leading `@` keeps `punctuation.definition.path.begin.moth` and also
  carries the path component scopes, so it shares the path colour. Path
  separators keep `punctuation.separator.path.moth` and the same component
  scopes; aliases and selections after the path keep their own scopes.
  Selected names use `variable.other.dependency.selection.moth`; aliases use
  `variable.other.dependency.alias.moth` / `variable.other.namespace.alias.moth`.
- Invalid or retired lexical forms use `invalid.illegal.*.moth`, never a
  current-syntax scope.
- Theme-facing scopes are kept stable where they express the same construct.
  This pass deliberately changed dependency-path, directive-operand, and
  delimiter scopes to avoid collisions with type and keyword colours. The
  extension ships no theme, so scope changes are reviewed against the grammar
  tests rather than a bundled colour map.

## Known TextMate limits

1. **Source directive attachment is lexical only.** The grammar cannot prove
   which declaration a directive annotates, enforce blank-line/scope-boundary
   attachment, reject duplicate names in a run, or decide target eligibility.
   It colours directive names and their ordinary expression operands.
2. **Template directive semantics are not validated.** TextMate cannot reject a
   second formatter, duplicate directive names, a slot with extra head items, or
   an unknown `$in` target. Lexically detectable mistakes are marked: call
   spelling, quoted slot targets, slot `0`, slot bodies, source directives in
   template heads, unknown directives, and template `else:`/`break`/`continue`
   where the grammar can see them.
3. **`.mtf` Markdown bodies are text.** Bare `else` or `break` in a `.mtf`
   Markdown body stays literal Markdown; only template heads and generic
   template bodies receive lexical control validation.
4. **Multiline links are bounded by one physical break.** `@/guide` followed by
   `(Guide)` on the next line links. A second blank line prevents label
   association, but the target may still be coloured as a link because TextMate
   cannot inspect a later line before styling the target.
5. **A parent inline-code span cannot cross a child template.** The compiler
   rejects a code span that begins before a nested template and ends after it.
   The grammar cannot detect that ordering and may still colour the span as
   inline code. Valid interpolation inside a code span is highlighted.
6. **Balanced Moth code is lexical.** `$code "moth"` balances `[]` and `{}` in
   authored code, including brackets inside strings, matching the compiler's
   balanced-body mode. A lone unmatched `]` closes the outer template early;
   that is invalid Moth content, not a grammar recovery promise.
7. **No semantic colouring.** There is no language server, semantic token
   provider, symbol resolution, or compiler diagnostic integration. Unknown
   names cannot be coloured by type or declaration role.
8. **File icons use an opt-in theme for exact filenames.** VS Code's language
   icon contribution cannot distinguish `@entry.moth`, `@mod.moth`, and
   `@package.moth`, so `Moth File Icons` adds exact-filename mappings on top of
   the regular `.moth` / `.mtf` icons. The language icon contributions remain
   the fallback until the user selects the file icon theme.

## VS Code integration decisions

- `.moth` uses `language-configuration.json`: `--` line comments, the original
  bracket pairs, and the existing `|` auto-close pair. The `|` pair is
  intentionally unchanged.
- `.mtf` uses `mtf-language-configuration.json` with no comment syntax, matching
  implicit Markdown body semantics. It keeps the same bracket and auto-close
  policy.
- No indentation rules are added: Moth uses `:`/`;` blocks and indentation is not
  semantic. Bracket-based folding remains the editor default.
- `@entry.moth`, `@mod.moth`, and `@package.moth` are the only special authored
  root filenames. `config.moth` branding is a separate, undecided design step.
- `fileicons/moth-icon-theme.json` contributes `Moth File Icons`. It maps exact
  root filenames to the blue, green, and violet artwork, while `.moth` and
  `.mtf` fall back to their existing language icons. Unmatched files and folders
  use the brown `icons/moth-logo.png` fallback. Selecting a file icon theme is
  an editor preference, so the theme is opt-in.
- The package identifier `moth-highligher` and publisher `Nye` are retained for
  upgrade compatibility. The typo is not changed in this pass.

## Validation baseline and commands

Baseline at commit `4441319` (descendant of the plan's `6d79209`):

```text
node --test tests/*.test.js
tests 98, pass 98, fail 0
```

Baseline fixtures still contained `#[...]` roots, `$code("...")`, `$insert(...)`,
`$children(...)`, `Float`, `$doc:`/`$todo:` template comments, and the
`source.moth.comment-directives` injection grammar. Those forms are now in the
labelled negative fixtures or removed.

Current suite:

```bash
npm test
```

The suite uses `vscode-textmate` and `vscode-oniguruma`, the libraries VS Code
uses for TextMate tokenisation. It covers both `source.moth` and `source.mtf`,
including fixture-corpus invalid-scope checks, multiline state, embedded-language
scopes, and restoration after closing delimiters.

Release checks:

```bash
npm ci
npm test
npm pack --dry-run
npx @vscode/vsce package
```
