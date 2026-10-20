import { ExternalLink, File, X } from "lucide-react";
import type { AssetMeta } from "../domain/types";
import { vaultFileUrl } from "../features/markdown/renderer";
import { ImageWorkspacePreview } from "./ImageWorkspacePreview";

export function AssetWorkspacePreview(props: { asset: AssetMeta; activeNote: string; onClose: () => void; onReveal: () => void }) {
  const source = vaultFileUrl(props.asset.path, props.activeNote);
  if (props.asset.kind === "image") return <ImageWorkspacePreview key={source} source={source} title={props.asset.title} onClose={props.onClose} onReveal={props.onReveal} />;
  return <section className="pm-asset-workspace">
    <header><div><strong>{props.asset.title}</strong><code>{props.asset.path}</code></div><span><button onClick={props.onReveal}><ExternalLink size={14} />Explorer</button><button onClick={props.onClose}><X size={16} />Fechar</button></span></header>
    <div className={`pm-asset-stage pm-asset-stage--${props.asset.kind}`}>
      {props.asset.kind === "audio" ? <audio controls autoPlay={false} preload="metadata" src={source} />
          : props.asset.kind === "video" ? <video controls preload="metadata" src={source} />
            : props.asset.kind === "pdf" ? <iframe src={source} title={props.asset.title} />
              : <a href={source} target="_blank" rel="noreferrer"><File size={28} /><span>Abrir arquivo</span></a>}
    </div>
  </section>;
}

