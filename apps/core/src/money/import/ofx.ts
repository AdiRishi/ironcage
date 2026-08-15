import { CalendarDate } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { BankImportBlocked, blocked } from "./block";
import { decodeWindows1252 } from "./bytes";

/**
 * The three observed NetBank OFX shapes. `home_loan` is the bank-writer quirk
 * profile: inside `BANKMSGSRSV1` it opens `CCSTMTRS` and closes `STMTRS`, and
 * exactly that pair is accepted — other mismatched aggregates stay malformed.
 */
export type OfxVariant = "deposit" | "credit_card" | "home_loan";

export interface OfxTransaction {
  readonly ordinal: number;
  /** Scalar tag → exact source text, for observation storage. */
  readonly raw: Readonly<Record<string, string>>;
  readonly trnType: string;
  readonly posted: CalendarDate;
  readonly valueDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly fitid: string;
  readonly memo: string;
}

export interface OfxBalance {
  readonly amount: BigDecimal.BigDecimal;
  readonly asOfRaw: string;
  readonly asOfDate: CalendarDate;
}

export interface OfxStatement {
  readonly currency: string;
  readonly account: {
    readonly bankId: string | null;
    readonly acctId: string;
    readonly acctType: string | null;
  };
  readonly window: { readonly start: CalendarDate; readonly end: CalendarDate };
  readonly transactions: readonly OfxTransaction[];
  readonly ledger: OfxBalance | null;
  readonly available: OfxBalance | null;
}

interface OfxNode {
  readonly tag: string;
  value: string;
  readonly children: OfxNode[];
}

const aggregates = new Set([
  "OFX",
  "SIGNONMSGSRSV1",
  "SONRS",
  "STATUS",
  "BANKMSGSRSV1",
  "CREDITCARDMSGSRSV1",
  "STMTTRNRS",
  "CCSTMTTRNRS",
  "STMTRS",
  "CCSTMTRS",
  "BANKACCTFROM",
  "CCACCTFROM",
  "BANKTRANLIST",
  "STMTTRN",
  "LEDGERBAL",
  "AVAILBAL",
]);

const scalars = new Set([
  "CODE",
  "SEVERITY",
  "DTSERVER",
  "LANGUAGE",
  "TRNUID",
  "CURDEF",
  "BANKID",
  "ACCTID",
  "ACCTTYPE",
  "DTSTART",
  "DTEND",
  "TRNTYPE",
  "DTPOSTED",
  "DTUSER",
  "TRNAMT",
  "FITID",
  "MEMO",
  "BALAMT",
  "DTASOF",
]);

const fail = (detail: string) => blocked("OfxGrammar", detail);

const requiredHeader = {
  OFXHEADER: "100",
  DATA: "OFXSGML",
  VERSION: "102",
  ENCODING: "USASCII",
  CHARSET: "1252",
} satisfies Readonly<Record<string, string>>;

const knownHeaderKeys = new Set([
  ...Object.keys(requiredHeader),
  "SECURITY",
  "COMPRESSION",
  "OLDFILEUID",
  "NEWFILEUID",
]);

const parseHeader = Effect.fn("parseOfxHeader")(function* (lines: readonly string[]) {
  const header = new Map<string, string>();

  for (const line of lines) {
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator < 1) return yield* fail(`malformed header line "${line}"`);
    const key = line.slice(0, separator);
    if (!knownHeaderKeys.has(key)) return yield* fail(`unknown header key "${key}"`);
    header.set(key, line.slice(separator + 1));
  }

  for (const [key, expected] of Object.entries(requiredHeader)) {
    const found = header.get(key);
    if (found !== expected) {
      return yield* fail(
        `header ${key} is "${found ?? "absent"}", the profile requires "${expected}"`,
      );
    }
  }
});

/** Strips exactly the line terminator that ends a scalar's value; internal and trailing spaces survive. */
const scalarValue = (text: string) => text.replace(/(\r\n)+$/, "");

