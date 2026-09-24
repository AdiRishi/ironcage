import {
  CommandId,
  type Counterparty,
  type CounterpartyKind,
  type CounterpartyRole,
  type MoveAlias,
  type Question,
  type QuestionKind,
  type ReferenceData,
  type SaveCounterparty,
} from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Amount } from "@/components/amount";
import { CategorySelect } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { counterpartyKinds, counterpartyRoles } from "@/features/counterparties/choices";
import { moveAlias, saveCounterparty } from "@/features/counterparties/functions";
import { useCommand } from "@/lib/use-command";

export type QuestionFilter = "who" | "people" | "accounts" | "rules";

const filters: ReadonlyArray<{
  value: QuestionFilter;
  label: string;
  kinds: readonly QuestionKind[];
}> = [
  { value: "who", label: "Who is this", kinds: ["counterparty", "alias", "unresolved"] },
  { value: "people", label: "People", kinds: ["person"] },
  { value: "accounts", label: "Accounts", kinds: ["ownAccount"] },
  { value: "rules", label: "Rule conflicts", kinds: ["ruleConflict"] },
];

export function QuestionsPage({
  questions,
  references,
  filter,
  onFilter,
  children,
}: {
  questions: readonly Question[];
  references: typeof ReferenceData.Type;
  filter: QuestionFilter | null;
  onFilter: (filter: QuestionFilter | null) => void;
  children: React.ReactNode;
}) {
  const shown = filter
    ? questions.filter((question) =>
        filters.find((item) => item.value === filter)?.kinds.includes(question.kind),
      )
    : questions;
  const currency = questions[0]?.outflow.currency;
  const total = questions.reduce(
    (sum, question) => sum + question.outflow.minor + question.inflow.minor,
    0n,
  );
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="type-title">Questions</h1>
        {questions.length === 0 || !currency ? (
          <p className="text-slate">Nothing is waiting on you. Every transaction has a meaning.</p>
        ) : (
          <p className="text-slate">
            {questions.length} {questions.length === 1 ? "answer" : "answers"} would settle{" "}
            <Amount value={{ currency, minor: total }} cents={false} className="text-intaglio" /> of
            your history. Each answer applies to every transaction it covers, past and future.
          </p>
        )}
      </header>

      {questions.length > 0 && (
        <nav aria-label="Kind of question" className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={filter ? "ghost" : "default"}
            aria-pressed={!filter}
            onClick={() => onFilter(null)}
          >
            All <span className="tabular opacity-70">{questions.length}</span>
          </Button>
          {filters.map((item) => {
            const count = questions.filter((question) => item.kinds.includes(question.kind)).length;
            return count === 0 ? null : (
              <Button
                key={item.value}
                size="sm"
                variant={filter === item.value ? "default" : "ghost"}
                aria-pressed={filter === item.value}
                onClick={() => onFilter(item.value)}
              >
                {item.label} <span className="tabular opacity-70">{count}</span>
              </Button>
            );
          })}
        </nav>
      )}

      <ol className="space-y-4">
        {shown.map((question) => (
          <li key={question.id}>
            <QuestionCard question={question} references={references} />
          </li>
        ))}
      </ol>

      {children}
    </div>
  );
}

function QuestionCard({
  question,
  references,
}: {
  question: Question;
  references: typeof ReferenceData.Type;
}) {
  return (
    <article className="space-y-4 rounded-lg border border-rule bg-sheet p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="type-heading">{title(question)}</h2>
        <p className="type-small text-slate">
          {question.eventCount} {question.eventCount === 1 ? "transaction" : "transactions"}
          {question.outflow.minor > 0n && (
            <>
              , <Amount value={question.outflow} cents={false} /> out
            </>
          )}
          {question.inflow.minor > 0n && (
            <>
              , <Amount value={question.inflow} cents={false} /> in
            </>
          )}
        </p>
      </header>
      {question.proposal ? (
        <p className="type-small text-slate">
          The model: {question.proposal.reason} {Math.round(question.proposal.confidence * 100)}%
          sure.
        </p>
      ) : (
        question.counterparty?.source === "model" &&
        question.counterparty.reason && (
          <p className="type-small text-slate">The model: {question.counterparty.reason}</p>
        )
      )}
      <Samples question={question} />
      <Answer question={question} references={references} />
    </article>
  );
}

function title(question: Question) {
  switch (question.kind) {
    case "person":
      return `What are payments with ${question.counterparty?.name ?? "this person"}?`;
    case "counterparty":
      return `Is this ${question.counterparty?.name ?? "right"}?`;
    case "alias":
      return `Is this ${question.counterparty?.name ?? "someone you know"}?`;
    case "ownAccount":
      return `Whose is account ${question.aliasKey?.replace("ACCOUNT ", "ending ") ?? ""}?`;
    case "unresolved":
      return question.counterparty
        ? `What is money with ${question.counterparty.name}?`
        : "Who is this?";
    case "ruleConflict":
      return "Two rules disagree";
  }
}

