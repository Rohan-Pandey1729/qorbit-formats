# Qorbit Core Flight Log Format

The single source of truth for the CSV contract between the **firmware**
(`pylon-firmware`, which writes the log) and the **platform**
(`lib/flight-parser.ts`, which reads it). Keep all three in sync: firmware
output, this doc, and the parser.

## File

- Plain CSV, UTF-8, one header row, comma-separated.
- One row per fusion tick (the firmware logs at ~20 Hz).
- Column order is not significant — the parser matches by header name — but the
  header names below are **required**.

## Columns

| Column | Unit | Meaning |
|---|---|---|
| `timestamp_s` | s | time since power-on / log start |
| `state` | enum | flight state at this tick (see below) |
| `raw_alt_m` | m AGL | raw barometric altitude |
| `filtered_alt_m` | m AGL | estimator (fused) altitude |
| `velocity_ms` | m/s | estimator vertical velocity (+ up) |
| `total_accel_g` | g | total specific-force magnitude (1 g at rest) |
| `accel_x_g` / `accel_y_g` / `accel_z_g` | g | per-axis acceleration |
| `gyro_x_dps` / `gyro_y_dps` / `gyro_z_dps` | °/s | per-axis angular rate |
| `pressure_hpa` | hPa | barometric pressure |
| `temperature_c` | °C | sensor temperature |
| `max_alt_m` | m AGL | running max altitude |
| `ballistic_count` | int | consecutive ballistic-threshold samples |

## State vocabulary (canonical)

These are the exact strings the firmware's `pylon_state_name()` emits in the
`state` column:

| State | Meaning |
|---|---|
| `BOOT`, `SELF_TEST`, `SAFE_IDLE`, `ARMED` | pre-flight |
| `LAUNCH_DETECT` | launch acceleration detected |
| `BOOST` | motor burning |
| `COAST` | burnout, coasting to apogee |
| `APOGEE_CONFIRMED` | apogee detected (velocity sign change confirmed) |
| `PRIMARY_FIRED` | **Channel 1 fired** — primary deploy at apogee (normal) |
| `NORMAL_DESCENT` | descending under recovery, below the ballistic threshold |
| `BALLISTIC` | **ballistic descent detected** (descent rate over threshold) |
| `FAILSAFE_FIRED` | **Channel 2 fired** — backup deploy after a ballistic descent |
| `LANDED` | on the ground |
| `FAULT` | self-test / in-flight fault |

### The critical distinction

`PRIMARY_FIRED` (Ch1, every normal flight) and `FAILSAFE_FIRED` (Ch2, only on a
ballistic save) are **different strings**. Earlier firmware aliased both to
`FAILSAFE_FIRED`, which made the platform classify every nominal flight as a
"ballistic save." Do not re-alias them.

## Outcome classification (what the parser does)

Outcome is keyed on the **`BALLISTIC`** state, never on `FAILSAFE_FIRED` alone:

| Condition | Outcome |
|---|---|
| no `BALLISTIC` state anywhere | `nominal` |
| `BALLISTIC` present **and** `FAILSAFE_FIRED` present | `ballistic_saved` |
| `BALLISTIC` present, no `FAILSAFE_FIRED` | `ballistic_impact` |

`failsafe_altitude_m` (the "Qorbit saved this flight" altitude) is taken from the
first `FAILSAFE_FIRED` row.

## Samples & template

- `public/samples/sample-flight-nominal.csv` — a real nominal flight (generated
  from the firmware host sim).
- `public/samples/sample-flight-ballistic-saved.csv` — a real ballistic save.
- `public/samples/qorbit-flight-log-template.csv` — header + a few example rows
  for hand-entry or conversion from another altimeter.

Regenerate the samples from the firmware to guarantee they match production:

```bash
# in pylon-firmware/firmware
make sim
PYLON_SIM_PROFILE=nominal   ./build/pylon_firmware 2>/dev/null > .../public/samples/sample-flight-nominal.csv
PYLON_SIM_PROFILE=ballistic ./build/pylon_firmware 2>/dev/null > .../public/samples/sample-flight-ballistic-saved.csv
```
