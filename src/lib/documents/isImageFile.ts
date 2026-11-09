/**
 * "Is this file a photo?" - the one routing decision the upload surfaces
 * share: photos take the on-device OCR review path (extract.ts cannot read
 * images, and a transcript must be user-checked before it is indexed or
 * attached); everything else goes through extract.ts.
 *
 * MIME first, extension as the fallback: Android's picker hands over
 * `image/jpeg` for a JPG, but a share sheet or a cloud-backed pick can arrive
 * with an empty type and only the name to go by.
 */
export function isImageFile(file: { type?: string; name: string }): boolean {
  return (
    (file.type || "").startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name)
  );
}
