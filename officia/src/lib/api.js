// Pont vers le processus principal. Lève une erreur lisible si l'opération échoue.
export async function call(channel, ...args) {
  if (!window.officia) throw new Error('Application à lancer via Electron');
  const r = await window.officia.call(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
export const on = (event, fn) => (window.officia ? window.officia.on(event, fn) : () => {});
