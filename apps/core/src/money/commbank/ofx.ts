import type { Money } from "@ironcage/domain";
import { Effect, Option, Schema } from "effect";

import { type SourceDate, sourceAmount, sourceDate } from "../values";
import type { CommBankAccountProfile } from "./profiles";

/**
 * The observed NetBank OFX is 1.02 in SGML form, not XML: scalar elements carry
 * no closing tag, and the file opens with a colon-delimited header rather than
 * a declaration. An XML parser cannot read it, and neither can a tokenizer that
 * assumes every open tag is an aggregate — `<FITID>` on a Mastercard row is an
 * empty scalar, and the file never says so.
 *
 * What the OFX contributes to an import bundle is the account identity the CSV
 * lacks, the requested source window, and a transaction identifier where the
 * profile has proven one is stable.
 */
export interface CommBankOfxAccount {
  readonly messageSet: "bank" | "credit_card";
  /** `BANKID`, present only in the bank message set. */
  readonly bankId: Option.Option<string>;
  readonly accountId: string;
  /** `ACCTTYPE`, present only in the bank message set. */
  readonly accountType: Option.Option<string>;
}

export interface CommBankOfxTransaction {
  /** Zero-based position in `BANKTRANLIST`, which is newest-first as the CSV is. */
  readonly sourceOrdinal: number;
  /** Every field exactly as the file wrote it, before interpretation. */
  readonly raw: {
    readonly type: string;
    readonly postedDate: string;
    readonly userDate: string;
    readonly amount: string;
    readonly identifier: string;
    readonly narrative: string;
  };
  /** `TRNTYPE`, preserved as source metadata. No analysis rule reads it. */
  readonly type: string;
  readonly postedDate: SourceDate;
  readonly userDate: Option.Option<SourceDate>;
  readonly amount: Money;
  /** `FITID`, absent when the observed element is empty. An empty element is not an identifier. */
  readonly identifier: Option.Option<string>;
  readonly narrative: string;
}

export interface CommBankOfxBalance {
  readonly amount: Money;
  readonly asOfDate: SourceDate;
  /**
   * The full `DTASOF` value. The observed balances carry a time, but OFX writes
   * no offset with it, so the time is kept as evidence rather than resolved
   * into an instant this decoder would have to invent a zone for.
   */
  readonly raw: string;
}

export interface CommBankOfxFile {
  readonly account: CommBankOfxAccount;
  readonly currency: string;
  /** `DTSTART` and `DTEND`, which the profile reads as the requested coverage window. */
  readonly window: { readonly start: SourceDate; readonly end: SourceDate };
  readonly transactions: readonly CommBankOfxTransaction[];
  readonly ledgerBalance: CommBankOfxBalance;
  /** Kept separate on purpose: available balance never substitutes for ledger balance. */
  readonly availableBalance: Option.Option<CommBankOfxBalance>;
}

