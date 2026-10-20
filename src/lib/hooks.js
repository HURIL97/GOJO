import { useCallback, useEffect, useRef, useState } from 'react';
import { call, on } from './api';
import { toast } from '../components/ui';

// Charge des données via IPC et recharge automatiquement après une synchronisation.
export function useData(channel, args = [], deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const argsRef = useRef(args);
  argsRef.current = args;
  const load = useCallback(async () => {
    try {
      setData(await call(channel, ...argsRef.current));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => on('data:changed', () => load()), [load]);
  return [data, load, loading];
}

// Exécute une action, affiche l'erreur éventuelle et renvoie le résultat.
export async function act(fn, success) {
  try {
    const r = await fn();
    if (success) toast(success, 'success');
    return r;
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  }
}
