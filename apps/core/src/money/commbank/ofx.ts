import type { Money } from "@ironcage/domain";
import { Effect, Option, Schema } from "effect";

import { type SourceDate, sourceAmount, sourceDate } from "../values";
import {
  type CommBankAccountProfile,
  commBankAccountProfiles,
  type CommBankProfileId,
} from "./profiles";

export type CommBankOfxAccount =
  | {
      readonly messageSet: "bank";
      readonly bankId: string;
      readonly accountId: string;
      readonly accountType: string;
    }
  | {
      readonly messageSet: "credit_card";
      readonly accountId: string;
    };

export interface CommBankOfxTransaction {
  readonly sourceOrdinal: number;
  readonly raw: {
    readonly type: string;
    readonly postedDate: string;
    readonly userDate: string;
    readonly amount: string;
    readonly identifier: string;
    readonly narrative: string;
  };
  readonly type: string;
  readonly postedDate: SourceDate;
  readonly userDate: SourceDate;
  readonly amount: Money;
  readonly identifier: Option.Option<string>;
  readonly narrative: string;
}

export interface CommBankOfxBalance {
  readonly amount: Money;
  readonly asOfDate: SourceDate;
  readonly raw: string;
}

export interface CommBankOfxFile {
  readonly account: CommBankOfxAccount;
  readonly currency: "AUD";
  readonly window: { readonly start: SourceDate; readonly end: SourceDate };
  readonly transactions: readonly CommBankOfxTransaction[];
  readonly ledgerBalance: CommBankOfxBalance;
  readonly availableBalance: Option.Option<CommBankOfxBalance>;
}

