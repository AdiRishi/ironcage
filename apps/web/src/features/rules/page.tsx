import { CommandId, type DeleteRule, type Rule } from "@repo/contracts/finance";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { RuleEditor } from "./editor";
import { deleteRule, getRuleExceptions, listRules } from "./functions";
export function RulesPage() {
  const query = useQuery({ queryKey: ["rules"], queryFn: () => listRules() });
  const [editing, setEditing] = useState<{ rule: Rule | null } | null>(null);
  const client = useQueryClient();
  const deletion = useCommand({
    mutationFn: (data: typeof DeleteRule.Type) => deleteRule({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <div className="max-w-5xl space-y-6">
      <header className="space-y-2">
        <Link to="/settings" className="type-small text-slate hover:text-intaglio">
          Settings
        </Link>
        <h1 className="type-title">Rules</h1>
        <p className="max-w-3xl text-slate">
          A rule sets the role or category of every transaction it matches, ahead of the model and
          the bank. Your own corrections still win. You see what a rule changes before it applies,
          and deleting one stops it without undoing what it already set.
        </p>
      </header>
      <Button onClick={() => setEditing({ rule: null })}>New rule</Button>
      {query.data?.length === 0 && (
        <p className="text-slate">
          No rules yet. Most transactions follow their counterparty, so a rule is for the
          exceptions, such as every transfer with the word Rent in its description.
        </p>
      )}
      {query.data?.map((rule) => (
        <section
          className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-rule bg-sheet p-4"
          key={rule.id}
        >
          <div>
            <h2 className="font-medium">{rule.name}</h2>
            <p className="type-small text-slate">
              {rule.action.kind === "category" ? "Set category" : "Set financial role"} ·{" "}
              {rule.scope}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing({ rule })}>
              Edit rule
            </Button>
            <Button
              variant="ghost"
              disabled={deletion.mutation.isPending}
              onClick={() =>
                deletion.submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  ruleId: rule.id,
                  expectedVersion: rule.version,
                })
              }
            >
              {deletion.uncertain ? "Retry deletion" : "Delete rule"}
            </Button>
          </div>
        </section>
      ))}
      {query.error && <p role="alert">{query.error.message}</p>}
      {deletion.mutation.error && <p role="alert">{deletion.mutation.error.message}</p>}
      {editing &&
        (editing.rule ? (
          <ExistingEditor
            key={editing.rule.id}
            rule={editing.rule}
            onClose={() => setEditing(null)}
          />
        ) : (
          <RuleEditor rule={null} initialExceptions={[]} onClose={() => setEditing(null)} />
        ))}
    </div>
  );
}
function ExistingEditor({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["ruleExceptions", rule.id],
    queryFn: () => getRuleExceptions({ data: { ruleId: rule.id } }),
  });
  if (query.error) return <p role="alert">{query.error.message}</p>;
  return query.data ? (
    <RuleEditor rule={rule} initialExceptions={query.data} onClose={onClose} />
  ) : (
    <p>Loading exceptions…</p>
  );
}
