declare const Buffer: any;

function NetworkOverridesStringToBase64Local(str: string): string {
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(str, 'utf8').toString('base64');
    } catch {}
  }

  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunkSize)));
  }
  return btoa(binary);
}

function NetworkOverridesNormalizeBodyLocal(body: string, isBase64: boolean): string {
  try {
    if (isBase64) {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(body, 'base64').toString('utf8');
      }
      const decoded = atob(body);
      return decodeURIComponent(escape(decoded));
    }
    return body;
  } catch {
    return body;
  }
}
