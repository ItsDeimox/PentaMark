import { ExternalLink, File, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssetMeta } from "../domain/types";
import { vaultFileUrl } from "../features/markdown/renderer";

export function AssetWorkspacePreview(props: { asset: AssetMeta; activeNote: string; onClose: () => void; onReveal: () => void }) {
  const source = vaultFileUrl(props.asset.path, props.activeNote);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, [props.asset.path]);
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  return <section className="pm-asset-workspace">
    <header><div><strong>{props.asset.title}</strong><code>{props.asset.path}</code></div><span><button onClick={() => setZoom((value) => Math.max(.15, value - .15))}><ZoomOut size={15} /></button><button onClick={reset} title="Ajustar"><Maximize2 size={15} /></button><button onClick={() => setZoom((value) => Math.min(8, value + .15))}><ZoomIn size={15} /></button><b>{Math.round(zoom * 100)}%</b><button onClick={props.onReveal}><ExternalLink size={14} />Explorer</button><button onClick={props.onClose}><X size={16} />Fechar</button></span></header>
    <div className={`pm-asset-stage pm-asset-stage--${props.asset.kind}`} onWheel={(event) => { if (props.asset.kind !== "image") return; event.preventDefault(); setZoom((value) => Math.max(.15, Math.min(8, value * (event.deltaY < 0 ? 1.12 : .89)))); }} onPointerDown={(event) => { if (props.asset.kind !== "image") return; drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drag.current) return; setOffset({ x: drag.current.originX + event.clientX - drag.current.x, y: drag.current.originY + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onDoubleClick={reset}>
      {props.asset.kind === "image" ? <img draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} src={source} alt={props.asset.title} />
        : props.asset.kind === "audio" ? <audio controls autoPlay={false} preload="metadata" src={source} />
          : props.asset.kind === "video" ? <video controls preload="metadata" src={source} />
            : props.asset.kind === "pdf" ? <iframe src={source} title={props.asset.title} />
              : <a href={source} target="_blank" rel="noreferrer"><File size={28} /><span>Abrir arquivo</span></a>}
    </div>
    {props.asset.kind === "image" && <footer>Scroll: zoom · arraste: mover · duplo clique: ajustar</footer>}
  </section>;
}

