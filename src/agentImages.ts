export interface ReferenceImage {
  name: string;
  url: string;
  size: number;
}
export const MAX_REFERENCE_IMAGES = 4;
export async function readReferenceImages(
  files: File[],
  existing: ReferenceImage[],
): Promise<ReferenceImage[]> {
  if (files.length + existing.length > MAX_REFERENCE_IMAGES)
    throw new Error('Attach up to 4 reference images per message.');
  if (
    files.reduce(
      (sum, f) => sum + f.size,
      existing.reduce((sum, f) => sum + f.size, 0),
    ) >
    20 * 1024 * 1024
  )
    throw new Error('Reference images must total 20 MB or less.');
  return Promise.all(
    files.map(async (file) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('Use PNG, JPEG or WebP reference images.');
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Each reference image must be 8 MB or less.');
      const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error(`Cannot read image: ${file.name}`);
      });
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 25_000_000)
        throw new Error('Reference images must be 25 megapixels or smaller.');
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(`Cannot read image: ${file.name}`));
        reader.readAsDataURL(file);
      });
      return { name: file.name, url, size: file.size };
    }),
  );
}
