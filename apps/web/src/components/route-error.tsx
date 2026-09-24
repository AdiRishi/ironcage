import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";

import { AppRequestError } from "@/lib/app-error";

import { Button } from "./ui/button";

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div role="alert" className="max-w-lg space-y-4 rounded-lg border border-rule bg-sheet p-6">
      <h1 className="type-heading">This page could not load</h1>
      <p className="text-slate">
        {error instanceof AppRequestError
          ? error.message
          : "The service could not complete the request. Try loading the page again."}
      </p>
      <Button
        variant="outline"
        onClick={() => {
          router.invalidate().then(reset).catch(reportError);
        }}
      >
        Try again
      </Button>
    </div>
  );
}
