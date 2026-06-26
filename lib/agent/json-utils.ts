export function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model output: " + text.slice(0, 200));
  return JSON.parse(match[0]);
}
