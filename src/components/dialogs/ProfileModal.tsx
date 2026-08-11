import { Camera, Check, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { avatarFromFile, initials } from "../../shared/client";

export function ProfileModal(props: { name: string; avatar: string; color: string; onClose: () => void; onSave: (name: string, avatar: string) => void; onError: (message: string) => void }) {
  const [name, setName] = useState(props.name);
  const [avatar, setAvatar] = useState(props.avatar);
  useEffect(() => { setName(props.name); setAvatar(props.avatar); }, [props.avatar, props.name]);

  const chooseAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try { setAvatar(await avatarFromFile(file)); }
    catch (error) { props.onError(error instanceof Error ? error.message : "Não deu para usar essa imagem"); }
  };

  return <div className="pm-modal-backdrop" onMouseDown={props.onClose}><form className="pm-modal pm-profile-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); const clean = name.trim().slice(0, 60); if (clean) props.onSave(clean, avatar); }}>
    <button type="button" className="pm-modal-close" onClick={props.onClose}><X size={17} /></button>
    <div className="pm-profile-heading"><label className="pm-profile-avatar" style={{ "--pm-presence-color": props.color } as React.CSSProperties}>{avatar ? <img src={avatar} alt="Sua foto" /> : initials(name)}<span><Camera size={14} /></span><input type="file" accept="image/*" onChange={(event) => void chooseAvatar(event.target.files)} /></label><div><h2>Conta local</h2><p>Seu perfil aparece para quem estiver conectado ao mesmo cofre.</p></div></div>
    <div className="pm-connect-fields"><label>Apelido<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} /></label></div>
    {avatar && <button type="button" className="pm-remove-avatar" onClick={() => setAvatar("")}>Remover foto</button>}
    <div className="pm-dialog-actions"><button type="button" className="secondary" onClick={props.onClose}>Cancelar</button><button type="submit" className="primary"><Check size={14} />Salvar perfil</button></div>
  </form></div>;
}

