from PIL import Image, ImageDraw

S = 1024  # supersample size, downscale later for crisp anti-aliasing

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def make_base():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    folder_back = (0x2f, 0x54, 0xc4, 255)   # darker blue, back panel
    folder_front = (0x5b, 0x8c, 0xff, 255)  # accent blue, front flap
    cloud_white = (0xff, 0xff, 0xff, 255)
    cloud_shadow = (0xd8, 0xe3, 0xff, 255)

    # --- Folder back tab (peeking above the front flap) ---
    rounded_rect(d, [96, 200, 460, 340], 60, folder_back)

    # --- Folder back body ---
    rounded_rect(d, [96, 260, 928, 860], 70, folder_back)

    # --- Folder front flap (overlaps back body, sits lower) ---
    rounded_rect(d, [64, 400, 960, 900], 80, folder_front)

    # --- Cloud sitting on/merging into the folder tab ---
    # base pill
    rounded_rect(d, [300, 300, 800, 500], 100, cloud_shadow)
    rounded_rect(d, [300, 300, 800, 490], 95, cloud_white)
    # puffs
    d.ellipse([260, 260, 480, 480], fill=cloud_white)
    d.ellipse([420, 200, 700, 480], fill=cloud_white)
    d.ellipse([620, 260, 840, 480], fill=cloud_white)
    # re-cover the seam so puffs blend smoothly with the base pill
    rounded_rect(d, [300, 360, 800, 500], 90, cloud_white)

    return img

base = make_base()

sizes = [16, 24, 32, 48, 64, 128, 256, 512]
pngs = {}
for s in sizes:
    pngs[s] = base.resize((s, s), Image.LANCZOS)

# Tray icon (Windows tray typically wants 32x32, with a 16x16 fallback)
pngs[32].save("/root/cloudmerge/build/tray-icon.png")
pngs[16].save("/root/cloudmerge/build/tray-icon-16.png")

# Full-res reference PNGs
pngs[512].save("/root/cloudmerge/build/icon-512.png")
pngs[256].save("/root/cloudmerge/build/icon-256.png")

# Multi-resolution Windows .ico for the app/installer icon
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
pngs[256].save("/root/cloudmerge/build/icon.ico", format="ICO", sizes=ico_sizes)

print("done")
