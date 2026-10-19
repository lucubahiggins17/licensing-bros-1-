"use client";
// Uploads for the admin control center.
// - Cover images go to the public `public-media` bucket and are stored as their public URL.
// - Lesson videos and attachments go to the private `course-media` bucket and are stored as "storage:<path>";
//   the `lesson` edge function turns those into short-lived signed links for students who have access.
import { supabase, accessToken } from "@/lib/supabaseClient";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

export const PUBLIC_BUCKET = "public-media";
export const PRIVATE_BUCKET = "course-media";

export function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Upload an image to the public bucket and return its public URL. */
export async function uploadPublicImage(file: File, folder: string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file (JPG, PNG or WebP).");
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is over 8 MB. Use a smaller image (under 2 MB loads fastest).");
  const path = `${folder.replace(/\/+$/, "")}/${stamp()}-${safeName(file.name)}`;
  const { error } = await supabase().storage.from(PUBLIC_BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error(uploadError(error.message));
  return supabase().storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

function uploadError(msg: string, status = 0): string {
  if (status === 413 || /maximum allowed size|too large|payload/i.test(msg)) {
    return "That file is bigger than your storage upload limit. Raise it in Supabase (Storage > Settings) or use a YouTube/Vimeo link instead.";
  }
  if (/bucket not found/i.test(msg)) return "The storage bucket is missing. Run the database setup script (supabase/schema.sql) again.";
  if (/row-level security|unauthorized|403/i.test(msg)) return "Only admins can upload files. Sign in with your admin account.";
  return msg || "The upload failed. Try again.";
}

export type UploadJob = { promise: Promise<string>; abort: () => void };

/**
 * Upload a file to the private course-media bucket with progress (0-100).
 * Resolves to "storage:<path>". `folder` is something like "lessons/<lesson id>".
 */
export function uploadPrivate(file: File, folder: string, onProgress: (pct: number) => void): UploadJob {
  const xhr = new XMLHttpRequest();
  let aborted = false;
  const path = `${folder.replace(/\/+$/, "")}/${stamp()}-${safeName(file.name)}`;
  const promise = (async () => {
    const token = await accessToken();
    if (!token) throw new Error("Your sign-in expired. Sign in again.");
    if (aborted) throw Object.assign(new Error("Upload cancelled."), { name: "AbortError" });
    const base = SUPABASE_URL;
    const url = `${base}/storage/v1/object/${PRIVATE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return await new Promise<string>((resolve, reject) => {
      xhr.open("POST", url);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.setRequestHeader("cache-control", "max-age=3600");
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(`storage:${path}`); return; }
        let msg = "";
        try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || ""; if (String(j.statusCode) === "413") return reject(new Error(uploadError(msg, 413))); } catch { /* not JSON */ }
        reject(new Error(uploadError(msg, xhr.status)));
      };
      xhr.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
      xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { name: "AbortError" }));
      xhr.send(file);
    });
  })();
  return { promise, abort: () => { aborted = true; try { xhr.abort(); } catch { /* not started */ } } };
}

/** "storage:lessons/abc/123-video.mp4" → "video.mp4"-ish display name */
export function storageFileName(ref: string): string {
  const p = ref.replace(/^storage:/, "");
  const last = p.split("/").pop() || p;
  return last.replace(/^[a-z0-9]{8,14}-/, "");
}

/** A temporary link (1 hour) so the admin can preview a private file. */
export async function signedUrl(ref: string): Promise<string | null> {
  if (!ref?.startsWith("storage:")) return ref || null;
  const { data, error } = await supabase().storage.from(PRIVATE_BUCKET).createSignedUrl(ref.slice(8), 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

export const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
