import { CoachApp } from "./coach-app";
import { requireChatGPTUser } from "./chatgpt-auth";

export default async function Home() {
  await requireChatGPTUser("/");
  return <CoachApp />;
}
