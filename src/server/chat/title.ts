/** A first-question title shared by the optimistic sidebar and native thread creation. */
export function titleFromQuestion(question: string): string {
  const title = question.replace(/\s+/g, " ").trim();
  return title.length > 60 ? `${title.slice(0, 60).trimEnd()}…` : title || "New chat";
}
