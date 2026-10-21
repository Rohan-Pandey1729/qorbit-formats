/**
 * Third-party altimeter import.
 *
 * WHY THIS EXISTS: parseFlightCSV requires all 16 Qorbit Core columns, so until
 * Qorbit hardware ships, nobody could upload a real flight — which left the
 * logbook, sim-diff, flight reports and 3D replay unreachable for every user.
 * This adapts logs from altimeters people already fly (Featherweight Raven,
 * Eggtimer, PerfectFlite StratoLogger, Altus Metrum) into our row shape.
 *
 * DESIGN: match columns by alias pattern rather than by exact header string.
 * Vendors change header text between firmware revisions and export options
 * (units in the header, spaces, casing), so an exact-match table would be
 * brittle and silently reject valid files. Anything with a recognisable time
 * and altitude column can be imported; everything else is derived.
 *
 * HONESTY: a third-party log has no ballistic-detection channel, because that
 * is Qorbit's own firmware feature. Imported flights therefore always report
 * ballistic_count 0 and never produce a BALLISTIC or FAILSAFE_FIRED state.
 * They are for baseline/sim-calibration use, not for claiming a save.
 */

import Papa from 'papaparse'
import { parseFlightCSV, summariseRows } from './flight-parser.js'
import type { FlightRow, ParsedFlight } from './flight-parser.js'

export type AltimeterSource =
  | 'qorbit'
  | 'featherweight'
  | 'eggtimer'
  | 'perfectflite'
  | 'altusmetrum'
  | 'generic'

export const SOURCE_LABELS: Record<AltimeterSource, string> = {
  qorbit: 'Qorbit Core',
  featherweight: 'Featherweight',
  eggtimer: 'Eggtimer',
  perfectflite: 'PerfectFlite',
  altusmetrum: 'Altus Metrum',
  generic: 'Generic CSV',
}

const FT_TO_M = 0.3048

type ColumnRole =
  | 'time'
  | 'altitude'
  | 'velocity'
  | 'accel'
  | 'temperature'
  | 'pressure'

/**
 * Alias patterns per role, matched against a normalised header (lowercased,
 * punctuation collapsed). Ordered: the first match wins, so put the most
 * specific pattern first.
 */
const ALIASES: Record<ColumnRole, RegExp[]> = {
  // "flight time" before bare "time" so a file with both picks the useful one.
  time: [/^flight[_ ]?time/, /^time/, /^t$/, /^seconds?$/, /^elapsed/],
  // Prefer a filtered/AGL altitude over a raw or MSL one when both exist.
  altitude: [
    /^(baro[_ ]?)?alt(itude)?[_ ]?agl/,
    /^filtered[_ ]?alt/,
    /^(baro[_ ]?)?alt(itude)?\b/,
    /^height/,
    /^agl/,
  ],
  velocity: [/^velocity/, /^speed/, /^vel\b/, /^vertical[_ ]?(velocity|speed)/],
  accel: [/^(total|resultant)[_ ]?accel/, /^accel(eration)?[_ ]?z/, /^accel(eration)?\b/, /^accel[_ ]?x/],
  temperature: [/^temp(erature)?/],
  pressure: [/^pressure/, /^baro[_ ]?pressure/],
}

/** Signatures that identify a specific vendor, checked against all headers. */
const SOURCE_SIGNATURES: { source: AltimeterSource; patterns: RegExp[] }[] = [
  { source: 'featherweight', patterns: [/featherweight/, /\braven\b/, /blue\s*raven/] },
  { source: 'eggtimer', patterns: [/eggtimer/, /\bquantum\b/, /\bproton\b/] },
  { source: 'perfectflite', patterns: [/perfectflite/, /stratologger/, /\bpnut\b/] },
  { source: 'altusmetrum', patterns: [/altus/, /telemetrum/, /telemega/, /easymini/] },
]

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** True when the header declares feet, so values need converting to metres. */
function headerIsFeet(header: string): boolean {
  const h = header.toLowerCase()
  return /\bf(ee)?t\b/.test(h) || /\(ft\)/.test(h) || /ft\/s/.test(h)
}

function findColumn(headers: string[], role: ColumnRole): string | null {
  for (const pattern of ALIASES[role]) {
    const hit = headers.find((h) => pattern.test(normaliseHeader(h)))
    if (hit) return hit
  }
  return null
}

