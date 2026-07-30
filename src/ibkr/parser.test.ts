import { describe, expect, it } from 'vitest'

import { deriveIbkrTransactions, parseIbkrTransactionsCsv } from './parser'

const sampleCsv = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Transaction History
Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount
Transaction History,Data,2025-04-05,U1234567,ALPHABET INC-CL C,Buy,GOOG,2.0,150.5,USD,-301.0,-0.35,-301.35
Transaction History,Data,2025-04-11,U1234567,ALPHABET INC-CL C,Sell,GOOG,-1.0,162.0,USD,162.0,-0.36,161.64
Transaction History,Data,2025-04-12,U1234567,MICROSOFT CORP,Buy,MSFT,1.5,400.0,USD,-600.0,-0.34,-600.34
Transaction History,Data,2025-04-15,U1234567,GOOG(US02079K1079) Cash Dividend USD 0.20 per Share (Ordinary Dividend),Dividend,GOOG,-,-,-,0.20,-,0.20
Transaction History,Data,2025-04-15,U1234567,GOOG(US02079K1079) Cash Dividend USD 0.20 per Share - US Tax,Foreign Tax Withholding,GOOG,-,-,-,-0.05,-,-0.05
Transaction History,Data,2025-04-16,U1234567,GOOG(US02079K1079) Cash Dividend USD 0.20 per Share - US Tax Reversal,Foreign Tax Withholding,GOOG,-,-,-,0.05,-,0.05
`

describe('parseIbkrTransactionsCsv', () => {
  it('parses buy and sell rows, discovers symbols, and ignores unsupported rows', () => {
    const parsed = parseIbkrTransactionsCsv(sampleCsv)

    expect(parsed.reportName).toBe('IBKR Transaction History')
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.dividendRows).toEqual([
      {
        broker: 'ibkr',
        stockSymbol: 'GOOG',
        sourceRowNumber: 7,
        tradeDate: '2025-04-15',
        description:
          'GOOG(US02079K1079) Cash Dividend USD 0.20 per Share (Ordinary Dividend)',
        transactionTypeLabel: 'Dividend',
        netAmountUsd: 0.2,
      },
    ])
    expect(parsed.cashLedgerRows.map((row) => ({
      stockSymbol: row.stockSymbol,
      transactionTypeLabel: row.transactionTypeLabel,
      netAmountUsd: row.netAmountUsd,
    }))).toEqual([
      { stockSymbol: 'GOOG', transactionTypeLabel: 'Buy', netAmountUsd: -301.35 },
      { stockSymbol: 'GOOG', transactionTypeLabel: 'Sell', netAmountUsd: 161.64 },
      { stockSymbol: 'MSFT', transactionTypeLabel: 'Buy', netAmountUsd: -600.34 },
      { stockSymbol: 'GOOG', transactionTypeLabel: 'Dividend', netAmountUsd: 0.2 },
      { stockSymbol: 'GOOG', transactionTypeLabel: 'Foreign Tax Withholding', netAmountUsd: -0.05 },
    ])
    expect(parsed.uniqueSymbols).toEqual(['GOOG', 'MSFT'])
    expect(parsed.ignoredRowCount).toBe(2)
    expect(parsed.rows[0]).toMatchObject({
      broker: 'ibkr',
      stockSymbol: 'GOOG',
      tradeDate: '2025-04-05',
      transactionTypeLabel: 'Buy',
      quantity: 2,
      pricePerShareUsd: 150.5,
      grossAmountUsd: 301,
      commissionUsd: 0.35,
    })
  })

  it('derives normalized FIFO transactions with positive share quantities', () => {
    const parsed = parseIbkrTransactionsCsv(sampleCsv)
    const transactions = deriveIbkrTransactions(parsed.rows)

    expect(transactions).toHaveLength(3)
    expect(transactions[0]).toMatchObject({
      broker: 'ibkr',
      stockSymbol: 'GOOG',
      transactionType: 'ACQUIRE',
      grantName: 'GOOG',
      shares: 2,
      pricePerShareUsd: 150.5,
    })
    expect(transactions[1]).toMatchObject({
      transactionType: 'SELL',
      shares: 1,
      grossAmountUsd: 162,
      feeUsd: 0.36,
    })
  })

  it('ignores rows with missing symbols and throws when no supported trades remain', () => {
    const invalidSymbolCsv = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Transaction History
Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount
Transaction History,Data,2025-04-05,U1234567,ALPHABET INC-CL C,Dividend,GOOG,-,-,-,0.20,-,0.20
Transaction History,Data,2025-04-11,U1234567,ALPHABET INC-CL C,Buy,-,1.0,162.0,USD,-162.0,-0.36,-162.36
`

    expect(() => parseIbkrTransactionsCsv(invalidSymbolCsv)).toThrow(
      'No IBKR buy or sell rows were found in the uploaded CSV.',
    )
  })

  it('throws when the transaction-history header does not match the expected format', () => {
    const invalidHeaderCsv = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Transaction History
Transaction History,Header,Trade Date,Account,Description,Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount
Transaction History,Data,2025-04-05,U1234567,ALPHABET INC-CL C,Buy,GOOG,2.0,150.5,USD,-301.0,-0.35,-301.35
`

    expect(() => parseIbkrTransactionsCsv(invalidHeaderCsv)).toThrow(
      'The uploaded file does not match the expected IBKR transactions format.',
    )
  })

  it('throws when a trade row contains an invalid date or amount', () => {
    const invalidTradeCsv = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Transaction History
Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount
Transaction History,Data,04/05/2025,U1234567,ALPHABET INC-CL C,Buy,GOOG,2.0,not-a-number,USD,-301.0,-0.35,-301.35
`

    expect(() => parseIbkrTransactionsCsv(invalidTradeCsv)).toThrow(
      'Unable to parse IBKR trade date "04/05/2025".',
    )
  })
})