export class CommBankOfxRejected extends Schema.TaggedError<CommBankOfxRejected>()(
  "CommBankOfxRejected",
  {
    reason: Schema.Literals([
      "undecodable_bytes",
      "missing_header",
      "duplicate_header",
      "unsupported_header",
      "malformed_sgml",
      "message_set_mismatch",
      "missing_element",
      "duplicate_element",
      "unexpected_children",
      "unexpected_element",
      "invalid_date",
      "invalid_amount",
      "invalid_window",
      "transaction_outside_window",
      "source_order",
      "identifier_policy",
      "account_type_mismatch",
      "unsupported_currency",
    ]),
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const reject = (
  reason: CommBankOfxRejected["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankOfxRejected({ reason, sourceOrdinal, detail });

const supportedHeader = {
  OFXHEADER: "100",
  DATA: "OFXSGML",
  VERSION: "102",
  SECURITY: "NONE",
  ENCODING: "USASCII",
  CHARSET: "1252",
  COMPRESSION: "NONE",
} as const;

interface OfxNode {
  readonly tag: string;
  readonly value: string | null;
  readonly children: OfxNode[];
}

const aggregateTags = new Set([
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

const tagName = /^\/?[A-Z][A-Z0-9]*$/;

const sourceValue = (content: string) => content.replace(/\r?\n$/, "");

const parseSgml = (
  body: string,
  statementAggregate: CommBankAccountProfile["statementAggregate"],
): Option.Option<OfxNode> => {
  const document: OfxNode = { tag: "#document", value: null, children: [] };
  const open: OfxNode[] = [document];
  let cursor = 0;

  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);

    if (start === -1) {
      return body.slice(cursor).trim() === "" && open.length === 1
        ? Option.some(document)
        : Option.none();
    }

    if (body.slice(cursor, start).trim() !== "") return Option.none();

    const end = body.indexOf(">", start + 1);

    if (end === -1) return Option.none();

    const tag = body.slice(start + 1, end);

    if (!tagName.test(tag)) return Option.none();

    const next = body.indexOf("<", end + 1);
    const content = next === -1 ? body.slice(end + 1) : body.slice(end + 1, next);
    const text = sourceValue(content);

    cursor = next === -1 ? body.length : next;

    if (tag.startsWith("/")) {
      const closing = tag.slice(1);
      const current = open.at(-1);
      const isProfileClose =
        current?.tag === statementAggregate.opening && closing === statementAggregate.closing;

      if (
        current === undefined ||
        (current.tag !== closing && !isProfileClose) ||
        text.trim() !== ""
      ) {
        return Option.none();
      }

      open.pop();
      continue;
    }

    const parent = open.at(-1);

    if (parent === undefined) return Option.none();

    if (aggregateTags.has(tag)) {
      if (text.trim() !== "") return Option.none();

      const node: OfxNode = { tag, value: null, children: [] };

      parent.children.push(node);
      open.push(node);
      continue;
    }

    parent.children.push({ tag, value: text, children: [] });
  }

  return open.length === 1 ? Option.some(document) : Option.none();
};

const childrenNamed = (node: OfxNode, tag: string) =>
  node.children.filter((child) => child.tag === tag);

const element = (node: OfxNode, tag: string, path: string, sourceOrdinal: number | null = null) =>
  Effect.gen(function* () {
    const found = childrenNamed(node, tag);
    const first = found[0];

    if (first === undefined) {
      return yield* reject("missing_element", `${path}/${tag} is absent`, sourceOrdinal);
    }

    if (found.length > 1) {
      return yield* reject(
        "duplicate_element",
        `${path}/${tag} appears ${found.length} times`,
        sourceOrdinal,
      );
    }

    return first;
  });

const optionalElement = (
  node: OfxNode,
  tag: string,
  path: string,
  sourceOrdinal: number | null = null,
) =>
  Effect.gen(function* () {
    const found = childrenNamed(node, tag);

    if (found.length > 1) {
      return yield* reject(
        "duplicate_element",
        `${path}/${tag} appears ${found.length} times`,
        sourceOrdinal,
      );
    }

    return Option.fromUndefinedOr(found[0]);
  });

const scalar = (node: OfxNode, tag: string, path: string, sourceOrdinal: number | null = null) =>
  Effect.gen(function* () {
    const found = yield* element(node, tag, path, sourceOrdinal);

    if (found.children.length > 0 || found.value === null) {
      return yield* reject(
        "unexpected_children",
        `${path}/${tag} is an aggregate, not a value`,
        sourceOrdinal,
      );
    }

    return found.value;
  });

const nonEmptyScalar = (
  node: OfxNode,
  tag: string,
  path: string,
  sourceOrdinal: number | null = null,
) =>
  Effect.gen(function* () {
    const value = yield* scalar(node, tag, path, sourceOrdinal);

    if (value === "") {
      return yield* reject("missing_element", `${path}/${tag} is empty`, sourceOrdinal);
    }

    return value;
  });

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

const balance = (statement: OfxNode, tag: "LEDGERBAL" | "AVAILBAL") =>
  Effect.gen(function* () {
    const node = yield* element(statement, tag, "OFX");
    const rawAmount = yield* nonEmptyScalar(node, "BALAMT", tag);
    const rawAsOf = yield* nonEmptyScalar(node, "DTASOF", tag);
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
  profileId: CommBankProfileId,
): Effect.fn.Return<CommBankOfxFile, CommBankOfxRejected> {
  const profile = commBankAccountProfiles[profileId];
  const bodyStart = bytes.indexOf(0x3c);

  if (bodyStart === -1) {
    return yield* reject("missing_header", "the file contains no SGML document");
  }

  const headerBytes = bytes.subarray(0, bodyStart);
  const highByte = headerBytes.findIndex((byte) => byte > 0x7f);

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

    const field = line.slice(0, separator).trim();

    if (header.has(field)) {
      return yield* reject("duplicate_header", `${field} appears more than once`);
    }

    header.set(field, line.slice(separator + 1).trim());
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

  const parsed = parseSgml(
    new TextDecoder("windows-1252").decode(bytes.subarray(bodyStart)),
    profile.statementAggregate,
  );

  if (Option.isNone(parsed)) {
    return yield* reject("malformed_sgml", "the SGML aggregate structure is invalid");
  }

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
  const currency = yield* nonEmptyScalar(statement, "CURDEF", profile.statementAggregate.opening);

  if (currency !== "AUD") {
    return yield* reject("unsupported_currency", `CURDEF is ${JSON.stringify(currency)}`);
  }

  const from = yield* element(statement, shape.from, profile.statementAggregate.opening);
  const accountId = yield* nonEmptyScalar(from, "ACCTID", shape.from);
  let account: CommBankOfxAccount;

  if (profile.messageSet === "bank") {
    const bankId = yield* nonEmptyScalar(from, "BANKID", shape.from);
    const accountType = yield* nonEmptyScalar(from, "ACCTTYPE", shape.from);
    const expectedAccountType = profile.accountType === "credit_line" ? "CREDITLINE" : "SAVINGS";

    if (accountType !== expectedAccountType) {
      return yield* reject(
        "account_type_mismatch",
        `${profile.label} expects ACCTTYPE ${expectedAccountType}, found ${JSON.stringify(accountType)}`,
      );
    }

    account = { messageSet: "bank", bankId, accountId, accountType };
  } else {
    const unexpected = ["BANKID", "ACCTTYPE"].filter((tag) => childrenNamed(from, tag).length > 0);

    if (unexpected.length > 0) {
      return yield* reject(
        "unexpected_element",
        `${shape.from} contains bank-only ${unexpected.join(", ")}`,
      );
    }

    account = { messageSet: "credit_card", accountId };
  }

  const list = yield* element(statement, "BANKTRANLIST", profile.statementAggregate.opening);
  const rawStart = yield* nonEmptyScalar(list, "DTSTART", "BANKTRANLIST");
  const rawEnd = yield* nonEmptyScalar(list, "DTEND", "BANKTRANLIST");
  const start = asDate(rawStart);
  const end = asDate(rawEnd);

  if (Option.isNone(start)) {
    return yield* reject("invalid_date", `BANKTRANLIST/DTSTART is ${JSON.stringify(rawStart)}`);
  }

  if (Option.isNone(end)) {
    return yield* reject("invalid_date", `BANKTRANLIST/DTEND is ${JSON.stringify(rawEnd)}`);
  }

  if (start.value > end.value) {
    return yield* reject(
      "invalid_window",
      `BANKTRANLIST starts ${start.value} after it ends ${end.value}`,
    );
  }

  const transactions: CommBankOfxTransaction[] = [];

  for (const [sourceOrdinal, node] of childrenNamed(list, "STMTTRN").entries()) {
    const path = `BANKTRANLIST/STMTTRN[${sourceOrdinal}]`;
    const type = yield* nonEmptyScalar(node, "TRNTYPE", path, sourceOrdinal);
    const rawPosted = yield* nonEmptyScalar(node, "DTPOSTED", path, sourceOrdinal);
    const rawUser = yield* nonEmptyScalar(node, "DTUSER", path, sourceOrdinal);
    const rawAmount = yield* nonEmptyScalar(node, "TRNAMT", path, sourceOrdinal);
    const rawIdentifier = yield* scalar(node, "FITID", path, sourceOrdinal);
    const narrative = yield* scalar(node, "MEMO", path, sourceOrdinal);
    const postedDate = asDate(rawPosted);
    const userDate = asDate(rawUser);
    const amount = sourceAmount(rawAmount);

    if (Option.isNone(postedDate)) {
      return yield* reject(
        "invalid_date",
        `${path}/DTPOSTED is ${JSON.stringify(rawPosted)}`,
        sourceOrdinal,
      );
    }

    if (Option.isNone(userDate)) {
      return yield* reject(
        "invalid_date",
        `${path}/DTUSER is ${JSON.stringify(rawUser)}`,
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

    if (postedDate.value < start.value || postedDate.value > end.value) {
      return yield* reject(
        "transaction_outside_window",
        `${path}/DTPOSTED ${postedDate.value} is outside ${start.value} to ${end.value}`,
        sourceOrdinal,
      );
    }

    const previous = transactions.at(-1);

    if (previous !== undefined && previous.postedDate < postedDate.value) {
      return yield* reject(
        "source_order",
        `${postedDate.value} is newer than the preceding transaction ${previous.postedDate}`,
        sourceOrdinal,
      );
    }

    const hasIdentifier = rawIdentifier !== "";

    if ((profile.identifier === "stable") !== hasIdentifier) {
      return yield* reject(
        "identifier_policy",
        `${profile.label} requires FITID to be ${profile.identifier === "stable" ? "populated" : "empty"}`,
        sourceOrdinal,
      );
    }

    transactions.push({
      sourceOrdinal,
      raw: {
        type,
        postedDate: rawPosted,
        userDate: rawUser,
        amount: rawAmount,
        identifier: rawIdentifier,
        narrative,
      },
      type,
      postedDate: postedDate.value,
      userDate: userDate.value,
      amount: amount.value,
      identifier: hasIdentifier ? Option.some(rawIdentifier) : Option.none(),
      narrative,
    });
  }

  const ledgerBalance = yield* balance(statement, "LEDGERBAL");
  const availableNode = yield* optionalElement(statement, "AVAILBAL", "OFX");
  const availableBalance = Option.isSome(availableNode)
    ? Option.some(yield* balance(statement, "AVAILBAL"))
    : Option.none<CommBankOfxBalance>();

  return {
    account,
    currency: "AUD",
    window: { start: start.value, end: end.value },
    transactions,
    ledgerBalance,
    availableBalance,
  };
});
