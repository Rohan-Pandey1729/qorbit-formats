# Contributing

## The short version

The single most useful thing you can contribute is a real flight log that this
library reads wrongly, together with a note on what the correct values should be.
Formats drift between firmware revisions and we cannot test against hardware we
do not own.

## Sign-off

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).
No CLA, no copyright assignment. You keep your copyright; you just confirm you
have the right to contribute the code.

Add a sign-off line to each commit:

```
Signed-off-by: Your Name <your.email@example.com>
```

`git commit -s` does this for you.

## Pull requests

- Add a test. For a format fix, add the smallest log excerpt that reproduces it.
- `npm test` and `npm run typecheck` must pass.
- Keep the scope of a pull request to one thing.

## What belongs here

File readers and writers, format detection, unit conversion, and the types those
produce.

## What does not belong here

Aerodynamics, simulation, trajectory maths, plotting, anything that makes a
network call, and anything that needs configuration. This package is plumbing.
Keeping it boring is the point, because that is what makes it safe to depend on.

## Adding a format

1. Add the vendor to `AltimeterSource` and `SOURCE_LABELS` in `src/flight-import.ts`.
2. Add detection in `detectSource`, keyed on something stable. A distinctive
   header or a file preamble beats a column count.
3. Add column aliases to `ALIASES`. Most specific pattern first.
4. Add a fixture under `fixtures/` and a test.

If the format is undocumented and you are reverse-engineering it from a sample,
say so in a comment. Future maintainers need to know which rules are specified
and which are inferred.
