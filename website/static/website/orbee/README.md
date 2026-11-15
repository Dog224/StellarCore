# Orbee mascot artwork

Project assets generated with the built-in `image_gen` tool from the user's two
character reference images. The mascot is Orbee: a white fluffy character with
a cream plumeria flower. Generated artwork, not a downloaded third-party asset.

- `orbee-poses.png`: original RGBA output, 1536 × 1024, 1,533,144 bytes.
- `orbee-poses.webp`: same-size web delivery copy, 222,556 bytes, with alpha
  preserved. Encoded through the browser's WebP encoder at quality 0.95; no
  artwork repainting, background flattening, or pose changes.
- Left half: joyful greeting pose. Right half: calm paws-together pose.
- Each CSS sprite viewport is 3:4. `background-size: 200% 100%` selects one pose
  without downloading two separate files. The PNG original remains available.

Generated using the built-in tool, without the CLI fallback. The web delivery
copy is about 85% smaller than the original PNG. Corner transparency and both
pose dimensions are verified by `tools/preview-orbee.mjs`.

## Final generation prompt

```text
Use case: background-extraction / identity-preserve. Asset type: transparent web mascot sprite atlas for MekongRise, character name Orbee. The two most recent attached images are the edit targets: the same cute white fluffy round-headed small dog mascot with a cream five-petal plumeria flower at viewer-left temple, black shiny eyes, small black nose, ink outlines and pale lavender edge shadows. Create ONE clean transparent PNG sprite atlas with TWO equal-width cells side by side: left cell preserves the joyful open-mouth waving/pointing pose from image 1; right cell preserves the calm front-facing paws-together pose from image 2. Preserve the exact character identity, drawn proportions, flower, linework and face; no redesign, no plant robot, no extra accessories, no text. Remove all black backgrounds, white rectangular borders and excitement marks outside the character. Real transparent alpha around both characters including between the two cells, NOT a checkerboard drawing. Both characters centered in their own half, complete body, same scale and head size, feet aligned, each occupies about 83 percent of the cell height with 8 percent safe margins, nothing cropped. Wide landscape 3:2 canvas, two adjacent equal cells; each cell contains exactly one pose. Retain the original charming hand-drawn 2D illustration appearance, off-white fluffy body and subtle cool shadows, warm cream petals. Crisp clean contours readable at 70-150 pixels tall on a website.
```
