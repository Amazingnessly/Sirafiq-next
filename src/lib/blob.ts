export async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const modernReader = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof modernReader === 'function') {
    return modernReader.call(blob);
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Le fichier n’a pas pu être lu sous forme binaire.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('La lecture du fichier a échoué.'));
    reader.onabort = () => reject(new Error('La lecture du fichier a été interrompue.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobAsText(blob: Blob): Promise<string> {
  const modernReader = (blob as Blob & { text?: () => Promise<string> }).text;
  if (typeof modernReader === 'function') {
    return modernReader.call(blob);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('La lecture du texte a échoué.'));
    reader.onabort = () => reject(new Error('La lecture du texte a été interrompue.'));
    reader.readAsText(blob);
  });
}
