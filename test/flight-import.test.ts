import { describe, it, expect } from 'vitest'
import { importThirdPartyCSV, detectSource, parseAnyFlightCSV } from '../src/flight-import'

/** Synthetic up-and-down flight: climbs to ~100 m, comes back to the pad. */
function trajectoryCSV(opts: {
  header: string
  altScale?: number
  withVelocity?: boolean
  preamble?: string
}) {
  const { header, altScale = 1, withVelocity = false, preamble = '' } = opts
  const lines: string[] = []
  if (preamble) lines.push(preamble)
  lines.push(header)
  // 0-2s climb, apogee at t=2, descent to ground by t=6
  const pts: [number, number][] = [
    [0, 0], [0.5, 20], [1.0, 55], [1.5, 85], [2.0, 100],
    [3.0, 80], [4.0, 55], [5.0, 25], [6.0, 0],
  ]
  for (const [t, alt] of pts) {
    const a = alt * altScale
    lines.push(withVelocity ? `${t},${a},0` : `${t},${a}`)
  }
  return lines.join('\n')
}

describe('detectSource', () => {
  it('identifies vendors from header text', () => {
    expect(detectSource(['Time (s)', 'Featherweight Alt'])).toBe('featherweight')
    expect(detectSource(['time', 'altitude'], 'Eggtimer Quantum export')).toBe('eggtimer')
    expect(detectSource(['Time', 'Alt'], 'PerfectFlite StratoLogger')).toBe('perfectflite')
    expect(detectSource(['time', 'height'], 'TeleMetrum v3')).toBe('altusmetrum')
  })

  it('falls back to generic for unrecognised files', () => {
    expect(detectSource(['Time (s)', 'Altitude (ft)'])).toBe('generic')
  })
})

describe('importThirdPartyCSV', () => {
  it('imports a minimal time+altitude CSV', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    expect(rows).toHaveLength(9)
    expect(rows[4].filtered_alt_m).toBeCloseTo(100, 5)
  })

  it('converts feet to metres when the header says feet', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (ft)' }))
    // 100 ft -> 30.48 m
    expect(rows[4].filtered_alt_m).toBeCloseTo(30.48, 4)
  })

  it('leaves metres alone', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Baro Alt (m)' }))
    expect(rows[4].filtered_alt_m).toBeCloseTo(100, 5)
  })

  it('derives velocity when the log has none', () => {
    const { rows, derived } = importThirdPartyCSV(
      trajectoryCSV({ header: 'Time (s),Altitude (m)' })
    )
    expect(derived).toContain('velocity')
    // Climbing early, descending after apogee.
    expect(rows[1].velocity_ms).toBeGreaterThan(0)
    expect(rows[6].velocity_ms).toBeLessThan(0)
  })

  it('skips preamble lines before the real header', () => {
    const { rows } = importThirdPartyCSV(
      trajectoryCSV({
        header: 'Time (s),Altitude (m)',
        preamble: 'Eggtimer Quantum\nFlight 004\nSerial 12345',
      })
    )
    expect(rows).toHaveLength(9)
    expect(rows[4].filtered_alt_m).toBeCloseTo(100, 5)
  })

  it('reconstructs a plausible state machine', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    const states = rows.map((r) => r.state)
    expect(states).toContain('BOOST')
    expect(states).toContain('APOGEE')
    expect(states).toContain('NORMAL_DESCENT')
    // APOGEE must land on the highest sample.
    expect(rows[states.indexOf('APOGEE')].filtered_alt_m).toBeCloseTo(100, 5)
  })

  it('reports zero velocity while on the pad and after landing', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    for (const r of rows) {
      if (r.state === 'IDLE' || r.state === 'LANDED') {
        expect(r.velocity_ms).toBe(0)
      }
    }
  })

  it('never fabricates a ballistic event on an imported log', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    expect(rows.every((r) => r.ballistic_count === 0)).toBe(true)
    expect(rows.some((r) => r.state === 'BALLISTIC')).toBe(false)
    expect(rows.some((r) => r.state === 'FAILSAFE_FIRED')).toBe(false)
  })

  it('tracks a running max altitude', () => {
    const { rows } = importThirdPartyCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    expect(rows[0].max_alt_m).toBeCloseTo(0, 5)
    expect(rows[rows.length - 1].max_alt_m).toBeCloseTo(100, 5)
    // Monotonic non-decreasing.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].max_alt_m).toBeGreaterThanOrEqual(rows[i - 1].max_alt_m)
    }
  })

  it('throws an actionable error when columns are unrecognisable', () => {
    expect(() => importThirdPartyCSV('foo,bar\n1,2')).toThrow(/time and altitude/i)
  })

  it('throws when there is too little data', () => {
    expect(() => importThirdPartyCSV('Time (s),Altitude (m)\n0,0')).toThrow(/two usable data rows/i)
  })
})

describe('parseAnyFlightCSV', () => {
  it('routes a third-party log through the importer', () => {
    const parsed = parseAnyFlightCSV(trajectoryCSV({ header: 'Time (s),Altitude (ft)' }))
    expect(parsed.source).toBe('generic')
    expect(parsed.derived.length).toBeGreaterThan(0)
    expect(parsed.summary.max_altitude_m).toBeCloseTo(30.48, 4)
  })

  it('classifies an imported flight as nominal, never as a save', () => {
    const parsed = parseAnyFlightCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    expect(parsed.summary.outcome).toBe('nominal')
    expect(parsed.summary.ballistic_detected).toBe(false)
  })

  it('produces state transitions the timeline can render', () => {
    const parsed = parseAnyFlightCSV(trajectoryCSV({ header: 'Time (s),Altitude (m)' }))
    expect(parsed.summary.state_transitions.length).toBeGreaterThan(1)
  })
})
