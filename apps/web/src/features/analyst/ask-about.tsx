import type { AskContext } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";

// Opens a new question about the selection it sits on. It is a link, so assistive
// technology announces where it goes. Where a screen offers one for each of several
// selections, `subject` names its selection in the link's name.
export function AskAbout({
  about,
  subject,
  children = "Ask about this",
}: {
  about: AskContext;
  subject?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      to="/analyst"
      search={{ about }}
      aria-label={subject && `Ask about this: ${subject}`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      {children}
    </Link>
  );
}
