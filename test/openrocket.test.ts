import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { parseOrk, orkXmlFromArchive } from '../src/openrocket'

/**
 * Builds a minimal .ork archive in memory so the reader is tested without
 * shipping a binary fixture. Lengths are metres and masses kilograms, as
 * OpenRocket writes them.
 */
function makeOrk(xml: string): Uint8Array {
  return zipSync({ 'rocket.ork': strToU8(xml) })
}

const MINIMAL = `<?xml version="1.0" encoding="UTF-8"?>
<openrocket version="1.5" creator="test">
  <rocket>
    <name>Test Bird</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone>
            <length>0.15</length>
            <shape>ogive</shape>
            <aftradius>0.0185</aftradius>
          </nosecone>
          <bodytube>
            <length>0.6</length>
            <radius>0.0185</radius>
            <subcomponents>
              <trapezoidfinset>
                <fincount>4</fincount>
                <rootchord>0.1</rootchord>
                <tipchord>0.05</tipchord>
                <height>0.06</height>
                <sweeplength>0.04</sweeplength>
              </trapezoidfinset>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

// xmldom's DOMParser is structurally compatible with the browser's for the
// read-only calls this library makes.
const parser = new DOMParser() as unknown as { parseFromString(s: string, m: string): Document }

describe('orkXmlFromArchive', () => {
  it('finds rocket.ork inside the archive', () => {
    const xml = orkXmlFromArchive(makeOrk(MINIMAL))
    expect(xml).toContain('<openrocket')
    expect(xml).toContain('Test Bird')
  })

  it('throws on an archive with no ork XML', () => {
    const notAnOrk = zipSync({ 'readme.txt': strToU8('nope') })
    expect(() => orkXmlFromArchive(notAnOrk)).toThrow(/No rocket.ork XML/)
  })
})

describe('parseOrk with an injected parser', () => {
  it('reads the name, geometry and fin set, converting metres to mm', () => {
    const d = parseOrk(makeOrk(MINIMAL), { parser })

    expect(d.name).toBe('Test Bird')
    expect(d.diameter_mm).toBeCloseTo(37, 0)      // 0.0185 m radius -> 37 mm dia
    expect(d.geometry.noseLength_mm).toBeCloseTo(150, 0)
    expect(d.geometry.noseShape).toBe('ogive')
    expect(d.geometry.bodyLength_mm).toBeCloseTo(600, 0)
    expect(d.geometry.fin.count).toBe(4)
    expect(d.geometry.fin.rootChord_mm).toBeCloseTo(100, 0)
    expect(d.geometry.fin.tipChord_mm).toBeCloseTo(50, 0)
    expect(d.geometry.fin.span_mm).toBeCloseTo(60, 0)
    expect(d.geometry.fin.sweep_mm).toBeCloseTo(40, 0)
  })

  it('rejects XML that is not an OpenRocket document', () => {
    const wrong = makeOrk('<?xml version="1.0"?><notrocket><a/></notrocket>')
    expect(() => parseOrk(wrong, { parser })).toThrow(/OpenRocket/)
  })
})
