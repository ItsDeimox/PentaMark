import { Camera, Check, HardDrive, UserCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { avatarFromFile, initials } from '../../shared/client';
import { DialogFrame, DialogSection } from './DialogFrame';

export function ProfileModal(p: { name: string; avatar: string; color: string; onClose: () => void; onSave: (name: string, avatar: string) => void; onError: (message: string) => void }) {
  const [error, setError] = useState('');
  const [name, setName] = useState(p.name), [avatar, setAvatar] = useState(p.avatar), [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null), sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const choose = async (files: FileList | null) => {
    const selected = files?.[0]; if (!selected) return;
    const id = ++sequence.current; setLoading(true); setError('');
    try { const image = await avatarFromFile(selected); if(id===sequence.current) setAvatar(image); }
    catch(e) { if(id===sequence.current) setError(e instanceof Error ? e.message : 'Não foi possível abrir a foto.'); }
    finally { if(id===sequence.current) setLoading(false); }
  };
  return <DialogFrame title="Conta local" icon={UserCircle} onClose={p.onClose} className="pm-profile-dialog" onSubmit={() => { if(name.trim() && !loading) p.onSave(name.trim().slice(0,60),avatar); }}
    footer={<><span className="pm-footer-hint"><HardDrive size={13}/>Neste dispositivo</span><button type="button" className="secondary" onClick={p.onClose}>Cancelar</button><button type="submit" className="primary" disabled={!name.trim() || loading}><Check size={15}/>Salvar perfil</button></>}>
    <div className="pm-identity-card"><div className="pm-identity-avatar">{avatar ? <img src={avatar} alt="Foto do perfil"/> : <span>{initials(name)}</span>}</div><div><strong>{name.trim() || 'Seu apelido'}</strong><div className="pm-inline-actions"><button type="button" onClick={() => file.current?.click()} disabled={loading}><Camera size={14}/>{loading ? 'Preparando foto…' : 'Alterar foto'}</button>{avatar && <button type="button" onClick={() => { sequence.current++;setLoading(false);setAvatar(''); }}>Remover foto</button>}</div></div></div>
    <input ref={file} type="file" accept="image/*" hidden aria-label="Selecionar foto do perfil" onChange={event => { void choose(event.target.files);event.target.value=''; }}/>
    <DialogSection title="Como você aparece"><label className="pm-field">Apelido<input data-autofocus aria-label="Apelido" value={name} onChange={event => setName(event.target.value)} maxLength={60} autoComplete="nickname" required/><span className="pm-field-meta">{name.length}/60 caracteres</span></label></DialogSection>
    {error && <p role="alert" className="pm-form-error">{error}</p>}
    <div className="pm-notice"><HardDrive size={17}/><span>Perfil salvo neste dispositivo. Não cria uma conta na nuvem.</span></div>
  </DialogFrame>;
}
