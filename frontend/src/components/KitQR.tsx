import { QRCodeSVG } from "qrcode.react";

interface Props {
  kitId: string;
  size?: number;
}

export function KitQR({ kitId, size = 128 }: Props) {
  const baseURL = import.meta.env.VITE_APP_BASE_URL || window.location.origin;
  const url = `${baseURL}/kits/${kitId}`;
  return (
    <div className="inline-flex flex-col items-center gap-1" aria-label="QR code for this kit">
      <QRCodeSVG value={url} size={size} bgColor="transparent" fgColor="currentColor" />
    </div>
  );
}
