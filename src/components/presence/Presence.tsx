import React, { useEffect, useState } from "react";
import type { ClientInfo } from "../../domain/types";
import { colorForClient, initials } from "../../shared/client";
import { textareaCaretPosition } from "../../shared/dom";

export function PresenceAvatar(props: { client: Pick<ClientInfo, "id" | "name" | "avatar" | "color">; tiny?: boolean }) {
  const color = props.client.color || colorForClient(props.client.id);
  return <span className={`pm-presence-avatar ${props.tiny ? "tiny" : ""}`} style={{ "--pm-presence-color": color } as React.CSSProperties} title={props.client.name}>
    {props.client.avatar ? <img src={props.client.avatar} alt="" /> : initials(props.client.name)}
  </span>;
}

export function PresenceStack(props: { clients: ClientInfo[]; compact?: boolean; onClientClick?: (client: ClientInfo) => void }) {
  const visible = props.clients.slice(0, props.compact ? 3 : 4);
  return <span className={`pm-presence-stack ${props.compact ? "compact" : ""}`} title={props.clients.map((client) => client.name).join(", ")}>
    {visible.map((client) => <span key={client.id} className={props.onClientClick ? "pm-presence-jump" : ""} role={props.onClientClick ? "button" : undefined} tabIndex={props.onClientClick ? 0 : undefined} onPointerDown={(event) => { if (props.onClientClick) event.stopPropagation(); }} onClick={(event) => { if (!props.onClientClick) return; event.preventDefault(); event.stopPropagation(); props.onClientClick(client); }} onKeyDown={(event) => { if (props.onClientClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); props.onClientClick(client); } }}><PresenceAvatar client={client} tiny={props.compact} /></span>)}
    {props.clients.length > visible.length && <span className="pm-presence-more">+{props.clients.length - visible.length}</span>}
  </span>;
}

export function RemoteCursorOverlay(props: { textareaRef: React.RefObject<HTMLTextAreaElement | null>; content: string; clients: ClientInfo[] }) {
  const [positions, setPositions] = useState<Array<{ client: ClientInfo; left: number; top: number; height: number }>>([]);

  useEffect(() => {
    const textarea = props.textareaRef.current;
    if (!textarea) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPositions(props.clients.map((client) => ({ client, ...textareaCaretPosition(textarea, client.cursor) }))));
    };
    update();
    textarea.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); textarea.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [props.clients, props.content, props.textareaRef]);

  return <div className="pm-remote-cursors" aria-hidden="true">{positions.map(({ client, left, top, height }) => <span className="pm-remote-caret" key={client.id} style={{ left, top, height, "--pm-presence-color": client.color || colorForClient(client.id) } as React.CSSProperties}><b>{client.name}</b></span>)}</div>;
}

