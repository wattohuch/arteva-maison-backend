import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer
from qrcode.image.styles.colormasks import SolidFillColorMask
from PIL import Image

def generate_qr():
    url = "https://www.artevamaisonkw.com"
    logo_path = r"c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-frontend\assets\images\logo.png"
    output_path = r"c:\Users\moham\OneDrive\سطح المكتب\Git\arteva-maison-frontend\assets\images\qr_code_premium.png"

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=20,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        color_mask=SolidFillColorMask(front_color=(20, 20, 20), back_color=(255, 255, 255)),
        embeded_image_path=logo_path
    )
    
    img.save(output_path)
    print(f"QR code generated at {output_path}")

if __name__ == '__main__':
    generate_qr()
