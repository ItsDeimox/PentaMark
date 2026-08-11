export class RequestError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error || `Erro ${status}`));
    this.name = "RequestError";
    this.status = status;
    this.data = data;
  }
}

export function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const clientId = localStorage.getItem("pentamark:client-id");
  if (clientId) headers.set("X-PentaMark-Client", clientId);
  return fetch(url, { ...init, headers }).then(async (response) => {
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new RequestError(response.status, data);
    return data as T;
  });
}
