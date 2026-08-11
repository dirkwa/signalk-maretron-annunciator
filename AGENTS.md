# AGENTS.md

Guidance for AI agents (and humans) working in this repository.
`CLAUDE.md` deliberately just points here so the two cannot drift.

## What this is

A Signal K server plugin that sounds a Maretron ALM100 annunciator when
notifications go active. It is a small TypeScript package: four modules under
`src/`, a matching test file each under `test/`.

The wire protocol it speaks was reverse-engineered against real hardware and is
documented in [canboat/canboat#833](https://github.com/canboat/canboat/pull/833).
Read `README.md` before changing anything that builds a PGN.

## Module format

**CommonJS, built with `tsc`.** Not ESM, and no bundler.

- `package.json` has no `"type"` field, so `.js` in `dist/` is CommonJS.
- `tsconfig.json` extends `@tsconfig/node20`, which sets `module: nodenext`.
- The entry point uses `module.exports = function (app) {...}`, which is the
  plugin shape the server calls.

This is deliberate, not an oversight. The server loads plugins through
`importOrRequire()` (`src/modules.ts`), which tries `require()` first and falls
back to `import()`, so both formats work — but CommonJS is what every plugin in
the ecosystem ships, it is what the `module.exports` plugin contract expects,
and there is nothing here that needs bundling. Do not convert it to ESM or add
Vite without a concrete reason.

## Commits

**Angular style**, as `<type>(<scope>): <subject>`:

```
feat(command): add a pattern override per notification state
fix: cap the repeat interval so it cannot wrap Node's timer
docs: explain how alert ids are allocated
```

- Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- Scope is optional and is a module name (`command`, `device`, `alerts`) when
  the change is confined to one.
- Subject in the imperative mood, lower case, no trailing period.
- New device support or a new option is `feat`. A wrong frame on the wire is
  `fix` — that is a bug in something safety-related, not a chore.
- Explain *why* in the body, and say what evidence backs a protocol claim.

## Testing

```sh
npm run ci-test      # build, format check, then the suite
npm test             # the suite alone
```

`test/encoded.test.ts` pins the **exact bytes** that were confirmed to sound and
silence a real ALM100. If a change makes those tests fail, the change is wrong
until proven otherwise on hardware — do not adjust the expected bytes to match
new output. It skips cleanly when `@canboat/canboatjs` is not installed, since
the encoder belongs to the server rather than to this package.

Two encoding rules are load-bearing and each has a test:

1. The 126208 parameter list must lead with the manufacturer and industry pairs.
   PGN 130824 has two variants, and without them an encoder resolves the target
   to B&G's dynamic key/value fields and emits a frame that its own decoder
   reads back as a different message
   ([canboat/canboatjs#458](https://github.com/canboat/canboatjs/issues/458)).
2. Pattern when silencing must be an explicit `0xffff`. Left undefined,
   canboat-wasm throws and canboatjs silently drops a byte.

## Working on the protocol

This device is on a live bus and makes noise by design. If you are testing
against real hardware:

- Confirm the bus is quiet first. An earlier round of this work drew the wrong
  conclusion because other software was driving the annunciator throughout.
- The device's own PGN 130824 reports whether it is sounding, at 1 Hz while it
  is and every 10 s while it is not, so success is checkable from the bus rather
  than by ear.
- Send single commands, not loops.

## Style

Prettier with the repository's `.prettierrc` (no semicolons, single quotes, no
trailing commas). `npm run prettier` formats; `npm run ci-lint` checks.

Comments should say why something is the way it is, especially where the
protocol is surprising. Do not add comments that restate the code.
