import type { SalesDeal } from "../monday";

export type NotesResult =
  | { status: "readable"; text: string }
  | { status: "missing" }
  | { status: "inaccessible"; reason: string };

export async function readFirstCallNotes(deal: SalesDeal): Promise<NotesResult> {
  if (deal.geminiNotesStatus === "Pasted in Monday" && deal.salesCallNotes.trim()) {
    return { status: "readable", text: deal.salesCallNotes.trim() };
  }
  if (!deal.geminiNotesUrl) return { status: "missing" };
  const documentId = deal.geminiNotesUrl.match(/\/document\/d\/([^/]+)/)?.[1];
  if (!documentId) return { status: "inaccessible", reason: "The Gemini link is not a supported Google Doc URL." };
  try {
    const response = await fetch(`https://docs.google.com/document/d/${documentId}/export?format=txt`, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { status: "inaccessible", reason: `Gemini document returned HTTP ${response.status}.` };
    const text = (await response.text()).trim();
    if (!text) return { status: "inaccessible", reason: "The Gemini document is empty." };
    return { status: "readable", text };
  } catch (error) {
    return { status: "inaccessible", reason: error instanceof Error ? error.message : "Unable to read Gemini document." };
  }
}
