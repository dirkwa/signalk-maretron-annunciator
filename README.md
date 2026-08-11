<img src="app-icon.svg" alt="" width="96" align="right">

# signalk-maretron-annunciator

Sound a Maretron ALM100 annunciator when Signal K notifications go active, and
silence it when they clear.

The plugin watches the `notifications.*` tree, picks the most severe
notification that is asking to be heard, and tells the annunciator to sound for
it. When the last one clears, it goes quiet.

## Installing

From the Signal K app store, or:

```sh
npm install signalk-maretron-annunciator
```

You need a NMEA 2000 connection that can transmit. The plugin refuses to send
anything until the server reports one.

**Node 20.19 or newer.** The plugin is an ES module, and that is the first
release where the server's plugin loader can `require()` one directly. Older
Node 20 builds fall back to a dynamic `import()`, which also works, but 20.19+
is the supported floor.

## Configuring

Most installations need nothing beyond turning it on. The annunciator's address
is discovered from the bus, so it keeps working if the device re-claims a
different one.

| Setting | Default | What it does |
|---|---|---|
| Sound the annunciator | on | Turn off to leave the device alone without stopping the plugin |
| Annunciator address | discovered | Set only if discovery does not find your device |
| Annunciator instance | 0 | As reported by the device in PGN 130817 |
| First alert id to use | 40000 | Alert ids are allocated from here, one per notification path |
| States that sound | `alarm`, `emergency` | Which notification states are audible |
| Default pulse pattern | 4 | 0 to 4 |
| Pattern per state | none | Optionally give each state its own pattern |
| Repeat every | 30 s | Re-sends the sound command as a guard against a lost frame; 0 disables |

### Notification states

A notification only sounds the annunciator if its `method` includes `sound` —
that is the Signal K convention, and it means a visual-only notification stays
silent. `normal` and `nominal` are treated as cleared.

When several notifications are active at once the most severe one wins:
`emergency` > `alarm` > `alert` > `warn`.

### Alert ids

The ALM100 keys on an alert id, so each notification path is given a stable one,
allocated from **First alert id to use**. Keep that range clear of the ids your
other equipment already uses — a chartplotter or alarm panel raising its own
alerts will have its own ids, and reusing one would confuse the device about
which alert is sounding. Check what your bus already uses before changing it.

### Patterns

PGN 130817 reports five patterns, numbered 0 to 4. They differ in **beep cadence
rather than pitch** — single beeps versus faster repeated beeps. The device does
not name them, so the plugin does not either; try them and pick the one you
want.

## Testing it

The plugin registers a PUT handler, so you can sound the annunciator without
waiting for a real alarm:

```sh
curl -X PUT -H 'Content-Type: application/json' \
  -d '{"value": true}' \
  http://localhost:3000/signalk/v1/api/vessels/self/electrical/annunciators/0/state
```

Send `false` to hand control back to the notifications. A real notification
always wins over this switch, so leaving a test switched on cannot mask an
actual alarm; and switching it off while something is still active leaves the
annunciator sounding for that.

The plugin status in the server UI shows the discovered device and whether it is
currently sounding.

## How it works

The annunciator is not written directly. PGN 130824 (Maretron: Annunciator) is a
status report — the device lists it only on its transmit side and ignores writes
to it. It is commanded by a **126208 NMEA Command group function addressed to
the device, targeting PGN 130824 and writing that PGN's fields**:

| Parameter | Field | Sounding | Silent |
|---|---|---|---|
| 1 | Manufacturer Code | 137 (Maretron) | 137 |
| 3 | Industry Code | 4 (Marine) | 4 |
| 4 | Annunciator Instance | 0 | 0 |
| 5 | Annunciator State | 100 | 0 |
| 6 | Pattern | 0–4 | `0xffff` (unavailable) |
| 7 | *unidentified* | 23 | 23 |
| 8 | Alert ID | the alert being sounded | same |

While sounding, the device's own 130824 reports state 100, the pattern and the
alert id, at 1 Hz instead of its usual 10 second idle beacon — so you can
confirm it is working from the bus rather than by ear.

Parameters 1 and 3 are not decoration. PGN 130824 has two variants —
`bGKeyValueData` and `maretronAnnunciator` — and without those pairs an encoder
resolves the target to the wrong one and emits a frame that its own decoder
reads back as a different message. See
[canboat/canboatjs#458](https://github.com/canboat/canboatjs/issues/458).

The PGN definitions and the captures behind all of this are in
[canboat/canboat#833](https://github.com/canboat/canboat/pull/833).

## Silencing from elsewhere

Acknowledging the underlying alert also stops the noise, because the
notification stops asking to be heard and the plugin then silences the device.
Anything that clears or acknowledges the Signal K notification works — you do
not have to talk to the annunciator.

## Limitations

- Only the ALM100 has been tested. Other Maretron annunciators use the same
  PGNs and should work, but the discovery check for a non-ALM100 relies on the
  device's address claim rather than its product code.
- Only annunciator instance 0 has been observed in the wild. The instance is a
  field and is configurable here, but nothing else has been tried.
- Field 7 is sent as the constant 23. It was 23 in every frame ever captured,
  from Maretron's own software and from replayed commands alike, and nothing has
  been seen to vary it.

## Development

```sh
npm install
npm run build          # tsc -> dist/
npm test               # mocha via tsx, no build step needed
npm run ci-test        # build, format check, tests
```

The package is an **ES module** (`"type": "module"`, `module: nodenext`, no
bundler), so relative imports carry an explicit `.js` extension even in the
TypeScript source — the specifier names the emitted file, not the `.ts` one —
and the plugin entry point is a `export default function (app) {...}`, which is
what the server's loader calls.

`test/encoded.test.ts` asserts the exact bytes that were confirmed to sound and
silence real hardware. It needs an encoder, which the server normally provides:

```sh
npm install --no-save @canboat/canboatjs
```

Without it those three tests skip, with a warning, rather than failing.

See [AGENTS.md](./AGENTS.md) for the full contributor guidance.

## License

Apache-2.0
