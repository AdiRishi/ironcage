import type { Figure } from "@repo/contracts/analyst";
import { figureText, formatCurrency } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { settingsQueryOptions } from "@/features/settings/queries";
import { instantLabel } from "@/lib/time";

import { recordLink } from "./record-link";

// How much of the figure rests on the model's reading of transactions, when any does.
const modelShare = (figure: Figure) =>
  figure.modelAmount !== null && figure.modelAmount.minor !== 0n ? figure.modelAmount : null;

// A number an answer quotes, as a link to the screen that shows the same number. Part of
// it resting on the model draws the model's hollow ring beside it. What the number is and
// when it was calculated show on hover and focus, and are read with the link.
export function FigureLink({ figure }: { figure: Figure }) {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const model = modelShare(figure);
  const note = model && `${formatCurrency(model)} of this is model-assigned.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link {...recordLink(figure.records)} />}
        className="font-[560] whitespace-nowrap tabular underline decoration-rule decoration-2 underline-offset-4 hover:decoration-intaglio"
      >
        {figureText(figure.value)}
        {model && (
          <span
            aria-hidden
            className="ml-1 inline-block size-2 rounded-full border-[1.5px] border-slate"
          />
        )}
        <span className="sr-only">
          {" "}
          ({figure.label}.{note && ` ${note}`})
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0 type-small!">
        <span>{figure.label}</span>
        {note && <span>{note}</span>}
        <span>Calculated {instantLabel(figure.calculatedAt, settings.timezone)}</span>
      </TooltipContent>
    </Tooltip>
  );
}
