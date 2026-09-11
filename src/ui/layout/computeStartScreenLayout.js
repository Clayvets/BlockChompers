import { containRect } from './containRect.js';

/**
 * Layout of the styled start screen (pure: no DOM, no clock).
 *
 * The art is contained in the viewport like `object-fit: contain`: the largest rect with the image's aspect that fits,
 * centred, so the whole image (painted title included) is always visible and never stretched. The Play button is
 * anchored to that rect: its centre and width are fractions of it (config.playButton centerX, centerY, widthPct), its
 * height follows the button image's aspect, and it is kept inside the art. The label size is a fraction of the button
 * height, so it scales with the button.
 *
 * @param {{ width: number, height: number }} viewport  CSS px
 * @param {{ background: { width: number, height: number }, button: { width: number, height: number } }} imageSize
 *   natural pixel sizes of the two images
 * @param {{ playButton: { centerX: number, centerY: number, widthPct: number, labelSize: number } }} config
 *   Config.ui.startScreen
 * @returns {{ image: Rect, button: Rect, labelSize: number }} rects in viewport CSS px
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */
export function computeStartScreenLayout(viewport, imageSize, config) {
  const { background, button } = imageSize;
  const image = containRect(viewport, background);
  const { width, height } = image;

  const { centerX, centerY, widthPct, labelSize } = config.playButton;
  let buttonWidth = width * Math.min(widthPct, 1);
  let buttonHeight = (buttonWidth * button.height) / button.width;
  if (buttonHeight > height) {
    buttonWidth *= height / buttonHeight;
    buttonHeight = height;
  }
  const cx = clamp(width * centerX, buttonWidth / 2, width - buttonWidth / 2);
  const cy = clamp(height * centerY, buttonHeight / 2, height - buttonHeight / 2);
  return {
    image,
    button: { x: image.x + cx - buttonWidth / 2, y: image.y + cy - buttonHeight / 2, width: buttonWidth, height: buttonHeight },
    labelSize: buttonHeight * labelSize,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
