import { CommandId, type DeleteRule, type Rule } from "@repo/contracts/finance";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
      <header>
        <h1 className="type-title">Interpretation rules</h1>
        <p className="mt-2 text-slate">
          Preview changes before applying them. Corrections and accepted relationships take
          precedence. Deleting a rule keeps its accepted interpretations and stops future use.
        </p>
      </header>
      <Button onClick={() => setEditing({ rule: null })}>New rule</Button>
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
