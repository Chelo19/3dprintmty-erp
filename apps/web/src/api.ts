export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body) headers.set("content-type", "application/json");
  const token = localStorage.getItem("printmty.token");
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`/api/v1${path}`, { ...options, headers });
  const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
  if (!response.ok) {
    throw new ApiError(body?.message ?? "No se pudo completar la acción.", body?.code ?? "request_failed");
  }
  return body as T;
}

export function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
}

export async function download(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem("printmty.token");
  const response = await fetch(`/api/v1${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(body?.message ?? "No se pudo descargar.", body?.code ?? "request_failed");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
