from pathlib import Path
import argparse
import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--scale", type=float, default=1.6)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.pdf)
    for index in range(len(document)):
        page = document[index]
        image = page.render(scale=args.scale).to_pil()
        image.save(output / f"page-{index + 1:02d}.png")
    print(len(document))


if __name__ == "__main__":
    main()
