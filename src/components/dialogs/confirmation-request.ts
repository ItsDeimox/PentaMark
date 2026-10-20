export type ConfirmationOptions = { title: string; message: string; accept?: string; danger?: boolean };
export type ConfirmationRequest = { options: ConfirmationOptions; reply: (accepted: boolean) => void };
export const CONFIRMATION_EVENT = 'pentamark:confirmation';
/** Bridge non-React rendered Markdown controls to the same modal UI. A missing
 * provider fails closed; it never performs a destructive action by default. */
export function requestConfirmation(origin: HTMLElement, options: ConfirmationOptions): Promise<boolean> {
  return new Promise(reply => {
    const event = new CustomEvent<ConfirmationRequest>(CONFIRMATION_EVENT, { bubbles: true, cancelable: true, detail: { options, reply } });
    origin.dispatchEvent(event);
    if (!event.defaultPrevented) reply(false);
  });
}
