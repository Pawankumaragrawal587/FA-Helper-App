import { describe, expect, it } from 'vitest'

import {
  getCapitalGainsExchangeRate,
  getExchangeRateOnOrBefore,
  getMaxInrAmountForRange,
  getPreviousMonthEnd,
  parseExchangeRateCsv,
} from './exchangeRates'

const sampleCsv = `DATE,PDF FILE,TT BUY,TT SELL,BILL BUY,BILL SELL,FOREX TRAVEL CARD BUY,FOREX TRAVEL CARD SELL,CN BUY,CN SELL
2020-01-04 09:00,example.pdf,0.00,0.00,71.29,72.34,70.70,72.55,70.40,72.70
2020-01-06 09:00,example.pdf,71.65,72.50,71.59,72.65,71.00,72.85,70.70,73.00
2020-01-17 09:00,example.pdf,70.58,71.43,70.52,71.57,69.9,71.8,69.6,71.9
2020-01-18 09:00,example.pdf,0,0,70.54,71.59,69.9,71.8,69.6,71.9
2025-10-31 09:00,example.pdf,72.15,72.75,71.75,73.15,71.45,73.35,71.05,73.65
`

describe('parseExchangeRateCsv', () => {
  it('parses TT BUY rows and supports previous-date fallback', () => {
    const parsed = parseExchangeRateCsv(sampleCsv)

    expect(parsed.reportName).toBe('SBI Reference Rates')
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows[0]).toMatchObject({
      date: '2020-01-04',
      ttBuyInr: 0,
    })

    expect(getExchangeRateOnOrBefore(parsed.rows, '2020-01-06')).toEqual({
      rate: 71.65,
      targetDate: '2020-01-06',
      rateDate: '2020-01-06',
      usedFallback: false,
    })

    expect(getExchangeRateOnOrBefore(parsed.rows, '2020-01-18')).toEqual({
      rate: 70.58,
      targetDate: '2020-01-18',
      rateDate: '2020-01-17',
      usedFallback: true,
    })
  })

  it('uses previous-month-end lookup for capital gains dates', () => {
    const parsed = parseExchangeRateCsv(sampleCsv)

    expect(getCapitalGainsExchangeRate(parsed.rows, '2025-11-04')).toMatchObject({
      targetDate: '2025-10-31',
      rateDate: '2025-10-31',
    })
  })

  it('returns null when no positive FX rate exists on or before the target date', () => {
    const parsed = parseExchangeRateCsv(sampleCsv)

    expect(getExchangeRateOnOrBefore(parsed.rows, '2020-01-05')).toBeNull()
  })

  it('computes the previous month end across year boundaries', () => {
    expect(getPreviousMonthEnd('2025-01-04')).toBe('2024-12-31')
    expect(getPreviousMonthEnd('2025-03-01')).toBe('2025-02-28')
  })

  it('picks the highest INR value within a symbol-specific price range', () => {
    const parsed = parseExchangeRateCsv(sampleCsv)

    const result = getMaxInrAmountForRange(
      [
        { stockSymbol: 'TEAM', date: '2020-01-16', closePriceUsd: 90, highPriceUsd: 100 },
        { stockSymbol: 'TEAM', date: '2020-01-18', closePriceUsd: 95, highPriceUsd: 120 },
        { stockSymbol: 'MSFT', date: '2020-01-18', closePriceUsd: 200, highPriceUsd: 220 },
      ],
      parsed.rows,
      'TEAM',
      '2020-01-15',
      '2020-01-18',
      2,
    )

    expect(result).toEqual({
      amountInr: 16939.2,
      priceDate: '2020-01-18',
      fxRate: 70.58,
      fxRateDate: '2020-01-17',
      usedFallback: true,
    })
  })

  it('returns null for max INR lookup when no matching price has a usable FX rate', () => {
    const parsed = parseExchangeRateCsv(sampleCsv)

    expect(
      getMaxInrAmountForRange(
        [{ stockSymbol: 'TEAM', date: '2019-12-31', closePriceUsd: 90, highPriceUsd: 95 }],
        parsed.rows,
        'TEAM',
        '2019-12-01',
        '2019-12-31',
        1,
      ),
    ).toBeNull()
  })

  it('throws when TT BUY contains a non-numeric value', () => {
    const invalidCsv = `DATE,PDF FILE,TT BUY
2025-01-01 09:00,example.pdf,not-a-number
`

    expect(() => parseExchangeRateCsv(invalidCsv)).toThrow(
      'Unable to parse exchange-rate value "not-a-number".',
    )
  })

  it('throws when the upload contains no usable rows', () => {
    const headerOnlyCsv = `DATE,PDF FILE,TT BUY
`

    expect(() => parseExchangeRateCsv(headerOnlyCsv)).toThrow(
      'No exchange-rate rows were found in the uploaded CSV.',
    )
  })
})