export class CommBankOfxRejected extends Schema.TaggedError<CommBankOfxRejected>()(
  "CommBankOfxRejected",
  {
    reason: Schema.Literals([
      "undecodable_bytes",
      "missing_header",
      "unsupported_header",
      "malformed_sgml",
      "message_set_mismatch",
      "missing_element",
      "duplicate_element",
      "unexpected_children",
      "invalid_date",
      "invalid_amount",
      "unsupported_currency",
    ]),
    /** The transaction that was refused, or `null` when the whole file was. */
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const reject = (
  reason: CommBankOfxRejected["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankOfxRejected({ reason, sourceOrdinal, detail });

/**
 * The header values this profile can read. `ENCODING` and `CHARSET` decide how
 * the body is decoded, and `COMPRESSION` and `SECURITY` decide whether the
 * bytes are the document at all, so an unrecognized value is a refusal rather
 * than a warning.
 */
const supportedHeader: Record<string, string> = {
  OFXHEADER: "100",
  DATA: "OFXSGML",
  VERSION: "102",
  SECURITY: "NONE",
  ENCODING: "USASCII",
  CHARSET: "1252",
  COMPRESSION: "NONE",
};

interface OfxNode {
  readonly tag: string;
  value: string | null;
  children: OfxNode[];
}

const documentStart = 0x3c;
const asciiLimit = 0x7f;

/**
 * Reconstructs the element tree from SGML that closes only its aggregates.
 *
 * A tag with no text after it is ambiguous — an aggregate that is about to open
 * children, or a scalar whose value is empty — and the file carries no DTD to
 * settle it. The parser opens it optimistically and settles the question at the
 * first closing tag: everything still open above the element being closed was
 * an empty scalar, and its apparent children belong to its parent. Source order
 * survives because those children are re-appended in the order they arrived.
 */
const parseSgml = (
  body: string,
  statementAggregate: CommBankAccountProfile["statementAggregate"],
): Option.Option<OfxNode> => {
  const document: OfxNode = { tag: "#document", value: null, children: [] };
  const open: OfxNode[] = [document];
  let cursor = 0;

  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);

    if (start === -1)
      return body.slice(cursor).trim() === "" ? Option.some(document) : Option.none();
    if (body.slice(cursor, start).trim() !== "") return Option.none();

    const end = body.indexOf(">", start + 1);

    if (end === -1) return Option.none();

    const tag = body.slice(start + 1, end);
    const next = body.indexOf("<", end + 1);
    const text = (next === -1 ? body.slice(end + 1) : body.slice(end + 1, next)).trim();

    cursor = next === -1 ? body.length : next;

    if (tag === "") return Option.none();

    if (tag.startsWith("/")) {
      const closing = tag.slice(1);
      const expectedOpening =
        closing === statementAggregate.closing ? statementAggregate.opening : closing;
      const depth = open.findLastIndex((node) => node.tag === expectedOpening);

      if (depth < 1 || text !== "") return Option.none();

      for (let level = open.length - 1; level > depth; level--) {
        const scalar = open[level] as OfxNode;
        const parent = open[level - 1] as OfxNode;

        scalar.value = "";
        parent.children.push(...scalar.children);
        scalar.children = [];
      }

      open.length = depth;
      continue;
    }

    const parent = open.at(-1) as OfxNode;
    const node: OfxNode = { tag, value: text === "" ? null : text, children: [] };

    parent.children.push(node);

    if (text === "") open.push(node);
  }

  return open.length === 1 ? Option.some(document) : Option.none();
};

const childrenNamed = (node: OfxNode, tag: string) =>
  node.children.filter((child) => child.tag === tag);

const element = (node: OfxNode, tag: string, path: string) =>
  Effect.gen(function* () {
    const found = childrenNamed(node, tag);
    const [first] = found;

    if (first === undefined) return yield* reject("missing_element", `${path}/${tag} is absent`);
    if (found.length > 1) {
      return yield* reject("duplicate_element", `${path}/${tag} appears ${found.length} times`);
    }

    return first;
  });

const scalar = (node: OfxNode, tag: string, path: string) =>
  Effect.gen(function* () {
    const found = yield* element(node, tag, path);

    if (found.children.length > 0) {
      return yield* reject("unexpected_children", `${path}/${tag} is an aggregate, not a value`);
    }

    return found.value ?? "";
  });

const optionalScalar = (node: OfxNode, tag: string) => {
  const found = childrenNamed(node, tag);

  return found.length === 1 && found[0]?.children.length === 0
    ? Option.some(found[0]?.value ?? "")
    : Option.none<string>();
};

/** `YYYYMMDD`, optionally followed by the `HHMMSS` the balance and window records carry. */
const ofxDate = /^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/;

const asDate = (raw: string) => {
  const parts = ofxDate.exec(raw);

  return parts === null
    ? Option.none<SourceDate>()
    : sourceDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));
};

const messageSets = {
  bank: {
    messages: "BANKMSGSRSV1",
    response: "STMTTRNRS",
    from: "BANKACCTFROM",
  },
  credit_card: {
    messages: "CREDITCARDMSGSRSV1",
    response: "CCSTMTTRNRS",
    from: "CCACCTFROM",
  },
} as const;

const balance = (statement: OfxNode, tag: string) =>
  Effect.gen(function* () {
    const node = yield* element(statement, tag, "OFX");
    const rawAmount = yield* scalar(node, "BALAMT", tag);
    const rawAsOf = yield* scalar(node, "DTASOF", tag);
    const amount = sourceAmount(rawAmount);
    const asOfDate = asDate(rawAsOf);

    if (Option.isNone(amount)) {
      return yield* reject("invalid_amount", `${tag}/BALAMT is ${JSON.stringify(rawAmount)}`);
    }

    if (Option.isNone(asOfDate)) {
      return yield* reject("invalid_date", `${tag}/DTASOF is ${JSON.stringify(rawAsOf)}`);
    }

    return { amount: amount.value, asOfDate: asOfDate.value, raw: rawAsOf };
  });

