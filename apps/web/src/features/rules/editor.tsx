import {
  CommandId,
  FinancialRole,
  Rule,
  RuleId,
  type EventId,
  type PreviewRule,
  type SaveRule,
} from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { accountsQueryOptions } from "../accounts/queries";
import { ReferenceChoice } from "../events/choice";
import { ImpactTable } from "../events/impact";
import { referenceDataQuery } from "../events/queries";
import { previewRule, saveRule } from "./functions";
export function RuleEditor({
  rule,
  initialExceptions,
  onClose,
}: {
  rule: Rule | null;
  initialExceptions: readonly (typeof EventId.Type)[];
  onClose: () => void;
}) {
  const id = useId();
  const [ruleId] = useState(() => rule?.id ?? RuleId.make(crypto.randomUUID()));
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const references = useQuery(referenceDataQuery());
  const accounts = useQuery(accountsQueryOptions());
  const client = useQueryClient();
  const defaults: Rule = rule ?? {
    id: ruleId,
    name: "",
    conditions: { accountId: null, role: null, merchantId: null, description: "" },
    action: { kind: "role", role: "income" },
    scope: "both",
    version: 1,
  };
  const preview = useMutation({
    mutationFn: (data: typeof PreviewRule.Type) => previewRule({ data }),
  });
  const command = useCommand({
    mutationFn: (data: typeof SaveRule.Type) => saveRule({ data }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  const form = useForm({
    defaultValues: defaults,
    onSubmit: ({ value }) => {
      const result = Schema.decodeResult(Rule)(value);
      if (result._tag === "Failure") {
        setError("Name the rule and choose its condition and action.");
        return;
      }
      setError(null);
      preview.mutate({ rule: result.success, exceptionEventIds: exceptions });
    },
  });
  const change = () => preview.reset();
  return (
    <form
      className="space-y-5 rounded-lg border p-5"
      onChange={change}
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <h3 className="text-lg font-medium">{rule ? "Edit rule" : "New rule"}</h3>
      <fieldset className="space-y-4" disabled={command.mutation.isPending || command.uncertain}>
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>Rule name</Label>
              <Input
                id={`${id}-name`}
                required
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="conditions.accountId">
            {(field) => (
              <ReferenceChoice
                label="Match account"
                value={field.state.value}
                options={(accounts.data ?? []).map((account) => ({
                  id: account.id,
                  name: account.label,
                }))}
                onChange={(value) => {
                  field.handleChange(value);
                  change();
                }}
              />
            )}
          </form.Field>
          <form.Field name="conditions.role">
            {(field) => (
              <ReferenceChoice
                label="Match financial role"
                value={field.state.value}
                options={FinancialRole.literals.map((role) => ({
                  id: role,
                  name: financialRoleLabels[role],
                }))}
                onChange={(value) => {
                  field.handleChange(value);
                  change();
                }}
              />
            )}
          </form.Field>
          <form.Field name="conditions.merchantId">
            {(field) => (
              <ReferenceChoice
                label="Match merchant or alias"
                value={field.state.value}
                options={references.data?.merchants ?? []}
                onChange={(value) => {
                  field.handleChange(value);
                  change();
                }}
              />
            )}
          </form.Field>
          <form.Field name="conditions.description">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-description`}>Description contains</Label>
                <Input
                  id={`${id}-description`}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
        <form.Field name="action">
          {(field) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <ReferenceChoice
                label="Rule action"
                value={field.state.value.kind}
                options={[
                  { id: "category", name: "Set category" },
                  { id: "role", name: "Set financial role" },
                ]}
                onChange={(value) => {
                  if (value === "role") field.handleChange({ kind: "role", role: "income" });
                  else if (value === "category" && references.data?.categories[0])
                    field.handleChange({
                      kind: "category",
                      categoryId: references.data.categories[0].id,
                    });
                  change();
                }}
              />
              {field.state.value.kind === "category" ? (
                <ReferenceChoice
                  label="Rule category"
                  value={field.state.value.categoryId}
                  options={
                    references.data?.categories.filter((category) => !category.archived) ?? []
                  }
                  onChange={(value) => {
                    if (value) field.handleChange({ kind: "category", categoryId: value });
                    change();
                  }}
                />
              ) : (
                <ReferenceChoice
                  label="Rule financial role"
                  value={field.state.value.role}
                  options={FinancialRole.literals.map((role) => ({
                    id: role,
                    name: financialRoleLabels[role],
                  }))}
                  onChange={(value) => {
                    if (value) field.handleChange({ kind: "role", role: value });
                    change();
                  }}
                />
              )}
            </div>
          )}
        </form.Field>
        <form.Field name="scope">
          {(field) => (
            <ReferenceChoice
              label="Apply rule to"
              value={field.state.value}
              options={[
                { id: "past", name: "Existing events" },
                { id: "future", name: "Future interpretations" },
                { id: "both", name: "Existing and future events" },
              ]}
              onChange={(value) => {
                if (value) field.handleChange(value);
                change();
              }}
            />
          )}
        </form.Field>
        <Button type="submit" disabled={preview.isPending}>
          {preview.isPending ? "Calculating…" : "Preview rule"}
        </Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {[preview.error, command.mutation.error, accounts.error, references.error]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p key={index} role="alert">
            {error.message}
          </p>
        ))}
      {preview.data && (
        <div className="space-y-4">
          <p>
            {preview.data.matched} matching events · {preview.data.affected.length} affected ·{" "}
            {preview.data.exceptions.length} exceptions · {preview.data.conflicts.length} conflicts
          </p>
          {preview.data.impacts.map((impact) => (
            <ImpactTable key={`${impact.currency}:${impact.start}`} impact={impact} />
          ))}
          <p className="text-sm text-muted-foreground">
            Exclude individual events below, then preview again. Specific corrections and splits
            always take precedence.
          </p>
          <ul className="space-y-3">
            {preview.data.matches.slice(0, limit).map((match) => (
              <li
                key={match.eventId}
                className="flex flex-wrap items-start justify-between gap-3 rounded border p-3"
              >
                <div>
                  <Link
                    className="underline"
                    to="/transactions/$id"
                    params={{ id: match.postingId }}
                  >
                    {match.postedOn} · {match.description}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {preview.data?.exceptions.find((row) => row.eventId === match.eventId)
                      ?.reason ??
                      (preview.data?.conflicts.includes(match.eventId)
                        ? "Conflicting rules. No rule action applied."
                        : "Matches rule")}
                  </p>
                </div>
                <Label>
                  <Checkbox
                    checked={exceptions.includes(match.eventId)}
                    onCheckedChange={(checked) => {
                      setExceptions((current) =>
                        checked
                          ? [...current, match.eventId]
                          : current.filter((id) => id !== match.eventId),
                      );
                      preview.reset();
                    }}
                  />
                  Exclude event
                </Label>
              </li>
            ))}
          </ul>
          {preview.data.matches.length > limit && (
            <Button type="button" variant="outline" onClick={() => setLimit((value) => value + 50)}>
              More matching events
            </Button>
          )}
          <Button
            type="button"
            disabled={command.mutation.isPending}
            onClick={() => {
              if (preview.data)
                command.submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  rule: preview.data.rule,
                  exceptionEventIds: preview.data.exceptionEventIds,
                  expectedVersion: rule?.version ?? null,
                  expectedVersions: preview.data.expectedVersions,
                });
            }}
          >
            {command.uncertain ? "Retry rule" : "Save rule"}
          </Button>
        </div>
      )}
      <Button type="button" variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </form>
  );
}
