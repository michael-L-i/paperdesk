export const textFile = name => /\.(tex|bib|sty|cls|bst|txt|md)$/i.test(name);
export const imageFile = name => /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
// A network error means the server stopped, usually because its Terminal window was closed.
export const request = (url, init) => fetch(url, init).catch(() => { throw new Error("Can't reach Paperdesk. Its server stopped, which happens when the Terminal window running it is closed. Double-click Start Paperdesk.command to start it again, then retry."); });
export async function api(url, body, method = 'POST') {
  const res = await request('/api' + url, body === undefined ? {} : { method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { diagnostics: result.diagnostics });
  return result;
}
