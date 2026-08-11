import { LogIn, RotateCcw, Users, Wifi, X } from "lucide-react";
import type { VaultState } from "../../domain/types";
import { PresenceAvatar } from "../presence/Presence";

export function ClientsModal(props: {
  vault: VaultState;
  currentClientId: string;
  isHost: boolean;
  onPermission: (clientId: string, permission: "viewer" | "editor" | "admin") => void;
  onClose: () => void;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><div className="pm-modal pm-clients-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-modal-icon"><Users size={21} /></div>
    <h2>Conectados ao cofre</h2>
    <p>{props.vault.clients} dispositivo{props.vault.clients === 1 ? "" : "s"} sincronizando <strong>{props.vault.vaultName}</strong> agora.</p>
    <div className="pm-client-list">
      {props.vault.connections.length ? props.vault.connections.map((client) => <div className="pm-client-card" key={client.id}>
        <PresenceAvatar client={client} />
        <div className="pm-client-copy"><strong>{client.name}</strong><span>{client.activePath ? `${client.editing ? "Editando" : "Visualizando"} ${client.activePath}` : `${client.address} · conectado às ${new Date(client.connectedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}</span></div>
        <div className="pm-client-tags">{client.id === props.currentClientId && <small>VOCÊ</small>}<small>{client.viaMcp ? "IA / MCP" : client.local ? "LOCAL" : "REMOTO"}</small>{props.vault.locks.some((lock) => lock.clientId === client.id) && <small>TRAVA</small>}{client.sessions > 1 && <small>{client.sessions} ABAS</small>}{props.isHost && !client.local && !client.viaMcp ? <select value={client.permission || "editor"} onChange={(event) => props.onPermission(client.id, event.target.value as "viewer" | "editor" | "admin")}><option value="viewer">Leitor</option><option value="editor">Editor</option><option value="admin">Admin</option></select> : <small>{client.permission === "viewer" ? "LEITOR" : client.permission === "admin" ? "ADMIN" : "EDITOR"}</small>}</div>
      </div>) : <div className="pm-client-empty"><Wifi size={18} /><span>Aguardando a lista de conexões…</span></div>}
    </div>
    <div className="pm-dialog-actions pm-dialog-actions--spread"><button className="secondary" onClick={props.onRefresh}><RotateCcw size={14} />Atualizar</button><button className="primary" onClick={props.onConnect}><LogIn size={14} />Conectar outro</button></div>
  </div></div>;
}