/**
 * Identify the altimeter. Vendor signatures are checked first (a header or
 * preamble naming the device); otherwise anything parseable is 'generic'.
 */
export function detectSource(headers: string[], rawText = ''): AltimeterSource {
  const haystack = (headers.join(' ') + ' ' + rawText.slice(0, 400)).toLowerCase()
  for (const { source, patterns } of SOURCE_SIGNATURES) {
    if (patterns.some((p) => p.test(haystack))) return source
  }
  return 'generic'
}

/**
 * Reconstruct a flight state machine from altitude alone.
 *
 * Qorbit's own logs carry `state` from firmware. Third-party logs don't, so the
 * timeline that drives the charts, the event log and the 3D replay has to be
 * inferred. Deliberately conservative: it emits only states that altitude can
 * actually justify — never BALLISTIC or FAILSAFE_FIRED, which require Qorbit's
 * detection logic.
 */
function reconstructStates(
  samples: { t: number; alt: number; vel: number }[]
): string[] {
  if (samples.length === 0) return []

  const maxAlt = Math.max(...samples.map((s) => s.alt))
  const apogeeIdx = samples.findIndex((s) => s.alt === maxAlt)

  // Launch = first sustained climb above a small threshold over the pad.
  const groundAlt = samples[0].alt
  const LAUNCH_THRESHOLD_M = 3
  let launchIdx = samples.findIndex((s) => s.alt - groundAlt > LAUNCH_THRESHOLD_M)
  if (launchIdx < 0) launchIdx = 0

  // Burnout = peak upward velocity, after which the rocket is coasting.
  let burnoutIdx = launchIdx
  let peakVel = -Infinity
  for (let i = launchIdx; i <= apogeeIdx; i++) {
    if (samples[i].vel > peakVel) {
      peakVel = samples[i].vel
      burnoutIdx = i
    }
  }

  // Landing = altitude back near the pad and staying there.
  const LANDED_THRESHOLD_M = 5
  let landedIdx = samples.length - 1
  for (let i = apogeeIdx; i < samples.length; i++) {
    if (samples[i].alt - groundAlt < LANDED_THRESHOLD_M) {
      landedIdx = i
      break
    }
  }

  return samples.map((_, i) => {
    if (i < launchIdx) return 'IDLE'
    if (i <= burnoutIdx) return 'BOOST'
    if (i < apogeeIdx) return 'COAST'
    if (i === apogeeIdx) return 'APOGEE'
    if (i < landedIdx) return 'NORMAL_DESCENT'
    return 'LANDED'
  })
}

export interface ImportedFlight {
  rows: FlightRow[]
  source: AltimeterSource
  /** Fields that were derived rather than measured, for UI disclosure. */
  derived: string[]
}

/**
 * Convert a third-party altimeter CSV into Qorbit FlightRows.
 * Throws with an actionable message when the file can't be understood.
 */
