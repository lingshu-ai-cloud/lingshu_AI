"""Local, non-paid product background removal. PNG bytes in and out."""
import sys
from rembg import new_session, remove


def main() -> None:
    source = sys.stdin.buffer.read(21 * 1024 * 1024)
    if not source or len(source) > 20 * 1024 * 1024:
        raise ValueError("product_cutout_source_size_invalid")
    output = remove(source, session=new_session("u2netp"))
    if not output or len(output) > 20 * 1024 * 1024:
        raise ValueError("product_cutout_output_size_invalid")
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    main()
