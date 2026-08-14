# Moth VS Code Syntax Highlighting

Language support and syntax highlighting for Moth (`.moth`) and Moth Template (`.mtf`) files.

## Installing

Download the `moth-highligher-*.vsix` file, go to VS Code extensions and select "install from VSIX...", then install this file.

If you don't trust it (which is reasonable): package this plugin yourself using `vsce package` to generate the vsix file.

![installing the moth highlighting plugin](installing.png)

## Known Limits

This extension uses TextMate grammars only. It does not provide semantic language-server support. For highly complex template heads (especially deeply mixed directive ordering with nested constructs), formatter-body activation can fall back to generic template-body highlighting.

## Development

Install dependencies and run the test suite:

```bash
npm ci
npm test
```

The test suite includes real TextMate tokenisation tests using `vscode-textmate` and `vscode-oniguruma`, the same libraries VS Code uses for grammar tokenisation. Tests verify token scopes, ranges, and rule-stack transitions across multiline dependency clauses, embedded Moth code, and general path expressions.

Inspect the packaged extension contents without publishing:

```bash
npm pack --dry-run
```
