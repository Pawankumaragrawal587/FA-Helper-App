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
})
