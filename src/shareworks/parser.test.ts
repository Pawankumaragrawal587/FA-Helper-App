import { describe, expect, it } from 'vitest'

import { parseShareworksCsv } from './parser'
import { deriveLongShareSaleTransactions } from './transform'

const sampleCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Example Grant A,1,Long Shares,18-Feb-2025,13-Feb-2025,YES,$316.00,USD,$948.00,USD,3,$942.00,USD,$314.0000,USD,$0.00,USD,$0.06,USD
01-Jan-2025,31-Dec-2025,SELLREF-002,RELREF-002,GRANT-002,Example Grant B,1,Long Shares,04-Mar-2025,18-Feb-2025,YES,$315.44,USD,"$1,892.64",USD,6,"$1,605.00",USD,$267.5000,USD,$0.00,USD,$0.13,USD
,,,,,,,,,,,,,,,9,"$2,547.00",USD,,,$0.00,USD,$0.19,USD
`

describe('parseShareworksCsv', () => {
  it('parses data rows and ignores the totals row', () => {
    const parsed = parseShareworksCsv(sampleCsv)

    expect(parsed.reportName).toBe('Sales - Long Shares')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.ignoredRowCount).toBe(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 5,
        reason: 'Summary totals row',
        preview: '9 | $2,547.00 | USD | $0.00',
      },
    ])
    expect(parsed.rows[0]).toMatchObject({
      withdrawalReferenceNumber: 'SELLREF-001',
      grantName: 'Example Grant A',
      saleDate: '2025-02-18',
      originalAcquisitionDate: '2025-02-13',
      sharesSold: 3,
      originalCostBasisUsd: 948,
      saleProceedsUsd: 942,
      supplementalTransactionFeeUsd: 0.06,
    })
  })

  it('derives sell transactions from each sales row', () => {
    const parsed = parseShareworksCsv(sampleCsv)
    const transactions = deriveLongShareSaleTransactions(parsed.rows)

    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-02-18',
      shares: 3,
      pricePerShareUsd: 314,
      grossAmountUsd: 942,
      feeUsd: 0.06,
    })
    expect(transactions[1]).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-03-04',
      shares: 6,
      grossAmountUsd: 1605,
      feeUsd: 0.13,
    })
  })
})
