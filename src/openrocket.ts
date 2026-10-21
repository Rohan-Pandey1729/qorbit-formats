import { unzipSync, strFromU8 } from 'fflate'
import type { RocketGeometry, NoseShape } from './geometry'

/**
 * Parser for OpenRocket `.ork` design files.
 *
 * An .ork is a ZIP containing `rocket.ork`, an XML document. All lengths in the
 * XML are in METERS and masses in KILOGRAMS; we convert to mm / grams. We pull
 * the fields needed to (a) prefill a Qorbit rocket and (b) compute the Barrowman
 * stability margin: nose shape/length, body diameter/length, and the fin set.
 *
 * Fin axial position in OpenRocket is expressed relative to its parent tube and
 * is version-dependent, so we estimate it as the aft end of the airframe (the
 * common case) and let the user nudge it in the UI. Everything else is read
 * directly.
 */

export interface ParsedOrk {
  name: string
  diameter_mm: number | null
  length_mm: number | null
  dry_mass_g: number | null
  geometry: RocketGeometry
}

const M_TO_MM = 1000
const KG_TO_G = 1000

function num(el: Element | null | undefined, tag: string): number | null {
  if (!el) return null
  const child = el.getElementsByTagName(tag)[0]
  if (!child || !child.textContent) return null
  const v = parseFloat(child.textContent.trim())
  return isNaN(v) ? null : v
}

function text(el: Element | null | undefined, tag: string): string | null {
  if (!el) return null
  const child = el.getElementsByTagName(tag)[0]
  return child?.textContent?.trim() ?? null
}

function mapNoseShape(s: string | null): NoseShape {
  switch ((s || '').toLowerCase()) {
    case 'conical': return 'conical'
    case 'parabolic': return 'parabolic'
    case 'ellipsoid': return 'ellipsoid'
    case 'haack': return 'haack'
    case 'ogive':
    default: return 'ogive'
  }
}

/**
 * Extract the rocket.ork XML string from a .ork file.
 *
 * Modern OpenRocket writes a ZIP archive, but a .ork can also be plain
 * uncompressed XML (older versions, and files that have been hand-edited or
 * re-saved by other tools). unzipSync throws on those, which surfaced to the
 * user as "Could not read that .ork file" — so sniff for raw XML first.
 */
export function orkXmlFromArchive(data: Uint8Array): string {
  // ZIP local file header: "PK\x03\x04".
  const isZip =
    data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04

  if (!isZip) {
    const asText = strFromU8(data)
    if (asText.includes('<openrocket')) return asText
    throw new Error(
      'That file is neither a valid OpenRocket archive nor OpenRocket XML. Re-save it from OpenRocket as .ork and try again.'
    )
  }

  const files = unzipSync(data)
  const key =
    Object.keys(files).find((k) => k.toLowerCase().endsWith('rocket.ork')) ||
    Object.keys(files).find((k) => k.toLowerCase().endsWith('.ork')) ||
    Object.keys(files).find((k) => strFromU8(files[k]).includes('<openrocket'))
  if (!key) throw new Error('No rocket.ork XML found inside the .ork archive.')
  return strFromU8(files[key])
}

/**
 * A DOMParser-shaped XML parser. Browsers provide this globally; on Node pass
 * one in (for example `new (require('@xmldom/xmldom').DOMParser)()`), since
 * Node has no global DOMParser.
 */
export interface XmlParser {
  parseFromString(source: string, mimeType: string): Document
}

export interface ParseOrkOptions {
  /** Defaults to the global DOMParser when one exists. */
  parser?: XmlParser
}

export function parseOrk(data: Uint8Array, options: ParseOrkOptions = {}): ParsedOrk {
  const xml = orkXmlFromArchive(data)
  const parser =
    options.parser ??
    (typeof DOMParser !== 'undefined' ? new DOMParser() : null)
  if (!parser) {
    throw new Error(
      'No XML parser available. Pass options.parser (for example @xmldom/xmldom\'s DOMParser) when running outside a browser.'
    )
  }
  const doc = parser.parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.getElementsByTagName('openrocket')[0]) {
    throw new Error("This doesn't look like a valid OpenRocket (.ork) file.")
  }

  const rocketEl = doc.getElementsByTagName('rocket')[0]
  const name = text(rocketEl, 'name') || 'Imported rocket'

  // --- Nose ---
  const noseEl = doc.getElementsByTagName('nosecone')[0] || null
  const noseLen_m = num(noseEl, 'length') ?? 0
  const noseShape = mapNoseShape(text(noseEl, 'shape'))
  // aftradius can be "auto"; fall back to the first body tube radius.
  let radius_m = parseFloat(text(noseEl, 'aftradius') || '') || NaN

  // --- Body tubes: total body length + diameter ---
  const tubes = Array.from(doc.getElementsByTagName('bodytube'))
  let bodyLen_m = 0
  for (const t of tubes) {
    bodyLen_m += num(t, 'length') ?? 0
    const r = parseFloat(text(t, 'radius') || '')
    if (!isNaN(r) && isNaN(radius_m)) radius_m = r
  }
  if (isNaN(radius_m)) radius_m = 0.012 // last-resort ~24mm tube

  const diameter_mm = radius_m * 2 * M_TO_MM
  const totalLen_mm = (noseLen_m + bodyLen_m) * M_TO_MM

  // --- Fins (first trapezoidal fin set) ---
  const finEl = doc.getElementsByTagName('trapezoidfinset')[0] || null
  const finCount = Math.round(num(finEl, 'fincount') ?? 3)
  const rootChord_mm = (num(finEl, 'rootchord') ?? 0) * M_TO_MM
  const tipChord_mm = (num(finEl, 'tipchord') ?? 0) * M_TO_MM
  const span_mm = (num(finEl, 'height') ?? 0) * M_TO_MM
  let sweep_mm = (num(finEl, 'sweeplength') ?? NaN) * M_TO_MM
  if (isNaN(sweep_mm)) {
    const angleDeg = num(finEl, 'sweepangle')
    sweep_mm = angleDeg != null ? span_mm * Math.tan((angleDeg * Math.PI) / 180) : 0
  }
  // Estimate the fin root LE at the aft end of the airframe (common case).
  const positionFromNose_mm = Math.max(0, totalLen_mm - rootChord_mm)

  // --- Mass (optional rocket-level override) ---
  const overrideMass = num(rocketEl, 'overridemass')
  const dry_mass_g = overrideMass != null ? overrideMass * KG_TO_G : null

  const geometry: RocketGeometry = {
    noseShape,
    noseLength_mm: noseLen_m * M_TO_MM,
    bodyDiameter_mm: diameter_mm,
    bodyLength_mm: bodyLen_m * M_TO_MM,
    fin: { count: finCount, rootChord_mm, tipChord_mm, span_mm, sweep_mm, positionFromNose_mm },
  }

  return {
    name,
    diameter_mm: diameter_mm || null,
    length_mm: totalLen_mm || null,
    dry_mass_g,
    geometry,
  }
}
