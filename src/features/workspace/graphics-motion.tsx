import { createContext, useContext, type ReactNode } from 'react';
import './graphics.css';

const InterfaceMotion = createContext(true);
/** Wrap the app shell so effects stop immediately when a setting changes. */
export function GraphicsMotionProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <InterfaceMotion.Provider value={enabled}>{children}</InterfaceMotion.Provider>;
}
export function useInterfaceMotion() { return useContext(InterfaceMotion); }
