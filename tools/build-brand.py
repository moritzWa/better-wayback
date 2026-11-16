"""Original red/charcoal archive-inspired wordmark and rewind favicon, with outlined type."""
from pathlib import Path
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public';OUT.mkdir(exist_ok=True)
FONT=ROOT/'tools/brand/BarlowCondensed-Bold.ttf'
RED='#a13832';INK='#252528';PAPER='#fff8f4'
font=TTFont(FONT);glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm
scale=108/units;x=122;baseline=101;paths=[];runs=[]
for word,color in [('Visual',RED),('Wayback',INK)]:
    start=x
    for character in word:
        glyph_name=cmap[ord(character)];pen=SVGPathPen(glyphs)
        glyphs[glyph_name].draw(TransformPen(pen,(scale,0,0,-scale,x,baseline)))
        paths.append(f'<path fill="{color}" d="{pen.getCommands()}"/>')
        x+=font['hmtx'][glyph_name][0]*scale
    runs.append((word,color,start));x+=12
width=math.ceil(x-8)
icon=f'<rect width="64" height="64" rx="13" fill="{RED}"/><path d="M19 18v28" fill="none" stroke="{PAPER}" stroke-width="6"/><path d="M45 17 26 32l19 15Z" fill="{PAPER}"/>'
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 128" role="img" aria-labelledby="title"><title id="title">Visual Wayback</title><g transform="translate(0 16) scale(1.5)">{icon}</g>{"".join(paths)}</svg>\n'
(OUT/'logo.svg').write_text(svg)
(OUT/'favicon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>Visual Wayback</title>{icon}</svg>\n')

def mark(size):
    # The icon is a stand-alone app-icon tile. The square-ended rewind glyph is
    # not a rounded container nested inside it, so no second corner radius competes.
    k=16;image=Image.new('RGBA',(size*k,size*k));d=ImageDraw.Draw(image)
    unit=size*k/64
    d.rounded_rectangle((0,0,size*k-1,size*k-1),radius=13*unit,fill=RED)
    d.line((19*unit,18*unit,19*unit,46*unit),fill=PAPER,width=round(6*unit))
    d.polygon([(45*unit,17*unit),(26*unit,32*unit),(45*unit,47*unit)],fill=PAPER)
    return image.resize((size,size),Image.Resampling.LANCZOS)
mark(512).save(OUT/'icon-512.png')
mark(180).save(OUT/'apple-touch-icon.png')
mark(32).save(OUT/'favicon-32.png')
mark(64).save(OUT/'favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])

# Native high-resolution transparent lock-up for the closing video card.
k=4;image=Image.new('RGBA',(width*k,128*k));image.alpha_composite(mark(96*k),(0,16*k))
d=ImageDraw.Draw(image);raster_font=ImageFont.truetype(str(FONT),108*k)
for word,color,start in runs:d.text((round(start*k),baseline*k),word,font=raster_font,fill=color,anchor='ls')
image.save(OUT/'logo.png')
print(f'Built original outlined logo ({width}×128), SVG/ICO/PNG favicons and a native {width*k}×512 logo PNG.')
