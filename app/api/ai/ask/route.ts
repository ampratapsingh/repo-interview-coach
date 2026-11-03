import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeAiRateLimit } from "../../../../lib/rate-limit";

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
const responseSchema = z.object({ answer: z.string().min(1).max(2_500), evidenceIds: z.array(z.string()).max(4) });
const answerTerms = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9_+#.-]{4,}/g) ?? []);

function supportingEvidenceIds(answer: string, evidence: z.infer<typeof evidenceSchema>[]) {
  const terms = answerTerms(answer);
  return evidence.map((item, index) => {
    const searchable = `${item.path} ${item.excerpt}`.toLowerCase();
    const overlap = [...terms].reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0);
    return { id: item.id, score: overlap * 3 + Math.max(0, evidence.length - index) };
  }).sort((a, b) => b.score - a.score).slice(0, Math.min(4, evidence.length)).map((item) => item.id);
}

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  const raw = fenced ?? (start >= 0 && end > start ? value.slice(start, end + 1) : "");
  if (!raw) throw new Error("The AI returned an incomplete response. Please try again.");
  try { return JSON.parse(raw); }
  catch { throw new Error("The AI response was cut off before it finished. Please try again."); }
}

function promptFor(input: z.infer<typeof requestSchema>) {
  return `Answer the latest repository question about ${input.repository}.

Return JSON only in this exact shape: {"answer":"...","evidenceIds":["..."]}.

Answer-writing rules:
- Answer the question directly in the first sentence. Do not restate the question.
- Synthesize the architecture or behavior; do not walk through the evidence one file at a time.
- Default to 80-160 words and one or two short paragraphs. Use at most three bullets only when they make the answer clearer.
- Do not put file paths, line numbers, citations, evidence IDs, or Markdown links inside the answer. The UI renders sources separately.
- Avoid filler, repeated qualifications, and exhaustive import lists.
- Do not append a generic limitations or "evidence does not establish" sentence. Mention uncertainty only when the question cannot be answered correctly without it.
- Choose only the 2-4 strongest supplied evidence IDs that support the answer. Never invent an ID or code fact.

Conversation history (context only): ${JSON.stringify(input.history)}
Latest question: ${input.question}
Current evidence: ${JSON.stringify(input.evidence)}`;
}

async function askQwen(input: z.infer<typeof requestSchema>, key: string) {
  const prompt = `Answer the latest repository question about ${input.repository}.

Answer-writing rules:
- Answer directly in the first sentence without restating the question.
- Synthesize the architecture or behavior; do not walk through files one by one.
- Use 80-160 words and one or two short paragraphs.
- Do not include file paths, line numbers, citations, evidence IDs, Markdown links, or a sources section.
- Avoid filler, repeated qualifications, and exhaustive import lists.
- Do not append a generic limitations or "evidence does not establish" sentence. Mention uncertainty only when the question cannot be answered correctly without it.
- Use only the supplied evidence for code claims; never invent a fact.

Conversation history (context only): ${JSON.stringify(input.history)}
Latest question: ${input.question}
Current evidence: ${JSON.stringify(input.evidence)}`;
  const baseUrl = (process.env.QWEN_BASE_URL || "https://api.iteracompute.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.QWEN_MODEL || "qwen/qwen3.8-27b", temperature: 0.1, max_tokens: 4_096, enable_thinking: false, messages: [{ role: "system", content: "Give a direct, concise answer grounded only in the supplied repository evidence." }, { role: "user", content: prompt }] }) });
  if (!response.ok) throw new Error(`Qwen returned ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Qwen did not return an answer. Please try again.");
  return { answer, evidenceIds: supportingEvidenceIds(answer, input.evidence) };
}

async function askProvider(input: z.infer<typeof requestSchema>, key: string) {
  const prompt = promptFor(input);
  if (input.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model, temperature: 0.1, max_tokens: 900, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Be direct and concise. Return grounded JSON only; never include citations in the answer text." }, { role: "user", content: prompt }] }) });
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
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationConfig: { temperature: 0.1, maxOutputTokens: 900, responseMimeType: "application/json" }, contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}.`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

export async function POST(request: NextRequest) {
  try {
    const clientId = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limit = consumeAiRateLimit(`anonymous:${clientId}`);
    if (!limit.allowed) return NextResponse.json({ error: "AI request limit reached. Please try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const input = requestSchema.parse(await request.json());
    const userKey = request.headers.get("x-provider-key");
    const key = userKey || process.env.QWEN_API_KEY;
    if (!key || key.length > 500) return NextResponse.json({ error: "No backend AI is configured. Add your provider API key in AI settings." }, { status: 401 });
    const answer = responseSchema.parse(await (userKey ? askProvider(input, key) : askQwen(input, key)));
    const allowedIds = new Set(input.evidence.map((item) => item.id));
    if (!answer.evidenceIds.every((id) => allowedIds.has(id))) throw new Error("Provider returned an unknown evidence reference.");
    return NextResponse.json(answer);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Repository question failed." }, { status: 502 });
  }
}
