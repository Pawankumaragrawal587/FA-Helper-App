import { describe, expect, it } from 'vitest'

import { parseShareworksCsv } from './parser'
import { deriveLongShareSaleTransactions } from './transform'

const sampleCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-101,RELREF-101,GRANT-101,Sample Grant Alpha,1,Long Shares,20-Jun-2025,10-Mar-2025,NO,$100.00,USD,$500.00,USD,5,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
01-Jan-2025,31-Dec-2025,SELLREF-102,RELREF-102,GRANT-102,Sample Grant Beta,1,Long Shares,01-Jul-2025,15-Apr-2025,NO,$120.00,USD,$480.00,USD,4,$520.00,USD,$130.0000,USD,$0.00,USD,$0.25,USD
,,,,,,,,,,,,,,,9,"$1,070.00",USD,,,$0.00,USD,$0.45,USD
`

describe('Shareworks sample file', () => {
  it('parses the uploaded sample and derives acquisition and sell rows', () => {
    const parsed = parseShareworksCsv(sampleCsv)
    const transactions = deriveLongShareSaleTransactions(parsed.rows)

    expect(parsed.reportName).toBe('Sales - Long Shares')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.ignoredRowCount).toBe(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 5,
        reason: 'Summary totals row',
        preview: '9 | $1,070.00 | USD | $0.00',
      },
    ])
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-06-20',
      shares: 5,
      grossAmountUsd: 550,
    })
    expect(transactions.at(-1)).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-07-01',
      shares: 4,
      grossAmountUsd: 520,
    })
  })
})
