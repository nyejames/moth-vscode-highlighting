# Moth VS Code Syntax Highlighting

Language support and syntax highlighting for Moth (`.moth`) files.

## Installing

Download the `moth-highligher-*.vsix` file, go to vscode extensions and select "install from VSIX...", then install this file.

If you don't trust it (which is reasonable): package this plugin yourself using `vsce package` to generate the vsix file.

![installing the moth highlighting plugin](installing.png)

I haven't got around to publishing this as an official extension yet, mostly due to how annoying it is to set up a microsoft marketplace account.

I want to make a **proper** language support plugin for Moth in the future with full tokenization. When there is more than 0 users.

## Known Limits

This extension uses TextMate grammars only. For highly complex template heads (especially deeply mixed directive ordering with nested constructs), formatter-body activation can fall back to generic template-body highlighting.

## Development

Run grammar regression checks:

```bash
npm test
```

Create a VSIX package:

```bash
vsce package
```
