import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { answerEvaluationSchema, interviewQuestionSchema } from "../../../../lib/domain";

export const runtime = "edge";

const requestSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  model: z.string().min(1).max(120),
  question: interviewQuestionSchema,
  answer: z.string().min(1).max(12_000),
  evidence: z.array(z.object({ id: z.string(), path: z.string(), startLine: z.number(), endLine: z.number(), excerpt: z.string().max(1_000) })).max(12),
});

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

function promptFor(input: z.infer<typeof requestSchema>) {
  return `You are grading a repository interview answer. Return JSON only with: verdict (strong|partial|needs_work), coveredPointIds, missedPointIds, feedback, evidenceIds, confidence (0..1), followUp (string|null). Use only rubric IDs and evidence IDs supplied below. Never invent code facts.\n\nQuestion: ${input.question.prompt}\nRubric: ${JSON.stringify(input.question.rubric)}\nEvidence: ${JSON.stringify(input.evidence)}\nCandidate answer: ${input.answer}`;
}

async function callProvider(input: z.infer<typeof requestSchema>, key: string) {
  const prompt = promptFor(input);
  if (input.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return grounded JSON only." }, { role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return extractJson(data.choices?.[0]?.message?.content ?? "");
  }
  if (input.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, max_tokens: 900, temperature: 0.1, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}.`);
    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    return extractJson(data.content?.find((item) => item.type === "text")?.text ?? "");
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationConfig: { temperature: 0.1, responseMimeType: "application/json" }, contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}.`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

export async function POST(request: NextRequest) {
  try {
    const key = request.headers.get("x-provider-key");
    if (!key || key.length > 500) return NextResponse.json({ error: "A provider key is required." }, { status: 401 });
    const input = requestSchema.parse(await request.json());
    const evaluation = answerEvaluationSchema.parse(await callProvider(input, key));
    const rubricIds = new Set(input.question.rubric.map((point) => point.id));
    const evidenceIds = new Set(input.evidence.map((item) => item.id));
    if (![...evaluation.coveredPointIds, ...evaluation.missedPointIds].every((id) => rubricIds.has(id))) throw new Error("Provider returned an unknown rubric reference.");
    if (!evaluation.evidenceIds.every((id) => evidenceIds.has(id))) throw new Error("Provider returned an unknown evidence reference.");
    return NextResponse.json({ evaluation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI evaluation failed." }, { status: 502 });
  }
}

