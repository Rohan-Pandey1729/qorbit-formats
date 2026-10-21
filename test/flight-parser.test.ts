import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseFlightCSV } from '../src/flight-parser'

const sample = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')

// Canonical header from the firmware logger.
const HEADER =
  'timestamp_s,state,raw_alt_m,filtered_alt_m,velocity_ms,total_accel_g,' +
  'accel_x_g,accel_y_g,accel_z_g,gyro_x_dps,gyro_y_dps,gyro_z_dps,' +
  'pressure_hpa,temperature_c,max_alt_m,ballistic_count'

// Build a minimal CSV from rows of [state, alt, velocity]; other columns are 0.
function csv(rows: Array<[string, number, number]>, startT = 0): string {
  const lines = rows.map(([state, alt, vel], i) => {
    const t = (startT + i * 0.05).toFixed(3)
    return `${t},${state},${alt},${alt},${vel},1,0,0,1,0,0,0,1013,20,${alt},0`
  })
  return [HEADER, ...lines].join('\n')
}

describe('parseFlightCSV outcome classification', () => {
  it('classifies a real nominal firmware log as nominal (PRIMARY_FIRED is not ballistic)', () => {
    const parsed = parseFlightCSV(sample('sample-flight-nominal.csv'))
    expect(parsed.summary.outcome).toBe('nominal')
    expect(parsed.summary.ballistic_detected).toBe(false)
    // A nominal flight DOES contain a PRIMARY_FIRED row — it must not flip outcome.
    expect(parsed.rows.some((r) => r.state === 'PRIMARY_FIRED')).toBe(true)
  })

  it('classifies a ballistic-saved firmware log as ballistic_saved', () => {
    const parsed = parseFlightCSV(sample('sample-flight-ballistic-saved.csv'))
    expect(parsed.summary.outcome).toBe('ballistic_saved')
    expect(parsed.summary.ballistic_detected).toBe(true)
    expect(parsed.summary.failsafe_altitude_m).not.toBeNull()
  })

  it('PRIMARY_FIRED without BALLISTIC stays nominal (regression for the misclassification bug)', () => {
    const parsed = parseFlightCSV(
      csv([
        ['BOOST', 10, 50],
        ['COAST', 100, 5],
        ['APOGEE_CONFIRMED', 120, 0],
        ['PRIMARY_FIRED', 119, -1],
        ['NORMAL_DESCENT', 60, -6],
        ['LANDED', 0, 0],
      ])
    )
    expect(parsed.summary.outcome).toBe('nominal')
  })

  it('BALLISTIC with a backup fire is ballistic_saved', () => {
    const parsed = parseFlightCSV(
      csv([
        ['BOOST', 10, 50],
        ['COAST', 120, 5],
        ['PRIMARY_FIRED', 119, -1],
        ['BALLISTIC', 100, -15],
        ['FAILSAFE_FIRED', 90, -15],
        ['NORMAL_DESCENT', 40, -6],
        ['LANDED', 0, 0],
      ])
    )
    expect(parsed.summary.outcome).toBe('ballistic_saved')
    expect(parsed.summary.failsafe_altitude_m).toBe(90)
  })

  it('BALLISTIC with no backup fire is ballistic_impact', () => {
    const parsed = parseFlightCSV(
      csv([
        ['BOOST', 10, 50],
        ['COAST', 120, 5],
        ['PRIMARY_FIRED', 119, -1],
        ['BALLISTIC', 100, -18],
        ['BALLISTIC', 20, -30],
      ])
    )
    expect(parsed.summary.outcome).toBe('ballistic_impact')
  })

  it('rejects a CSV missing required columns', () => {
    expect(() => parseFlightCSV('timestamp_s,state\n0,BOOST')).toThrow(/Qorbit Core flight log/)
  })
})

describe('flight duration', () => {
  it('measures liftoff to touchdown, not to the end of the recording', () => {
    // 0.05 s per row. Liftoff at row 1, touchdown at row 5, then 4 rows of the
    // altimeter sitting on the ground still logging.
    const parsed = parseFlightCSV(
      csv([
        ['IDLE', 0, 0],
        ['BOOST', 10, 50],
        ['COAST', 100, 5],
        ['APOGEE_CONFIRMED', 120, 0],
        ['NORMAL_DESCENT', 60, -6],
        ['LANDED', 0, 0],
        ['LANDED', 0, 0],
        ['LANDED', 0, 0],
        ['LANDED', 0, 0],
      ])
    )
    // liftoff 0.05 s, touchdown 0.25 s
    expect(parsed.summary.duration_s).toBeCloseTo(0.2, 5)
  })

  it('falls back to the last sample when the log never reaches LANDED', () => {
    const parsed = parseFlightCSV(
      csv([
        ['BOOST', 10, 50],
        ['COAST', 100, 5],
        ['APOGEE_CONFIRMED', 120, 0],
        ['NORMAL_DESCENT', 60, -6],
      ])
    )
    expect(parsed.summary.duration_s).toBeCloseTo(0.15, 5)
  })
})
