import { describe, expect, it } from 'vitest'
import { formatHit, isBinary, parseForbidden, scanText } from './scan.ts'

describe('no-real-site scanning', () => {
  const forbidden = parseForbidden('# comment\nalpha-111\n\nbeta-222\n')

  it('ignores comments and blank lines in the list', () => {
    expect(forbidden).toEqual(['alpha-111', 'beta-222'])
  })

  it('reports the file, the line and which entry matched', () => {
    const hits = scanText('notes.md', 'one\ntwo beta-222 three\nfour', forbidden)

    expect(hits).toEqual([{ file: 'notes.md', line: 2, entry: 2 }])
  })

  it('reports every match on a line, once per entry', () => {
    expect(scanText('a', 'alpha-111 and beta-222 and alpha-111', forbidden)).toHaveLength(2)
  })

  it('ignores a number that sits inside a longer number', () => {
    const numbers = parseForbidden('12.345\n')

    expect(scanText('a', 'id 9912.34577', numbers)).toEqual([])
    expect(scanText('a', 'lat 12.345 lon', numbers)).toHaveLength(1)
    expect(scanText('a', 'lat 12.34599 lon', numbers)).toHaveLength(1)
    expect(scanText('a', 'lat 912.345', numbers)).toHaveLength(1)
    expect(scanText('a', 'id 9912.34577 then 12.345', numbers)).toHaveLength(1)
  })

  it('does not apply the digit rule to a value that is not a plain number', () => {
    expect(scanText('a', 'x 1alpha-1112', parseForbidden('alpha-111\n'))).toHaveLength(1)
  })

  it('says nothing for clean text', () => {
    expect(scanText('a', 'nothing to see', forbidden)).toEqual([])
  })

  it('formats a hit without ever containing the value', () => {
    const [hit] = scanText('notes.md', 'x alpha-111', forbidden)

    expect(formatHit(hit!)).toBe('notes.md:1 holds forbidden value #1')
  })

  it('treats a file with a NUL byte as binary', () => {
    expect(isBinary(new Uint8Array([104, 105, 0, 1]))).toBe(true)
    expect(isBinary(new TextEncoder().encode('plain text'))).toBe(false)
  })
})