const parseBody = Effect.fn("parseOfxBody")(function* (body: string, variant: OfxVariant) {
  const root: OfxNode = { tag: "", value: "", children: [] };
  const stack: OfxNode[] = [root];
  let pendingScalar: OfxNode | null = null;
  let last = 0;

  const tagPattern = /<(\/?)([A-Z0-9]+)>/g;

  for (let match = tagPattern.exec(body); match !== null; match = tagPattern.exec(body)) {
    const text = body.slice(last, match.index);
    last = tagPattern.lastIndex;
    const closing = match[1]!;
    const tag = match[2]!;

    if (pendingScalar !== null) {
      pendingScalar.value = scalarValue(text);
      pendingScalar = null;
    } else if (text.replace(/\r\n/g, "") !== "") {
      return yield* fail(`stray text "${text.trim()}" outside a scalar element`);
    }

    const parent = stack[stack.length - 1]!;

    if (closing === "/") {
      const open = stack.pop();
      if (open === undefined || open === root) return yield* fail(`unopened closing tag </${tag}>`);
      if (open.tag !== tag) {
        const sanctionedQuirk =
          variant === "home_loan" && open.tag === "CCSTMTRS" && tag === "STMTRS";
        if (!sanctionedQuirk) {
          return yield* fail(`<${open.tag}> closed by </${tag}>`);
        }
      }
      continue;
    }

    if (aggregates.has(tag)) {
      const node: OfxNode = { tag, value: "", children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (scalars.has(tag)) {
      const node: OfxNode = { tag, value: "", children: [] };
      parent.children.push(node);
      pendingScalar = node;
    } else {
      return yield* fail(`unknown element <${tag}>`);
    }
  }

  if (pendingScalar !== null || stack.length !== 1) {
    return yield* fail("file ended inside an open element");
  }
  if (body.slice(last).replace(/\r\n/g, "") !== "") {
    return yield* fail("trailing text after </OFX>");
  }

  return root;
});

const children = (node: OfxNode, tag: string) => node.children.filter((child) => child.tag === tag);

const one = (node: OfxNode, tag: string): Effect.Effect<OfxNode, BankImportBlocked> => {
  const found = children(node, tag);
  return found.length === 1
    ? Effect.succeed(found[0]!)
    : fail(`expected exactly one <${tag}> inside <${node.tag}>, found ${found.length}`);
};

const value = (node: OfxNode, tag: string) => Effect.map(one(node, tag), (child) => child.value);

const dateFrom = (digits: string, tag: string): Effect.Effect<CalendarDate, BankImportBlocked> => {
  if (!/^\d{8}(\d{6})?$/.test(digits)) {
    return fail(`${tag} "${digits}" is not an 8- or 14-digit OFX date`);
  }
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Schema.decodeUnknownEffect(CalendarDate)(iso).pipe(
    Effect.mapError(
      () =>
        new BankImportBlocked({
          code: "OfxGrammar",
          detail: `${tag} "${digits}" is not a real calendar date`,
        }),
    ),
  );
};

const amountPattern = /^[+-]?\d+(\.\d+)?$/;

const amountFrom = (
  raw: string,
  tag: string,
): Effect.Effect<BigDecimal.BigDecimal, BankImportBlocked> =>
  amountPattern.test(raw)
    ? Effect.succeed(BigDecimal.fromStringUnsafe(raw))
    : fail(`${tag} "${raw}" is not a decimal amount`);

const statusOk = Effect.fn("ofxStatusOk")(function* (parent: OfxNode) {
  const status = yield* one(parent, "STATUS");
  const code = yield* value(status, "CODE");
  if (code !== "0") return yield* fail(`<${parent.tag}> status code is ${code}`);
});

const transactionTags = ["TRNTYPE", "DTPOSTED", "DTUSER", "TRNAMT", "FITID", "MEMO"];

const parseTransaction = Effect.fn("parseOfxTransaction")(function* (
  node: OfxNode,
  ordinal: number,
) {
  for (const child of node.children) {
    if (!transactionTags.includes(child.tag)) {
      return yield* fail(`transaction ${ordinal + 1} carries unexpected <${child.tag}>`);
    }
  }

  const raw: Record<string, string> = {};
  for (const tag of transactionTags) {
    raw[tag] = yield* value(node, tag);
  }

  return {
    ordinal,
    raw,
    trnType: raw["TRNTYPE"]!,
    posted: yield* dateFrom(raw["DTPOSTED"]!, "DTPOSTED"),
    valueDate: yield* dateFrom(raw["DTUSER"]!, "DTUSER"),
    amount: yield* amountFrom(raw["TRNAMT"]!, "TRNAMT"),
    fitid: raw["FITID"]!,
    memo: raw["MEMO"]!,
  } satisfies OfxTransaction;
});

const parseBalance = Effect.fn("parseOfxBalance")(function* (node: OfxNode) {
  const raw = yield* value(node, "DTASOF");
  return {
    amount: yield* amountFrom(yield* value(node, "BALAMT"), "BALAMT"),
    asOfRaw: raw,
    asOfDate: yield* dateFrom(raw, "DTASOF"),
  } satisfies OfxBalance;
});

const optionalBalance = Effect.fn("parseOptionalOfxBalance")(function* (
  node: OfxNode,
  tag: string,
) {
  const found = children(node, tag);
  if (found.length > 1) return yield* fail(`expected at most one <${tag}>`);
  return found.length === 1 ? yield* parseBalance(found[0]!) : null;
});

interface OfxGrammar {
  readonly message: string;
  readonly response: string;
  readonly statement: string;
  readonly account: string;
}

const variantGrammar = {
  deposit: {
    message: "BANKMSGSRSV1",
    response: "STMTTRNRS",
    statement: "STMTRS",
    account: "BANKACCTFROM",
  },
  credit_card: {
    message: "CREDITCARDMSGSRSV1",
    response: "CCSTMTTRNRS",
    statement: "CCSTMTRS",
    account: "CCACCTFROM",
  },
  home_loan: {
    message: "BANKMSGSRSV1",
    response: "STMTTRNRS",
    statement: "CCSTMTRS",
    account: "BANKACCTFROM",
  },
} satisfies Record<OfxVariant, OfxGrammar>;

/**
 * Parses a NetBank OFX 1.02 SGML export. The tag vocabulary is closed: an
 * element outside the observed grammar blocks the file rather than being
 * skipped, and scalar values keep their exact source text.
 */
export const parseBankOfx = Effect.fn("parseBankOfx")(function* (
  bytes: Uint8Array,
  variant: OfxVariant,
): Effect.fn.Return<OfxStatement, BankImportBlocked> {
  const text = decodeWindows1252(bytes);
  const bodyStart = text.indexOf("<");
  if (bodyStart < 0) return yield* fail("no OFX body found");

  yield* parseHeader(text.slice(0, bodyStart).split("\r\n"));

  const grammar = variantGrammar[variant];
  const root = yield* parseBody(text.slice(bodyStart), variant);
  const ofx = yield* one(root, "OFX");
  yield* statusOk(yield* one(yield* one(ofx, "SIGNONMSGSRSV1"), "SONRS"));

  const message = yield* one(ofx, grammar.message);
  const response = yield* one(message, grammar.response);
  yield* statusOk(response);
  const statement = yield* one(response, grammar.statement);

  const currency = yield* value(statement, "CURDEF");
  if (currency !== "AUD") {
    return yield* blocked("CurrencyUnsupported", `CURDEF is ${currency}, the record is AUD`);
  }

  const account = yield* one(statement, grammar.account);
  const bankIds = children(account, "BANKID");
  const acctTypes = children(account, "ACCTTYPE");

  const list = yield* one(statement, "BANKTRANLIST");
  const transactions = yield* Effect.forEach(children(list, "STMTTRN"), (node, index) =>
    parseTransaction(node, index),
  );

  return {
    currency,
    account: {
      bankId: bankIds[0]?.value ?? null,
      acctId: yield* value(account, "ACCTID"),
      acctType: acctTypes[0]?.value ?? null,
    },
    window: {
      start: yield* dateFrom(yield* value(list, "DTSTART"), "DTSTART"),
      end: yield* dateFrom(yield* value(list, "DTEND"), "DTEND"),
    },
    transactions,
    ledger: yield* optionalBalance(statement, "LEDGERBAL"),
    available: yield* optionalBalance(statement, "AVAILBAL"),
  } satisfies OfxStatement;
});
