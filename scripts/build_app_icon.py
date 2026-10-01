from pathlib import Path

from PIL import IcoImagePlugin, Image, ImageFilter


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BRANDING_ROOT = PROJECT_ROOT / "assets" / "branding"
SOURCE = BRANDING_ROOT / "app-icon.png"
NORMALIZED = BRANDING_ROOT / "app-icon-1024.png"
ICO = BRANDING_ROOT / "app-icon.ico"
PREVIEW_ROOT = BRANDING_ROOT / "previews"
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    normalized = image.resize((1024, 1024), Image.Resampling.LANCZOS)
    normalized.save(NORMALIZED, optimize=True)

    normalized.save(
        ICO,
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        bitmap_format="png",
    )

    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    for size in ICO_SIZES:
        preview = normalized.resize((size, size), Image.Resampling.LANCZOS)
        if size <= 48:
            preview = preview.filter(
                ImageFilter.UnsharpMask(radius=0.6, percent=115, threshold=2)
            )
        preview.save(PREVIEW_ROOT / f"app-icon-{size}.png", optimize=True)

    with ICO.open("rb") as stream:
        embedded_sizes = sorted(IcoImagePlugin.IcoFile(stream).sizes())

    alpha_min, alpha_max = normalized.getextrema()[3]
    print(f"source_size={image.size}")
    print(f"normalized_size={normalized.size}")
    print(f"alpha_range=({alpha_min}, {alpha_max})")
    print(f"ico_sizes={embedded_sizes}")
    print(f"ico_bytes={ICO.stat().st_size}")


if __name__ == "__main__":
    main()
