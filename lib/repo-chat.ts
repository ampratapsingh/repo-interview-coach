import type { RepoIdentity } from "./domain";

export type RepoChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidenceIds?: string[];
  createdAt: string;
};

export type RepoChatThread = {
  id: string;
  identity: RepoIdentity;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: RepoChatMessage[];
};

export const repoKey = (identity: RepoIdentity) => `${identity.owner}/${identity.repository}@${identity.headSha}`;

export function newRepoChat(identity: RepoIdentity): RepoChatThread {
  const now = new Date().toISOString();
  return { id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, identity, title: "New conversation", createdAt: now, updatedAt: now, messages: [] };
}

export function loadRepoChats(): RepoChatThread[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("ric-repo-chats") ?? "[]") as RepoChatThread[]; }
  catch { return []; }
}

export function saveRepoChats(chats: RepoChatThread[]) {
  localStorage.setItem("ric-repo-chats", JSON.stringify(chats));
}
