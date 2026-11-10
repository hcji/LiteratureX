import { describe, expect, it } from 'vitest'
import { parseBibtex } from '../../src/main/services/importExport'

describe('BibTeX parsing', () => {
  it('parses entries, nested braces, quoted values and concatenation', () => {
    const entries = parseBibtex(`
@article{ji2024deep,
  title = {{Deep Learning} for Predicting Tandem Mass Spectra},
  author = {Hongchao Ji and Mei Wang},
  journal = "Journal of Natural Products",
  year = {2024},
  volume = {87},
  number = {4},
  pages = {1001--1012},
  doi = {10.1021/acs.jnatprod.4c00123},
  keywords = {deep learning, MS/MS}
}

@misc{note1,
  title = "A {Nested {Brace}} Title",
  author = {Someone}
}
`)
    expect(entries).toHaveLength(2)
    expect(entries[0].type).toBe('article')
    expect(entries[0].key).toBe('ji2024deep')
    expect(entries[0].fields.title).toContain('Deep Learning')
    expect(entries[0].fields.author).toBe('Hongchao Ji and Mei Wang')
    expect(entries[0].fields.pages).toBe('1001--1012')
    expect(entries[1].fields.title).toBe('A Nested Brace Title')
  })
})
