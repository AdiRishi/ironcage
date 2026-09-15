import {
  CalendarDate,
  CommandId,
  type DeleteReference,
  type ReferenceWrite,
} from "@repo/contracts/finance";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { referenceDataQuery } from "@/features/events/queries";
import { useCommand } from "@/lib/use-command";

import { ReferenceEditor } from "./editor";
import { deleteReference } from "./functions";

export function ReferencesPage() {
  const { data } = useSuspenseQuery(referenceDataQuery());
  const [draft, setDraft] = useState<typeof ReferenceWrite.Type | null>(null);
  const client = useQueryClient();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (input: typeof DeleteReference.Type) => deleteReference({ data: input }),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const today = CalendarDate.make(new Intl.DateTimeFormat("en-CA").format(new Date()));
  const records: ReadonlyArray<typeof ReferenceWrite.Type> = [
    ...data.categories.map((category) => ({
      kind: "category" as const,
      target: { kind: "update" as const, id: category.id, expectedVersion: category.version },
      name: category.name,
      parentId: category.parentId,
      archived: category.archived,
    })),
    ...data.merchants.map((merchant) => ({
      kind: "merchant" as const,
      target: { kind: "update" as const, id: merchant.id, expectedVersion: merchant.version },
      name: merchant.name,
      aliases: merchant.aliases,
    })),
    ...data.tags.map((tag) => ({
      kind: "tag" as const,
      target: { kind: "update" as const, id: tag.id, expectedVersion: tag.version },
      name: tag.name,
    })),
    ...data.personalEvents.map((personal) => ({
      kind: "personalEvent" as const,
      target: { kind: "update" as const, id: personal.id, expectedVersion: personal.version },
      name: personal.name,
      startOn: personal.startOn,
      endOn: personal.endOn,
      excludeFromOrdinary: personal.excludeFromOrdinary,
    })),
  ];
  const sections = [
    {
      kind: "category",
      label: "Categories",
      create: {
        kind: "category",
        target: { kind: "create" },
        name: "",
        parentId: null,
        archived: false,
      },
    },
    {
      kind: "merchant",
      label: "Merchants",
      create: { kind: "merchant", target: { kind: "create" }, name: "", aliases: [] },
    },
    { kind: "tag", label: "Tags", create: { kind: "tag", target: { kind: "create" }, name: "" } },
    {
      kind: "personalEvent",
      label: "Personal events",
      create: {
        kind: "personalEvent",
        target: { kind: "create" },
        name: "",
        startOn: today,
        endOn: today,
        excludeFromOrdinary: false,
      },
    },
  ] satisfies ReadonlyArray<{
    kind: (typeof ReferenceWrite.Type)["kind"];
    label: string;
    create: typeof ReferenceWrite.Type;
  }>;
  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <Link to="/settings" className="text-primary underline">
          Settings
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">Categories and labels</h1>
      </header>
      {draft && (
        <ReferenceEditor
          key={draft.target.kind === "update" ? draft.target.id : draft.kind}
          record={draft}
          references={data}
          onClose={() => setDraft(null)}
        />
      )}
      {mutation.error && (
        <p role="alert">
          {mutation.error.message}
          {uncertain && (
            <Button
              onClick={() => {
                if (mutation.variables) submit(mutation.variables);
              }}
            >
              Retry deletion
            </Button>
          )}
        </p>
      )}
      {sections.map((section) => (
        <section key={section.kind} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{section.label}</h2>
            <Button variant="outline" onClick={() => setDraft(section.create)}>
              Add {section.kind === "personalEvent" ? "personal event" : section.kind}
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {records
              .filter((record) => record.kind === section.kind)
              .map((record) => (
                <li
                  key={record.target.kind === "update" ? record.target.id : record.kind}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {record.kind === "category" &&
                        record.parentId &&
                        `${data.categories.find((parent) => parent.id === record.parentId)?.name} / `}
                      {record.name}
                      {record.kind === "category" && record.archived && " · Archived"}
                    </p>
                    {record.kind === "merchant" && (
                      <p className="text-sm text-muted-foreground">{record.aliases.join(", ")}</p>
                    )}
                    {record.kind === "personalEvent" && (
                      <p className="text-sm text-muted-foreground">
                        {record.startOn} through {record.endOn}
                        {record.excludeFromOrdinary && " · Excluded from ordinary costs"}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setDraft(record)}>
                      Edit {record.name}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={mutation.isPending || uncertain}
                      onClick={() => {
                        if (record.target.kind !== "update") return;
                        switch (record.kind) {
                          case "category":
                            if (record.target.kind === "update")
                              submit({
                                commandId: CommandId.make(crypto.randomUUID()),
                                record: {
                                  kind: record.kind,
                                  id: record.target.id,
                                  expectedVersion: record.target.expectedVersion,
                                },
                              });
                            break;
                          case "merchant":
                            if (record.target.kind === "update")
                              submit({
                                commandId: CommandId.make(crypto.randomUUID()),
                                record: {
                                  kind: record.kind,
                                  id: record.target.id,
                                  expectedVersion: record.target.expectedVersion,
                                },
                              });
                            break;
                          case "tag":
                            if (record.target.kind === "update")
                              submit({
                                commandId: CommandId.make(crypto.randomUUID()),
                                record: {
                                  kind: record.kind,
                                  id: record.target.id,
                                  expectedVersion: record.target.expectedVersion,
                                },
                              });
                            break;
                          case "personalEvent":
                            if (record.target.kind === "update")
                              submit({
                                commandId: CommandId.make(crypto.randomUUID()),
                                record: {
                                  kind: record.kind,
                                  id: record.target.id,
                                  expectedVersion: record.target.expectedVersion,
                                },
                              });
                            break;
                        }
                      }}
                    >
                      Delete {record.name}
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
          {!records.some((record) => record.kind === section.kind) && (
            <p className="text-sm text-muted-foreground">None yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
