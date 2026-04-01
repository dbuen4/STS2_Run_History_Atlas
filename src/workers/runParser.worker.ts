/// <reference lib="webworker" />

import { parseAnalyticsTexts } from "../data/runParser";
import { ParseRequestMessage, ParseSuccessMessage } from "../types";

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", async (event: MessageEvent<ParseRequestMessage>) => {
  if (event.data.type !== "parse-files") {
    return;
  }

  try {
    const files = await Promise.all(
      event.data.files.map(async (file) => ({
        fileName: file.name,
        text: await file.text(),
      }))
    );

    const result = parseAnalyticsTexts(files);
    const message: ParseSuccessMessage = {
      type: "parse-complete",
      result,
    };
    self.postMessage(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parsing failure";
    self.postMessage({
      type: "parse-error",
      message,
    });
  }
});
