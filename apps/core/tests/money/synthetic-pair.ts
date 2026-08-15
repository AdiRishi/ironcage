/**
 * Deliberately synthetic deposit-account CSV/OFX pairs for integration
 * scenarios the redacted corpus cannot express (cross-account transfers,
 * disjoint windows). Synthetic data never certifies a profile; the fixture
 * corpus does that.
 */
export interface SyntheticRow {
  readonly date: string; // DD/MM/YYYY
  readonly amount: string; // signed, two decimals
  readonly narrative: string;
  readonly balance: string; // signed running balance
}

export interface SyntheticPair {
  readonly csv: Uint8Array;
  readonly ofx: Uint8Array;
}

const signedForCsv = (value: string) => (value.startsWith("-") ? value : `+${value}`);
const ofxDate = (date: string) => `${date.slice(6)}${date.slice(3, 5)}${date.slice(0, 2)}`;

export const makeDepositPair = (
  acctId: string,
  oldestFirst: readonly SyntheticRow[],
  window: readonly [string, string],
): SyntheticPair => {
  const newestFirst = [...oldestFirst].reverse();
  const csv = `${newestFirst
    .map(
      (row) =>
        `${row.date},"${signedForCsv(row.amount)}","${row.narrative}","${signedForCsv(row.balance)}"`,
    )
    .join("\r\n")}\r\n`;

  const transactions = newestFirst
    .map(
      (row, index) =>
        `<STMTTRN>\r\n<TRNTYPE>${row.amount.startsWith("-") ? "DEBIT" : "CREDIT"}\r\n<DTPOSTED>${ofxDate(row.date)}\r\n<DTUSER>${ofxDate(row.date)}\r\n<TRNAMT>${row.amount}\r\n<FITID>f-${acctId}-${ofxDate(row.date)}-${index}\r\n<MEMO>${row.narrative}\r\n</STMTTRN>\r\n`,
    )
    .join("");
  const newest = newestFirst[0]!;
  const ofx =
    `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n` +
    `<OFX>\r\n<SIGNONMSGSRSV1>\r\n<SONRS>\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<DTSERVER>${ofxDate(window[1])}104618\r\n<LANGUAGE>ENG\r\n</SONRS>\r\n</SIGNONMSGSRSV1>\r\n` +
    `<BANKMSGSRSV1>\r\n<STMTTRNRS>\r\n<TRNUID>0\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<STMTRS>\r\n<CURDEF>AUD\r\n` +
    `<BANKACCTFROM>\r\n<BANKID>999999\r\n<ACCTID>${acctId}\r\n<ACCTTYPE>SAVINGS\r\n</BANKACCTFROM>\r\n` +
    `<BANKTRANLIST>\r\n<DTSTART>${ofxDate(window[0])}000000\r\n<DTEND>${ofxDate(window[1])}000000\r\n${transactions}</BANKTRANLIST>\r\n` +
    `<LEDGERBAL>\r\n<BALAMT>${newest.balance}\r\n<DTASOF>${ofxDate(window[1])}104618\r\n</LEDGERBAL>\r\n` +
    `</STMTRS>\r\n</STMTTRNRS>\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n`;

  const encode = (text: string) => new TextEncoder().encode(text);
  return { csv: encode(csv), ofx: encode(ofx) };
};
