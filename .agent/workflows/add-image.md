---
description: How to add a new photo to the gallery
---

# Add a New Gallery Image

When you have a new photo to add to the gallery, run these two commands from the project root.

## 1. Create the thumbnail (600px, quality 70)

```bash
sips --resampleHeightWidthMax 600 -s formatOptions 70 /path/to/original.jpeg --out static/images/gallery/thumbnails/NAME.jpeg
```

## 2. Create the fullsrc / lightbox version (2000px, quality 80)

```bash
sips --resampleHeightWidthMax 2000 -s formatOptions 80 /path/to/original.jpeg --out static/images/gallery/fullsrc/NAME.jpeg
```

## 3. (Optional) Back up the original

```bash
cp /path/to/original.jpeg static/images/gallery/originals/fullsrc/NAME.jpeg
```

## 4. Add to the template

Add the `<img>` tag in `templates/photos.html`:

```html
<img src="/images/gallery/thumbnails/NAME.jpeg" data-fullsrc="/images/gallery/fullsrc/NAME.jpeg">
```

## Quick one-liner

Replace `PHOTO` with the source path and `NAME` with the desired filename:

// turbo
```bash
PHOTO=/path/to/photo.jpeg NAME=myimage; sips --resampleHeightWidthMax 600 -s formatOptions 70 "$PHOTO" --out static/images/gallery/thumbnails/"$NAME".jpeg && sips --resampleHeightWidthMax 2000 -s formatOptions 80 "$PHOTO" --out static/images/gallery/fullsrc/"$NAME".jpeg
```
