import { createHash } from "node:crypto"
import { logger } from "@/lib/logger"

// The raw Cloudinary signing/upload/destroy primitives. Product photos (media-service.ts) and
// taxonomy photos (taxonomy-service.ts's category/sub-category image) both go through this —
// one signed-upload implementation, not two copies that could quietly drift apart.

export class MediaError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "MediaError"
    }
}

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])

export function assertValidImage(file: File): void {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        throw new MediaError(`${file.type || "that file"} is not an image. Use JPEG, PNG, WebP or AVIF.`)
    }
    if (file.size > MEDIA_MAX_BYTES) {
        throw new MediaError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.`)
    }
}

function credentials() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET
    if (!cloudName || !apiKey || !apiSecret) {
        throw new MediaError(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
        )
    }
    return { cloudName, apiKey, apiSecret }
}

function sign(params: Record<string, string>, apiSecret: string): string {
    const canonical = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&")
    return createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex")
}

export interface CloudinaryUploadResult {
    secure_url: string
    public_id: string
    width?: number
    height?: number
}

// `overwrite: true` on a fixed public_id means "upload" and "replace the existing photo" are
// the same call — callers that only ever hold one photo per entity (categories, sub-categories)
// can pass a stable id-derived public_id and never have to track or clean up a previous asset.
export async function uploadImageToCloudinary(file: File, publicId: string): Promise<CloudinaryUploadResult> {
    const { cloudName, apiKey, apiSecret } = credentials()
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params = { public_id: publicId, timestamp, overwrite: "true", invalidate: "true" }

    const form = new FormData()
    form.append("file", file)
    for (const [key, value] of Object.entries(params)) form.append(key, value)
    form.append("api_key", apiKey)
    form.append("signature", sign(params, apiSecret))

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: form,
    })
    if (!response.ok) {
        // The response body names the cloud, the public id and sometimes the signature input —
        // it belongs in the log, not in a toast.
        logger.error({ status: response.status, publicId, body: await response.text() }, "cloudinary refused an upload")
        throw new MediaError(`Cloudinary refused the upload (${response.status}). Try again, and tell an administrator if it keeps happening.`)
    }
    return response.json() as Promise<CloudinaryUploadResult>
}

export async function destroyCloudinaryAsset(publicId: string): Promise<void> {
    const { cloudName, apiKey, apiSecret } = credentials()
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params = { public_id: publicId, timestamp, invalidate: "true" }

    const form = new FormData()
    for (const [key, value] of Object.entries(params)) form.append(key, value)
    form.append("api_key", apiKey)
    form.append("signature", sign(params, apiSecret))

    await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: "POST", body: form })
}
