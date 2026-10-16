import { filename, type BoardObject } from './api';
import { unionBounds } from './canvas';

const PADDING = 40;
const MAX_PIXELS = 4096;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports exactly what the board renders: the on-screen object layer is
 * cloned, stripped of selection chrome, and framed around its content.
 */
export async function exportBoard(
  layer: SVGGElement,
  objects: BoardObject[],
  title: string,
  format: 'png' | 'pdf' | 'svg',
) {
  const bounds = unionBounds(objects);
  if (!bounds) throw new Error('Add something to the board before exporting.');
  const x = bounds.x - PADDING;
  const y = bounds.y - PADDING;
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);

  const clone = layer.cloneNode(true) as SVGGElement;
  clone.querySelectorAll('[data-ui]').forEach((node) => node.remove());
  clone
    .querySelectorAll('[style]')
    .forEach((node) => node.removeAttribute('style'));
  await inlineImages(clone);
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fffefa"/>${new XMLSerializer().serializeToString(clone)}</svg>`;
  const svgBlob = new Blob([markup], { type: 'image/svg+xml' });
  if (format === 'svg') {
    download(svgBlob, filename(title, 'svg'));
    return;
  }

  const scale = Math.min(2, MAX_PIXELS / Math.max(width, height));
  const image = new Image();
  const url = URL.createObjectURL(svgBlob);
  try {
    image.src = url;
    await image.decode();
  } catch {
    throw new Error('Unable to render this board for export.');
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Canvas export is unavailable in this browser.');
  context.fillStyle = '#fffefa';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (format === 'png') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('Unable to create the PNG.');
    download(blob, filename(title, 'png'));
    return;
  }

  // A single-page PDF holding the board as a JPEG, sized to its content.
  const jpeg = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]!);
  const pageWidth = Math.round((width * 72) / 96);
  const pageHeight = Math.round((height * 72) / 96);
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;
  const pdfObjects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  pdfObjects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index++)
    bytes[index] = pdf.charCodeAt(index);
  download(
    new Blob([bytes], { type: 'application/pdf' }),
    filename(title, 'pdf'),
  );
}

/**
 * Shrinks an uploaded image so it can be shared through the board. Returns
 * the encoded file plus, for boards kept only in this browser, a data URL.
 */
export async function prepareImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 15_000_000) throw new Error('Images must be under 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image could not be opened.');
  });
  const fit = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * fit));
  canvas.height = Math.max(1, Math.round(bitmap.height * fit));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality),
    );
    // Data URLs grow by a third, and must stay under the server's limit.
    if (blob && blob.size < 560_000)
      return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error('This image is too detailed to share. Try a smaller one.');
}

export function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('This image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** An SVG drawn as an image cannot load files, so uploaded images are inlined. */
async function inlineImages(root: SVGGElement) {
  await Promise.all(
    [...root.querySelectorAll('image')].map(async (image) => {
      const href = image.getAttribute('href');
      if (!href || href.startsWith('data:')) return;
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok)
        throw new Error('An image on this board could not be loaded.');
      image.setAttribute('href', await dataUrl(await response.blob()));
    }),
  );
}
