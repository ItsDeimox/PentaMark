export function timeAgo(value: number) {
  const delta = Date.now() - value;
  if (delta < 60_000) return "agora";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} min`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h`;
  return `${Math.floor(delta / 86_400_000)} d`;
}

export function defaultDeviceName() {
  const agent = navigator.userAgent.toLowerCase();
  if (/android|iphone|ipad|mobile/.test(agent)) return "Celular";
  if (agent.includes("electron")) return "PentaMark Desktop";
  return "Navegador";
}

export function initialDeviceName() {
  const fromConnection = new URLSearchParams(window.location.search).get("device")?.trim();
  return (fromConnection || localStorage.getItem("pentamark:device-name") || defaultDeviceName()).slice(0, 60);
}

export function isMobileViewport() {
  return window.matchMedia("(max-width: 880px), (pointer: coarse)").matches;
}

export function connectionLabel(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.endsWith(".ts.net") ? "Tailscale HTTPS" : "HTTPS";
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "Neste aparelho";
    if (url.hostname.startsWith("26.")) return "Radmin · Windows";
    const octets = url.hostname.split(".").map(Number);
    if (octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return "Tailscale";
    return "Rede local";
  } catch {
    return "Endereço";
  }
}

export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Não deu para copiar automaticamente");
}

export function normalizeConnectionAddress(input: string) {
  let value = input.trim();
  if (!value) throw new Error("Digite o endereço do host");
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const target = new URL(value);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Use um endereço HTTP do PentaMark");
  if (!target.port && target.protocol === "http:") target.port = "3417";
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  return target;
}

const PRESENCE_COLORS = ["#67e7ef", "#a78bfa", "#f0a35e", "#73dc8c", "#f07aa8", "#75a7ff", "#e6d267"];

export function colorForClient(id: string) {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

export function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("Escolha uma imagem"));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("A foto precisa ter menos de 8 MB"));
  return new Promise((resolveAvatar, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = (image.naturalWidth - size) / 2;
      const sourceY = (image.naturalHeight - size) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      canvas.getContext("2d")?.drawImage(image, sourceX, sourceY, size, size, 0, 0, 128, 128);
      URL.revokeObjectURL(objectUrl);
      resolveAvatar(canvas.toDataURL("image/webp", .82));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Não deu para ler essa imagem")); };
    image.src = objectUrl;
  });
}

