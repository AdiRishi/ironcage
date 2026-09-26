import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render } from "vitest-browser-react";

import { getRouter } from "@/router";
import { Route as root } from "@/routes/__root";

// The app's router, with its routes and pages, opened at an address. The route tree
// imports every feature's server functions, so a test that opens the app mocks
// `createServerFn` to make each one a mock. The root's shell renders <html> and <body>,
// which would land inside the test's container, and Chromium hangs focusing a text field
// under a nested <body>, so the pages render without it.
export async function openApp(
  address: string,
  onTestFinished: (cleanup: () => Promise<void>) => void,
) {
  const router = getRouter();
  Object.assign(root.options, { shellComponent: undefined });
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
  return router;
}
