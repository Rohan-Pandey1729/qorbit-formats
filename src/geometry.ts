/**
 * Rocket geometry types shared by the format importers.
 *
 * These are the shapes a design-file importer fills in. The aerodynamic maths
 * that consumes them (Barrowman CP, stability margin) is deliberately NOT part
 * of this package: this package is plumbing, not physics.
 *
 * Sign convention: all axial positions are measured from the NOSE TIP, growing
 * aft.
 */

export type NoseShape = 'ogive' | 'conical' | 'parabolic' | 'ellipsoid' | 'haack'

export interface FinSet {
  count: number
  rootChord_mm: number
  tipChord_mm: number
  /** Semi-span: fin height from the body wall to the tip. */
  span_mm: number
  /** Sweep: axial distance from the root leading edge to the tip leading edge. */
  sweep_mm: number
  /** Axial position of the fin root leading edge, measured from the nose tip. */
  positionFromNose_mm: number
}

export interface RocketGeometry {
  noseShape: NoseShape
  noseLength_mm: number
  bodyDiameter_mm: number
  bodyLength_mm: number
  fin: FinSet
  /** Measured CG (balance point) from the nose tip. Optional — if absent, the
   *  caller must supply it separately (you find it by balancing the rocket). */
  cgFromNose_mm?: number
}

export interface StabilityResult {
  cp_mm: number // center of pressure from nose tip
  cg_mm: number | null // center of gravity from nose tip (null if unknown)
  cn_total: number // total normal-force coefficient slope
  marginCalibers: number | null
  verdict: 'unstable' | 'understable' | 'stable' | 'overstable' | 'unknown'
  verdictLabel: string
}
