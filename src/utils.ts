export function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function normalizeBody(body: string, isBase64: boolean): string {
  try {
    if (isBase64) {
      const decoded = atob(body);
      // Decode UTF-8 sequence to string
      return decodeURIComponent(escape(decoded));
    }
    return body;
  } catch {
    return body;
  }
}