export const decodeCommBankOfx = Effect.fn("decodeCommBankOfx")(function* (
  bytes: Uint8Array,
  profile: CommBankAccountProfile,
): Effect.fn.Return<CommBankOfxFile, CommBankOfxRejected> {
  const bodyStart = bytes.indexOf(documentStart);

  if (bodyStart === -1)
    return yield* reject("missing_header", "the file contains no SGML document");

  // The header has to be read before the body can be decoded, because the
  // header is what declares the body's character set. OFX 1.x writes the header
  // itself in ASCII.
  const headerBytes = bytes.subarray(0, bodyStart);
  const highByte = headerBytes.findIndex((byte) => byte > asciiLimit);

  if (highByte !== -1) {
    return yield* reject("undecodable_bytes", `header byte at offset ${highByte} is outside ASCII`);
  }

  const header = new Map<string, string>();

  for (const line of new TextDecoder().decode(headerBytes).split(/\r?\n/)) {
    if (line.trim() === "") continue;

    const separator = line.indexOf(":");

    if (separator === -1) {
      return yield* reject("missing_header", `${JSON.stringify(line)} is not a header field`);
    }

    header.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  for (const [field, expected] of Object.entries(supportedHeader)) {
    const declared = header.get(field);

    if (declared !== expected) {
      return yield* reject(
        "unsupported_header",
        `${field} is ${declared === undefined ? "absent" : JSON.stringify(declared)}, expected ${expected}`,
      );
    }
  }

  // `ENCODING:USASCII` with `CHARSET:1252` is the observed declaration: the
  // document is ASCII, and anything above it means Windows-1252. Obeying the
  // declaration is the whole reason the header is validated first.
  const parsed = parseSgml(
    new TextDecoder("windows-1252").decode(bytes.subarray(bodyStart)),
    profile.statementAggregate,
  );

  if (Option.isNone(parsed))
    return yield* reject("malformed_sgml", "the element tree is unbalanced");

  const root = yield* element(parsed.value, "OFX", "");
  const shape = messageSets[profile.messageSet];
  const other = messageSets[profile.messageSet === "bank" ? "credit_card" : "bank"];

  if (childrenNamed(root, other.messages).length > 0) {
    return yield* reject(
      "message_set_mismatch",
      `${profile.label} files use ${shape.messages}, found ${other.messages}`,
    );
  }

  const messages = yield* element(root, shape.messages, "OFX");
  const response = yield* element(messages, shape.response, `OFX/${shape.messages}`);
  const statement = yield* element(
    response,
    profile.statementAggregate.opening,
    `OFX/${shape.messages}/${shape.response}`,
  );
  const currency = yield* scalar(statement, "CURDEF", profile.statementAggregate.opening);

  // Every cage comparison, every split, and every balance in this system is
  // AUD. A file denominated in anything else would decode into numbers that
  // silently mean something different.
  if (currency !== "AUD") {
    return yield* reject("unsupported_currency", `CURDEF is ${JSON.stringify(currency)}`);
  }

  const from = yield* element(statement, shape.from, profile.statementAggregate.opening);
  const accountId = yield* scalar(from, "ACCTID", shape.from);
  const list = yield* element(statement, "BANKTRANLIST", profile.statementAggregate.opening);
  const rawStart = yield* scalar(list, "DTSTART", "BANKTRANLIST");
  const rawEnd = yield* scalar(list, "DTEND", "BANKTRANLIST");
  const start = asDate(rawStart);
  const end = asDate(rawEnd);

  if (Option.isNone(start)) {
    return yield* reject("invalid_date", `BANKTRANLIST/DTSTART is ${JSON.stringify(rawStart)}`);
  }

  if (Option.isNone(end)) {
    return yield* reject("invalid_date", `BANKTRANLIST/DTEND is ${JSON.stringify(rawEnd)}`);
  }

  const transactions: CommBankOfxTransaction[] = [];

  for (const [sourceOrdinal, node] of childrenNamed(list, "STMTTRN").entries()) {
    const path = `BANKTRANLIST/STMTTRN[${sourceOrdinal}]`;
    const type = yield* scalar(node, "TRNTYPE", path);
    const rawPosted = yield* scalar(node, "DTPOSTED", path);
    const rawAmount = yield* scalar(node, "TRNAMT", path);
    const narrative = yield* scalar(node, "MEMO", path);
    const rawUser = optionalScalar(node, "DTUSER");
    const rawIdentifier = optionalScalar(node, "FITID");
    const postedDate = asDate(rawPosted);
    const amount = sourceAmount(rawAmount);

    if (Option.isNone(postedDate)) {
      return yield* reject(
        "invalid_date",
        `${path}/DTPOSTED is ${JSON.stringify(rawPosted)}`,
        sourceOrdinal,
      );
    }

    if (Option.isNone(amount)) {
      return yield* reject(
        "invalid_amount",
        `${path}/TRNAMT is ${JSON.stringify(rawAmount)}`,
        sourceOrdinal,
      );
    }

    const userDate = Option.flatMap(rawUser, asDate);

    if (Option.isSome(rawUser) && rawUser.value !== "" && Option.isNone(userDate)) {
      return yield* reject(
        "invalid_date",
        `${path}/DTUSER is ${JSON.stringify(rawUser.value)}`,
        sourceOrdinal,
      );
    }

    transactions.push({
      sourceOrdinal,
      raw: {
        type,
        postedDate: rawPosted,
        userDate: Option.getOrElse(rawUser, () => ""),
        amount: rawAmount,
        identifier: Option.getOrElse(rawIdentifier, () => ""),
        narrative,
      },
      type,
      postedDate: postedDate.value,
      userDate,
      amount: amount.value,
      identifier: Option.filter(rawIdentifier, (value) => value !== ""),
      narrative,
    });
  }

  const ledgerBalance = yield* balance(statement, "LEDGERBAL");
  const availableBalance =
    childrenNamed(statement, "AVAILBAL").length === 0
      ? Option.none<CommBankOfxBalance>()
      : Option.some(yield* balance(statement, "AVAILBAL"));

  return {
    account: {
      messageSet: profile.messageSet,
      bankId: optionalScalar(from, "BANKID"),
      accountId,
      accountType: optionalScalar(from, "ACCTTYPE"),
    },
    currency,
    window: { start: start.value, end: end.value },
    transactions,
    ledgerBalance,
    availableBalance,
  };
});
