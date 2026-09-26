import {
  Ask,
  type AskContext,
  type Conversation,
  type ConversationId,
} from "@repo/contracts/analyst";
import { useForm } from "@tanstack/react-form";
import { Schema, Struct } from "effect";
import { useId } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { outcomeUnknown } from "@/lib/use-command";
import { useFocusRequest } from "@/lib/use-focus-request";

import { ContextChip } from "./context";
import { useAsk } from "./use-ask";

const Fields = Schema.Struct(Struct.pick(Ask.fields, ["question"]));

// A question for the analyst, and what it is about. Enter sends it and Shift+Enter starts
// a new line. The analyst answers one question of a conversation at a time, so while it
// works on one the next waits. An example fills in the question for you to send, and
// removing what the question is about leaves you in the question box. Sending disables
// the box, so a question that could not be sent returns focus to it, or to Retry when the
// reply was lost and the box stays disabled until the same question is sent again.
export function Composer({
  label,
  conversationId,
  context,
  onRemoveContext,
  onAsked,
  answering,
  examples = [],
}: {
  label: string;
  conversationId: ConversationId | null;
  context: AskContext | null;
  onRemoveContext?: () => void;
  onAsked?: (conversation: Conversation) => void;
  answering: boolean;
  examples?: ReadonlyArray<string>;
}) {
  const id = useId();
  const [box, focusBox] = useFocusRequest<HTMLTextAreaElement>({ onlyWhenLost: true });
  const [send, focusSend] = useFocusRequest<HTMLButtonElement>({ onlyWhenLost: true });
  const form = useForm({
    defaultValues: { question: "" },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) => command.ask(value.question, context),
  });
  const command = useAsk(conversationId, {
    onAsked: (conversation) => {
      form.reset();
      onAsked?.(conversation);
    },
    onFailed: (error) => (outcomeUnknown(error) ? focusSend : focusBox)(),
  });
  const { mutation, uncertain } = command;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      {examples.length > 0 && (
        <div className="space-y-2">
          <p className="type-small text-slate">Try one of these:</p>
          <ul className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <li key={example}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 text-left whitespace-normal"
                  disabled={mutation.isPending || answering}
                  onClick={() => {
                    form.setFieldValue("question", example);
                    box.current?.focus();
                  }}
                >
                  {example}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <fieldset disabled={mutation.isPending || uncertain || answering}>
        <form.Field name="question">
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0} className="gap-2">
              <FieldLabel htmlFor={`${id}-question`}>{label}</FieldLabel>
              {context && (
                <p className="flex min-w-0 items-center gap-2 type-small text-slate">
                  About{" "}
                  <ContextChip
                    context={context}
                    onRemove={
                      onRemoveContext &&
                      (() => {
                        onRemoveContext();
                        box.current?.focus();
                      })
                    }
                  />
                </p>
              )}
              <Textarea
                id={`${id}-question`}
                ref={box}
                rows={2}
                required
                maxLength={2000}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={`${id}-hint ${id}-error`}
              />
              <FieldDescription id={`${id}-hint`}>
                {answering
                  ? "The analyst is answering. Ask your next question once it has."
                  : "Enter sends the question. Shift+Enter starts a new line."}
              </FieldDescription>
              <FieldError id={`${id}-error`} errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </fieldset>
      {mutation.error && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
      <Button ref={send} type="submit" disabled={mutation.isPending || answering}>
        {mutation.isPending ? "Asking…" : uncertain ? "Retry" : "Ask"}
      </Button>
    </form>
  );
}
