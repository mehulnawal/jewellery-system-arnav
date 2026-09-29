const cloudName =
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "kn2591yp";
const uploadPreset =
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "granthaExports-preset";
const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

export async function uploadChallanImage(file) {
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset);

  const response = await fetch(uploadUrl, { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.secure_url || !result.public_id)
    throw new Error(result.error?.message || "Cloudinary rejected the image.");

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    originalFilename: result.original_filename || file.name,
    format: result.format || "",
    width: Number(result.width || 0),
    height: Number(result.height || 0),
    bytes: Number(result.bytes || 0),
  };
}
