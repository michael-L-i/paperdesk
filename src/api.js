export const textFile = name => /\.(tex|bib|sty|cls|bst|txt|md)$/i.test(name);
export const imageFile = name => /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
// A network error means the server is not running.
export const request = (url, init) => fetch(url, init).catch(() => { throw Object.assign(new Error("Can't reach Paperdesk. Start it again with Start Paperdesk.command or `paperdesk`, then retry."), { offline: true }); });
export async function api(url, body, method = 'POST') {
  const res = await request('/api' + url, body === undefined ? {} : { method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { diagnostics: result.diagnostics });
  return result;
}