function Samples({ question }: { question: Question }) {
  return (
    <ul className="divide-y divide-rule/70 border-y border-rule/70 type-small">
      {question.samples.map((sample) => (
        <li key={sample.eventId}>
          <Link
            to="/ledger/$id"
            params={{ id: sample.postingId }}
            className="grid grid-cols-[5.5rem_1fr_auto] gap-3 py-1.5 hover:text-intaglio"
          >
            <span className="text-slate tabular">{sample.postedOn}</span>
            <span className="truncate">{sample.description}</span>
            <Amount value={sample.amount} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Answer({
  question,
  references,
}: {
  question: Question;
  references: typeof ReferenceData.Type;
}) {
  const client = useQueryClient();
  const save = useCommand({
    mutationFn: (data: typeof SaveCounterparty.Type) => saveCounterparty({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const counterparty = question.counterparty;
  const saveAs =
    (target: (typeof SaveCounterparty.Type)["target"]) =>
    (fields: (typeof SaveCounterparty.Type)["fields"]) =>
      save.submit({ commandId: CommandId.make(crypto.randomUUID()), target, fields });
  const create = saveAs({
    kind: "create",
    aliasKeys: question.aliasKey ? [question.aliasKey] : [],
  });
  const submit = counterparty
    ? saveAs({ kind: "update", id: counterparty.id, expectedVersion: counterparty.version })
    : create;
  const busy = save.mutation.isPending;
  const status = save.mutation.error && (
    <p role="alert" className="type-small text-attention">
      {save.mutation.error.message}
    </p>
  );

  if (question.kind === "ruleConflict" || (!counterparty && !question.aliasKey)) {
    const [sample] = question.samples;
    return sample ? (
      <Link
        to="/ledger/$id"
        params={{ id: sample.postingId }}
        className="type-small underline underline-offset-4"
      >
        Open the transaction to choose
      </Link>
    ) : null;
  }

  if (question.kind === "person" && counterparty) {
    return (
      <div className="space-y-2">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">What these payments are</legend>
          {counterpartyRoles.map((role) => (
            <Button
              key={role.value}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                submit({
                  name: counterparty.name,
                  kind: role.value === "transfer" ? "ownAccount" : counterparty.kind,
                  brand: counterparty.brand,
                  defaultCategoryId: counterparty.defaultCategoryId,
                  defaultRole: role.value === "transfer" ? null : role.value,
                })
              }
            >
              {role.value === "transfer" ? "This is me, moving my own money" : role.label}
            </Button>
          ))}
        </fieldset>
        {status}
      </div>
    );
  }

  if (question.kind === "counterparty" && counterparty) {
    const category = references.categories.find(
      (item) => item.id === counterparty.defaultCategoryId,
    );
    return (
      <div className="space-y-2">
        <p className="type-small">
          {counterpartyKinds.find((kind) => kind.value === counterparty.kind)?.label}
          {category ? `, usually ${category.name}` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              submit({
                name: counterparty.name,
                kind: counterparty.kind,
                brand: counterparty.brand,
                defaultCategoryId: counterparty.defaultCategoryId,
                defaultRole: counterparty.defaultRole,
              })
            }
          >
            Yes, that's right
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/counterparties/$counterpartyId"
                params={{ counterpartyId: counterparty.id }}
              />
            }
          >
            Change it
          </Button>
        </div>
        {status}
      </div>
    );
  }

  if (question.kind === "ownAccount") {
    return <OwnAccountAnswer question={question} busy={busy} onSave={submit} status={status} />;
  }

  if (question.kind === "alias" && counterparty && question.aliasKey) {
    return (
      <AliasAnswer
        question={question}
        aliasKey={question.aliasKey}
        counterparty={counterparty}
        references={references}
        busy={busy}
        onCreate={create}
        status={status}
      />
    );
  }

  return (
    <Identify
      question={question}
      counterparty={counterparty}
      references={references}
      busy={busy}
      onSave={submit}
      status={status}
    />
  );
}

// Confirms that a descriptor belongs to the counterparty the model suggested, or names
// the counterparty it really belongs to.
function AliasAnswer({
  question,
  aliasKey,
  counterparty,
  references,
  busy,
  onCreate,
  status,
}: {
  question: Question;
  aliasKey: string;
  counterparty: Counterparty;
  references: typeof ReferenceData.Type;
  busy: boolean;
  onCreate: (fields: (typeof SaveCounterparty.Type)["fields"]) => void;
  status: React.ReactNode;
}) {
  const client = useQueryClient();
  const [someoneElse, setSomeoneElse] = useState(false);
  const confirm = useCommand({
    mutationFn: (data: typeof MoveAlias.Type) => moveAlias({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const pending = busy || confirm.mutation.isPending;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            confirm.submit({
              commandId: CommandId.make(crypto.randomUUID()),
              aliasKey,
              counterpartyId: counterparty.id,
            })
          }
        >
          Yes, it's {counterparty.name}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={someoneElse}
          onClick={() => setSomeoneElse(true)}
        >
          Someone else
        </Button>
      </div>
      {someoneElse && (
        <Identify
          question={question}
          counterparty={null}
          references={references}
          busy={pending}
          onSave={onCreate}
          status={status}
        />
      )}
      {confirm.mutation.error && (
        <p role="alert" className="type-small text-attention">
          {confirm.mutation.error.message}
        </p>
      )}
      {!someoneElse && status}
    </div>
  );
}

function OwnAccountAnswer({
  question,
  busy,
  onSave,
  status,
}: {
  question: Question;
  busy: boolean;
  onSave: (fields: (typeof SaveCounterparty.Type)["fields"]) => void;
  status: React.ReactNode;
}) {
  const id = useId();
  const [someoneElse, setSomeoneElse] = useState(false);
  const [name, setName] = useState("");
  const label = `Account ${question.aliasKey?.replace("ACCOUNT ", "ending ") ?? ""}`;
  const fields = (kind: CounterpartyKind, value: string) => ({
    name: value,
    kind,
    brand: null,
    defaultCategoryId: null,
    defaultRole: null,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onSave(fields("ownAccount", label))}>
          It's mine
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={someoneElse}
          onClick={() => setSomeoneElse(true)}
        >
          It belongs to someone else
        </Button>
      </div>
      {someoneElse && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSave(fields("person", name.trim()));
          }}
        >
          <label className="grid gap-1.5" htmlFor={id}>
            <span className="type-small text-slate">Their name</span>
            <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Save
          </Button>
        </form>
      )}
      {status}
    </div>
  );
}

// Names whoever is behind an alias key, or fixes the defaults of a counterparty whose
// payments still have no role.
function Identify({
  question,
  counterparty,
  references,
  busy,
  onSave,
  status,
}: {
  question: Question;
  counterparty: Counterparty | null;
  references: typeof ReferenceData.Type;
  busy: boolean;
  onSave: (fields: (typeof SaveCounterparty.Type)["fields"]) => void;
  status: React.ReactNode;
}) {
  const id = useId();
  const [name, setName] = useState(counterparty?.name ?? question.samples[0]?.description ?? "");
  const [kind, setKind] = useState<CounterpartyKind>(counterparty?.kind ?? "business");
  const [role, setRole] = useState<typeof CounterpartyRole.Type | "">(
    counterparty?.defaultRole ?? "",
  );
  const [categoryId, setCategoryId] = useState(counterparty?.defaultCategoryId ?? null);
  const hasRole = kind === "person" || kind === "institution";
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(),
          kind,
          brand: counterparty?.brand ?? null,
          defaultCategoryId: kind === "ownAccount" ? null : categoryId,
          defaultRole: hasRole ? role || null : null,
        });
      }}
    >
      <label className="grid gap-1.5" htmlFor={`${id}-name`}>
        <span className="type-small text-slate">Name</span>
        <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="grid gap-1.5" htmlFor={`${id}-kind`}>
        <span className="type-small text-slate">Who they are</span>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => {
            const next = counterpartyKinds.find((item) => item.value === event.target.value);
            if (next) setKind(next.value);
          }}
          className="h-9 rounded-md border border-input bg-sheet px-2.5"
        >
          {counterpartyKinds.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {hasRole && (
        <label className="grid gap-1.5" htmlFor={`${id}-role`}>
          <span className="type-small text-slate">Money to or from them is</span>
          <select
            id={`${id}-role`}
            value={role}
            onChange={(event) => {
              const next = counterpartyRoles.find((item) => item.value === event.target.value);
              setRole(next?.value ?? "");
            }}
            className="h-9 rounded-md border border-input bg-sheet px-2.5"
          >
            <option value="">Decide from each payment</option>
            {counterpartyRoles.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind !== "ownAccount" && (
        <label className="grid gap-1.5" htmlFor={`${id}-category`}>
          <span className="type-small text-slate">Usual category</span>
          <CategorySelect
            id={`${id}-category`}
            categories={references.categories}
            tree={role === "income" ? "income" : "spending"}
            value={categoryId}
            onChange={setCategoryId}
          />
        </label>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          Save for all {question.eventCount}
        </Button>
        {status}
      </div>
    </form>
  );
}
