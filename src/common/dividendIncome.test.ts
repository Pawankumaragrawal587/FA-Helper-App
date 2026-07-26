import { describe, expect, it } from 'vitest'

import { buildDividendIncomeRows } from './dividendIncome'

describe('buildDividendIncomeRows', () => {
  it('filters dividends to the financial year and applies previous-month FX conversion', () => {
    const rows = buildDividendIncomeRows(
      [
        {
          broker: 'ibkr',
          stockSymbol: 'MSFT',
          sourceRowNumber: 4,
          tradeDate: '2025-03-30',
          description: 'MSFT dividend before FY',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 1.25,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'GOOG',
          sourceRowNumber: 2,
          tradeDate: '2025-04-15',
          description: 'GOOG dividend',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 2,
        },
        {
          broker: 'ibkr',
          stockSymbol: 'AAPL',
          sourceRowNumber: 3,
          tradeDate: '2025-12-15',
          description: 'AAPL dividend',
          transactionTypeLabel: 'Dividend',
          netAmountUsd: 3,
        },
      ],
      [
        { date: '2025-03-31', ttBuyInr: 80 },
        { date: '2025-11-28', ttBuyInr: 84 },
      ],
      {
        financialStart: '2025-04-01',
        financialEnd: '2026-03-31',
      },
    )

    expect(rows).toEqual([
      {
        id: 'dividend-AAPL-3',
        stockSymbol: 'AAPL',
        dividendDate: '2025-12-15',
        description: 'AAPL dividend',
        dividendAmountUsd: 3,
        fxRate: 84,
        fxRateDate: '2025-11-28',
        dividendAmountInr: 252,
      },
      {
        id: 'dividend-GOOG-2',
        stockSymbol: 'GOOG',
        dividendDate: '2025-04-15',
        description: 'GOOG dividend',
        dividendAmountUsd: 2,
        fxRate: 80,
        fxRateDate: '2025-03-31',
        dividendAmountInr: 160,
      },
    ])
  })
})
