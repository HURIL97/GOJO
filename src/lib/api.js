// Pont vers le processus principal. Lève une erreur lisible si l'opération échoue.
export async function call(channel, ...args) {
  if (!window.hospitalis) throw new Error('Application à lancer via Electron');
  const r = await window.hospitalis.call(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
export const on = (event, fn) => (window.hospitalis ? window.hospitalis.on(event, fn) : () => {});
