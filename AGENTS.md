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

**ESM, built with `tsc`.** No bundler.

- `package.json` has `"type": "module"`, so `.js` in `dist/` is an ES module.
- `tsconfig.json` sets `module` and `moduleResolution` to `nodenext`.
- The entry point is `export default function (app) {...}`.

Three things follow from that, and each will bite if forgotten:

1. **Relative imports need an explicit `.js` extension**, including in `.ts`
   source: `import { buildCommand } from './command.js'`. The specifier refers
   to the emitted file, not the TypeScript source. `tsc` will not add it for
   you and Node will not guess.
2. **The default export is the contract.** The server does
   `pluginConstructor = await importOrRequire(moduleDir)` and then calls
   `pluginConstructor(app)`; `importOrRequire` returns `mod.default ?? mod`
   (`src/modules.ts`). A named export or a `module.exports` assignment will not
   be found.
3. **There is no `require` and no `__dirname`.** Use `await import()` for
   optional dependencies — `test/encoded.test.ts` does this for
   `@canboat/canboatjs` — and `import.meta.url` if a path is ever needed.

The server loads plugins through `importOrRequire()`, which calls `require()`
first and falls back to `import()`. On Node 20.19+ and 22+, `require()` can load
ESM directly, so the first path succeeds and `mod.default` is picked up; on
older runtimes the `import()` fallback handles it. Both routes are exercised —
`npm test` runs the suite as ESM, and the plugin has been loaded through a
`require()` shim matching the server's own logic.

No bundler is needed: this is four small modules with one runtime dependency.
A bundler such as Vite would earn its place only if a webapp or admin-UI panel
were added, since those need module federation. Do not add one otherwise.

## Commits

**Angular style**, as `<type>(<scope>): <subject>`:

```text
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

Mocha runs the TypeScript directly through `tsx` (`.mocharc.json`), which
handles ESM without a build step. Tests import from `../src/*.js` — the `.js`
extension is required even though the file on disk is `.ts`.

`test/encoded.test.ts` pins the **exact bytes** that were confirmed to sound and
silence a real ALM100. If a change makes those tests fail, the change is wrong
until proven otherwise on hardware — do not adjust the expected bytes to match
new output. It skips when `@canboat/canboatjs` is not installed, since the encoder belongs
to the server rather than to this package — but it prints a warning when it
does, so a green run cannot quietly hide the tests that matter most. Install it
with `npm install --no-save @canboat/canboatjs` to run them.

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
