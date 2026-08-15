const windows1252 = new TextDecoder("windows-1252");

export const decodeWindows1252 = (bytes: Uint8Array): string => windows1252.decode(bytes);

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
