# qorbit-formats

Readers for the file formats of hobby and student rocketry. Altimeter flight
logs in, design files in, plain typed objects out.

Every altimeter vendor writes a different CSV. Every design tool writes a
different XML. Anyone who wants to do something useful with a flight has to
write the same adapters again, which is why most teams end up with a Python
notebook that one person maintains and nobody else can run.

This package is those adapters, maintained in the open so nobody has to write
them a third time.

No network calls, no state, no telemetry, no physics. It reads files.

## Status

Early. Version 0.1.0, not yet published to npm. The flight log readers are in
daily use in a production app; the OpenRocket reader is newer. Formats are read
by pattern rather than by exact header match, so a vendor firmware revision that
renames a column usually still works, but if you have a log it misreads, that
is a bug worth filing.

## Install

Until this is on npm:

```bash
npm install github:Rohan-Pandey1729/qorbit-formats
```

## Flight logs

```ts
import { parseAnyFlightCSV, SOURCE_LABELS } from 'qorbit-formats'

const parsed = parseAnyFlightCSV(csvText)

console.log(SOURCE_LABELS[parsed.source])   // "Featherweight"
console.log(parsed.summary.max_altitude_m)  // 1043.2
console.log(parsed.summary.outcome)         // "nominal"
console.log(parsed.rows.length)             // 8471
```

`parseAnyFlightCSV` sniffs the source and routes to the right reader. If you
know you have a native log, `parseFlightCSV` is stricter and will tell you
exactly which columns are missing.

### What it detects by name

| Source | Notes |
|---|---|
| Qorbit Core | Native 16-column format, documented in [docs/FLIGHT_LOG_FORMAT.md](docs/FLIGHT_LOG_FORMAT.md) |
| Featherweight | Raven family |
| Eggtimer | |
| PerfectFlite | StratoLogger family |
| Altus Metrum | |
| Generic CSV | Fallback: anything with a recognisable time column and altitude column |

The generic path is not a consolation prize. It is how a Jolly Logic Chute
Release export, an AltimeterTwo export, or a log from something written in 2009
still gets read. Feet are converted to metres automatically.

### Honest limitations

A third-party log has no ballistic-detection channel, because that is a feature
of a specific flight computer's firmware rather than a property of the flight.
Imported flights therefore always report `ballistic_count: 0` and never
synthesise a `BALLISTIC` or `FAILSAFE_FIRED` state. They are for baseline and
simulation-calibration use. Nothing here will tell you a parachute deployed if
the altimeter did not record it.

## Design files

```ts
import { parseOrk } from 'qorbit-formats'

const design = parseOrk(new Uint8Array(await file.arrayBuffer()))
console.log(design.name, design.bodyDiameter_mm, design.geometry.fin.count)
```

OpenRocket `.ork` only. RockSim `.rkt` is **not** supported: the format is not
published and we are not going to guess at it in a library other people depend
on.

`parseOrk` uses the global `DOMParser` in a browser. On Node, pass one in:

```ts
import { DOMParser } from '@xmldom/xmldom'
parseOrk(bytes, { parser: new DOMParser() })
```

### A note on design tools

OpenRocket and RockSim are good simulators and this package is not an attempt to
replace either. It reads their output. If you maintain a design tool and want its
format read correctly here, open an issue; a sample file is worth more than a
specification.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contribution is a real
flight log from an altimeter this misreads, with a note on what the correct
numbers should be.

## Support

See [SUPPORT.md](SUPPORT.md). Short version: best effort, no SLA.

## License

Apache-2.0. Use it in commercial products, embed it in your own tool, no
permission needed.

This package is maintained alongside [Qorbit](https://www.qorbitsystems.com),
which is a hosted platform for rocketry teams. The platform is a separate,
closed product. This package stands on its own and will stay permissively
licensed regardless of what happens to it.
