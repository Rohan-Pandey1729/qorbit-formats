import Papa from 'papaparse'

const REQUIRED_COLUMNS = [
  'timestamp_s', 'state', 'accel_x_g', 'accel_y_g', 'accel_z_g', 'total_accel_g',
  'gyro_x_dps', 'gyro_y_dps', 'gyro_z_dps', 'pressure_hpa', 'temperature_c',
  'raw_alt_m', 'filtered_alt_m', 'velocity_ms', 'max_alt_m', 'ballistic_count',
]

export interface FlightRow {
  timestamp_s: number
  state: string
  accel_x_g: number
  accel_y_g: number
  accel_z_g: number
  total_accel_g: number
  gyro_x_dps: number
  gyro_y_dps: number
  gyro_z_dps: number
  pressure_hpa: number
  temperature_c: number
  raw_alt_m: number
  filtered_alt_m: number
  velocity_ms: number
  max_alt_m: number
  ballistic_count: number
}

export interface StateTransition {
  state: string
  timestamp: number
  altitude: number
  velocity: number
}

export interface FlightSummary {
  max_altitude_m: number
  apogee_time_s: number
  launch_time_s: number
  descent_rate_ms: number
  duration_s: number
  outcome: 'nominal' | 'ballistic_saved' | 'ballistic_impact' | 'other'
  failsafe_altitude_m: number | null
  state_transitions: StateTransition[]
  ballistic_detected: boolean
}

export interface ParsedFlight {
  rows: FlightRow[]
  summary: FlightSummary
}

export function parseFlightCSV(csvString: string): ParsedFlight {
  const result = Papa.parse<Record<string, string>>(csvString.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  if (result.errors.length > 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`)
  }

  const headers = result.meta.fields || []
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
  if (missing.length > 0) {
    throw new Error(
      `This doesn't look like a Qorbit Core flight log. Missing columns: ${missing.join(', ')}. ` +
      `Expected columns: ${REQUIRED_COLUMNS.join(', ')}`
    )
  }

  const rows: FlightRow[] = result.data.map((row) => ({
    timestamp_s: parseFloat(row.timestamp_s),
    state: row.state.trim(),
    accel_x_g: parseFloat(row.accel_x_g),
    accel_y_g: parseFloat(row.accel_y_g),
    accel_z_g: parseFloat(row.accel_z_g),
    total_accel_g: parseFloat(row.total_accel_g),
    gyro_x_dps: parseFloat(row.gyro_x_dps),
    gyro_y_dps: parseFloat(row.gyro_y_dps),
    gyro_z_dps: parseFloat(row.gyro_z_dps),
    pressure_hpa: parseFloat(row.pressure_hpa),
    temperature_c: parseFloat(row.temperature_c),
    raw_alt_m: parseFloat(row.raw_alt_m),
    filtered_alt_m: parseFloat(row.filtered_alt_m),
    velocity_ms: parseFloat(row.velocity_ms),
    max_alt_m: parseFloat(row.max_alt_m),
    ballistic_count: parseInt(row.ballistic_count, 10),
  }))

  return { rows, summary: summariseRows(rows) }
}

/**
 * Derive flight summary metrics from parsed rows.
 *
 * Split out from parseFlightCSV so third-party imports (lib/flight-import.ts)
 * produce summaries by exactly the same rules as native Qorbit logs — the
 * charts, logbook and reports all read this shape.
 */
export function summariseRows(rows: FlightRow[]): FlightSummary {
  let maxAlt = 0
  let apogeeTime = 0
  let launchTime = 0
  let failsafeAlt: number | null = null
  let ballisticDetected = false
  const normalDescentVelocities: number[] = []
  const stateTransitions: StateTransition[] = []
  let prevState = ''

  for (const row of rows) {
    if (row.filtered_alt_m > maxAlt) {
      maxAlt = row.filtered_alt_m
      apogeeTime = row.timestamp_s
    }

    if (row.state === 'BOOST' && launchTime === 0) {
      launchTime = row.timestamp_s
    }

    if (row.state === 'NORMAL_DESCENT') {
      normalDescentVelocities.push(Math.abs(row.velocity_ms))
    }

    // Only the BALLISTIC state marks a genuine ballistic-descent event. The
    // apogee deploy logs as PRIMARY_FIRED and the backup deploy as
    // FAILSAFE_FIRED, so a normal flight (PRIMARY_FIRED only, no BALLISTIC) is
    // never ballistic. See docs/FLIGHT_LOG_FORMAT.md.
    if (row.state === 'BALLISTIC') {
      ballisticDetected = true
    }

    // FAILSAFE_FIRED = the backup channel firing — the altitude at which Qorbit
    // caught a ballistic descent.
    if (row.state === 'FAILSAFE_FIRED' && failsafeAlt === null) {
      failsafeAlt = row.filtered_alt_m
    }

    if (row.state !== prevState) {
      stateTransitions.push({
        state: row.state,
        timestamp: row.timestamp_s,
        altitude: row.filtered_alt_m,
        velocity: row.velocity_ms,
      })
      prevState = row.state
    }
  }

  // Flight duration is liftoff to touchdown, not liftoff to end of recording.
  // Altimeters keep logging on the ground long after the rocket has landed, so
  // using the last row inflates duration by however long it sat in the field.
  const lastRow = rows[rows.length - 1]
  const landedRow = rows.find((r) => r.state === 'LANDED' && r.timestamp_s >= launchTime)
  const touchdownTime = landedRow ? landedRow.timestamp_s : lastRow ? lastRow.timestamp_s : 0
  const duration = rows.length > 0 ? touchdownTime - launchTime : 0
  const avgDescentRate =
    normalDescentVelocities.length > 0
      ? normalDescentVelocities.reduce((a, b) => a + b, 0) / normalDescentVelocities.length
      : 0

  // Classification keys off the BALLISTIC state. If the backup channel fired
  // (FAILSAFE_FIRED) after a ballistic descent, Qorbit saved it; a ballistic
  // descent with no backup fire is an impact; no ballistic descent at all is a
  // nominal flight (regardless of the normal PRIMARY_FIRED apogee deploy).
  const backupFired = rows.some((r) => r.state === 'FAILSAFE_FIRED')
  const outcome: FlightSummary['outcome'] = ballisticDetected
    ? backupFired
      ? 'ballistic_saved'
      : 'ballistic_impact'
    : 'nominal'

  return {
    max_altitude_m: maxAlt,
    apogee_time_s: apogeeTime - launchTime,
    launch_time_s: launchTime,
    descent_rate_ms: avgDescentRate,
    duration_s: duration,
    outcome,
    failsafe_altitude_m: failsafeAlt,
    state_transitions: stateTransitions,
    ballistic_detected: ballisticDetected,
  }
}
