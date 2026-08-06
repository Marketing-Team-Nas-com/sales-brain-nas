export const realQuestionnaireUpdate = {
  id: "9876543210",
  created_at: "2026-07-29T09:42:17Z",
  creator: { id: "person-42", name: "Ari Sales" },
  body: `
    <p>✅ <strong>Am I talking to the key decision-maker?</strong> Yes</p>
    <p>☑️ <strong>Is the person/company at least $5M in revenue?</strong> Y</p>
    <p>✔️ <strong>Are they spending at least $500K in marketing?</strong> True</p>
    <p>✅ <strong>Are they interested in continuing to the next stage?</strong> Yes</p>
    <p>✅ <strong>Does the salesperson think they are worth pursuing?</strong> Yes</p>
    <p>Verdict: Sales Qualified</p>
    <p>Notes: Buyer requested a technical follow-up.</p>
    <p>Google Docs: https://docs.google.com/document/d/1AbC_def-GhIJ23456789/edit?usp=sharing</p>
  `,
};

export const salespersonNoteUpdate = {
  id: "note-100",
  created_at: "2026-07-29T10:15:00Z",
  creator: { id: "person-42", name: "Ari Sales" },
  body: `
    <p>Salesperson note: Procurement asked us to reconnect on Friday.</p>
    <p>https://docs.google.com/document/d/note_doc_456/edit</p>
  `,
};

export const systemUpdate = {
  id: "system-200",
  created_at: "2026-07-29T10:20:00Z",
  creator: { id: "bot-1", name: "Monday Automation Bot" },
  body: "<p>Automation changed the Call Stage from Booked to Completed.</p>",
};
