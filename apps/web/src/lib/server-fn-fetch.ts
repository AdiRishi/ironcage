import { AppRequestError } from "@repo/contracts/app";

export async function serverFnFetch(...args: Parameters<typeof fetch>) {
  try {
    return await fetch(...args);
  } catch (error) {
    if (error instanceof TypeError)
      throw new AppRequestError("unavailable", "The connection was lost. Please try again.");
    throw error;
  }
}
