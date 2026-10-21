/**
 * qorbit-formats: readers for the file formats of hobby and student rocketry.
 *
 * Flight logs from the altimeters people actually fly, and design files from
 * the tools people actually design in. No physics, no network, no state.
 */

// Flight logs
export {
  parseFlightCSV,
  summariseRows,
} from './flight-parser'
export type {
  FlightRow,
  FlightSummary,
  ParsedFlight,
  StateTransition,
} from './flight-parser'

// Third-party altimeter logs
export {
  detectSource,
  importThirdPartyCSV,
  parseAnyFlightCSV,
  SOURCE_LABELS,
} from './flight-import'
export type {
  AltimeterSource,
  AnyParsedFlight,
  ImportedFlight,
} from './flight-import'

// Design files
export { parseOrk, orkXmlFromArchive } from './openrocket'
export type { ParsedOrk, ParseOrkOptions, XmlParser } from './openrocket'

// Shared geometry types
export type {
  FinSet,
  NoseShape,
  RocketGeometry,
  StabilityResult,
} from './geometry'
