/** Only same-site paths are allowed as ?next= targets */
export function safeNext(next: string | string[] | undefined | null): string | null {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || typeof v !== 'string') return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  return v.slice(0, 512);
}

/** Funnel attribution tags accepted by the API: rc_x, of_x, npx, web, api, mcp */
export function safeSrc(src: string | string[] | undefined | null): string | null {
  const v = Array.isArray(src) ? src[0] : src;
  if (!v || typeof v !== 'string') return null;
  return /^[A-Za-z0-9_@/.-]{2,64}$/.test(v) ? v : null;
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