export function importThirdPartyCSV(csvString: string): ImportedFlight {
  // Some altimeters emit preamble lines before the header row. Find the first
  // line that looks like a header containing a time-ish and altitude-ish column.
  const lines = csvString.trim().split(/\r?\n/)
  let headerLine = 0
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cells = lines[i].split(/[,;\t]/).map(normaliseHeader)
    const hasTime = cells.some((c) => ALIASES.time.some((p) => p.test(c)))
    const hasAlt = cells.some((c) => ALIASES.altitude.some((p) => p.test(c)))
    if (hasTime && hasAlt) {
      headerLine = i
      break
    }
  }

  const body = lines.slice(headerLine).join('\n')
  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h: string) => h.trim(),
  })

  const headers = (result.meta.fields || []).filter(Boolean)
  const timeCol = findColumn(headers, 'time')
  const altCol = findColumn(headers, 'altitude')

  if (!timeCol || !altCol) {
    throw new Error(
      'Could not find a time and altitude column in this file. ' +
        'Supported: Qorbit Core, Featherweight, Eggtimer, PerfectFlite, Altus Metrum, ' +
        'or any CSV with recognisable time and altitude columns.'
    )
  }

  const velCol = findColumn(headers, 'velocity')
  const accelCol = findColumn(headers, 'accel')
  const tempCol = findColumn(headers, 'temperature')
  const pressCol = findColumn(headers, 'pressure')

  const altInFeet = headerIsFeet(altCol)
  const velInFeet = velCol ? headerIsFeet(velCol) : false

  const num = (v: string | undefined): number => {
    const n = parseFloat((v ?? '').toString().replace(/[^0-9eE+.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const raw = result.data
    .map((r) => ({
      t: num(r[timeCol]),
      alt: num(r[altCol]) * (altInFeet ? FT_TO_M : 1),
      vel: velCol ? num(r[velCol]) * (velInFeet ? FT_TO_M : 1) : NaN,
      accel: accelCol ? num(r[accelCol]) : NaN,
      temp: tempCol ? num(r[tempCol]) : NaN,
      press: pressCol ? num(r[pressCol]) : NaN,
    }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.alt))

  if (raw.length < 2) {
    throw new Error('This file has fewer than two usable data rows.')
  }

  const derived: string[] = []

  // Derive velocity by differentiating altitude when the log doesn't carry it.
  const hasVelocity = velCol && raw.some((r) => Number.isFinite(r.vel) && r.vel !== 0)
  if (!hasVelocity) {
    derived.push('velocity')
    for (let i = 0; i < raw.length; i++) {
      const prev = raw[Math.max(0, i - 1)]
      const next = raw[Math.min(raw.length - 1, i + 1)]
      const dt = next.t - prev.t
      raw[i].vel = dt > 0 ? (next.alt - prev.alt) / dt : 0
    }
  }

  if (!accelCol) derived.push('acceleration')
  if (!tempCol) derived.push('temperature')
  if (!pressCol) derived.push('pressure')
  derived.push('flight state')

  const states = reconstructStates(raw.map((r) => ({ t: r.t, alt: r.alt, vel: r.vel })))

  // A rocket on the pad is stationary — that is certain, not an assumption.
  // A centered difference across the launch boundary otherwise smears the first
  // boost sample backwards and reports tens of m/s during IDLE, which reads as
  // a broken log. Same at rest after landing.
  for (let i = 0; i < raw.length; i++) {
    if (states[i] === 'IDLE' || states[i] === 'LANDED') raw[i].vel = 0
  }

  let runningMax = 0
  const rows: FlightRow[] = raw.map((r, i) => {
    runningMax = Math.max(runningMax, r.alt)
    const accel = Number.isFinite(r.accel) ? r.accel : 0
    return {
      timestamp_s: r.t,
      state: states[i],
      // Third-party logs rarely carry 3-axis IMU. Put whatever single-axis
      // acceleration exists on Z (the thrust axis) and leave the rest at 0
      // rather than inventing values.
      accel_x_g: 0,
      accel_y_g: 0,
      accel_z_g: accel,
      total_accel_g: Math.abs(accel),
      gyro_x_dps: 0,
      gyro_y_dps: 0,
      gyro_z_dps: 0,
      pressure_hpa: Number.isFinite(r.press) ? r.press : 0,
      temperature_c: Number.isFinite(r.temp) ? r.temp : 0,
      raw_alt_m: r.alt,
      filtered_alt_m: r.alt,
      velocity_ms: r.vel,
      max_alt_m: runningMax,
      // No third-party altimeter has Qorbit's ballistic-detection channel.
      ballistic_count: 0,
    }
  })

  const source = detectSource(headers, csvString)

  return { rows, source, derived }
}

export interface AnyParsedFlight extends ParsedFlight {
  source: AltimeterSource
  /** Empty for native Qorbit logs; lists inferred fields for imports. */
  derived: string[]
}

/**
 * Parse any supported flight log.
 *
 * Tries the strict Qorbit parser first so native logs keep their firmware-
 * reported state machine and ballistic detection verbatim, and only falls back
 * to third-party adaptation when that fails. If both fail, the third-party
 * error is surfaced — it is the more useful one for someone uploading a
 * Featherweight or Eggtimer export.
 */
export function parseAnyFlightCSV(csvString: string): AnyParsedFlight {
  try {
    const native = parseFlightCSV(csvString)
    return { ...native, source: 'qorbit', derived: [] }
  } catch {
    const imported = importThirdPartyCSV(csvString)
    return {
      rows: imported.rows,
      summary: summariseRows(imported.rows),
      source: imported.source,
      derived: imported.derived,
    }
  }
}
