import type { RepoFactSheet, SessionReport } from "./domain";

const DB_NAME = "repo-interview-coach";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("facts")) db.createObjectStore("facts");
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(store: "facts" | "reports", mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest) {
  const db = await openDb();
  return new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export const factKey = (facts: Pick<RepoFactSheet, "identity">) => `${facts.identity.owner}/${facts.identity.repository}@${facts.identity.headSha}`;
export async function saveFactSheet(facts: RepoFactSheet) { await transact("facts", "readwrite", (store) => store.put(facts, factKey(facts))); }
export async function getFactSheet(key: string) { return transact("facts", "readonly", (store) => store.get(key)) as Promise<RepoFactSheet | undefined>; }
export async function saveReport(report: SessionReport) { await transact("reports", "readwrite", (store) => store.put(report)); }
export async function listReports() { return transact("reports", "readonly", (store) => store.getAll()) as Promise<SessionReport[]>; }
export async function clearLocalData() { const db = await openDb(); for (const name of ["facts", "reports"]) db.transaction(name, "readwrite").objectStore(name).clear(); db.close(); localStorage.removeItem("ric-provider-settings"); }

