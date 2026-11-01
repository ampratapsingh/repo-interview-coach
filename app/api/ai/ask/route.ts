import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "edge";

const evidenceSchema = z.object({ id: z.string(), path: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive(), excerpt: z.string().max(1_000) });
const requestSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
  model: z.string().min(1).max(120),
  repository: z.string().min(1).max(200),
  question: z.string().min(3).max(2_000),
  evidence: z.array(evidenceSchema).min(1).max(8),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4_000) })).max(12).default([]),
});
const responseSchema = z.object({ answer: z.string().min(1).max(8_000), evidenceIds: z.array(z.string()).max(8) });

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

function backendKey(provider: z.infer<typeof requestSchema>["provider"]) {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.GEMINI_API_KEY;
}

async function askProvider(input: z.infer<typeof requestSchema>, key: string) {
  const prompt = `Answer the latest question in a repository chat about ${input.repository}. Return JSON only with answer and evidenceIds. Conversation history provides context only; use only the supplied current evidence for code claims. Cite supporting paths inline as path:line. If the evidence is insufficient, say exactly what cannot be established; do not guess.\n\nConversation history: ${JSON.stringify(input.history)}\nLatest question: ${input.question}\nCurrent evidence: ${JSON.stringify(input.evidence)}`;
  if (input.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Answer repository questions using grounded JSON only." }, { role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return extractJson(data.choices?.[0]?.message?.content ?? "");
  }
  if (input.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, max_tokens: 1_200, temperature: 0.1, messages: [{ role: "user", content: prompt }] }) });
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
    const input = requestSchema.parse(await request.json());
    const key = request.headers.get("x-provider-key") || backendKey(input.provider);
    if (!key || key.length > 500) return NextResponse.json({ error: "No backend AI is configured. Add your provider API key in AI settings." }, { status: 401 });
    const answer = responseSchema.parse(await askProvider(input, key));
    const allowedIds = new Set(input.evidence.map((item) => item.id));
    if (!answer.evidenceIds.every((id) => allowedIds.has(id))) throw new Error("Provider returned an unknown evidence reference.");
    return NextResponse.json(answer);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Repository question failed." }, { status: 502 });
  }
}
