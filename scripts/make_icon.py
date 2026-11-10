from PIL import Image, ImageDraw, ImageFont
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(root, 'build'), exist_ok=True)
os.makedirs(os.path.join(root, 'resources'), exist_ok=True)
size = 1024
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))

gradient = Image.new('RGBA', (size, size))
gradient_draw = ImageDraw.Draw(gradient)
for y in range(size):
    t = y / (size - 1)
    red = int(13 + (45 - 13) * t)
    green = int(148 + (212 - 148) * t)
    blue = int(136 + (191 - 136) * t)
    gradient_draw.line([(0, y), (size, y)], fill=(red, green, blue, 255))

mask = Image.new('L', (size, size), 0)
ImageDraw.Draw(mask).rounded_rectangle([32, 32, size - 32, size - 32], radius=220, fill=255)
image.paste(gradient, (0, 0), mask)

draw = ImageDraw.Draw(image)
for index, alpha in enumerate([80, 58, 36]):
    y = 648 + index * 66
    draw.rounded_rectangle([232, y, 792, y + 24], radius=12, fill=(255, 255, 255, alpha))

font = None
for candidate in [
    r'C:\Windows\Fonts\seguisb.ttf',
    r'C:\Windows\Fonts\segoeuib.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
]:
    if os.path.exists(candidate):
        font = ImageFont.truetype(candidate, 400)
        break
if font is None:
    font = ImageFont.load_default()

bbox = draw.textbbox((0, 0), 'Lx', font=font)
width = bbox[2] - bbox[0]
height = bbox[3] - bbox[1]
draw.text(((size - width) / 2 - bbox[0], (size - height) / 2 - bbox[1] - 70), 'Lx', font=font, fill=(255, 255, 255, 255))

image.save(os.path.join(root, 'build', 'icon.png'))
image.resize((512, 512), Image.LANCZOS).save(os.path.join(root, 'resources', 'icon.png'))
image.resize((256, 256), Image.LANCZOS).save(
    os.path.join(root, 'build', 'icon.ico'),
    format='ICO',
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print('icons generated')
