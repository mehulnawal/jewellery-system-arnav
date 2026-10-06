const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function uploadChallanImage(file) {
  if (!cloudName || !uploadPreset)
    throw new Error("Image uploads are not configured. Please contact Admin.");
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset);

  const response = await fetch("https://api.cloudinary.com/v1_1/" + encodeURIComponent(cloudName) + "/image/upload", { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.secure_url || !result.public_id)
    throw new Error("The image could not be uploaded. Please try again.");

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    originalFilename: result.original_filename || file.name,
  };
}
