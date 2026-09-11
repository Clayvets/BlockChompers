/**
 * `object-fit: contain` as a pure function (no DOM): the largest rect with the image's aspect that fits in `frame`,
 * centred in it, so the whole image shows and is never stretched.
 * @param {{ x?: number, y?: number, width: number, height: number }} frame
 * @param {{ width: number, height: number }} imageSize natural pixel size (only its aspect matters)
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function containRect(frame, imageSize) {
  const { x = 0, y = 0, width, height } = frame;
  const scale = Math.min(width / imageSize.width, height / imageSize.height);
  const w = imageSize.width * scale;
  const h = imageSize.height * scale;
  return { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h };
}
