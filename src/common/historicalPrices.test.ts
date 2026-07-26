import { describe, expect, it } from 'vitest'

import { parseHistoricalPriceCsv } from './historicalPrices'

const sampleCsv = `Date,Close/Last,Volume,Open,High,Low
07/24/2026,$86.88,4166916,$81.43,$87.09,$81.43
12/31/2025,$162.14,1372626,$163.00,$163.2611,$161.5342
07/26/2021,$267.54,813743,$270.87,$270.87,$265.24
`

describe('parseHistoricalPriceCsv', () => {
  it('parses historical price rows and sorts them by date', () => {
    const parsed = parseHistoricalPriceCsv(sampleCsv)

    expect(parsed.reportName).toBe('Historical Prices')
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.rows[0]).toMatchObject({
      date: '2021-07-26',
      closePriceUsd: 267.54,
      highPriceUsd: 270.87,
    })
    expect(parsed.rows.at(-1)).toMatchObject({
      date: '2026-07-24',
      closePriceUsd: 86.88,
      highPriceUsd: 87.09,
    })
  })

  it('preserves the provided stock symbol and ignores incomplete rows', () => {
    const csv = `Date,Close/Last,Volume,Open,High,Low
07-24-2026,$86.88,4166916,$81.43,$87.09,$81.43
07/25/2026,$87.10,4000000,$86.00,,$85.50
`

    const parsed = parseHistoricalPriceCsv(csv, 'GOOG')

    expect(parsed.rows).toEqual([
      {
        stockSymbol: 'GOOG',
        date: '2026-07-24',
        closePriceUsd: 86.88,
        highPriceUsd: 87.09,
      },
    ])
  })

  it('throws when a historical price date is invalid', () => {
    const invalidDateCsv = `Date,Close/Last,Volume,Open,High,Low
2026-07-24,$86.88,4166916,$81.43,$87.09,$81.43
`

    expect(() => parseHistoricalPriceCsv(invalidDateCsv)).toThrow(
      'Unable to parse historical price date "2026-07-24".',
    )
  })

  it('throws when a USD amount cannot be parsed', () => {
    const invalidAmountCsv = `Date,Close/Last,Volume,Open,High,Low
07/24/2026,$86.88,4166916,$81.43,not-a-number,$81.43
`

    expect(() => parseHistoricalPriceCsv(invalidAmountCsv)).toThrow(
      'Unable to parse USD amount "not-a-number".',
    )
  })

  it('throws when no complete rows are available', () => {
    const incompleteCsv = `Date,Close/Last,Volume,Open,High,Low
07/24/2026,$86.88,4166916,$81.43,,$81.43
`

    expect(() => parseHistoricalPriceCsv(incompleteCsv)).toThrow(
      'No historical price rows were found in the uploaded CSV.',
    )
  })
})
