/**
 * Imports the built package the way a Node ESM consumer does.
 *
 * This exists because `vitest` and bundlers resolve extensionless relative
 * specifiers, and Node does not. A build that passes the unit tests can still
 * be completely unimportable once published, which is exactly what happened in
 * 0.1.0. Nothing here tests behaviour; it tests that the artifact loads.
 */
import assert from 'node:assert/strict'

const mod = await import('../dist/index.js')

const expected = [
  'parseFlightCSV',
  'summariseRows',
  'detectSource',
  'importThirdPartyCSV',
  'parseAnyFlightCSV',
  'SOURCE_LABELS',
  'parseOrk',
  'orkXmlFromArchive',
]

for (const name of expected) {
  assert.ok(name in mod, `dist/index.js does not export ${name}`)
}

// Parse something end to end so the dependency graph is genuinely exercised.
const csv = [
  'Time,Altitude',
  '0.0,0',
  '1.0,120',
  '2.0,240',
  '3.0,180',
  '4.0,0',
].join('\n')

const flight = mod.parseAnyFlightCSV(csv)
assert.equal(flight.source, 'generic')
assert.ok(flight.rows.length === 5, `expected 5 rows, got ${flight.rows.length}`)
assert.ok(flight.summary.max_altitude_m > 0, 'no altitude parsed')

console.log(
  `ok: dist imports on Node ${process.versions.node}, ${expected.length} exports present, ` +
  `parsed ${flight.rows.length} rows (max ${flight.summary.max_altitude_m} m)`
)
