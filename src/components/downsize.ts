/** Shrink big photos before upload: a reference doesn't need 12 megapixels. */
export async function downsize(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 900_000) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const encode = (type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, 0.85));
  const webp = await encode("image/webp");
  return webp?.type === "image/webp" ? webp : ((await encode("image/jpeg")) ?? file);
}
