import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { extractStatement } from "./extract.js";

const port = 8080;
const maximumPdfBytes = 25 * 1024 * 1024;

const readBody = async (request: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumPdfBytes) throw new Error("statement exceeds 25 MiB");
    chunks.push(chunk);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
};

const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(204).end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/extract") {
    response.writeHead(404).end();
    return;
  }

  try {
    const pdf = await readBody(request);
    if (pdf.length < 5 || new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-") {
      response.writeHead(400).end("expected PDF bytes");
      return;
    }

    const result = await extractStatement(pdf);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "statement extraction failed";
    response.writeHead(422).end(message);
  }
};

createServer((request, response) => void handleRequest(request, response)).listen(port, "0.0.0.0");
