const OWNER_REPO = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubUrl(input: string): { owner: string; repository: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a full GitHub URL, for example https://github.com/owner/repository.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only public github.com repository URLs are supported.");
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2) throw new Error("Use the repository root URL, not a branch, file, pull request, or subdirectory URL.");
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repository) || !repository) throw new Error("That GitHub repository URL is not valid.");
  return { owner, repository };
}

export function assertGitHubSegment(value: string, label: string) {
  if (!OWNER_REPO.test(value)) throw new Error(`Invalid GitHub ${label}.`);
  return value;
}

