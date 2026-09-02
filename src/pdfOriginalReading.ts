type StoredSupport = {
  id: string;
  name: string;
  blob?: Blob;
  dataUrl?: string;
};

const DB_NAME = 'sirafiq-next';
const STORE = 'supports';

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2);
  if (!header || payload === undefined) throw new Error('Fichier local illisible.');
  const mime = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  const bytes = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function supportToBlob(support: StoredSupport): Blob {
  if (support.blob instanceof Blob) return support.blob;
  if (support.dataUrl) return dataUrlToBlob(support.dataUrl);
  throw new Error('Fichier local illisible.');
}

function getSupportByName(name: string): Promise<StoredSupport | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const getAll = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        const supports = getAll.result as StoredSupport[];
        resolve(supports.find((support) => support.name === name) ?? null);
      };
    };
  });
}

async function openOriginalPdf(card: Element) {
  const name = card.querySelector('h3')?.textContent?.trim();
  if (!name) return;
  const support = await getSupportByName(name);
  if (!support) throw new Error('Support introuvable.');
  const objectUrl = URL.createObjectURL(supportToBlob(support));
  const opened = window.open(objectUrl, '_blank');
  if (!opened) window.location.assign(objectUrl);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

window.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.textContent?.trim() !== 'Lire') return;
  const card = target.closest('.card');
  if (!card || card.querySelector('.file-mark')?.textContent?.trim().toUpperCase() !== 'PDF') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openOriginalPdf(card).catch((error) => {
    console.error(error);
    window.alert("Impossible d'ouvrir le PDF original.");
  });
}, true);
